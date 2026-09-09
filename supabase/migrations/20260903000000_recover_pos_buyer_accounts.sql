-- Recovery migration: the buyer-account ordering path.
--
-- This is the largest single gap between this repository and production. The
-- live pos-order Edge Function tracks orders through pos_buyer_tracking_internal
-- and posts customer chat through pos_buyer_message_internal, attaching the
-- order to a signed-in buyer with pos_attach_buyer_to_order_internal. None of
-- those three functions, and neither of the two columns they depend on, had a
-- migration here -- so a database built from this repository could not serve the
-- public ordering path that is actually live.
--
-- The older pos_guest_tracking_internal / pos_guest_message_internal remain in
-- production alongside these and are left untouched; production simply stopped
-- routing to them.
--
-- Everything below is read from the live schema. Written idempotently: against
-- production every statement is a no-op; against an empty database it builds the
-- real thing.

-- ---------------------------------------------------------------------------
-- Columns the buyer model hangs off.
-- ---------------------------------------------------------------------------

-- Which signed-in buyer, if any, claimed this order. Null for a walk-in or a
-- guest who never signed in, which is why the tracking token stays the primary
-- credential.
alter table public.pos_orders
  add column if not exists buyer_user_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pos_orders_buyer_user_id_fkey') then
    alter table public.pos_orders add constraint pos_orders_buyer_user_id_fkey
      foreign key (buyer_user_id) references auth.users(id) on delete set null;
  end if;
end $$;

create index if not exists idx_pos_orders_buyer_user_id
  on public.pos_orders (buyer_user_id) where buyer_user_id is not null;

-- Who actually wrote a chat message. Staff messages carry the staff user;
-- customer messages carry the buyer account. Partial, because most rows on a
-- busy day are neither.
alter table public.pos_chat_messages
  add column if not exists sender_user_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pos_chat_messages_sender_user_id_fkey') then
    alter table public.pos_chat_messages add constraint pos_chat_messages_sender_user_id_fkey
      foreign key (sender_user_id) references auth.users(id) on delete set null;
  end if;
end $$;

create index if not exists pos_chat_sender_user_idx
  on public.pos_chat_messages (sender_user_id) where sender_user_id is not null;

-- ---------------------------------------------------------------------------
-- Staff may only reply on an order a buyer has actually claimed, as themselves.
--
-- This is a real tightening over the policy in 20260828132911: staff now have
-- to stamp their own auth.uid() on the message, and there must be a buyer on
-- the other end of the conversation. Without the buyer_user_id check, staff
-- could write into a thread nobody could ever read.
-- ---------------------------------------------------------------------------
drop policy if exists pos_chat_staff_insert on public.pos_chat_messages;
create policy pos_chat_staff_insert on public.pos_chat_messages
  for insert to authenticated
  with check (
    public.pos_is_member(merchant_id)
    and sender_type = 'staff'
    and sender_user_id = (select auth.uid())
    and exists (
      select 1 from public.pos_orders o
      where o.id = pos_chat_messages.order_id
        and o.merchant_id = pos_chat_messages.merchant_id
        and o.buyer_user_id is not null
        and o.status <> all (array['completed','cancelled'])
    )
  );

-- ---------------------------------------------------------------------------
-- The three buyer RPCs. service_role only: they are SECURITY DEFINER, they read
-- across every merchant, and the browser reaches them through pos-order.
-- ---------------------------------------------------------------------------

-- Claims an order for a buyer account. First claim wins; a second account
-- asking for the same order is refused rather than silently taking it over.
create or replace function public.pos_attach_buyer_to_order_internal(p_tracking_token uuid, p_buyer_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_order public.pos_orders%rowtype;
begin
  if p_buyer_user_id is null then raise exception 'Buyer account required'; end if;
  select * into v_order from public.pos_orders where tracking_token=p_tracking_token for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.buyer_user_id is null then
    update public.pos_orders set buyer_user_id=p_buyer_user_id,updated_at=now() where id=v_order.id;
  elsif v_order.buyer_user_id <> p_buyer_user_id then
    raise exception 'Order belongs to another buyer account' using errcode='42501';
  end if;
  return v_order.id;
end;
$$;

-- Tracking. Takes the buyer optionally, because someone holding only the link
-- still sees their order's progress -- they just do not see the chat. Messages
-- are returned only to the account the order belongs to, so a leaked link
-- exposes status and total but never the conversation.
create or replace function public.pos_buyer_tracking_internal(p_tracking_token uuid, p_buyer_user_id uuid default null::uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'order_number',o.order_number,
    'customer_name',o.customer_name,
    'fulfillment',o.fulfillment,
    'table_label',o.table_label,
    'status',o.status,
    'payment_status',o.payment_status,
    'total',o.total,
    'created_at',o.created_at,
    'updated_at',o.updated_at,
    'chat_available',(
      p_buyer_user_id is not null
      and (o.buyer_user_id is null or o.buyer_user_id=p_buyer_user_id)
      and o.status not in ('completed','cancelled')
    ),
    'chat_account_required',(p_buyer_user_id is null),
    'chat_account_mismatch',(
      p_buyer_user_id is not null and o.buyer_user_id is not null and o.buyer_user_id<>p_buyer_user_id
    ),
    'messages',case
      when p_buyer_user_id is not null and o.buyer_user_id=p_buyer_user_id then coalesce((
        select jsonb_agg(jsonb_build_object('sender_type',cm.sender_type,'message',cm.message,'created_at',cm.created_at) order by cm.created_at)
        from public.pos_chat_messages cm where cm.order_id=o.id
      ),'[]'::jsonb)
      else '[]'::jsonb
    end
  )
  from public.pos_orders o
  where o.tracking_token=p_tracking_token
  limit 1;
$$;

-- Customer chat. Claims the order on first message, so a buyer who signs in
-- after ordering can still start a conversation.
create or replace function public.pos_buyer_message_internal(p_tracking_token uuid, p_buyer_user_id uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order public.pos_orders%rowtype;
  v_id uuid;
begin
  if p_buyer_user_id is null then raise exception 'Buyer account required'; end if;
  if p_message is null or length(trim(p_message))=0 or length(trim(p_message))>1000 then raise exception 'Invalid message'; end if;

  select * into v_order from public.pos_orders where tracking_token=p_tracking_token for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status in ('completed','cancelled') then raise exception 'Chat closed'; end if;

  if v_order.buyer_user_id is null then
    update public.pos_orders set buyer_user_id=p_buyer_user_id,updated_at=now() where id=v_order.id;
  elsif v_order.buyer_user_id <> p_buyer_user_id then
    raise exception 'Order belongs to another buyer account' using errcode='42501';
  end if;

  insert into public.pos_chat_messages(order_id,merchant_id,sender_type,sender_user_id,message)
  values(v_order.id,v_order.merchant_id,'customer',p_buyer_user_id,trim(p_message))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.pos_attach_buyer_to_order_internal(uuid,uuid) from public, anon, authenticated;
revoke all on function public.pos_buyer_tracking_internal(uuid,uuid) from public, anon, authenticated;
revoke all on function public.pos_buyer_message_internal(uuid,uuid,text) from public, anon, authenticated;

grant execute on function public.pos_attach_buyer_to_order_internal(uuid,uuid) to service_role;
grant execute on function public.pos_buyer_tracking_internal(uuid,uuid) to service_role;
grant execute on function public.pos_buyer_message_internal(uuid,uuid,text) to service_role;

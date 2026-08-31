-- Order chat is transactional support, not a permanent inbox.
-- Close customer/staff messages immediately once an order is completed or cancelled.

create or replace function public.pos_guest_message_internal(p_tracking_token uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.pos_orders%rowtype;
  v_id uuid;
begin
  if p_message is null or length(trim(p_message))=0 or length(trim(p_message))>1000 then
    raise exception 'Invalid message';
  end if;

  select * into v_order
  from public.pos_orders
  where tracking_token=p_tracking_token;

  if not found then raise exception 'Order not found'; end if;
  if v_order.status in ('completed','cancelled') then raise exception 'Chat closed'; end if;

  insert into public.pos_chat_messages(order_id,merchant_id,sender_type,message)
  values(v_order.id,v_order.merchant_id,'customer',trim(p_message))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.pos_guest_message_internal(uuid,text) from public, anon, authenticated;
grant execute on function public.pos_guest_message_internal(uuid,text) to service_role;

create or replace function public.pos_enforce_open_order_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if new.sender_type in ('customer','staff') then
    select status into v_status
    from public.pos_orders
    where id=new.order_id and merchant_id=new.merchant_id;

    if v_status in ('completed','cancelled') then
      raise exception 'Chat closed';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.pos_enforce_open_order_chat() from public, anon, authenticated;

drop trigger if exists trg_pos_enforce_open_order_chat on public.pos_chat_messages;
create trigger trg_pos_enforce_open_order_chat
before insert on public.pos_chat_messages
for each row execute function public.pos_enforce_open_order_chat();

create or replace function public.pos_clock_in(p_merchant_id uuid,p_outlet_id uuid,p_verification_path text default null)
returns uuid
language plpgsql
security definer
set search_path=public,auth
as $$
declare v_id uuid;
begin
  if not public.pos_is_member(p_merchant_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  if not exists(select 1 from public.pos_outlets where id=p_outlet_id and merchant_id=p_merchant_id and active and archived_at is null) then raise exception 'Outlet unavailable'; end if;
  if exists(select 1 from public.pos_attendance where merchant_id=p_merchant_id and user_id=(select auth.uid()) and clock_out_at is null) then raise exception 'Already clocked in'; end if;
  insert into public.pos_attendance(merchant_id,user_id,outlet_id,verification_path)
  values(p_merchant_id,(select auth.uid()),p_outlet_id,nullif(trim(p_verification_path),'')) returning id into v_id;
  insert into public.pos_audit_events(merchant_id,actor_user_id,actor_type,action,entity_type,entity_id)
  values(p_merchant_id,(select auth.uid()),'user','attendance.clock_in','attendance',v_id);
  return v_id;
end;
$$;
revoke all on function public.pos_clock_in(uuid,uuid,text) from public;
grant execute on function public.pos_clock_in(uuid,uuid,text) to authenticated;

create or replace function public.pos_clock_out(p_merchant_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,auth
as $$
declare v_id uuid;
begin
  if not public.pos_is_member(p_merchant_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  select id into v_id from public.pos_attendance where merchant_id=p_merchant_id and user_id=(select auth.uid()) and clock_out_at is null order by clock_in_at desc limit 1 for update;
  if v_id is null then raise exception 'No open attendance session'; end if;
  update public.pos_attendance set clock_out_at=now() where id=v_id;
  insert into public.pos_audit_events(merchant_id,actor_user_id,actor_type,action,entity_type,entity_id)
  values(p_merchant_id,(select auth.uid()),'user','attendance.clock_out','attendance',v_id);
  return v_id;
end;
$$;
revoke all on function public.pos_clock_out(uuid) from public;
grant execute on function public.pos_clock_out(uuid) to authenticated;

create or replace function public.pos_open_cash_session(p_merchant_id uuid,p_outlet_id uuid,p_opening_float numeric default 0)
returns uuid
language plpgsql
security definer
set search_path=public,auth
as $$
declare v_id uuid;
begin
  if not public.pos_has_role(p_merchant_id,array['owner','manager','cashier']) then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_opening_float<0 then raise exception 'Opening float cannot be negative'; end if;
  if not exists(select 1 from public.pos_outlets where id=p_outlet_id and merchant_id=p_merchant_id and active and archived_at is null) then raise exception 'Outlet unavailable'; end if;
  insert into public.pos_cash_sessions(merchant_id,outlet_id,opened_by,opening_float)
  values(p_merchant_id,p_outlet_id,(select auth.uid()),p_opening_float) returning id into v_id;
  insert into public.pos_audit_events(merchant_id,actor_user_id,actor_type,action,entity_type,entity_id,metadata)
  values(p_merchant_id,(select auth.uid()),'user','cash_session.opened','cash_session',v_id,jsonb_build_object('opening_float',p_opening_float));
  return v_id;
end;
$$;
revoke all on function public.pos_open_cash_session(uuid,uuid,numeric) from public;
grant execute on function public.pos_open_cash_session(uuid,uuid,numeric) to authenticated;

create or replace function public.pos_close_cash_session(p_cash_session_id uuid,p_closing_count numeric)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare v_session public.pos_cash_sessions%rowtype; v_expected numeric(14,2); v_cash_sales numeric(14,2); v_movements numeric(14,2);
begin
  select * into v_session from public.pos_cash_sessions where id=p_cash_session_id for update;
  if not found then raise exception 'Cash session not found'; end if;
  if v_session.status<>'open' then raise exception 'Cash session already closed'; end if;
  if not public.pos_has_role(v_session.merchant_id,array['owner','manager','cashier']) then raise exception 'Not authorized' using errcode='42501'; end if;
  if v_session.opened_by<>(select auth.uid()) and not public.pos_has_role(v_session.merchant_id,array['owner','manager']) then raise exception 'Only a manager can close another cashier session'; end if;
  if p_closing_count<0 then raise exception 'Closing count cannot be negative'; end if;

  select coalesce(sum(p.amount),0) into v_cash_sales
  from public.pos_payments p join public.pos_orders o on o.id=p.order_id
  where p.merchant_id=v_session.merchant_id and o.outlet_id=v_session.outlet_id and p.method='cash' and p.status='verified'
    and p.verified_at>=v_session.opened_at and p.verified_at<=now();
  select coalesce(sum(case when movement_type='cash_in' then amount else -amount end),0) into v_movements
  from public.pos_cash_movements where cash_session_id=v_session.id;
  v_expected:=v_session.opening_float+v_cash_sales+v_movements;

  update public.pos_cash_sessions set status='closed',closed_by=(select auth.uid()),closing_count=p_closing_count,closed_at=now() where id=v_session.id;
  insert into public.pos_audit_events(merchant_id,actor_user_id,actor_type,action,entity_type,entity_id,metadata)
  values(v_session.merchant_id,(select auth.uid()),'user','cash_session.closed','cash_session',v_session.id,jsonb_build_object('expected',v_expected,'counted',p_closing_count,'variance',p_closing_count-v_expected));
  return jsonb_build_object('cash_session_id',v_session.id,'expected',v_expected,'counted',p_closing_count,'variance',p_closing_count-v_expected);
end;
$$;
revoke all on function public.pos_close_cash_session(uuid,numeric) from public;
grant execute on function public.pos_close_cash_session(uuid,numeric) to authenticated;

create or replace function public.pos_record_cash_movement(p_cash_session_id uuid,p_type text,p_amount numeric,p_note text default null)
returns uuid
language plpgsql
security definer
set search_path=public,auth
as $$
declare v_session public.pos_cash_sessions%rowtype; v_id uuid;
begin
  select * into v_session from public.pos_cash_sessions where id=p_cash_session_id and status='open';
  if not found then raise exception 'Open cash session not found'; end if;
  if not public.pos_has_role(v_session.merchant_id,array['owner','manager','cashier']) then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_type not in ('cash_in','cash_out','expense') or p_amount<=0 then raise exception 'Invalid cash movement'; end if;
  insert into public.pos_cash_movements(cash_session_id,merchant_id,movement_type,amount,note,created_by)
  values(v_session.id,v_session.merchant_id,p_type,p_amount,nullif(trim(p_note),''),(select auth.uid())) returning id into v_id;
  insert into public.pos_audit_events(merchant_id,actor_user_id,actor_type,action,entity_type,entity_id,metadata)
  values(v_session.merchant_id,(select auth.uid()),'user','cash.movement','cash_movement',v_id,jsonb_build_object('type',p_type,'amount',p_amount));
  return v_id;
end;
$$;
revoke all on function public.pos_record_cash_movement(uuid,text,numeric,text) from public;
grant execute on function public.pos_record_cash_movement(uuid,text,numeric,text) to authenticated;

create or replace function public.pos_cancel_unpaid_order(p_order_id uuid,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare v_order public.pos_orders%rowtype;
begin
  if p_reason is null or length(trim(p_reason))<3 or length(trim(p_reason))>500 then raise exception 'Cancellation reason required'; end if;
  select * into v_order from public.pos_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not public.pos_has_role(v_order.merchant_id,array['owner','manager','cashier']) then raise exception 'Not authorized' using errcode='42501'; end if;
  if v_order.payment_status='paid' or v_order.status not in ('parked','awaiting_payment','payment_review') then raise exception 'Paid or active kitchen orders require the refund/void workflow'; end if;
  update public.pos_orders set status='cancelled',payment_status='void',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now(),version=version+1 where id=v_order.id;
  update public.pos_payments set status='void',updated_at=now() where order_id=v_order.id and status='pending';
  insert into public.pos_audit_events(merchant_id,actor_user_id,actor_type,action,entity_type,entity_id,metadata)
  values(v_order.merchant_id,(select auth.uid()),'user','order.cancelled','order',v_order.id,jsonb_build_object('reason',trim(p_reason)));
  return jsonb_build_object('order_id',v_order.id,'status','cancelled');
end;
$$;
revoke all on function public.pos_cancel_unpaid_order(uuid,text) from public;
grant execute on function public.pos_cancel_unpaid_order(uuid,text) to authenticated;

-- Realtime only for operational tables needed by the live order queue/chat. Ignore if already added.
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='pos_orders') then
    alter publication supabase_realtime add table public.pos_orders;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='pos_chat_messages') then
    alter publication supabase_realtime add table public.pos_chat_messages;
  end if;
end $$;

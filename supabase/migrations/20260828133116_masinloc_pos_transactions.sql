-- Secure transactional RPCs and safe storefront reads for Masinloc POS.

alter table public.pos_products
  add constraint pos_products_tracked_stock_nonnegative
  check (not track_inventory or stock_on_hand >= 0) not valid;
alter table public.pos_products validate constraint pos_products_tracked_stock_nonnegative;

create unique index if not exists pos_inventory_one_sale_per_order_product
  on public.pos_inventory_movements(order_id, product_id, reason)
  where order_id is not null and reason = 'sale';
create unique index if not exists pos_loyalty_one_earn_per_order
  on public.pos_loyalty_transactions(order_id, reason)
  where order_id is not null and reason = 'earn';

-- Safe public storefront metadata. No private merchant/member/customer fields.
create or replace function public.pos_public_storefront(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'merchant_id', m.id,
    'name', m.name,
    'slug', m.slug,
    'currency', m.currency,
    'outlet', jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'dine_in_enabled', o.dine_in_enabled,
      'pickup_enabled', o.pickup_enabled,
      'delivery_enabled', o.delivery_enabled,
      'delivery_fee', o.delivery_fee,
      'minimum_delivery_order', o.minimum_delivery_order
    ),
    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pm.id,
        'method', pm.method,
        'label', pm.label,
        'requires_manual_verification', pm.requires_manual_verification,
        'instructions', pm.instructions
      ) order by pm.sort_order, pm.label)
      from public.pos_payment_methods pm
      where pm.merchant_id = m.id and pm.outlet_id = o.id and pm.enabled
    ), '[]'::jsonb)
  )
  from public.pos_merchants m
  join lateral (
    select po.* from public.pos_outlets po
    where po.merchant_id = m.id and po.active and po.archived_at is null and po.ordering_enabled
    order by po.created_at asc limit 1
  ) o on true
  where m.slug = lower(trim(p_slug))
    and m.status = 'active'
    and m.eligibility_status = 'verified'
  limit 1;
$$;

create or replace function public.pos_public_menu(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select m.id as merchant_id
    from public.pos_merchants m
    where m.slug = lower(trim(p_slug)) and m.status = 'active' and m.eligibility_status = 'verified'
    limit 1
  ), cats as (
    select c.id, c.name, c.sort_order
    from public.pos_categories c join target t on t.merchant_id = c.merchant_id
    where c.active and c.archived_at is null
  ), products as (
    select p.*
    from public.pos_products p join target t on t.merchant_id = p.merchant_id
    where p.active and p.archived_at is null
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'products', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'description', p.description,
          'price', p.price,
          'image_path', p.image_path,
          'available', (not p.track_inventory or p.stock_on_hand > 0),
          'modifiers', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', g.id,
              'name', g.name,
              'min_select', g.min_select,
              'max_select', g.max_select,
              'required', g.required,
              'options', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id', mo.id,
                  'name', mo.name,
                  'price_delta', mo.price_delta
                ) order by mo.sort_order, mo.name)
                from public.pos_modifier_options mo
                where mo.group_id = g.id and mo.active and mo.archived_at is null
              ), '[]'::jsonb)
            ) order by g.sort_order, g.name)
            from public.pos_modifier_groups g
            where g.product_id = p.id and g.active and g.archived_at is null
          ), '[]'::jsonb)
        ) order by p.sort_order, p.name)
        from products p where p.category_id = c.id
      ), '[]'::jsonb)
    ) order by c.sort_order, c.name
  ), '[]'::jsonb)
  from cats c;
$$;

revoke all on function public.pos_public_storefront(text) from public;
revoke all on function public.pos_public_menu(text) from public;
grant execute on function public.pos_public_storefront(text) to anon, authenticated;
grant execute on function public.pos_public_menu(text) to anon, authenticated;

-- Current authenticated user's merchant contexts, for app bootstrapping.
create or replace function public.pos_my_contexts()
returns table (
  merchant_id uuid,
  merchant_name text,
  merchant_slug text,
  merchant_status text,
  eligibility_status text,
  plan_code text,
  role text,
  outlet_id uuid,
  outlet_name text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select m.id, m.name, m.slug, m.status, m.eligibility_status, m.plan_code, pm.role,
         o.id, o.name
  from public.pos_memberships pm
  join public.pos_merchants m on m.id = pm.merchant_id
  left join lateral (
    select po.id, po.name from public.pos_outlets po
    where po.merchant_id = m.id and po.archived_at is null
    order by po.created_at asc limit 1
  ) o on true
  where pm.user_id = (select auth.uid()) and pm.status = 'active'
  order by m.created_at;
$$;
revoke all on function public.pos_my_contexts() from public;
grant execute on function public.pos_my_contexts() to authenticated;

-- Dashboard uses only real persisted transactions.
create or replace function public.pos_dashboard(p_merchant_id uuid, p_outlet_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare v_result jsonb;
begin
  if not public.pos_is_member(p_merchant_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  select jsonb_build_object(
    'sales_today', coalesce(sum(o.total) filter (where o.status = 'completed' and o.created_at >= date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'), 0),
    'orders_today', count(*) filter (where o.created_at >= date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'),
    'payment_review', count(*) filter (where o.status = 'payment_review'),
    'active_orders', count(*) filter (where o.status in ('paid','preparing','ready','out_for_delivery')),
    'low_stock', (select count(*) from public.pos_products p where p.merchant_id = p_merchant_id and p.archived_at is null and p.active and p.track_inventory and p.stock_on_hand <= p.low_stock_threshold)
  ) into v_result
  from public.pos_orders o
  where o.merchant_id = p_merchant_id and (p_outlet_id is null or o.outlet_id = p_outlet_id);
  return v_result;
end;
$$;
revoke all on function public.pos_dashboard(uuid, uuid) from public;
grant execute on function public.pos_dashboard(uuid, uuid) to authenticated;

-- Staff POS creates an order atomically from server-authoritative prices.
create or replace function public.pos_create_staff_order(
  p_merchant_id uuid,
  p_outlet_id uuid,
  p_fulfillment text,
  p_customer_name text,
  p_items jsonb,
  p_payment_method text default 'cash',
  p_table_label text default null,
  p_customer_phone text default null,
  p_notes text default null,
  p_park boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_limits public.pos_plan_limits%rowtype;
  v_order public.pos_orders%rowtype;
  v_outlet public.pos_outlets%rowtype;
  v_item jsonb;
  v_product public.pos_products%rowtype;
  v_qty integer;
  v_note text;
  v_modifier_ids uuid[];
  v_modifier_sum numeric(12,2);
  v_order_item_id uuid;
  v_subtotal numeric(14,2) := 0;
  v_delivery_fee numeric(14,2) := 0;
  v_total_qty integer := 0;
  v_customer_id uuid;
  v_existing public.pos_orders%rowtype;
begin
  if not public.pos_has_role(p_merchant_id, array['owner','manager','cashier']) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if p_customer_name is null or length(trim(p_customer_name)) = 0 then raise exception 'Customer name is required'; end if;
  if p_fulfillment not in ('dine_in','pickup','delivery') then raise exception 'Invalid fulfillment'; end if;
  if p_payment_method not in ('cash','gcash','maya','qrph','card','room_charge') then raise exception 'Invalid payment method'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Order must contain items'; end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.pos_orders where merchant_id=p_merchant_id and idempotency_key=p_idempotency_key limit 1;
    if found then return jsonb_build_object('order_id',v_existing.id,'order_number',v_existing.order_number,'total',v_existing.total,'status',v_existing.status,'existing',true); end if;
  end if;

  select o.* into v_outlet from public.pos_outlets o
  where o.id=p_outlet_id and o.merchant_id=p_merchant_id and o.active and o.archived_at is null;
  if not found then raise exception 'Outlet unavailable'; end if;
  if p_fulfillment='dine_in' and not v_outlet.dine_in_enabled then raise exception 'Dine in is disabled'; end if;
  if p_fulfillment='pickup' and not v_outlet.pickup_enabled then raise exception 'Pickup is disabled'; end if;
  if p_fulfillment='delivery' and not v_outlet.delivery_enabled then raise exception 'Delivery is disabled'; end if;

  select l.* into v_limits from public.pos_merchants m join public.pos_plan_limits l on l.plan_code=m.plan_code where m.id=p_merchant_id;
  if jsonb_array_length(p_items) > v_limits.max_order_lines then raise exception 'Too many order lines'; end if;

  if p_customer_phone is not null and length(trim(p_customer_phone)) > 0 then
    insert into public.pos_customers(merchant_id, display_name, phone)
    values (p_merchant_id, trim(p_customer_name), trim(p_customer_phone))
    on conflict (merchant_id, phone) where phone is not null
    do update set display_name=excluded.display_name, updated_at=now()
    returning id into v_customer_id;
  end if;

  insert into public.pos_orders(
    merchant_id,outlet_id,customer_id,source,fulfillment,customer_name,customer_phone,table_label,notes,status,payment_status,idempotency_key,created_by
  ) values (
    p_merchant_id,p_outlet_id,v_customer_id,'pos',p_fulfillment,trim(p_customer_name),nullif(trim(p_customer_phone),''),nullif(trim(p_table_label),''),nullif(trim(p_notes),''),
    case when p_park then 'parked' else 'awaiting_payment' end,'unpaid',p_idempotency_key,(select auth.uid())
  ) returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    begin v_qty := (v_item->>'quantity')::integer; exception when others then raise exception 'Invalid quantity'; end;
    if v_qty < 1 or v_qty > 99 then raise exception 'Invalid quantity'; end if;
    v_total_qty := v_total_qty + v_qty;
    if v_total_qty > v_limits.max_order_quantity then raise exception 'Order quantity limit exceeded'; end if;
    v_note := nullif(trim(v_item->>'note'),'');
    if v_note is not null and length(v_note)>500 then raise exception 'Item note too long'; end if;

    select p.* into v_product from public.pos_products p
    where p.id=(v_item->>'product_id')::uuid and p.merchant_id=p_merchant_id and p.active and p.archived_at is null;
    if not found then raise exception 'Product unavailable'; end if;
    if v_product.track_inventory and v_product.stock_on_hand < v_qty then raise exception 'Insufficient stock for %', v_product.name; end if;

    select coalesce(array_agg(x::uuid), array[]::uuid[]) into v_modifier_ids
    from jsonb_array_elements_text(coalesce(v_item->'modifier_option_ids','[]'::jsonb)) x;

    if exists (
      select 1 from unnest(v_modifier_ids) x(id)
      left join public.pos_modifier_options mo on mo.id=x.id and mo.merchant_id=p_merchant_id and mo.active and mo.archived_at is null
      left join public.pos_modifier_groups mg on mg.id=mo.group_id and mg.product_id=v_product.id and mg.active and mg.archived_at is null
      where mo.id is null or mg.id is null
    ) then raise exception 'Invalid modifier selection'; end if;

    if exists (
      select 1
      from public.pos_modifier_groups mg
      where mg.product_id=v_product.id and mg.active and mg.archived_at is null
      and (
        (select count(*) from public.pos_modifier_options mo where mo.group_id=mg.id and mo.id=any(v_modifier_ids) and mo.active and mo.archived_at is null) < mg.min_select
        or
        (select count(*) from public.pos_modifier_options mo where mo.group_id=mg.id and mo.id=any(v_modifier_ids) and mo.active and mo.archived_at is null) > mg.max_select
      )
    ) then raise exception 'Modifier requirements not satisfied for %', v_product.name; end if;

    select coalesce(sum(price_delta),0) into v_modifier_sum
    from public.pos_modifier_options where id=any(v_modifier_ids) and merchant_id=p_merchant_id;

    insert into public.pos_order_items(order_id,merchant_id,product_id,product_name,quantity,unit_price,modifier_total,note)
    values(v_order.id,p_merchant_id,v_product.id,v_product.name,v_qty,v_product.price,v_modifier_sum,v_note)
    returning id into v_order_item_id;

    insert into public.pos_order_item_modifiers(order_item_id,merchant_id,modifier_option_id,modifier_name,price_delta)
    select v_order_item_id,p_merchant_id,mo.id,mo.name,mo.price_delta
    from public.pos_modifier_options mo where mo.id=any(v_modifier_ids) and mo.merchant_id=p_merchant_id;

    v_subtotal := v_subtotal + round(v_qty*(v_product.price+v_modifier_sum),2);
  end loop;

  if p_fulfillment='delivery' then
    v_delivery_fee := v_outlet.delivery_fee;
    if v_subtotal < v_outlet.minimum_delivery_order then raise exception 'Minimum delivery order is %', v_outlet.minimum_delivery_order; end if;
  end if;

  update public.pos_orders set subtotal=v_subtotal,delivery_fee=v_delivery_fee,total=v_subtotal+v_delivery_fee,updated_at=now()
  where id=v_order.id returning * into v_order;

  if not p_park then
    insert into public.pos_payments(order_id,merchant_id,method,amount,status)
    values(v_order.id,p_merchant_id,p_payment_method,v_order.total,'pending');
  end if;

  insert into public.pos_audit_events(merchant_id,actor_user_id,actor_type,action,entity_type,entity_id,metadata)
  values(p_merchant_id,(select auth.uid()),'user','order.created','order',v_order.id,jsonb_build_object('source','pos','total',v_order.total,'parked',p_park));

  return jsonb_build_object('order_id',v_order.id,'order_number',v_order.order_number,'total',v_order.total,'status',v_order.status,'existing',false);
end;
$$;
revoke all on function public.pos_create_staff_order(uuid,uuid,text,text,jsonb,text,text,text,text,boolean,text) from public;
grant execute on function public.pos_create_staff_order(uuid,uuid,text,text,jsonb,text,text,text,text,boolean,text) to authenticated;

create or replace function public.pos_confirm_payment(p_order_id uuid, p_reference_number text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_order public.pos_orders%rowtype; v_payment public.pos_payments%rowtype;
begin
  select * into v_order from public.pos_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not public.pos_has_role(v_order.merchant_id, array['owner','manager','cashier']) then raise exception 'Not authorized' using errcode='42501'; end if;
  if v_order.status not in ('awaiting_payment','payment_review') or v_order.payment_status='paid' then raise exception 'Order is not awaiting payment'; end if;

  select * into v_payment from public.pos_payments where order_id=v_order.id and status='pending' order by created_at desc limit 1 for update;
  if not found then raise exception 'Pending payment not found'; end if;
  if v_payment.amount <> v_order.total then raise exception 'Payment amount mismatch'; end if;

  update public.pos_payments set status='verified',reference_number=coalesce(nullif(trim(p_reference_number),''),reference_number),verified_by=(select auth.uid()),verified_at=now(),updated_at=now() where id=v_payment.id;
  update public.pos_orders set payment_status='paid',status='paid',updated_at=now() where id=v_order.id returning * into v_order;

  insert into public.pos_inventory_movements(merchant_id,product_id,order_id,delta,reason,created_by)
  select v_order.merchant_id, oi.product_id, v_order.id, -sum(oi.quantity)::numeric, 'sale', (select auth.uid())
  from public.pos_order_items oi
  join public.pos_products p on p.id=oi.product_id and p.merchant_id=oi.merchant_id
  where oi.order_id=v_order.id and oi.product_id is not null and p.track_inventory
  group by oi.product_id
  on conflict (order_id, product_id, reason) where order_id is not null and reason='sale' do nothing;

  insert into public.pos_audit_events(merchant_id,actor_user_id,actor_type,action,entity_type,entity_id,metadata)
  values(v_order.merchant_id,(select auth.uid()),'user','payment.verified','order',v_order.id,jsonb_build_object('method',v_payment.method,'amount',v_payment.amount));

  return jsonb_build_object('order_id',v_order.id,'status',v_order.status,'payment_status',v_order.payment_status);
end;
$$;
revoke all on function public.pos_confirm_payment(uuid,text) from public;
grant execute on function public.pos_confirm_payment(uuid,text) to authenticated;

create or replace function public.pos_advance_order(p_order_id uuid, p_target_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_order public.pos_orders%rowtype; v_allowed boolean := false; v_points integer;
begin
  select * into v_order from public.pos_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not public.pos_has_role(v_order.merchant_id, array['owner','manager','cashier','kitchen']) then raise exception 'Not authorized' using errcode='42501'; end if;

  v_allowed :=
    (v_order.status='paid' and p_target_status='preparing') or
    (v_order.status='preparing' and p_target_status='ready') or
    (v_order.status='ready' and v_order.fulfillment='delivery' and p_target_status='out_for_delivery') or
    (v_order.status='ready' and v_order.fulfillment<>'delivery' and p_target_status='completed') or
    (v_order.status='out_for_delivery' and p_target_status='completed');
  if not v_allowed then raise exception 'Invalid status transition from % to %',v_order.status,p_target_status; end if;

  update public.pos_orders
  set status=p_target_status,
      kitchen_sent_at=case when p_target_status='preparing' and kitchen_sent_at is null then now() else kitchen_sent_at end,
      completed_at=case when p_target_status='completed' then now() else completed_at end,
      updated_at=now(),version=version+1
  where id=v_order.id returning * into v_order;

  if p_target_status='completed' and v_order.customer_id is not null then
    update public.pos_customers set visit_count=visit_count+1,lifetime_spend=lifetime_spend+v_order.total,updated_at=now() where id=v_order.customer_id and merchant_id=v_order.merchant_id;
    if exists(select 1 from public.pos_customers where id=v_order.customer_id and merchant_id=v_order.merchant_id and loyalty_opt_in) then
      v_points := floor(v_order.total/10)::integer;
      if v_points > 0 then
        insert into public.pos_loyalty_transactions(merchant_id,customer_id,order_id,points_delta,reason,created_by)
        values(v_order.merchant_id,v_order.customer_id,v_order.id,v_points,'earn',(select auth.uid()))
        on conflict (order_id, reason) where order_id is not null and reason='earn' do nothing;
        if found then update public.pos_customers set points_balance=points_balance+v_points,updated_at=now() where id=v_order.customer_id and merchant_id=v_order.merchant_id; end if;
      end if;
    end if;
  end if;

  insert into public.pos_audit_events(merchant_id,actor_user_id,actor_type,action,entity_type,entity_id,metadata)
  values(v_order.merchant_id,(select auth.uid()),'user','order.status_changed','order',v_order.id,jsonb_build_object('status',p_target_status));
  return jsonb_build_object('order_id',v_order.id,'status',v_order.status);
end;
$$;
revoke all on function public.pos_advance_order(uuid,text) from public;
grant execute on function public.pos_advance_order(uuid,text) to authenticated;

create or replace function public.pos_record_inventory_movement(p_product_id uuid, p_delta numeric, p_reason text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_product public.pos_products%rowtype; v_id uuid;
begin
  select * into v_product from public.pos_products where id=p_product_id and archived_at is null;
  if not found then raise exception 'Product not found'; end if;
  if not public.pos_has_role(v_product.merchant_id,array['owner','manager']) then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_reason not in ('restock','adjustment','waste') then raise exception 'Invalid inventory reason'; end if;
  if p_delta=0 then raise exception 'Delta cannot be zero'; end if;
  insert into public.pos_inventory_movements(merchant_id,product_id,delta,reason,note,created_by)
  values(v_product.merchant_id,v_product.id,p_delta,p_reason,nullif(trim(p_note),''),(select auth.uid())) returning id into v_id;
  insert into public.pos_audit_events(merchant_id,actor_user_id,actor_type,action,entity_type,entity_id,metadata)
  values(v_product.merchant_id,(select auth.uid()),'user','inventory.movement','product',v_product.id,jsonb_build_object('delta',p_delta,'reason',p_reason));
  return v_id;
end;
$$;
revoke all on function public.pos_record_inventory_movement(uuid,numeric,text,text) from public;
grant execute on function public.pos_record_inventory_movement(uuid,numeric,text,text) to authenticated;

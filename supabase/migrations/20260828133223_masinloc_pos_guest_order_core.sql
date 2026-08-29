create or replace function public.pos_create_guest_order_internal(
  p_slug text,
  p_source text,
  p_fulfillment text,
  p_customer_name text,
  p_items jsonb,
  p_payment_method text,
  p_table_label text default null,
  p_customer_phone text default null,
  p_delivery_address text default null,
  p_delivery_landmark text default null,
  p_payment_reference text default null,
  p_loyalty_opt_in boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant public.pos_merchants%rowtype;
  v_outlet public.pos_outlets%rowtype;
  v_limits public.pos_plan_limits%rowtype;
  v_payment_method public.pos_payment_methods%rowtype;
  v_order public.pos_orders%rowtype;
  v_existing public.pos_orders%rowtype;
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
begin
  select * into v_merchant from public.pos_merchants
  where slug=lower(trim(p_slug)) and status='active' and eligibility_status='verified';
  if not found then raise exception 'Store unavailable'; end if;

  if p_source not in ('qr','marketplace') then raise exception 'Invalid order source'; end if;
  if p_customer_name is null or length(trim(p_customer_name))=0 then raise exception 'Customer name is required'; end if;
  if length(trim(p_customer_name)) > 120 then raise exception 'Customer name too long'; end if;
  if p_fulfillment not in ('dine_in','pickup','delivery') then raise exception 'Invalid fulfillment'; end if;
  if p_payment_method not in ('cash','gcash','maya','qrph','card','room_charge') then raise exception 'Invalid payment method'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'Order must contain items'; end if;

  select * into v_outlet from public.pos_outlets
  where merchant_id=v_merchant.id and active and archived_at is null and ordering_enabled
  order by created_at asc limit 1;
  if not found then raise exception 'Store ordering unavailable'; end if;
  if p_fulfillment='dine_in' and not v_outlet.dine_in_enabled then raise exception 'Dine in is disabled'; end if;
  if p_fulfillment='pickup' and not v_outlet.pickup_enabled then raise exception 'Pickup is disabled'; end if;
  if p_fulfillment='delivery' and not v_outlet.delivery_enabled then raise exception 'Delivery is disabled'; end if;
  if p_fulfillment='delivery' and (p_customer_phone is null or length(trim(p_customer_phone))=0) then raise exception 'Mobile number is required for delivery'; end if;
  if p_fulfillment='delivery' and (p_delivery_address is null or length(trim(p_delivery_address))=0) then raise exception 'Delivery address is required'; end if;
  if p_delivery_address is not null and length(p_delivery_address)>500 then raise exception 'Delivery address too long'; end if;
  if p_delivery_landmark is not null and length(p_delivery_landmark)>300 then raise exception 'Landmark too long'; end if;

  select * into v_payment_method from public.pos_payment_methods
  where merchant_id=v_merchant.id and outlet_id=v_outlet.id and method=p_payment_method and enabled;
  if not found then raise exception 'Payment method unavailable'; end if;

  select * into v_limits from public.pos_plan_limits where plan_code=v_merchant.plan_code;
  if jsonb_array_length(p_items)>v_limits.max_order_lines then raise exception 'Too many order lines'; end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.pos_orders where merchant_id=v_merchant.id and idempotency_key=p_idempotency_key limit 1;
    if found then return jsonb_build_object('order_id',v_existing.id,'order_number',v_existing.order_number,'tracking_token',v_existing.tracking_token,'total',v_existing.total,'status',v_existing.status,'payment_status',v_existing.payment_status,'existing',true); end if;
  end if;

  if p_customer_phone is not null and length(trim(p_customer_phone))>0 then
    insert into public.pos_customers(merchant_id,display_name,phone,loyalty_opt_in)
    values(v_merchant.id,trim(p_customer_name),trim(p_customer_phone),p_loyalty_opt_in)
    on conflict (merchant_id,phone) where phone is not null
    do update set display_name=excluded.display_name,loyalty_opt_in=(public.pos_customers.loyalty_opt_in or excluded.loyalty_opt_in),updated_at=now()
    returning id into v_customer_id;
  end if;

  insert into public.pos_orders(
    merchant_id,outlet_id,customer_id,source,fulfillment,customer_name,customer_phone,table_label,
    delivery_address,delivery_landmark,status,payment_status,idempotency_key
  ) values (
    v_merchant.id,v_outlet.id,v_customer_id,p_source,p_fulfillment,trim(p_customer_name),nullif(trim(p_customer_phone),''),nullif(trim(p_table_label),''),
    nullif(trim(p_delivery_address),''),nullif(trim(p_delivery_landmark),''),
    case when p_payment_method='cash' then 'awaiting_payment' else 'payment_review' end,
    case when p_payment_method='cash' then 'unpaid' else 'pending_verification' end,
    p_idempotency_key
  ) returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    begin v_qty := (v_item->>'quantity')::integer; exception when others then raise exception 'Invalid quantity'; end;
    if v_qty<1 or v_qty>99 then raise exception 'Invalid quantity'; end if;
    v_total_qty:=v_total_qty+v_qty;
    if v_total_qty>v_limits.max_order_quantity then raise exception 'Order quantity limit exceeded'; end if;
    v_note:=nullif(trim(v_item->>'note'),'');
    if v_note is not null and length(v_note)>500 then raise exception 'Item note too long'; end if;

    select * into v_product from public.pos_products
    where id=(v_item->>'product_id')::uuid and merchant_id=v_merchant.id and active and archived_at is null;
    if not found then raise exception 'Product unavailable'; end if;
    if v_product.track_inventory and v_product.stock_on_hand<v_qty then raise exception 'Product is out of stock'; end if;

    select coalesce(array_agg(x::uuid),array[]::uuid[]) into v_modifier_ids
    from jsonb_array_elements_text(coalesce(v_item->'modifier_option_ids','[]'::jsonb)) x;

    if exists(
      select 1 from unnest(v_modifier_ids) x(id)
      left join public.pos_modifier_options mo on mo.id=x.id and mo.merchant_id=v_merchant.id and mo.active and mo.archived_at is null
      left join public.pos_modifier_groups mg on mg.id=mo.group_id and mg.product_id=v_product.id and mg.active and mg.archived_at is null
      where mo.id is null or mg.id is null
    ) then raise exception 'Invalid modifier selection'; end if;

    if exists(
      select 1 from public.pos_modifier_groups mg
      where mg.product_id=v_product.id and mg.active and mg.archived_at is null
      and (
        (select count(*) from public.pos_modifier_options mo where mo.group_id=mg.id and mo.id=any(v_modifier_ids) and mo.active and mo.archived_at is null)<mg.min_select
        or
        (select count(*) from public.pos_modifier_options mo where mo.group_id=mg.id and mo.id=any(v_modifier_ids) and mo.active and mo.archived_at is null)>mg.max_select
      )
    ) then raise exception 'Modifier requirements not satisfied'; end if;

    select coalesce(sum(price_delta),0) into v_modifier_sum from public.pos_modifier_options
    where id=any(v_modifier_ids) and merchant_id=v_merchant.id;

    insert into public.pos_order_items(order_id,merchant_id,product_id,product_name,quantity,unit_price,modifier_total,note)
    values(v_order.id,v_merchant.id,v_product.id,v_product.name,v_qty,v_product.price,v_modifier_sum,v_note)
    returning id into v_order_item_id;

    insert into public.pos_order_item_modifiers(order_item_id,merchant_id,modifier_option_id,modifier_name,price_delta)
    select v_order_item_id,v_merchant.id,mo.id,mo.name,mo.price_delta
    from public.pos_modifier_options mo where mo.id=any(v_modifier_ids) and mo.merchant_id=v_merchant.id;

    v_subtotal:=v_subtotal+round(v_qty*(v_product.price+v_modifier_sum),2);
  end loop;

  if p_fulfillment='delivery' then
    v_delivery_fee:=v_outlet.delivery_fee;
    if v_subtotal<v_outlet.minimum_delivery_order then raise exception 'Minimum delivery order not met'; end if;
  end if;

  update public.pos_orders set subtotal=v_subtotal,delivery_fee=v_delivery_fee,total=v_subtotal+v_delivery_fee,updated_at=now()
  where id=v_order.id returning * into v_order;

  insert into public.pos_payments(order_id,merchant_id,method,amount,status,reference_number)
  values(v_order.id,v_merchant.id,p_payment_method,v_order.total,'pending',nullif(trim(p_payment_reference),''));

  insert into public.pos_audit_events(merchant_id,actor_type,action,entity_type,entity_id,metadata)
  values(v_merchant.id,'customer','order.created','order',v_order.id,jsonb_build_object('source',p_source,'fulfillment',p_fulfillment,'total',v_order.total));

  return jsonb_build_object('order_id',v_order.id,'order_number',v_order.order_number,'tracking_token',v_order.tracking_token,'total',v_order.total,'status',v_order.status,'payment_status',v_order.payment_status,'existing',false);
end;
$$;

revoke all on function public.pos_create_guest_order_internal(text,text,text,text,jsonb,text,text,text,text,text,text,boolean,text) from public;
grant execute on function public.pos_create_guest_order_internal(text,text,text,text,jsonb,text,text,text,text,text,text,boolean,text) to service_role;

-- Safe tracking payload is token-gated and only exposed through service role / Edge Function.
create or replace function public.pos_guest_tracking_internal(p_tracking_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
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
    'messages',coalesce((select jsonb_agg(jsonb_build_object('sender_type',cm.sender_type,'message',cm.message,'created_at',cm.created_at) order by cm.created_at) from public.pos_chat_messages cm where cm.order_id=o.id),'[]'::jsonb)
  )
  from public.pos_orders o
  where o.tracking_token=p_tracking_token
  limit 1;
$$;
revoke all on function public.pos_guest_tracking_internal(uuid) from public;
grant execute on function public.pos_guest_tracking_internal(uuid) to service_role;

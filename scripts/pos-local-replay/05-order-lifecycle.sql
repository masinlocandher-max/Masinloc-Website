-- End-to-end order lifecycle, executed for real against the replayed schema.
--
-- Every step runs as the role that step runs as in production: the merchant's
-- owner as `authenticated` carrying their JWT claims, the storefront as
-- `service_role` (which is how the Edge Function reaches the guest RPCs), and
-- nothing as a superuser except reading fixtures and asserting results. RLS and
-- the gate functions are live throughout, so this proves the flow works
-- *through* the policies rather than around them.
--
-- Ten steps, matching the product lifecycle:
--   1  merchant is active and verified
--   2  merchant creates a product
--   3  merchant stocks it through an inventory movement
--   4  the product appears in the public catalog
--   5  a customer places an order from the storefront
--   6  a payment record is created, pending, for the order total
--   7  the merchant verifies the payment
--   8  the order reaches the kitchen queue and is accepted
--   9  the order is completed
--  10  inventory and the sales report both reflect it
--
-- Identifiers are captured as psql variables while still superuser and passed
-- into the restricted steps, so no step has to read a fixture table under a
-- role that should not be able to. Any failed assertion raises, and
-- ON_ERROR_STOP makes the harness exit non-zero.

\set ON_ERROR_STOP 1

select v as ua from public.qa_ids where k = 'user_a' \gset
select v as ma from public.qa_ids where k = 'merchant_a' \gset

-- psql does not interpolate :variables inside dollar-quoted blocks, so the
-- assertion blocks below read the same ids back out of session settings.
select set_config('qa.ma', :'ma', false) as _g \gset

-- ---------------------------------------------------------------------------
-- 1. Merchant preconditions
-- ---------------------------------------------------------------------------
do $$
declare m public.pos_merchants%rowtype;
begin
  select * into m from public.pos_merchants where slug = 'kitchen-a';
  if not found then raise exception 'step 1: merchant kitchen-a missing'; end if;
  if m.status <> 'active' or m.eligibility_status <> 'verified' then
    raise exception 'step 1: merchant not orderable (status=%, eligibility=%)', m.status, m.eligibility_status;
  end if;
  if not m.is_test then
    raise exception 'step 1: lifecycle fixture merchant is not flagged is_test';
  end if;
  raise notice 'PASS 1  merchant % is active and verified', m.slug;
end $$;

select slug as mslug from public.pos_merchants where slug = 'kitchen-a' \gset

-- ---------------------------------------------------------------------------
-- 2. Merchant creates a product (as the owner, through RLS)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'ua', 'role', 'authenticated')::text, true) as _claims \gset
insert into public.pos_categories(merchant_id, name) values (:'ma', 'Lifecycle Noodles');
insert into public.pos_products(merchant_id, category_id, name, price, track_inventory, stock_on_hand, active)
values (:'ma',
        (select id from public.pos_categories where merchant_id = :'ma' and name = 'Lifecycle Noodles'),
        'Lifecycle Lomi', 120, true, 0, true);
-- Deliberately uncategorized, to pin the catalog behaviour asserted in step 4.
insert into public.pos_products(merchant_id, name, price, track_inventory, stock_on_hand, active)
values (:'ma', 'Lifecycle Orphan', 90, false, 0, true);
commit;

select id as prod, price as prod_price from public.pos_products where name = 'Lifecycle Lomi' \gset
select id as orphan from public.pos_products where name = 'Lifecycle Orphan' \gset
select set_config('qa.orphan', :'orphan', false) as _g \gset
select set_config('qa.prod', :'prod', false) as _g \gset

do $$
declare p public.pos_products%rowtype;
begin
  select * into p from public.pos_products where id = current_setting('qa.prod')::uuid;
  if not found then raise exception 'step 2: product was not created'; end if;
  if p.merchant_id <> current_setting('qa.ma')::uuid then raise exception 'step 2: product landed on the wrong merchant'; end if;
  raise notice 'PASS 2  product created at price %', p.price;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Stock it. Direct stock edits are blocked by the ledger guard, so this has
--    to go through the inventory-movement RPC, which is the real path.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'ua', 'role', 'authenticated')::text, true) as _claims \gset
select public.pos_record_inventory_movement(:'prod', 25, 'restock', 'lifecycle test') as _mv \gset
commit;

do $$
declare v_stock numeric;
begin
  select stock_on_hand into v_stock from public.pos_products where id = current_setting('qa.prod')::uuid;
  if v_stock <> 25 then raise exception 'step 3: expected stock 25, got %', v_stock; end if;
  raise notice 'PASS 3  restock movement brought stock to %', v_stock;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The product appears in the public catalog
-- ---------------------------------------------------------------------------
begin;
set local role service_role;
select set_config('request.jwt.claims', '', true) as _claims \gset
select public.pos_public_menu(:'mslug') as menu \gset
commit;
select set_config('qa.menu', :'menu', false) as _g \gset

do $$
declare v_hit integer; v_orphan integer; v_available boolean;
begin
  -- pos_public_menu returns a bare array of categories, each with its products.
  select count(*), bool_and((p ->> 'available')::boolean) into v_hit, v_available
  from jsonb_array_elements(current_setting('qa.menu')::jsonb) c,
       jsonb_array_elements(c -> 'products') p
  where (p ->> 'id')::uuid = current_setting('qa.prod')::uuid;
  if v_hit <> 1 then
    raise exception 'step 4: product not visible in the public catalog (matches=%)', v_hit;
  end if;
  if not v_available then
    raise exception 'step 4: product is in the catalog but marked unavailable';
  end if;

  -- KNOWN LIMITATION, pinned deliberately: the public menu groups strictly by
  -- category, so a product with no category is silently absent from the
  -- storefront -- no error, no placeholder, nothing for the merchant to notice.
  -- The product-create UI must therefore require a category. If this assertion
  -- ever fails because the count became 1, the menu grew an uncategorized
  -- bucket and the UI requirement can be relaxed.
  select count(*) into v_orphan
  from jsonb_array_elements(current_setting('qa.menu')::jsonb) c,
       jsonb_array_elements(c -> 'products') p
  where (p ->> 'id')::uuid = current_setting('qa.orphan')::uuid;
  if v_orphan <> 0 then
    raise exception 'step 4: uncategorized product is now surfaced (matches=%); update the UI rule', v_orphan;
  end if;

  raise notice 'PASS 4  product is visible and available in the public catalog';
  raise notice '        (uncategorized products stay hidden -- the UI must require a category)';
end $$;

-- ---------------------------------------------------------------------------
-- 5. A customer places an order from the storefront
-- ---------------------------------------------------------------------------
begin;
set local role service_role;
select set_config('request.jwt.claims', '', true) as _claims \gset
select public.pos_create_guest_order_internal(
  p_slug           => :'mslug',
  p_source         => 'qr',
  p_fulfillment    => 'pickup',
  p_customer_name  => 'Lifecycle Customer',
  p_items          => jsonb_build_array(jsonb_build_object('product_id', :'prod', 'quantity', 3)),
  p_payment_method => 'cash'
) as ord \gset
commit;

select ((:'ord')::jsonb ->> 'order_id') as ordid \gset
select set_config('qa.ordid', :'ordid', false) as _g \gset

do $$
declare v_order public.pos_orders%rowtype;
begin
  select * into v_order from public.pos_orders where id = current_setting('qa.ordid')::uuid;
  if not found then raise exception 'step 5: order row missing'; end if;
  if v_order.status <> 'awaiting_payment' or v_order.payment_status <> 'unpaid' then
    raise exception 'step 5: unexpected new-order state (status=%, payment=%)',
      v_order.status, v_order.payment_status;
  end if;
  -- 3 x 120, pickup so no delivery fee
  if v_order.total <> 360 then raise exception 'step 5: expected total 360, got %', v_order.total; end if;
  raise notice 'PASS 5  order % placed for %', v_order.order_number, v_order.total;
end $$;

-- ---------------------------------------------------------------------------
-- 6. A pending payment record exists for the order total
-- ---------------------------------------------------------------------------
do $$
declare v_pay public.pos_payments%rowtype; v_total numeric;
begin
  select total into v_total from public.pos_orders where id = current_setting('qa.ordid')::uuid;
  select * into v_pay from public.pos_payments where order_id = current_setting('qa.ordid')::uuid;
  if not found then raise exception 'step 6: no payment record was created'; end if;
  if v_pay.status <> 'pending' then raise exception 'step 6: payment status is %, expected pending', v_pay.status; end if;
  if v_pay.amount <> v_total then raise exception 'step 6: payment % does not match order total %', v_pay.amount, v_total; end if;
  raise notice 'PASS 6  pending % payment recorded for %', v_pay.method, v_pay.amount;
end $$;

-- ---------------------------------------------------------------------------
-- 7. The merchant verifies the payment
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'ua', 'role', 'authenticated')::text, true) as _claims \gset
select public.pos_confirm_payment(:'ordid', 'LIFECYCLE-REF') as _r \gset
commit;

do $$
declare v_order public.pos_orders%rowtype; v_pay public.pos_payments%rowtype;
begin
  select * into v_order from public.pos_orders where id = current_setting('qa.ordid')::uuid;
  select * into v_pay from public.pos_payments where order_id = current_setting('qa.ordid')::uuid;
  if v_order.payment_status <> 'paid' or v_order.status <> 'paid' then
    raise exception 'step 7: order did not reach paid (status=%, payment=%)', v_order.status, v_order.payment_status;
  end if;
  if v_pay.status <> 'verified' or v_pay.verified_at is null then
    raise exception 'step 7: payment not marked verified';
  end if;
  raise notice 'PASS 7  payment verified, order is paid';
end $$;

-- ---------------------------------------------------------------------------
-- 8. The kitchen queue receives the order and accepts it
-- ---------------------------------------------------------------------------
do $$
declare v_queued integer;
begin
  select count(*) into v_queued from public.pos_orders
  where merchant_id = current_setting('qa.ma')::uuid and id = current_setting('qa.ordid')::uuid and status = 'paid';
  if v_queued <> 1 then raise exception 'step 8: order is not sitting in the kitchen queue'; end if;
end $$;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'ua', 'role', 'authenticated')::text, true) as _claims \gset
select public.pos_advance_order(:'ordid', 'preparing') as _r \gset
commit;

do $$
declare v_order public.pos_orders%rowtype;
begin
  select * into v_order from public.pos_orders where id = current_setting('qa.ordid')::uuid;
  if v_order.status <> 'preparing' then raise exception 'step 8: expected preparing, got %', v_order.status; end if;
  if v_order.kitchen_sent_at is null then raise exception 'step 8: kitchen_sent_at was not stamped'; end if;
  raise notice 'PASS 8  kitchen accepted the order';
end $$;

-- ---------------------------------------------------------------------------
-- 9. The order is completed
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'ua', 'role', 'authenticated')::text, true) as _claims \gset
select public.pos_advance_order(:'ordid', 'ready') as _r \gset
select public.pos_advance_order(:'ordid', 'completed') as _r \gset
commit;

do $$
declare v_order public.pos_orders%rowtype;
begin
  select * into v_order from public.pos_orders where id = current_setting('qa.ordid')::uuid;
  if v_order.status <> 'completed' then raise exception 'step 9: expected completed, got %', v_order.status; end if;
  if v_order.completed_at is null then raise exception 'step 9: completed_at was not stamped'; end if;
  raise notice 'PASS 9  order completed';
end $$;

-- ---------------------------------------------------------------------------
-- 10. Inventory and the sales report both moved
-- ---------------------------------------------------------------------------
do $$
declare v_stock numeric; v_sold numeric;
begin
  select stock_on_hand into v_stock from public.pos_products where id = current_setting('qa.prod')::uuid;
  if v_stock <> 22 then raise exception 'step 10: expected stock 22 after selling 3 of 25, got %', v_stock; end if;

  select -delta into v_sold from public.pos_inventory_movements
  where order_id = current_setting('qa.ordid')::uuid and reason = 'sale';
  if v_sold is null then raise exception 'step 10: no sale movement was written to the ledger'; end if;
  if v_sold <> 3 then raise exception 'step 10: sale movement is %, expected 3', v_sold; end if;
  raise notice 'PASS 10a inventory ledger recorded the sale; stock is now %', v_stock;
end $$;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'ua', 'role', 'authenticated')::text, true) as _claims \gset
select public.pos_dashboard(:'ma') as dash \gset
commit;
select set_config('qa.dash', :'dash', false) as _g \gset

do $$
declare v_sales numeric; v_orders integer;
begin
  v_sales := (current_setting('qa.dash')::jsonb ->> 'sales_today')::numeric;
  v_orders := (current_setting('qa.dash')::jsonb ->> 'orders_today')::integer;
  if v_sales < 360 then
    raise exception 'step 10: sales_today is %, expected the 360 order to be counted', v_sales;
  end if;
  if v_orders < 1 then raise exception 'step 10: orders_today is %', v_orders; end if;
  raise notice 'PASS 10b sales report shows sales_today=% orders_today=%', v_sales, v_orders;
end $$;

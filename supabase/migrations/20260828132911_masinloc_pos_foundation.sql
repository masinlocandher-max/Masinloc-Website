-- Masinloc POS foundation. Additive, no seed business/customer/order data.

create table if not exists public.pos_plan_limits (
  plan_code text primary key,
  product_limit integer not null check (product_limit between 1 and 1000),
  staff_limit integer not null check (staff_limit between 0 and 100),
  outlet_limit integer not null check (outlet_limit between 1 and 100),
  category_limit integer not null check (category_limit between 1 and 200),
  modifier_groups_per_product integer not null check (modifier_groups_per_product between 0 and 50),
  modifier_options_per_group integer not null check (modifier_options_per_group between 0 and 100),
  max_order_lines integer not null check (max_order_lines between 1 and 100),
  max_order_quantity integer not null check (max_order_quantity between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.pos_plan_limits (
  plan_code, product_limit, staff_limit, outlet_limit, category_limit,
  modifier_groups_per_product, modifier_options_per_group, max_order_lines, max_order_quantity
) values ('community_free', 100, 3, 1, 30, 8, 25, 20, 40)
on conflict (plan_code) do update set
  product_limit = excluded.product_limit,
  staff_limit = excluded.staff_limit,
  outlet_limit = excluded.outlet_limit,
  category_limit = excluded.category_limit,
  modifier_groups_per_product = excluded.modifier_groups_per_product,
  modifier_options_per_group = excluded.modifier_options_per_group,
  max_order_lines = excluded.max_order_lines,
  max_order_quantity = excluded.max_order_quantity,
  updated_at = now();

create table if not exists public.pos_merchants (
  id uuid primary key default gen_random_uuid(),
  business_submission_id uuid unique references public.business_submissions(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  plan_code text not null default 'community_free' references public.pos_plan_limits(plan_code),
  status text not null default 'pending' check (status in ('pending','active','suspended','closed')),
  eligibility_status text not null default 'pending' check (eligibility_status in ('pending','verified','rejected')),
  currency text not null default 'PHP' check (currency = 'PHP'),
  timezone text not null default 'Asia/Manila',
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status <> 'active') or (eligibility_status = 'verified'))
);

create table if not exists public.pos_memberships (
  merchant_id uuid not null references public.pos_merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','cashier','kitchen')),
  status text not null default 'active' check (status in ('active','disabled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, user_id)
);

create unique index if not exists pos_one_active_owner_per_merchant
  on public.pos_memberships(merchant_id)
  where role = 'owner' and status = 'active';
create index if not exists pos_memberships_user_idx on public.pos_memberships(user_id, status);

create table if not exists public.pos_outlets (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.pos_merchants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  code text not null default 'MAIN' check (length(trim(code)) between 1 and 24),
  address text,
  barangay text,
  active boolean not null default true,
  archived_at timestamptz,
  ordering_enabled boolean not null default true,
  dine_in_enabled boolean not null default true,
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default false,
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
  minimum_delivery_order numeric(12,2) not null default 0 check (minimum_delivery_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, code),
  unique (id, merchant_id)
);
create index if not exists pos_outlets_merchant_idx on public.pos_outlets(merchant_id) where archived_at is null;

create table if not exists public.pos_categories (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.pos_merchants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  sort_order integer not null default 0,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, name),
  unique (id, merchant_id)
);
create index if not exists pos_categories_merchant_idx on public.pos_categories(merchant_id, sort_order) where archived_at is null;

create table if not exists public.pos_products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.pos_merchants(id) on delete cascade,
  category_id uuid,
  sku text,
  barcode text,
  name text not null check (length(trim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  price numeric(12,2) not null check (price >= 0),
  cost numeric(12,2) check (cost is null or cost >= 0),
  image_path text,
  active boolean not null default true,
  archived_at timestamptz,
  track_inventory boolean not null default false,
  stock_on_hand numeric(14,3) not null default 0,
  low_stock_threshold numeric(14,3) not null default 0 check (low_stock_threshold >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, merchant_id),
  unique (merchant_id, sku),
  unique (merchant_id, barcode),
  constraint pos_products_category_fk foreign key (category_id, merchant_id)
    references public.pos_categories(id, merchant_id) on delete set null
);
create index if not exists pos_products_catalog_idx on public.pos_products(merchant_id, category_id, sort_order) where archived_at is null and active;
create index if not exists pos_products_low_stock_idx on public.pos_products(merchant_id, stock_on_hand) where archived_at is null and track_inventory and active;

create table if not exists public.pos_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.pos_merchants(id) on delete cascade,
  product_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 80),
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer not null default 1 check (max_select >= 1),
  required boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, merchant_id),
  constraint pos_modifier_groups_product_fk foreign key (product_id, merchant_id)
    references public.pos_products(id, merchant_id) on delete cascade,
  check (max_select >= min_select)
);
create index if not exists pos_modifier_groups_product_idx on public.pos_modifier_groups(product_id, sort_order) where archived_at is null and active;

create table if not exists public.pos_modifier_options (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.pos_merchants(id) on delete cascade,
  group_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 80),
  price_delta numeric(12,2) not null default 0,
  sort_order integer not null default 0,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, merchant_id),
  constraint pos_modifier_options_group_fk foreign key (group_id, merchant_id)
    references public.pos_modifier_groups(id, merchant_id) on delete cascade
);
create index if not exists pos_modifier_options_group_idx on public.pos_modifier_options(group_id, sort_order) where archived_at is null and active;

create table if not exists public.pos_payment_methods (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.pos_merchants(id) on delete cascade,
  outlet_id uuid not null,
  method text not null check (method in ('cash','gcash','maya','qrph','card','room_charge')),
  label text not null check (length(trim(label)) between 1 and 60),
  enabled boolean not null default true,
  requires_manual_verification boolean not null default true,
  qr_image_path text,
  instructions text check (instructions is null or length(instructions) <= 500),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id, method),
  unique (id, merchant_id),
  constraint pos_payment_methods_outlet_fk foreign key (outlet_id, merchant_id)
    references public.pos_outlets(id, merchant_id) on delete cascade
);

create table if not exists public.pos_customers (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.pos_merchants(id) on delete cascade,
  display_name text check (display_name is null or length(trim(display_name)) between 1 and 120),
  phone text,
  loyalty_opt_in boolean not null default false,
  visit_count integer not null default 0 check (visit_count >= 0),
  lifetime_spend numeric(14,2) not null default 0 check (lifetime_spend >= 0),
  points_balance integer not null default 0 check (points_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, merchant_id)
);
create unique index if not exists pos_customers_phone_unique on public.pos_customers(merchant_id, phone) where phone is not null;

create table if not exists public.pos_orders (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.pos_merchants(id) on delete restrict,
  outlet_id uuid not null,
  customer_id uuid,
  order_number bigint generated always as identity,
  source text not null check (source in ('pos','qr','marketplace','phone')),
  fulfillment text not null check (fulfillment in ('dine_in','pickup','delivery')),
  customer_name text not null check (length(trim(customer_name)) between 1 and 120),
  customer_phone text,
  table_label text,
  delivery_address text,
  delivery_landmark text,
  notes text check (notes is null or length(notes) <= 1000),
  status text not null check (status in ('parked','awaiting_payment','payment_review','paid','preparing','ready','out_for_delivery','completed','cancelled')),
  payment_status text not null check (payment_status in ('unpaid','pending_verification','paid','void','refunded')),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  discount_total numeric(14,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(14,2) not null default 0 check (tax_total >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  tracking_token uuid not null default gen_random_uuid(),
  idempotency_key text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kitchen_sent_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  version integer not null default 1,
  unique (tracking_token),
  unique (merchant_id, idempotency_key),
  unique (id, merchant_id),
  constraint pos_orders_outlet_fk foreign key (outlet_id, merchant_id)
    references public.pos_outlets(id, merchant_id) on delete restrict,
  constraint pos_orders_customer_fk foreign key (customer_id, merchant_id)
    references public.pos_customers(id, merchant_id) on delete set null
);
create index if not exists pos_orders_queue_idx on public.pos_orders(merchant_id, outlet_id, status, created_at desc);
create index if not exists pos_orders_created_idx on public.pos_orders(merchant_id, created_at desc);
create index if not exists pos_orders_customer_idx on public.pos_orders(customer_id, created_at desc) where customer_id is not null;

create table if not exists public.pos_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  merchant_id uuid not null references public.pos_merchants(id) on delete restrict,
  product_id uuid,
  product_name text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  modifier_total numeric(12,2) not null default 0,
  line_total numeric(14,2) generated always as (round(quantity * (unit_price + modifier_total), 2)) stored,
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (id, merchant_id),
  constraint pos_order_items_order_fk foreign key (order_id, merchant_id)
    references public.pos_orders(id, merchant_id) on delete cascade,
  constraint pos_order_items_product_fk foreign key (product_id, merchant_id)
    references public.pos_products(id, merchant_id) on delete set null
);
create index if not exists pos_order_items_order_idx on public.pos_order_items(order_id);

create table if not exists public.pos_order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null,
  merchant_id uuid not null references public.pos_merchants(id) on delete restrict,
  modifier_option_id uuid,
  modifier_name text not null,
  price_delta numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  constraint pos_order_item_modifiers_item_fk foreign key (order_item_id, merchant_id)
    references public.pos_order_items(id, merchant_id) on delete cascade,
  constraint pos_order_item_modifiers_option_fk foreign key (modifier_option_id, merchant_id)
    references public.pos_modifier_options(id, merchant_id) on delete set null
);
create index if not exists pos_order_item_modifiers_item_idx on public.pos_order_item_modifiers(order_item_id);

create table if not exists public.pos_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  merchant_id uuid not null references public.pos_merchants(id) on delete restrict,
  method text not null check (method in ('cash','gcash','maya','qrph','card','room_charge')),
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','verified','void','refunded')),
  reference_number text,
  proof_path text,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_payments_order_fk foreign key (order_id, merchant_id)
    references public.pos_orders(id, merchant_id) on delete restrict
);
create index if not exists pos_payments_order_idx on public.pos_payments(order_id, created_at desc);
create index if not exists pos_payments_pending_idx on public.pos_payments(merchant_id, status, created_at) where status = 'pending';

create table if not exists public.pos_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.pos_merchants(id) on delete restrict,
  product_id uuid not null,
  order_id uuid,
  delta numeric(14,3) not null check (delta <> 0),
  reason text not null check (reason in ('sale','restock','adjustment','waste','void','refund')),
  note text check (note is null or length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint pos_inventory_product_fk foreign key (product_id, merchant_id)
    references public.pos_products(id, merchant_id) on delete restrict,
  constraint pos_inventory_order_fk foreign key (order_id, merchant_id)
    references public.pos_orders(id, merchant_id) on delete set null
);
create index if not exists pos_inventory_product_idx on public.pos_inventory_movements(product_id, created_at desc);

create table if not exists public.pos_expenses (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.pos_merchants(id) on delete restrict,
  outlet_id uuid not null,
  category text not null check (length(trim(category)) between 1 and 80),
  amount numeric(14,2) not null check (amount > 0),
  note text check (note is null or length(note) <= 500),
  expense_date date not null default current_date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_expenses_outlet_fk foreign key (outlet_id, merchant_id)
    references public.pos_outlets(id, merchant_id) on delete restrict
);
create index if not exists pos_expenses_date_idx on public.pos_expenses(merchant_id, expense_date desc);

create table if not exists public.pos_cash_sessions (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.pos_merchants(id) on delete restrict,
  outlet_id uuid not null,
  opened_by uuid not null references auth.users(id) on delete restrict,
  closed_by uuid references auth.users(id) on delete set null,
  opening_float numeric(14,2) not null default 0 check (opening_float >= 0),
  closing_count numeric(14,2) check (closing_count is null or closing_count >= 0),
  status text not null default 'open' check (status in ('open','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint pos_cash_sessions_outlet_fk foreign key (outlet_id, merchant_id)
    references public.pos_outlets(id, merchant_id) on delete restrict
);
create unique index if not exists pos_one_open_cash_session_per_user_outlet
  on public.pos_cash_sessions(outlet_id, opened_by) where status = 'open';

create table if not exists public.pos_cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.pos_cash_sessions(id) on delete restrict,
  merchant_id uuid not null references public.pos_merchants(id) on delete restrict,
  movement_type text not null check (movement_type in ('cash_in','cash_out','expense')),
  amount numeric(14,2) not null check (amount > 0),
  note text check (note is null or length(note) <= 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists pos_cash_movements_session_idx on public.pos_cash_movements(cash_session_id, created_at);

create table if not exists public.pos_attendance (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.pos_merchants(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  outlet_id uuid not null,
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  verification_path text,
  created_at timestamptz not null default now(),
  constraint pos_attendance_outlet_fk foreign key (outlet_id, merchant_id)
    references public.pos_outlets(id, merchant_id) on delete restrict,
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);
create index if not exists pos_attendance_user_idx on public.pos_attendance(merchant_id, user_id, clock_in_at desc);

create table if not exists public.pos_chat_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  merchant_id uuid not null references public.pos_merchants(id) on delete restrict,
  sender_type text not null check (sender_type in ('customer','staff','system')),
  sender_user_id uuid references auth.users(id) on delete set null,
  message text not null check (length(trim(message)) between 1 and 1000),
  created_at timestamptz not null default now(),
  constraint pos_chat_messages_order_fk foreign key (order_id, merchant_id)
    references public.pos_orders(id, merchant_id) on delete cascade
);
create index if not exists pos_chat_order_idx on public.pos_chat_messages(order_id, created_at);

create table if not exists public.pos_loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.pos_merchants(id) on delete restrict,
  customer_id uuid not null,
  order_id uuid,
  points_delta integer not null check (points_delta <> 0),
  reason text not null check (reason in ('earn','redeem','adjustment','reversal')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint pos_loyalty_customer_fk foreign key (customer_id, merchant_id)
    references public.pos_customers(id, merchant_id) on delete restrict,
  constraint pos_loyalty_order_fk foreign key (order_id, merchant_id)
    references public.pos_orders(id, merchant_id) on delete set null
);
create index if not exists pos_loyalty_customer_idx on public.pos_loyalty_transactions(customer_id, created_at desc);

create table if not exists public.pos_audit_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references public.pos_merchants(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null check (actor_type in ('user','customer','system','admin')),
  action text not null check (length(trim(action)) between 1 and 100),
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pos_audit_merchant_idx on public.pos_audit_events(merchant_id, created_at desc);

-- Updated-at helper.
create or replace function public.pos_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Tenant membership helpers. SECURITY DEFINER prevents recursive RLS lookups.
create or replace function public.pos_is_member(p_merchant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.pos_memberships pm
    join public.pos_merchants m on m.id = pm.merchant_id
    where pm.merchant_id = p_merchant_id
      and pm.user_id = (select auth.uid())
      and pm.status = 'active'
      and m.status = 'active'
      and m.eligibility_status = 'verified'
  );
$$;

create or replace function public.pos_has_role(p_merchant_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.pos_memberships pm
    join public.pos_merchants m on m.id = pm.merchant_id
    where pm.merchant_id = p_merchant_id
      and pm.user_id = (select auth.uid())
      and pm.status = 'active'
      and pm.role = any(p_roles)
      and m.status = 'active'
      and m.eligibility_status = 'verified'
  );
$$;

create or replace function public.pos_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin', false);
$$;

revoke all on function public.pos_is_member(uuid) from public;
revoke all on function public.pos_has_role(uuid, text[]) from public;
revoke all on function public.pos_is_platform_admin() from public;
grant execute on function public.pos_is_member(uuid) to authenticated;
grant execute on function public.pos_has_role(uuid, text[]) to authenticated;
grant execute on function public.pos_is_platform_admin() to authenticated;

-- Hard plan limits with transaction-scoped advisory locks to avoid concurrent bypass.
create or replace function public.pos_enforce_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.merchant_id::text || ':' || tg_table_name, 0));
  select m.plan_code into v_plan from public.pos_merchants m where m.id = new.merchant_id;
  if v_plan is null then raise exception 'Unknown merchant'; end if;

  if tg_table_name = 'pos_products' then
    if new.archived_at is not null then return new; end if;
    select product_limit into v_limit from public.pos_plan_limits where plan_code = v_plan;
    select count(*) into v_count from public.pos_products where merchant_id = new.merchant_id and archived_at is null and id <> new.id;
  elsif tg_table_name = 'pos_categories' then
    if new.archived_at is not null then return new; end if;
    select category_limit into v_limit from public.pos_plan_limits where plan_code = v_plan;
    select count(*) into v_count from public.pos_categories where merchant_id = new.merchant_id and archived_at is null and id <> new.id;
  elsif tg_table_name = 'pos_outlets' then
    if new.archived_at is not null then return new; end if;
    select outlet_limit into v_limit from public.pos_plan_limits where plan_code = v_plan;
    select count(*) into v_count from public.pos_outlets where merchant_id = new.merchant_id and archived_at is null and id <> new.id;
  elsif tg_table_name = 'pos_memberships' then
    if new.status <> 'active' or new.role = 'owner' then return new; end if;
    select staff_limit into v_limit from public.pos_plan_limits where plan_code = v_plan;
    select count(*) into v_count from public.pos_memberships where merchant_id = new.merchant_id and status = 'active' and role <> 'owner' and user_id <> new.user_id;
  else
    return new;
  end if;

  if v_count >= v_limit then
    raise exception 'Plan limit reached for %: maximum %', tg_table_name, v_limit using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.pos_enforce_modifier_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_limit integer; v_count integer; v_plan text;
begin
  if new.archived_at is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(new.product_id::text, new.group_id::text) || ':' || tg_table_name, 0));
  select plan_code into v_plan from public.pos_merchants where id = new.merchant_id;
  if tg_table_name = 'pos_modifier_groups' then
    select modifier_groups_per_product into v_limit from public.pos_plan_limits where plan_code = v_plan;
    select count(*) into v_count from public.pos_modifier_groups where product_id = new.product_id and archived_at is null and id <> new.id;
  else
    select modifier_options_per_group into v_limit from public.pos_plan_limits where plan_code = v_plan;
    select count(*) into v_count from public.pos_modifier_options where group_id = new.group_id and archived_at is null and id <> new.id;
  end if;
  if v_count >= v_limit then raise exception 'Modifier limit reached: maximum %', v_limit using errcode = 'check_violation'; end if;
  return new;
end;
$$;

-- Inventory ledger is the only supported way to change tracked stock after setup.
create or replace function public.pos_apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pos_products
     set stock_on_hand = stock_on_hand + new.delta,
         updated_at = now()
   where id = new.product_id and merchant_id = new.merchant_id and track_inventory = true;
  return new;
end;
$$;

-- Generic updated_at triggers.
do $$
declare t text;
begin
  foreach t in array array['pos_plan_limits','pos_merchants','pos_memberships','pos_outlets','pos_categories','pos_products','pos_modifier_groups','pos_modifier_options','pos_payment_methods','pos_customers','pos_orders','pos_payments','pos_expenses'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.pos_touch_updated_at()', 'trg_' || t || '_updated_at', t);
  end loop;
end $$;

drop trigger if exists trg_pos_product_limit on public.pos_products;
create trigger trg_pos_product_limit before insert or update of merchant_id, archived_at on public.pos_products for each row execute function public.pos_enforce_plan_limit();
drop trigger if exists trg_pos_category_limit on public.pos_categories;
create trigger trg_pos_category_limit before insert or update of merchant_id, archived_at on public.pos_categories for each row execute function public.pos_enforce_plan_limit();
drop trigger if exists trg_pos_outlet_limit on public.pos_outlets;
create trigger trg_pos_outlet_limit before insert or update of merchant_id, archived_at on public.pos_outlets for each row execute function public.pos_enforce_plan_limit();
drop trigger if exists trg_pos_staff_limit on public.pos_memberships;
create trigger trg_pos_staff_limit before insert or update of merchant_id, role, status on public.pos_memberships for each row execute function public.pos_enforce_plan_limit();
drop trigger if exists trg_pos_modifier_group_limit on public.pos_modifier_groups;
create trigger trg_pos_modifier_group_limit before insert or update of merchant_id, product_id, archived_at on public.pos_modifier_groups for each row execute function public.pos_enforce_modifier_limit();
drop trigger if exists trg_pos_modifier_option_limit on public.pos_modifier_options;
create trigger trg_pos_modifier_option_limit before insert or update of merchant_id, group_id, archived_at on public.pos_modifier_options for each row execute function public.pos_enforce_modifier_limit();
drop trigger if exists trg_pos_inventory_apply on public.pos_inventory_movements;
create trigger trg_pos_inventory_apply after insert on public.pos_inventory_movements for each row execute function public.pos_apply_inventory_movement();

-- RLS: no POS table is anonymously readable/writable. Public menu access is via curated functions added separately.
do $$
declare t text;
begin
  foreach t in array array['pos_plan_limits','pos_merchants','pos_memberships','pos_outlets','pos_categories','pos_products','pos_modifier_groups','pos_modifier_options','pos_payment_methods','pos_customers','pos_orders','pos_order_items','pos_order_item_modifiers','pos_payments','pos_inventory_movements','pos_expenses','pos_cash_sessions','pos_cash_movements','pos_attendance','pos_chat_messages','pos_loyalty_transactions','pos_audit_events'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Plan limits are readable by authenticated merchant users, not writable.
create policy pos_plan_limits_read on public.pos_plan_limits for select to authenticated using (true);

create policy pos_merchants_read on public.pos_merchants for select to authenticated
  using (public.pos_is_member(id) or public.pos_is_platform_admin());
create policy pos_merchants_admin_all on public.pos_merchants for all to authenticated
  using (public.pos_is_platform_admin()) with check (public.pos_is_platform_admin());

create policy pos_memberships_read on public.pos_memberships for select to authenticated
  using (public.pos_is_member(merchant_id) or public.pos_is_platform_admin());
create policy pos_memberships_admin_all on public.pos_memberships for all to authenticated
  using (public.pos_is_platform_admin()) with check (public.pos_is_platform_admin());

create policy pos_outlets_read on public.pos_outlets for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_outlets_manage on public.pos_outlets for all to authenticated
  using (public.pos_has_role(merchant_id, array['owner','manager']))
  with check (public.pos_has_role(merchant_id, array['owner','manager']));

create policy pos_categories_read on public.pos_categories for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_categories_manage on public.pos_categories for all to authenticated
  using (public.pos_has_role(merchant_id, array['owner','manager']))
  with check (public.pos_has_role(merchant_id, array['owner','manager']));

create policy pos_products_read on public.pos_products for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_products_manage on public.pos_products for all to authenticated
  using (public.pos_has_role(merchant_id, array['owner','manager']))
  with check (public.pos_has_role(merchant_id, array['owner','manager']));

create policy pos_modifier_groups_read on public.pos_modifier_groups for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_modifier_groups_manage on public.pos_modifier_groups for all to authenticated
  using (public.pos_has_role(merchant_id, array['owner','manager']))
  with check (public.pos_has_role(merchant_id, array['owner','manager']));

create policy pos_modifier_options_read on public.pos_modifier_options for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_modifier_options_manage on public.pos_modifier_options for all to authenticated
  using (public.pos_has_role(merchant_id, array['owner','manager']))
  with check (public.pos_has_role(merchant_id, array['owner','manager']));

create policy pos_payment_methods_read on public.pos_payment_methods for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_payment_methods_manage on public.pos_payment_methods for all to authenticated
  using (public.pos_has_role(merchant_id, array['owner','manager']))
  with check (public.pos_has_role(merchant_id, array['owner','manager']));

create policy pos_customers_read on public.pos_customers for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_customers_write on public.pos_customers for all to authenticated
  using (public.pos_has_role(merchant_id, array['owner','manager','cashier']))
  with check (public.pos_has_role(merchant_id, array['owner','manager','cashier']));

create policy pos_orders_read on public.pos_orders for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_order_items_read on public.pos_order_items for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_order_item_modifiers_read on public.pos_order_item_modifiers for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_payments_read on public.pos_payments for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_inventory_read on public.pos_inventory_movements for select to authenticated using (public.pos_is_member(merchant_id));

create policy pos_expenses_read on public.pos_expenses for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_expenses_insert on public.pos_expenses for insert to authenticated
  with check (public.pos_has_role(merchant_id, array['owner','manager','cashier']) and created_by = (select auth.uid()));
create policy pos_expenses_update on public.pos_expenses for update to authenticated
  using (public.pos_has_role(merchant_id, array['owner','manager']))
  with check (public.pos_has_role(merchant_id, array['owner','manager']));

create policy pos_cash_sessions_read on public.pos_cash_sessions for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_cash_movements_read on public.pos_cash_movements for select to authenticated using (public.pos_is_member(merchant_id));

create policy pos_attendance_read on public.pos_attendance for select to authenticated
  using (user_id = (select auth.uid()) or public.pos_has_role(merchant_id, array['owner','manager']));

create policy pos_chat_read on public.pos_chat_messages for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_chat_staff_insert on public.pos_chat_messages for insert to authenticated
  with check (public.pos_is_member(merchant_id) and sender_type = 'staff' and sender_user_id = (select auth.uid()));

create policy pos_loyalty_read on public.pos_loyalty_transactions for select to authenticated using (public.pos_is_member(merchant_id));
create policy pos_audit_read on public.pos_audit_events for select to authenticated
  using (merchant_id is not null and public.pos_has_role(merchant_id, array['owner','manager']));
create policy pos_audit_admin_read on public.pos_audit_events for select to authenticated using (public.pos_is_platform_admin());

-- Table grants. RLS remains authoritative.
grant select on public.pos_plan_limits to authenticated;
grant select on public.pos_merchants, public.pos_memberships to authenticated;
grant select, insert, update, delete on public.pos_outlets, public.pos_categories, public.pos_products, public.pos_modifier_groups, public.pos_modifier_options, public.pos_payment_methods to authenticated;
grant select, insert, update on public.pos_customers to authenticated;
grant select on public.pos_orders, public.pos_order_items, public.pos_order_item_modifiers, public.pos_payments, public.pos_inventory_movements to authenticated;
grant select, insert, update on public.pos_expenses to authenticated;
grant select on public.pos_cash_sessions, public.pos_cash_movements, public.pos_attendance, public.pos_loyalty_transactions, public.pos_audit_events to authenticated;
grant select, insert on public.pos_chat_messages to authenticated;

-- No anonymous table access.
do $$
declare t text;
begin
  foreach t in array array['pos_plan_limits','pos_merchants','pos_memberships','pos_outlets','pos_categories','pos_products','pos_modifier_groups','pos_modifier_options','pos_payment_methods','pos_customers','pos_orders','pos_order_items','pos_order_item_modifiers','pos_payments','pos_inventory_movements','pos_expenses','pos_cash_sessions','pos_cash_movements','pos_attendance','pos_chat_messages','pos_loyalty_transactions','pos_audit_events'] loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

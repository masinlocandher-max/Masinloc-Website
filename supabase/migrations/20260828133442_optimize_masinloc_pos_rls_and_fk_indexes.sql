-- Cover POS foreign keys used by deletes, joins and RLS paths.
create index if not exists pos_merchants_plan_idx on public.pos_merchants(plan_code);
create index if not exists pos_merchants_approved_by_idx on public.pos_merchants(approved_by) where approved_by is not null;
create index if not exists pos_memberships_created_by_idx on public.pos_memberships(created_by) where created_by is not null;
create index if not exists pos_products_category_merchant_idx on public.pos_products(category_id,merchant_id) where category_id is not null;
create index if not exists pos_modifier_groups_product_merchant_idx on public.pos_modifier_groups(product_id,merchant_id);
create index if not exists pos_modifier_groups_merchant_idx on public.pos_modifier_groups(merchant_id);
create index if not exists pos_modifier_options_group_merchant_idx on public.pos_modifier_options(group_id,merchant_id);
create index if not exists pos_modifier_options_merchant_idx on public.pos_modifier_options(merchant_id);
create index if not exists pos_payment_methods_outlet_merchant_idx on public.pos_payment_methods(outlet_id,merchant_id);
create index if not exists pos_payment_methods_merchant_idx on public.pos_payment_methods(merchant_id);
create index if not exists pos_orders_outlet_merchant_idx on public.pos_orders(outlet_id,merchant_id);
create index if not exists pos_orders_customer_merchant_idx on public.pos_orders(customer_id,merchant_id) where customer_id is not null;
create index if not exists pos_orders_created_by_idx on public.pos_orders(created_by) where created_by is not null;
create index if not exists pos_order_items_order_merchant_idx on public.pos_order_items(order_id,merchant_id);
create index if not exists pos_order_items_product_merchant_idx on public.pos_order_items(product_id,merchant_id) where product_id is not null;
create index if not exists pos_order_items_merchant_idx on public.pos_order_items(merchant_id);
create index if not exists pos_order_item_modifiers_item_merchant_idx on public.pos_order_item_modifiers(order_item_id,merchant_id);
create index if not exists pos_order_item_modifiers_option_merchant_idx on public.pos_order_item_modifiers(modifier_option_id,merchant_id) where modifier_option_id is not null;
create index if not exists pos_order_item_modifiers_merchant_idx on public.pos_order_item_modifiers(merchant_id);
create index if not exists pos_payments_order_merchant_idx on public.pos_payments(order_id,merchant_id);
create index if not exists pos_payments_verified_by_idx on public.pos_payments(verified_by) where verified_by is not null;
create index if not exists pos_inventory_merchant_idx on public.pos_inventory_movements(merchant_id);
create index if not exists pos_inventory_product_merchant_idx on public.pos_inventory_movements(product_id,merchant_id);
create index if not exists pos_inventory_order_merchant_idx on public.pos_inventory_movements(order_id,merchant_id) where order_id is not null;
create index if not exists pos_inventory_created_by_idx on public.pos_inventory_movements(created_by) where created_by is not null;
create index if not exists pos_expenses_outlet_merchant_idx on public.pos_expenses(outlet_id,merchant_id);
create index if not exists pos_expenses_created_by_idx on public.pos_expenses(created_by);
create index if not exists pos_cash_sessions_merchant_idx on public.pos_cash_sessions(merchant_id);
create index if not exists pos_cash_sessions_outlet_merchant_idx on public.pos_cash_sessions(outlet_id,merchant_id);
create index if not exists pos_cash_sessions_opened_by_idx on public.pos_cash_sessions(opened_by);
create index if not exists pos_cash_sessions_closed_by_idx on public.pos_cash_sessions(closed_by) where closed_by is not null;
create index if not exists pos_cash_movements_merchant_idx on public.pos_cash_movements(merchant_id);
create index if not exists pos_cash_movements_created_by_idx on public.pos_cash_movements(created_by);
create index if not exists pos_attendance_outlet_merchant_idx on public.pos_attendance(outlet_id,merchant_id);
create index if not exists pos_attendance_user_only_idx on public.pos_attendance(user_id);
create index if not exists pos_chat_order_merchant_idx on public.pos_chat_messages(order_id,merchant_id);
create index if not exists pos_chat_merchant_idx on public.pos_chat_messages(merchant_id);
create index if not exists pos_chat_sender_user_idx on public.pos_chat_messages(sender_user_id) where sender_user_id is not null;
create index if not exists pos_loyalty_merchant_idx on public.pos_loyalty_transactions(merchant_id);
create index if not exists pos_loyalty_customer_merchant_idx on public.pos_loyalty_transactions(customer_id,merchant_id);
create index if not exists pos_loyalty_order_merchant_idx on public.pos_loyalty_transactions(order_id,merchant_id) where order_id is not null;
create index if not exists pos_loyalty_created_by_idx on public.pos_loyalty_transactions(created_by) where created_by is not null;
create index if not exists pos_audit_actor_idx on public.pos_audit_events(actor_user_id) where actor_user_id is not null;

-- Avoid duplicate permissive SELECT policy evaluation by splitting write policies.
drop policy if exists pos_merchants_admin_all on public.pos_merchants;
create policy pos_merchants_admin_insert on public.pos_merchants for insert to authenticated with check (public.pos_is_platform_admin());
create policy pos_merchants_admin_update on public.pos_merchants for update to authenticated using (public.pos_is_platform_admin()) with check (public.pos_is_platform_admin());
create policy pos_merchants_admin_delete on public.pos_merchants for delete to authenticated using (public.pos_is_platform_admin());

drop policy if exists pos_memberships_admin_all on public.pos_memberships;
create policy pos_memberships_admin_insert on public.pos_memberships for insert to authenticated with check (public.pos_is_platform_admin());
create policy pos_memberships_admin_update on public.pos_memberships for update to authenticated using (public.pos_is_platform_admin()) with check (public.pos_is_platform_admin());
create policy pos_memberships_admin_delete on public.pos_memberships for delete to authenticated using (public.pos_is_platform_admin());

drop policy if exists pos_outlets_manage on public.pos_outlets;
create policy pos_outlets_insert on public.pos_outlets for insert to authenticated with check (public.pos_has_role(merchant_id,array['owner','manager']));
create policy pos_outlets_update on public.pos_outlets for update to authenticated using (public.pos_has_role(merchant_id,array['owner','manager'])) with check (public.pos_has_role(merchant_id,array['owner','manager']));
create policy pos_outlets_delete on public.pos_outlets for delete to authenticated using (public.pos_has_role(merchant_id,array['owner','manager']));

drop policy if exists pos_categories_manage on public.pos_categories;
create policy pos_categories_insert on public.pos_categories for insert to authenticated with check (public.pos_has_role(merchant_id,array['owner','manager']));
create policy pos_categories_update on public.pos_categories for update to authenticated using (public.pos_has_role(merchant_id,array['owner','manager'])) with check (public.pos_has_role(merchant_id,array['owner','manager']));
create policy pos_categories_delete on public.pos_categories for delete to authenticated using (public.pos_has_role(merchant_id,array['owner','manager']));

drop policy if exists pos_products_manage on public.pos_products;
create policy pos_products_insert on public.pos_products for insert to authenticated with check (public.pos_has_role(merchant_id,array['owner','manager']));
create policy pos_products_update on public.pos_products for update to authenticated using (public.pos_has_role(merchant_id,array['owner','manager'])) with check (public.pos_has_role(merchant_id,array['owner','manager']));
create policy pos_products_delete on public.pos_products for delete to authenticated using (public.pos_has_role(merchant_id,array['owner','manager']));

drop policy if exists pos_modifier_groups_manage on public.pos_modifier_groups;
create policy pos_modifier_groups_insert on public.pos_modifier_groups for insert to authenticated with check (public.pos_has_role(merchant_id,array['owner','manager']));
create policy pos_modifier_groups_update on public.pos_modifier_groups for update to authenticated using (public.pos_has_role(merchant_id,array['owner','manager'])) with check (public.pos_has_role(merchant_id,array['owner','manager']));
create policy pos_modifier_groups_delete on public.pos_modifier_groups for delete to authenticated using (public.pos_has_role(merchant_id,array['owner','manager']));

drop policy if exists pos_modifier_options_manage on public.pos_modifier_options;
create policy pos_modifier_options_insert on public.pos_modifier_options for insert to authenticated with check (public.pos_has_role(merchant_id,array['owner','manager']));
create policy pos_modifier_options_update on public.pos_modifier_options for update to authenticated using (public.pos_has_role(merchant_id,array['owner','manager'])) with check (public.pos_has_role(merchant_id,array['owner','manager']));
create policy pos_modifier_options_delete on public.pos_modifier_options for delete to authenticated using (public.pos_has_role(merchant_id,array['owner','manager']));

drop policy if exists pos_payment_methods_manage on public.pos_payment_methods;
create policy pos_payment_methods_insert on public.pos_payment_methods for insert to authenticated with check (public.pos_has_role(merchant_id,array['owner','manager']));
create policy pos_payment_methods_update on public.pos_payment_methods for update to authenticated using (public.pos_has_role(merchant_id,array['owner','manager'])) with check (public.pos_has_role(merchant_id,array['owner','manager']));
create policy pos_payment_methods_delete on public.pos_payment_methods for delete to authenticated using (public.pos_has_role(merchant_id,array['owner','manager']));

drop policy if exists pos_customers_write on public.pos_customers;
create policy pos_customers_insert on public.pos_customers for insert to authenticated with check (public.pos_has_role(merchant_id,array['owner','manager','cashier']));
create policy pos_customers_update on public.pos_customers for update to authenticated using (public.pos_has_role(merchant_id,array['owner','manager','cashier'])) with check (public.pos_has_role(merchant_id,array['owner','manager','cashier']));

drop policy if exists pos_audit_read on public.pos_audit_events;
drop policy if exists pos_audit_admin_read on public.pos_audit_events;
create policy pos_audit_read on public.pos_audit_events for select to authenticated
using (public.pos_is_platform_admin() or (merchant_id is not null and public.pos_has_role(merchant_id,array['owner','manager'])));

-- Protect ledger-derived fields from direct browser edits.
create or replace function public.pos_protect_product_stock()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.stock_on_hand is distinct from old.stock_on_hand and current_user in ('anon','authenticated') then
    raise exception 'Stock must be changed through an inventory movement' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.pos_protect_product_stock() from public,anon,authenticated;
drop trigger if exists trg_pos_protect_product_stock on public.pos_products;
create trigger trg_pos_protect_product_stock before update of stock_on_hand on public.pos_products for each row execute function public.pos_protect_product_stock();

create or replace function public.pos_protect_customer_metrics()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if (new.visit_count is distinct from old.visit_count
      or new.lifetime_spend is distinct from old.lifetime_spend
      or new.points_balance is distinct from old.points_balance)
     and current_user in ('anon','authenticated') then
    raise exception 'Customer metrics are transaction-derived' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.pos_protect_customer_metrics() from public,anon,authenticated;
drop trigger if exists trg_pos_protect_customer_metrics on public.pos_customers;
create trigger trg_pos_protect_customer_metrics before update of visit_count,lifetime_spend,points_balance on public.pos_customers for each row execute function public.pos_protect_customer_metrics();

-- Catalog/history uses soft archive. Do not hard-delete through browser roles.
drop policy if exists pos_products_delete on public.pos_products;
drop policy if exists pos_categories_delete on public.pos_categories;
drop policy if exists pos_modifier_groups_delete on public.pos_modifier_groups;
drop policy if exists pos_modifier_options_delete on public.pos_modifier_options;
revoke delete on public.pos_products,public.pos_categories,public.pos_modifier_groups,public.pos_modifier_options from authenticated;

-- Payment methods may be removed because they are configuration, not transaction history.
-- Orders/payments/inventory/audit already have no direct browser mutation grants.

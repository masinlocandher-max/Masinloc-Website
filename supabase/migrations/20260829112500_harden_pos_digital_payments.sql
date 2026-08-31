-- Defense-in-depth for manual digital payments.
-- Digital methods cannot be enabled without a QR asset, remain manual-verification
-- only in MVP, and guest QR/Marketplace orders must carry a payment reference.

do $$
begin
  if not exists (select 1 from pg_constraint where conname='pos_payment_methods_enabled_digital_qr_chk') then
    alter table public.pos_payment_methods
      add constraint pos_payment_methods_enabled_digital_qr_chk
      check (
        not enabled
        or method not in ('gcash','maya','qrph')
        or nullif(trim(coalesce(qr_image_path,'')),'') is not null
      );
  end if;

  if not exists (select 1 from pg_constraint where conname='pos_payment_methods_digital_manual_chk') then
    alter table public.pos_payment_methods
      add constraint pos_payment_methods_digital_manual_chk
      check (method not in ('gcash','maya','qrph') or requires_manual_verification);
  end if;
end $$;

create or replace function public.pos_enforce_guest_payment_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text;
begin
  if new.method in ('gcash','maya','qrph') then
    select o.source into v_source
    from public.pos_orders o
    where o.id = new.order_id
      and o.merchant_id = new.merchant_id;

    if v_source in ('qr','marketplace')
       and nullif(trim(coalesce(new.reference_number,'')),'') is null then
      raise exception 'Payment reference is required';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.pos_enforce_guest_payment_reference() from public, anon, authenticated;

drop trigger if exists trg_pos_guest_payment_reference on public.pos_payments;
create trigger trg_pos_guest_payment_reference
before insert or update of order_id, merchant_id, method, reference_number
on public.pos_payments
for each row execute function public.pos_enforce_guest_payment_reference();

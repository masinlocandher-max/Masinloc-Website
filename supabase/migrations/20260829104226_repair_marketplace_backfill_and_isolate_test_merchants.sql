-- Two corrections to the POS/Marketplace bridge. Forward-only: the historical
-- migration 20260828140118 stays byte-for-byte as production executed it.
--
-- 1. The backfill DO block in 20260828140118 could never work.
--    marketplace_sync_pos_merchant() is a trigger function that dereferences
--    NEW; calling it as `perform ... from (select r.*) as new_row` never binds
--    NEW, so it raised, and `exception when others then null` swallowed the
--    failure. It was harmless only because pos_merchants was empty. Replayed
--    against a restore or staging clone that already has merchants, it would
--    silently create no listings and still report success.
--
-- 2. Test merchants must not be able to reach the public Marketplace. Relying
--    on remembering to set admin_hidden is a convention, not a guarantee, so
--    the exclusion is moved into the publication trigger itself.

alter table public.pos_merchants
  add column if not exists is_test boolean not null default false;

comment on column public.pos_merchants.is_test is
  'Controlled test merchant. Publication is forced hidden by marketplace_prepare_listing, so a test entity can never reach the public Marketplace feed regardless of status, eligibility or profile completeness.';

create index if not exists pos_merchants_is_test_idx on public.pos_merchants(is_test) where is_test;

-- Republished with the test-merchant gate added. Everything else is unchanged
-- from the version recorded in 20260828140118.
create or replace function public.marketplace_prepare_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_eligibility text;
  v_is_test boolean;
begin
  new.slug := lower(trim(new.slug));
  new.name := trim(new.name);
  new.category := nullif(trim(new.category), '');
  new.location := nullif(trim(new.location), '');
  new.barangay := nullif(trim(new.barangay), '');
  new.description := nullif(trim(new.description), '');
  new.descriptor := nullif(trim(new.descriptor), '');
  new.meta_description := nullif(trim(new.meta_description), '');
  new.facebook_page := nullif(trim(new.facebook_page), '');
  new.updated_at := now();

  if new.pos_merchant_id is not null then
    select m.status, m.eligibility_status, m.is_test
    into v_status, v_eligibility, v_is_test
    from public.pos_merchants m
    where m.id = new.pos_merchant_id;
  end if;

  if new.admin_hidden then
    new.publication_status := 'hidden';
  elsif coalesce(v_is_test, false) then
    -- A controlled test merchant is never publishable.
    new.publication_status := 'hidden';
  elsif new.source = 'pos' then
    if new.pos_merchant_id is null then
      new.publication_status := 'hidden';
    else
      if v_status = 'active'
         and v_eligibility = 'verified'
         and not new.claim_review_required
         and new.category is not null
         and new.location is not null
         and new.description is not null then
        new.publication_status := 'published';
      elsif v_status in ('suspended','closed') then
        new.publication_status := 'hidden';
      else
        new.publication_status := 'draft';
      end if;
    end if;
  end if;

  if new.publication_status = 'published' and old.publication_status is distinct from 'published' then
    new.published_at := now();
  elsif new.publication_status <> 'published' then
    new.published_at := null;
  end if;

  return new;
end;
$$;

revoke execute on function public.marketplace_prepare_listing() from public, anon, authenticated;

-- Working backfill. Rather than duplicating the trigger's logic, it re-fires
-- the trigger: UPDATE ... OF name fires on column mention, not on value
-- change, so `set name = name` is a no-op write that runs the real sync path.
-- Errors propagate instead of being swallowed.
create or replace function public.marketplace_backfill_pos_merchants()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  with touched as (
    update public.pos_merchants m
    set name = m.name
    where not exists (
      select 1 from public.marketplace_listings ml where ml.pos_merchant_id = m.id
    )
    returning 1
  )
  select count(*) into v_count from touched;
  return v_count;
end;
$$;

revoke all on function public.marketplace_backfill_pos_merchants() from public, anon, authenticated;
grant execute on function public.marketplace_backfill_pos_merchants() to service_role;

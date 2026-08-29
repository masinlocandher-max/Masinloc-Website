-- Forward-only repair for the original Marketplace POS backfill.
-- The historical 20260828140118 migration is preserved byte-for-byte as applied.

create or replace function public.marketplace_sync_pos_merchant_id(p_merchant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant public.pos_merchants%rowtype;
  v_listing_id uuid;
  v_collision_slug text;
begin
  select * into v_merchant
  from public.pos_merchants
  where id = p_merchant_id;

  if not found then
    return;
  end if;

  select ml.id into v_listing_id
  from public.marketplace_listings ml
  where ml.pos_merchant_id = v_merchant.id
  limit 1;

  if v_listing_id is not null then
    update public.marketplace_listings
    set name = case when source = 'pos' then v_merchant.name else name end,
        updated_at = now()
    where id = v_listing_id;
    return;
  end if;

  if v_merchant.business_submission_id is not null then
    select ml.id into v_listing_id
    from public.marketplace_listings ml
    where ml.business_submission_id = v_merchant.business_submission_id
      and ml.pos_merchant_id is null
    limit 1;

    if v_listing_id is not null then
      update public.marketplace_listings
      set pos_merchant_id = v_merchant.id,
          claim_review_required = false,
          updated_at = now()
      where id = v_listing_id;
      return;
    end if;
  end if;

  if exists (
    select 1 from public.marketplace_listings ml
    where ml.slug = v_merchant.slug
      and ml.pos_merchant_id is distinct from v_merchant.id
  ) then
    v_collision_slug := v_merchant.slug || '-pos-' || substr(replace(v_merchant.id::text, '-', ''), 1, 6);
    insert into public.marketplace_listings(
      slug, name, source, pos_merchant_id, publication_status,
      admin_hidden, claim_review_required
    ) values (
      v_collision_slug, v_merchant.name, 'pos', v_merchant.id, 'draft', true, true
    );
  else
    insert into public.marketplace_listings(
      slug, name, source, pos_merchant_id, publication_status,
      admin_hidden, claim_review_required
    ) values (
      v_merchant.slug, v_merchant.name, 'pos', v_merchant.id, 'draft', false, false
    );
  end if;
end;
$$;

revoke execute on function public.marketplace_sync_pos_merchant_id(uuid) from public, anon, authenticated;

create or replace function public.marketplace_sync_pos_merchant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.marketplace_sync_pos_merchant_id(new.id);
  return new;
end;
$$;

revoke execute on function public.marketplace_sync_pos_merchant() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select id from public.pos_merchants loop
    perform public.marketplace_sync_pos_merchant_id(r.id);
  end loop;
end $$;

-- POS audit actor_type uses user/customer/system/admin. The Marketplace profile
-- RPC incorrectly wrote actor_type='staff', which violated the table check and
-- made legitimate owner/manager profile saves fail atomically.

create or replace function public.pos_update_marketplace_profile(
  p_merchant_id uuid,
  p_category text,
  p_location text,
  p_barangay text default null,
  p_description text default null,
  p_descriptor text default null,
  p_facebook_page text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.marketplace_listings%rowtype;
  v_facebook text := nullif(trim(coalesce(p_facebook_page,'')), '');
begin
  if not public.pos_has_role(p_merchant_id, array['owner','manager']) then
    raise exception 'FORBIDDEN';
  end if;

  if p_category is not null and p_category <> all(array['food-drinks','catering-events','retail','beauty-wellness','services','tourism-accommodation','other']) then
    raise exception 'INVALID_CATEGORY';
  end if;
  if length(trim(coalesce(p_location,''))) > 300
     or length(trim(coalesce(p_barangay,''))) > 120
     or length(trim(coalesce(p_description,''))) > 1200
     or length(trim(coalesce(p_descriptor,''))) > 120 then
    raise exception 'VALIDATION';
  end if;
  if v_facebook is not null and v_facebook !~* '^https://(www\\.|m\\.)?(facebook\\.com|fb\\.com)/.+' then
    raise exception 'INVALID_FACEBOOK';
  end if;

  select * into v_row
  from public.marketplace_listings
  where pos_merchant_id = p_merchant_id
  for update;

  if not found then raise exception 'LISTING_NOT_FOUND'; end if;
  if v_row.claim_review_required then raise exception 'CLAIM_REVIEW_REQUIRED'; end if;

  update public.marketplace_listings
  set category = nullif(trim(coalesce(p_category,'')), ''),
      location = nullif(trim(coalesce(p_location,'')), ''),
      barangay = nullif(trim(coalesce(p_barangay,'')), ''),
      description = nullif(trim(coalesce(p_description,'')), ''),
      descriptor = nullif(trim(coalesce(p_descriptor,'')), ''),
      facebook_page = v_facebook
  where id = v_row.id
  returning * into v_row;

  insert into public.pos_audit_events(merchant_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_merchant_id, (select auth.uid()), 'user', 'marketplace.profile_updated', 'marketplace_listing', v_row.id,
          jsonb_build_object('publication_status', v_row.publication_status));

  return jsonb_build_object(
    'slug', v_row.slug,
    'publication_status', v_row.publication_status,
    'claim_review_required', v_row.claim_review_required
  );
end;
$$;

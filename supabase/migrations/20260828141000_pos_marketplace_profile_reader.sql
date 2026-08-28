create or replace function public.pos_get_marketplace_profile(p_merchant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.marketplace_listings%rowtype;
begin
  if not public.pos_has_role(p_merchant_id, array['owner','manager']) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_row
  from public.marketplace_listings
  where pos_merchant_id = p_merchant_id
  limit 1;

  if not found then return null; end if;

  return jsonb_build_object(
    'slug', v_row.slug,
    'name', v_row.name,
    'category', v_row.category,
    'location', v_row.location,
    'barangay', v_row.barangay,
    'description', v_row.description,
    'descriptor', v_row.descriptor,
    'facebook_page', v_row.facebook_page,
    'publication_status', v_row.publication_status,
    'claim_review_required', v_row.claim_review_required,
    'admin_hidden', v_row.admin_hidden,
    'updated_at', v_row.updated_at
  );
end;
$$;

grant execute on function public.pos_get_marketplace_profile(uuid) to authenticated;
revoke execute on function public.pos_get_marketplace_profile(uuid) from public, anon;

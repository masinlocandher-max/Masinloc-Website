-- The storefront database RPC is service-role only. Include the private QR
-- storage path for the Edge function so it can create a short-lived signed URL.
-- The Edge function must strip this path and unrelated internal IDs before
-- returning the public guest payload.

create or replace function public.pos_public_storefront(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'merchant_id', m.id,
    'name', m.name,
    'slug', m.slug,
    'currency', m.currency,
    'outlet', jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'dine_in_enabled', o.dine_in_enabled,
      'pickup_enabled', o.pickup_enabled,
      'delivery_enabled', o.delivery_enabled,
      'delivery_fee', o.delivery_fee,
      'minimum_delivery_order', o.minimum_delivery_order
    ),
    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pm.id,
        'method', pm.method,
        'label', pm.label,
        'requires_manual_verification', pm.requires_manual_verification,
        'instructions', pm.instructions,
        'qr_image_path', pm.qr_image_path
      ) order by pm.sort_order, pm.label)
      from public.pos_payment_methods pm
      where pm.merchant_id = m.id
        and pm.outlet_id = o.id
        and pm.enabled
    ), '[]'::jsonb)
  )
  from public.pos_merchants m
  join lateral (
    select po.*
    from public.pos_outlets po
    where po.merchant_id = m.id
      and po.active
      and po.archived_at is null
      and po.ordering_enabled
    order by po.created_at asc
    limit 1
  ) o on true
  where m.slug = lower(trim(p_slug))
    and m.status = 'active'
    and m.eligibility_status = 'verified'
  limit 1;
$$;

revoke all on function public.pos_public_storefront(text) from public, anon, authenticated;
grant execute on function public.pos_public_storefront(text) to service_role;

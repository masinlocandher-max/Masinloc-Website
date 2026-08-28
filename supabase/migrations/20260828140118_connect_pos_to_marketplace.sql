-- Connect Masinloc POS to the public Marketplace without exposing private
-- business-submission or POS-operational fields.
--
-- Public directory data gets its own table. POS creates a draft automatically,
-- but publication is derived from merchant verification + complete public copy.
-- A slug/name collision is never treated as proof of ownership: it is quarantined
-- for an admin to link explicitly.

create table public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text,
  location text,
  barangay text,
  description text,
  descriptor text,
  schema_type text not null default 'LocalBusiness',
  meta_description text,
  facebook_page text,
  source text not null default 'editorial',
  pos_merchant_id uuid unique references public.pos_merchants(id) on delete set null,
  business_submission_id uuid unique references public.business_submissions(id) on delete set null,
  publication_status text not null default 'draft',
  admin_hidden boolean not null default false,
  claim_review_required boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_listings_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint marketplace_listings_name_check check (length(trim(name)) between 1 and 120),
  constraint marketplace_listings_category_check check (category is null or category = any(array['food-drinks','catering-events','retail','beauty-wellness','services','tourism-accommodation','other'])),
  constraint marketplace_listings_source_check check (source = any(array['editorial','pos','business_submission'])),
  constraint marketplace_listings_status_check check (publication_status = any(array['draft','published','hidden'])),
  constraint marketplace_listings_schema_type_check check (schema_type = any(array['LocalBusiness','FoodEstablishment','CafeOrCoffeeShop','Bakery','Restaurant','Store','HealthAndBeautyBusiness','ProfessionalService','LodgingBusiness','TouristAttraction'])),
  constraint marketplace_listings_facebook_check check (
    facebook_page is null or facebook_page ~* '^https://(www\.|m\.)?(facebook\.com|fb\.com)/.+'
  ),
  constraint marketplace_listings_lengths_check check (
    (location is null or length(trim(location)) <= 300)
    and (barangay is null or length(trim(barangay)) <= 120)
    and (description is null or length(trim(description)) <= 1200)
    and (descriptor is null or length(trim(descriptor)) <= 120)
    and (meta_description is null or length(trim(meta_description)) <= 320)
  )
);

create index marketplace_listings_public_idx
  on public.marketplace_listings(publication_status, category, name)
  where admin_hidden = false;
create index marketplace_listings_pos_idx on public.marketplace_listings(pos_merchant_id) where pos_merchant_id is not null;

alter table public.marketplace_listings enable row level security;
revoke all on table public.marketplace_listings from anon;
revoke all on table public.marketplace_listings from authenticated;
grant select, insert, update, delete on table public.marketplace_listings to authenticated;

create policy marketplace_admin_all
on public.marketplace_listings
for all to authenticated
using ((select public.pos_is_platform_admin()))
with check ((select public.pos_is_platform_admin()));

create or replace function public.marketplace_prepare_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_eligibility text;
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

  if new.admin_hidden then
    new.publication_status := 'hidden';
  elsif new.source = 'pos' then
    if new.pos_merchant_id is null then
      new.publication_status := 'hidden';
    else
      select m.status, m.eligibility_status
      into v_status, v_eligibility
      from public.pos_merchants m
      where m.id = new.pos_merchant_id;

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

create trigger trg_marketplace_prepare_listing
before insert or update on public.marketplace_listings
for each row execute function public.marketplace_prepare_listing();

create or replace function public.marketplace_sync_pos_merchant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id uuid;
  v_collision_slug text;
begin
  select ml.id into v_listing_id
  from public.marketplace_listings ml
  where ml.pos_merchant_id = new.id
  limit 1;

  if v_listing_id is not null then
    update public.marketplace_listings
    set name = case when source = 'pos' then new.name else name end,
        updated_at = now()
    where id = v_listing_id;
    return new;
  end if;

  if new.business_submission_id is not null then
    select ml.id into v_listing_id
    from public.marketplace_listings ml
    where ml.business_submission_id = new.business_submission_id
      and ml.pos_merchant_id is null
    limit 1;

    if v_listing_id is not null then
      update public.marketplace_listings
      set pos_merchant_id = new.id,
          claim_review_required = false,
          updated_at = now()
      where id = v_listing_id;
      return new;
    end if;
  end if;

  if exists (
    select 1 from public.marketplace_listings ml
    where ml.slug = new.slug and ml.pos_merchant_id is distinct from new.id
  ) then
    v_collision_slug := new.slug || '-pos-' || substr(replace(new.id::text, '-', ''), 1, 6);
    insert into public.marketplace_listings(
      slug, name, source, pos_merchant_id, publication_status,
      admin_hidden, claim_review_required
    ) values (
      v_collision_slug, new.name, 'pos', new.id, 'draft', true, true
    );
  else
    insert into public.marketplace_listings(
      slug, name, source, pos_merchant_id, publication_status,
      admin_hidden, claim_review_required
    ) values (
      new.slug, new.name, 'pos', new.id, 'draft', false, false
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.marketplace_sync_pos_merchant() from public, anon, authenticated;

create trigger trg_marketplace_sync_pos_merchant
after insert or update of name, slug, status, eligibility_status, business_submission_id
on public.pos_merchants
for each row execute function public.marketplace_sync_pos_merchant();

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
  if v_facebook is not null and v_facebook !~* '^https://(www\.|m\.)?(facebook\.com|fb\.com)/.+' then
    raise exception 'INVALID_FACEBOOK';
  end if;

  select * into v_row
  from public.marketplace_listings
  where pos_merchant_id = p_merchant_id
  for update;

  if not found then
    raise exception 'LISTING_NOT_FOUND';
  end if;
  if v_row.claim_review_required then
    raise exception 'CLAIM_REVIEW_REQUIRED';
  end if;

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
  values (p_merchant_id, (select auth.uid()), 'staff', 'marketplace.profile_updated', 'marketplace_listing', v_row.id,
          jsonb_build_object('publication_status', v_row.publication_status));

  return jsonb_build_object(
    'slug', v_row.slug,
    'publication_status', v_row.publication_status,
    'claim_review_required', v_row.claim_review_required
  );
end;
$$;

grant execute on function public.pos_update_marketplace_profile(uuid,text,text,text,text,text,text) to authenticated;
revoke execute on function public.pos_update_marketplace_profile(uuid,text,text,text,text,text,text) from public, anon;

create or replace function public.marketplace_admin_link_pos(p_listing_id uuid, p_merchant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_existing uuid;
  v_row public.marketplace_listings%rowtype;
begin
  if not public.pos_is_platform_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if not exists (select 1 from public.pos_merchants where id = p_merchant_id) then
    raise exception 'MERCHANT_NOT_FOUND';
  end if;

  select pos_merchant_id into v_existing
  from public.marketplace_listings
  where id = p_listing_id
  for update;
  if not found then raise exception 'LISTING_NOT_FOUND'; end if;
  if v_existing is not null and v_existing <> p_merchant_id then
    raise exception 'LISTING_ALREADY_LINKED';
  end if;

  delete from public.marketplace_listings
  where pos_merchant_id = p_merchant_id
    and id <> p_listing_id
    and source = 'pos'
    and claim_review_required = true
    and publication_status in ('draft','hidden');

  update public.marketplace_listings
  set pos_merchant_id = p_merchant_id,
      claim_review_required = false,
      admin_hidden = false,
      updated_at = now()
  where id = p_listing_id
  returning * into v_row;

  insert into public.pos_audit_events(merchant_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_merchant_id, (select auth.uid()), 'admin', 'marketplace.pos_linked', 'marketplace_listing', v_row.id,
          jsonb_build_object('slug', v_row.slug));

  return jsonb_build_object('listing_id', v_row.id, 'slug', v_row.slug, 'publication_status', v_row.publication_status);
end;
$$;

grant execute on function public.marketplace_admin_link_pos(uuid,uuid) to authenticated;
revoke execute on function public.marketplace_admin_link_pos(uuid,uuid) from public, anon;

-- The seed is not dummy data. It is the exact public directory already
-- committed in data/marketplace.json, moved into the new public-safe store.
insert into public.marketplace_listings
(slug,name,category,location,barangay,description,descriptor,schema_type,meta_description,facebook_page,source,publication_status)
values
('diwan-coffee','Diwan Coffee','food-drinks','Masinloc Baywalk, Pasalubong Center Stall #8, Masinloc, Zambales','Masinloc Baywalk','Coffee, non-coffee drinks, freshly made pastries, and signature drinks including the Diwan Alon Latte and the Diwan Alon Biscoff Latte.','Coffee Shop','CafeOrCoffeeShop','Diwan Coffee is a coffee shop at Masinloc Baywalk in Masinloc, Zambales, serving coffee, non-coffee drinks and freshly made pastries. Find it on Masinloc Connect.','https://www.facebook.com/share/19N6bZoTdn/?mibextid=wwXIfr','editorial','published'),
('adalers-grazing-delights','Adaler''s Grazing Delights','catering-events','Barangay Inhobol, Masinloc, Zambales','Inhobol','Grazing tables and food stations, including kakanin, bread, street food and food offerings for events.','Catering','FoodEstablishment','Adaler''s Grazing Delights provides catering, grazing tables and food stations for events in Barangay Inhobol, Masinloc, Zambales. Find it on Masinloc Connect.','https://www.facebook.com/share/1HkafuWsjt/?mibextid=wwXIfr','editorial','published'),
('zamgyup-199-masinloc','Zamgyup 199','food-drinks','Barangay Inhobol, Masinloc, Zambales 2211','Inhobol','A Korean grill restaurant in Barangay Inhobol offering Korean-style grill dining, with dine-in, takeout and reservations listed on its Facebook page.','Korean Restaurant','Restaurant','Zamgyup 199 is a Korean grill restaurant in Barangay Inhobol, Masinloc, Zambales. View its Masinloc Connect listing and Facebook page.','https://www.facebook.com/share/1G7LLouFwr/?mibextid=wwXIfr','editorial','published'),
('tagpuan-shawarma-grill','Tagpuan Shawarma & Grill','food-drinks','Kapitan Tinong St. cor. Olongapo-Bugallon Rd., Masinloc, Zambales 2211',null,'A Masinloc bar and grill specializing in shawarma and grilled food, located at Kapitan Tinong Street corner Olongapo-Bugallon Road.','Shawarma & Grill','Restaurant','Tagpuan Shawarma & Grill serves shawarma and grilled food in Masinloc, Zambales. Find its location and Facebook contact on Masinloc Connect.','https://www.facebook.com/share/19dT1i8ubE/?mibextid=wwXIfr','editorial','published'),
('coocaati-masinloc','Coocaati','food-drinks','Conde St., North Poblacion, Masinloc, Zambales','North Poblacion','A Zambales coffee and donut brand with a Masinloc location on Conde Street, North Poblacion, serving coffee and donuts.','Coffee & Donuts','CafeOrCoffeeShop','Coocaati is a coffee and donut brand with a location on Conde Street, North Poblacion, Masinloc, Zambales. Find it on Masinloc Connect.','https://www.facebook.com/share/1RwL5znsuh/?mibextid=wwXIfr','editorial','published'),
('1418-cafe','1418 Cafe','food-drinks','Barangay Inhobol, Masinloc, Zambales 2211','Inhobol','A local café in Barangay Inhobol, Masinloc, with its Facebook page available for current offerings and inquiries.','Cafe','CafeOrCoffeeShop','1418 Cafe is a local café in Barangay Inhobol, Masinloc, Zambales. View its location and Facebook contact on Masinloc Connect.','https://www.facebook.com/share/19X8r25qkR/?mibextid=wwXIfr','editorial','published'),
('captain-wheels-car-rental','Captain Wheels','services','Barangay Inhobol, Masinloc, Zambales 2211','Inhobol','A vehicle rental service based in Barangay Inhobol, advertising sedans, SUVs, vans, pickup trucks and other rental vehicles.','Car Rental','LocalBusiness','Captain Wheels is a vehicle rental service in Barangay Inhobol, Masinloc, Zambales. View its Masinloc Connect listing and Facebook page.','https://www.facebook.com/share/1HmuayGknQ/?mibextid=wwXIfr','editorial','published'),
('cakes-by-jacq','CAKES by JACQ','food-drinks','Magsaysay Street, Masinloc, Zambales 2211',null,'A Masinloc-based cake business offering customized cakes, cupcakes and dessert treats for celebrations and special occasions.','Custom Cakes & Desserts','FoodEstablishment','CAKES by JACQ offers customized cakes, cupcakes and dessert treats in Masinloc, Zambales. Find it and message the business through Masinloc Connect.','https://www.facebook.com/share/19DKR8C3rZ/?mibextid=wwXIfr','editorial','published')
on conflict (slug) do nothing;

-- Recovery migration for public.business_submissions.
--
-- This table predates the repository but is an FK target of both
-- pos_merchants.business_submission_id and
-- marketplace_listings.business_submission_id, so without it a from-scratch
-- rebuild fails at the POS foundation migration. scripts/check-backend-contract.py
-- has been reporting the gap.
--
-- Everything below is read from the live schema (columns, defaults, checks,
-- indexes, RLS policy, trigger), not reconstructed from guesswork. It is written
-- idempotently: against production, where the table already exists, every
-- statement is a no-op. Against an empty database it builds the real thing.
--
-- The version is dated ahead of every other migration in this repository so it
-- sorts before the POS foundation that depends on it.

-- Shared updated_at trigger function. Also predates the repo; the
-- business_submissions trigger below needs it to exist.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.business_submissions (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique
    default ('MC-B-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  brand_name text not null,
  brand_logo_path text,
  store_locations text,
  contact_number text not null,
  facebook_page text not null,
  short_description text not null,
  status text not null default 'pending',
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Owner contact is private. It is never published to the Marketplace; see
  -- scripts/check-marketplace-privacy.py, which fails the build if any of these
  -- reach a public page.
  owner_name text,
  owner_email text,
  owner_phone text,
  dashboard_interest boolean not null default false,
  dashboard_interest_at timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_brand_name_len') then
    alter table public.business_submissions add constraint business_brand_name_len
      check (char_length(brand_name) >= 1 and char_length(brand_name) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_contact_len') then
    alter table public.business_submissions add constraint business_contact_len
      check (char_length(contact_number) >= 3 and char_length(contact_number) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_desc_len') then
    alter table public.business_submissions add constraint business_desc_len
      check (char_length(short_description) >= 1 and char_length(short_description) <= 1200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_facebook_len') then
    alter table public.business_submissions add constraint business_facebook_len
      check (char_length(facebook_page) >= 1 and char_length(facebook_page) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_locations_len') then
    alter table public.business_submissions add constraint business_locations_len
      check (store_locations is null or char_length(store_locations) <= 1500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_status_allowed') then
    alter table public.business_submissions add constraint business_status_allowed
      check (status = any (array['pending','reviewing','needs_review','approved','rejected','published','archived']));
  end if;
end $$;

create index if not exists business_submissions_status_created_idx
  on public.business_submissions (status, created_at desc);

drop trigger if exists business_submissions_updated_at on public.business_submissions;
create trigger business_submissions_updated_at
  before update on public.business_submissions
  for each row execute function public.set_updated_at();

-- Submissions arrive through the submit-masinloc Edge Function on the service
-- role. Browser roles get no table access at all; only a platform admin reads
-- or writes through the console.
alter table public.business_submissions enable row level security;
revoke all on table public.business_submissions from anon, authenticated;

drop policy if exists admin_manage_business on public.business_submissions;
create policy admin_manage_business on public.business_submissions
  for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

comment on table public.business_submissions is
  'Masinloc Connect business submissions. Contains both public business detail and private owner contact; only the public subset may ever reach the Marketplace.';

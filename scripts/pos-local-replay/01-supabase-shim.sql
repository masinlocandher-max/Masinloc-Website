-- Minimal Supabase-compatible substrate so the recovered migrations can be
-- replayed on a stock Postgres. Everything here mirrors what Supabase provides
-- before the first project migration runs; nothing here is project code.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;

create schema if not exists auth authorization postgres;
create schema if not exists storage authorization postgres;
create schema if not exists extensions authorization postgres;

create extension if not exists pgcrypto with schema extensions;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;

-- auth.users: only the columns the POS migrations actually reference.
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud text,
  role text,
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- PostgREST sets request.jwt.claims per request; these read it exactly as
-- Supabase's own helpers do.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

-- storage: buckets/objects and foldername(), used by the payment-asset policies.
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select string_to_array(name, '/');
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- Realtime publication the guardrails migration adds tables to.
create publication supabase_realtime;

-- business_submissions is no longer stubbed here. It is an FK target of
-- pos_merchants and marketplace_listings, and it now has a real migration
-- (20260816000000_create_business_submissions.sql) recovered from the live
-- schema, so the replay below builds it the same way production has it.

-- Recovery migration for the professional-directory core.
--
-- Like business_submissions, these objects predate the repository and have no
-- migration here, so a from-scratch rebuild failed at
-- 20260823151416_harden_professional_visibility_function_and_fk_indexes.sql
-- ("function public.sync_professional_employer_visibility() does not exist")
-- and at 20260823152139_harden_service_only_security_objects.sql
-- ("relation public.masinloc_profile_code_sequences does not exist").
--
-- Every definition below is read from the live schema — columns, defaults,
-- check constraints, foreign keys, partial indexes, RLS state, policies,
-- triggers and function bodies — not reconstructed from guesswork. Written
-- idempotently: against production every statement is a no-op; against an
-- empty database it builds what production actually has.

-- ---------------------------------------------------------------------------
-- Profile-code allocator. Internal state for next_masinloc_profile_code().
-- ---------------------------------------------------------------------------
create table if not exists public.masinloc_profile_code_sequences (
  period_key text primary key,
  last_value integer not null,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'masinloc_profile_code_sequences_last_value_check') then
    alter table public.masinloc_profile_code_sequences
      add constraint masinloc_profile_code_sequences_last_value_check check (last_value > 0);
  end if;
end $$;

alter table public.masinloc_profile_code_sequences enable row level security;
revoke all on table public.masinloc_profile_code_sequences from anon, authenticated;

create or replace function public.next_masinloc_profile_code()
returns text
language plpgsql
set search_path to 'public'
as $$
declare
  v_local timestamp;
  v_month text;
  v_year text;
  v_period text;
  v_seq integer;
begin
  v_local := timezone('Asia/Manila', now());
  v_month := to_char(v_local, 'MM');
  v_year := to_char(v_local, 'YYYY');
  v_period := v_year || '-' || v_month;

  insert into public.masinloc_profile_code_sequences(period_key, last_value, updated_at)
  values (v_period, 1, now())
  on conflict (period_key)
  do update set
    last_value = public.masinloc_profile_code_sequences.last_value + 1,
    updated_at = now()
  returning last_value into v_seq;

  return 'MC-' || v_month || '-' || v_year || '-' || lpad(v_seq::text, 3, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- professional_submissions. Contains personal contact data; browser roles get
-- no table access at all, only a platform admin reads or writes it.
-- ---------------------------------------------------------------------------
create table if not exists public.professional_submissions (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique default public.next_masinloc_profile_code(),
  full_name text not null,
  profession text not null,
  skills text not null,
  current_location text not null,
  contact_number text not null,
  professional_link text,
  professional_description text not null,
  public_profile boolean not null,
  status text not null default 'pending',
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text,
  profile_payload jsonb not null default '{}'::jsonb,
  resume_snapshot jsonb,
  final_reviewed_at timestamptz,
  normalized_mobile text,
  normalized_email text,
  employer_sharing_consent boolean not null default false,
  employer_sharing_consented_at timestamptz,
  employer_sharing_consent_version text,
  job_seeking_status text not null default 'not_looking',
  availability_updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employer_sharing_consent_timestamp_check') then
    alter table public.professional_submissions add constraint employer_sharing_consent_timestamp_check
      check (((employer_sharing_consent = true) and (employer_sharing_consented_at is not null))
          or ((employer_sharing_consent = false) and (employer_sharing_consented_at is null)));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'professional_contact_len') then
    alter table public.professional_submissions add constraint professional_contact_len
      check (char_length(contact_number) >= 3 and char_length(contact_number) <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'professional_desc_len') then
    alter table public.professional_submissions add constraint professional_desc_len
      check (char_length(professional_description) >= 1 and char_length(professional_description) <= 1800);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'professional_email_len') then
    alter table public.professional_submissions add constraint professional_email_len
      check (email is null or char_length(email) <= 320);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'professional_job_seeking_status_allowed') then
    alter table public.professional_submissions add constraint professional_job_seeking_status_allowed
      check (job_seeking_status = any (array['looking','not_looking']));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'professional_link_len') then
    alter table public.professional_submissions add constraint professional_link_len
      check (professional_link is null or char_length(professional_link) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'professional_location_len') then
    alter table public.professional_submissions add constraint professional_location_len
      check (char_length(current_location) >= 1 and char_length(current_location) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'professional_name_len') then
    alter table public.professional_submissions add constraint professional_name_len
      check (char_length(full_name) >= 1 and char_length(full_name) <= 160);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'professional_profession_len') then
    alter table public.professional_submissions add constraint professional_profession_len
      check (char_length(profession) >= 1 and char_length(profession) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'professional_skills_len') then
    alter table public.professional_submissions add constraint professional_skills_len
      check (char_length(skills) >= 1 and char_length(skills) <= 2500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'professional_status_allowed') then
    alter table public.professional_submissions add constraint professional_status_allowed
      check (status = any (array['pending','private','reviewing','needs_review','approved','rejected','published','archived']));
  end if;
end $$;

create index if not exists professional_submissions_status_created_idx
  on public.professional_submissions (status, created_at desc);
create index if not exists professional_submissions_public_idx
  on public.professional_submissions (public_profile, status) where public_profile = true;
create index if not exists professional_submissions_normalized_email_idx
  on public.professional_submissions (normalized_email) where normalized_email is not null;
create index if not exists professional_submissions_normalized_mobile_idx
  on public.professional_submissions (normalized_mobile) where normalized_mobile is not null;
create index if not exists professional_submissions_employer_sharing_idx
  on public.professional_submissions (employer_sharing_consent, status, created_at desc)
  where employer_sharing_consent = true;
create index if not exists professional_available_employer_idx
  on public.professional_submissions (created_at desc)
  where job_seeking_status = 'looking'
    and employer_sharing_consent = true
    and status = any (array['private','reviewing','approved']);

-- Keeps employer-sharing consent and its timestamp in lockstep with the
-- job-seeking status, so the consent check constraint above can never be
-- violated by a partial update.
create or replace function public.sync_professional_employer_visibility()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$ begin if tg_op = 'INSERT' or new.job_seeking_status is distinct from old.job_seeking_status then new.availability_updated_at := now(); end if; if new.job_seeking_status = 'looking' then new.employer_sharing_consent := true; if tg_op = 'INSERT' or old.employer_sharing_consent is distinct from true or old.employer_sharing_consented_at is null then new.employer_sharing_consented_at := now(); end if; else new.employer_sharing_consent := false; new.employer_sharing_consented_at := null; end if; return new; end; $$;

drop trigger if exists professional_submissions_updated_at on public.professional_submissions;
create trigger professional_submissions_updated_at
  before update on public.professional_submissions
  for each row execute function public.set_updated_at();

drop trigger if exists professional_sync_employer_visibility on public.professional_submissions;
create trigger professional_sync_employer_visibility
  before insert or update of job_seeking_status on public.professional_submissions
  for each row execute function public.sync_professional_employer_visibility();

alter table public.professional_submissions enable row level security;
revoke all on table public.professional_submissions from anon, authenticated;

drop policy if exists admin_manage_professional on public.professional_submissions;
create policy admin_manage_professional on public.professional_submissions
  for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- ---------------------------------------------------------------------------
-- Challenge tables. Short-lived verification state written only by trusted
-- Edge Functions on the service role; no policies, so RLS denies everyone else.
-- ---------------------------------------------------------------------------
create table if not exists public.professional_duplicate_challenges (
  token uuid primary key default gen_random_uuid(),
  professional_submission_id uuid not null
    references public.professional_submissions(id) on delete cascade,
  match_reason text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now()
);

create index if not exists professional_duplicate_challenges_expiry_idx
  on public.professional_duplicate_challenges (expires_at);
create index if not exists professional_duplicate_challenges_submission_idx
  on public.professional_duplicate_challenges (professional_submission_id);

alter table public.professional_duplicate_challenges enable row level security;
revoke all on table public.professional_duplicate_challenges from anon, authenticated;

create table if not exists public.professional_recovery_challenges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    references public.professional_submissions(id) on delete cascade,
  question_keys text[] not null default '{}'::text[],
  attempts integer not null default 0,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'professional_recovery_challenges_attempts_check') then
    alter table public.professional_recovery_challenges
      add constraint professional_recovery_challenges_attempts_check
      check (attempts >= 0 and attempts <= 5);
  end if;
end $$;

create index if not exists professional_recovery_challenges_expires_idx
  on public.professional_recovery_challenges (expires_at);
create index if not exists professional_recovery_challenges_profile_idx
  on public.professional_recovery_challenges (profile_id);

alter table public.professional_recovery_challenges enable row level security;
revoke all on table public.professional_recovery_challenges from anon, authenticated;

comment on table public.professional_submissions is
  'Masinloc Connect professional directory submissions. Contains personal contact data; only the public subset may ever reach a public page.';

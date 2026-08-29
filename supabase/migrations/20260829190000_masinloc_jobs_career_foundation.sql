create table public.member_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  mobile text,
  current_location text,
  onboarding_status text not null default 'new' check (onboarding_status in ('new','career_started','career_ready')),
  privacy_policy_version text,
  privacy_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (display_name is null or char_length(display_name) <= 160),
  check (mobile is null or char_length(mobile) <= 80),
  check (current_location is null or char_length(current_location) <= 300)
);

comment on table public.member_profiles is 'Private Masinloc Connect account profile keyed to Supabase Auth. Shared identity layer for Jobs and future Connect utilities.';

create table public.career_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  legacy_professional_submission_id uuid unique references public.professional_submissions(id) on delete set null,
  full_name text,
  preferred_email text,
  mobile text,
  current_location text,
  target_roles text[] not null default '{}',
  skills text[] not null default '{}',
  education_level text,
  school text,
  work_experience jsonb not null default '[]'::jsonb,
  training text[] not null default '{}',
  certifications text[] not null default '{}',
  languages text[] not null default '{}',
  profile_summary text,
  availability text,
  profile_completion integer not null default 0 check (profile_completion between 0 and 100),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (full_name is null or char_length(full_name) <= 160),
  check (preferred_email is null or char_length(preferred_email) <= 320),
  check (mobile is null or char_length(mobile) <= 80),
  check (current_location is null or char_length(current_location) <= 300),
  check (profile_summary is null or char_length(profile_summary) <= 2000),
  check (jsonb_typeof(work_experience) = 'array')
);

comment on table public.career_profiles is 'Private structured career identity used to build resumes and match external job opportunities. Distinct from legacy moderated professional submissions.';

create table public.job_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  target_roles text[] not null default '{}',
  preferred_locations text[] not null default '{}',
  remote_ok boolean not null default false,
  relocation_ok boolean not null default false,
  abroad_ok boolean not null default false,
  employment_types text[] not null default '{}',
  expected_salary_min numeric,
  expected_salary_max numeric,
  notify_new_matches boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expected_salary_min is null or expected_salary_min >= 0),
  check (expected_salary_max is null or expected_salary_max >= 0),
  check (expected_salary_min is null or expected_salary_max is null or expected_salary_max >= expected_salary_min)
);

comment on table public.job_preferences is 'Private job-search preferences. Kept separate from resume facts so users can change where and how they want to work without rewriting their resume.';

create table public.resume_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My Resume',
  target_role text,
  template_code text not null default 'clean_v1',
  resume_snapshot jsonb not null default '{}'::jsonb,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(name) between 1 and 120),
  check (target_role is null or char_length(target_role) <= 200),
  check (template_code ~ '^[a-z0-9_]+$'),
  check (jsonb_typeof(resume_snapshot) = 'object')
);

create unique index resume_versions_one_primary_per_user on public.resume_versions(user_id) where is_primary;
create index resume_versions_user_idx on public.resume_versions(user_id, updated_at desc);

comment on table public.resume_versions is 'User-owned generated resume snapshots. Career Profile remains source of truth; resume versions are application-ready outputs.';

create table public.job_providers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  integration_type text not null check (integration_type in ('api','embed','curated')),
  render_mode text not null check (render_mode in ('native','embed','linkout')),
  application_mode text not null check (application_mode in ('handoff','partner_apply','native')),
  status text not null default 'planned' check (status in ('planned','testing','live','paused')),
  attribution_label text not null,
  homepage_url text,
  public_note text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code ~ '^[a-z0-9_]+$'),
  check (char_length(name) between 1 and 120),
  check (char_length(attribution_label) between 1 and 120)
);

comment on table public.job_providers is 'Public-safe provider registry. Contains no credentials. Provider secrets belong only in Edge Function environment configuration.';

insert into public.job_providers (code,name,integration_type,render_mode,application_mode,status,attribution_label,homepage_url,public_note) values
  ('indeed','Indeed','embed','embed','handoff','planned','From Indeed','https://www.indeed.com/','Requires approved Indeed partner/publisher access before going live.'),
  ('philjobnet','PhilJobNet','curated','linkout','handoff','planned','From PhilJobNet','https://philjobnet.gov.ph/','Official Philippine employment source; live ingestion method must be approved before activation.'),
  ('csc','Civil Service Commission','curated','linkout','handoff','planned','From CSC','https://csc.gov.ph/','Government vacancies source; use only approved/publicly reusable metadata.'),
  ('dmw','Department of Migrant Workers','curated','linkout','handoff','planned','From DMW','https://dmw.gov.ph/','Overseas opportunities must preserve official source attribution and verification context.'),
  ('upwork','Upwork','api','native','handoff','planned','From Upwork','https://www.upwork.com/','Requires approved API credentials and compliance with provider terms.'),
  ('onlinejobs','OnlineJobs.ph','curated','linkout','handoff','planned','From OnlineJobs.ph','https://www.onlinejobs.ph/','Activation requires a permitted integration or curated metadata workflow.'),
  ('jobstreet','JobStreet / SEEK','api','native','handoff','planned','From JobStreet','https://www.jobstreet.com.ph/','Requires SEEK partner/API approval before activation.')
on conflict (code) do update set
  name = excluded.name,
  integration_type = excluded.integration_type,
  render_mode = excluded.render_mode,
  application_mode = excluded.application_mode,
  attribution_label = excluded.attribution_label,
  homepage_url = excluded.homepage_url,
  public_note = excluded.public_note,
  updated_at = now();

create table public.external_jobs (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.job_providers(id) on delete restrict,
  external_job_id text not null,
  title text not null,
  company text,
  location text,
  work_setup text,
  employment_type text,
  salary_text text,
  description_excerpt text,
  requirements_excerpt text,
  published_at timestamptz,
  expires_at timestamptz,
  source_url text not null,
  apply_url text not null,
  canonical_key text,
  last_verified_at timestamptz not null default now(),
  cache_expires_at timestamptz not null,
  provider_metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_id, external_job_id),
  check (char_length(external_job_id) between 1 and 500),
  check (char_length(title) between 1 and 300),
  check (company is null or char_length(company) <= 300),
  check (location is null or char_length(location) <= 300),
  check (salary_text is null or char_length(salary_text) <= 300),
  check (description_excerpt is null or char_length(description_excerpt) <= 4000),
  check (requirements_excerpt is null or char_length(requirements_excerpt) <= 4000),
  check (jsonb_typeof(provider_metadata) = 'object')
);

create index external_jobs_active_fresh_idx on public.external_jobs(is_active, cache_expires_at desc, published_at desc);
create index external_jobs_provider_idx on public.external_jobs(provider_id, published_at desc);
create index external_jobs_location_idx on public.external_jobs(location);

comment on table public.external_jobs is 'Short-lived normalized cache of provider-permitted external job metadata. Not a permanent mirror of third-party job boards.';

create table public.saved_jobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  external_job_id uuid not null references public.external_jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, external_job_id)
);

create index saved_jobs_user_created_idx on public.saved_jobs(user_id, created_at desc);

create table public.application_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_job_id uuid references public.external_jobs(id) on delete set null,
  resume_version_id uuid references public.resume_versions(id) on delete set null,
  status text not null default 'preparing' check (status in ('preparing','ready_to_apply','handed_off','applied_confirmed','interview','offer','hired','not_pursuing')),
  job_snapshot jsonb not null default '{}'::jsonb,
  handed_off_at timestamptz,
  user_confirmed_applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(job_snapshot) = 'object')
);

create index application_activity_user_idx on public.application_activity(user_id, updated_at desc);
create index application_activity_job_idx on public.application_activity(external_job_id);

comment on table public.application_activity is 'User-owned application journey. A handed-off external job is not marked applied until the user confirms it or a future authorized provider integration confirms it.';

create or replace function public.create_masinloc_member_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.member_profiles(user_id, display_name)
  values (new.id, nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'full_name','')),160),''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_masinloc_member_profile() from public;

drop trigger if exists masinloc_create_member_profile on auth.users;
create trigger masinloc_create_member_profile
after insert on auth.users
for each row execute function public.create_masinloc_member_profile();

insert into public.member_profiles(user_id, display_name)
select id, nullif(left(trim(coalesce(raw_user_meta_data ->> 'full_name','')),160),'')
from auth.users
on conflict (user_id) do nothing;

create trigger member_profiles_touch_updated_at before update on public.member_profiles for each row execute function public.set_updated_at();
create trigger career_profiles_touch_updated_at before update on public.career_profiles for each row execute function public.set_updated_at();
create trigger job_preferences_touch_updated_at before update on public.job_preferences for each row execute function public.set_updated_at();
create trigger resume_versions_touch_updated_at before update on public.resume_versions for each row execute function public.set_updated_at();
create trigger job_providers_touch_updated_at before update on public.job_providers for each row execute function public.set_updated_at();
create trigger external_jobs_touch_updated_at before update on public.external_jobs for each row execute function public.set_updated_at();
create trigger application_activity_touch_updated_at before update on public.application_activity for each row execute function public.set_updated_at();

alter table public.member_profiles enable row level security;
alter table public.career_profiles enable row level security;
alter table public.job_preferences enable row level security;
alter table public.resume_versions enable row level security;
alter table public.job_providers enable row level security;
alter table public.external_jobs enable row level security;
alter table public.saved_jobs enable row level security;
alter table public.application_activity enable row level security;

create policy member_profiles_own on public.member_profiles for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy member_profiles_admin on public.member_profiles for all to authenticated using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin') with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy career_profiles_own on public.career_profiles for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy career_profiles_admin on public.career_profiles for all to authenticated using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin') with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy job_preferences_own on public.job_preferences for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy job_preferences_admin on public.job_preferences for all to authenticated using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin') with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy resume_versions_own on public.resume_versions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy resume_versions_admin on public.resume_versions for all to authenticated using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin') with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy job_providers_public_read on public.job_providers for select to anon, authenticated using (status in ('testing','live'));
create policy job_providers_admin on public.job_providers for all to authenticated using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin') with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy external_jobs_public_read on public.external_jobs for select to anon, authenticated using (
  is_active = true
  and cache_expires_at > now()
  and exists (select 1 from public.job_providers p where p.id = provider_id and p.status in ('testing','live'))
);
create policy external_jobs_admin on public.external_jobs for all to authenticated using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin') with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy saved_jobs_own on public.saved_jobs for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy saved_jobs_admin on public.saved_jobs for all to authenticated using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin') with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');
create policy application_activity_own on public.application_activity for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy application_activity_admin on public.application_activity for all to authenticated using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin') with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

grant select, insert, update on public.member_profiles to authenticated;
grant select, insert, update on public.career_profiles to authenticated;
grant select, insert, update on public.job_preferences to authenticated;
grant select, insert, update, delete on public.resume_versions to authenticated;
grant select on public.job_providers to anon, authenticated;
grant select on public.external_jobs to anon, authenticated;
grant select, insert, delete on public.saved_jobs to authenticated;
grant select, insert, update, delete on public.application_activity to authenticated;

revoke insert, update, delete on public.job_providers from anon, authenticated;
revoke insert, update, delete on public.external_jobs from anon, authenticated;

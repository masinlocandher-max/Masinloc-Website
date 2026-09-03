-- Recovery migration for the last two pre-repository submission tables.
--
-- story_submissions and resume_support_submissions predate this repository and
-- had no migration here; scripts/check-backend-contract.py listed both under
-- "not version-controlled". They are read and written by the admin console
-- (admin.js), so a database rebuilt from this repository alone would leave two
-- admin tabs broken.
--
-- resume_support_submissions also carries a foreign key to
-- professional_submissions, so it has to sort after 20260816000001.
--
-- Read from the live schema, written idempotently: against production every
-- statement is a no-op; against an empty database it builds the real thing.
-- Both hold personal contact data, so browser roles get no table access at all
-- and only a platform admin reaches them.

create table if not exists public.story_submissions (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique
    default ('MC-S-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  title text not null,
  about text not null,
  story text not null,
  contributor_name text not null,
  contributor_contact text not null,
  location text,
  attachment_paths text[] not null default '{}'::text[],
  status text not null default 'pending',
  internal_notes text,
  verification_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resume_support_submissions (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique
    default ('MC-R-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  professional_submission_id uuid
    references public.professional_submissions(id) on delete set null,
  full_name text,
  contact_number text,
  profession text,
  target_job text not null,
  preferred_location text,
  remote_work text,
  school text not null,
  education text not null,
  work_experience text not null,
  training text,
  achievements text,
  skills text,
  languages text,
  existing_resume_path text,
  status text not null default 'pending',
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'story_about_len') then
    alter table public.story_submissions add constraint story_about_len
      check (char_length(about) >= 1 and char_length(about) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'story_attachment_count') then
    alter table public.story_submissions add constraint story_attachment_count
      check (cardinality(attachment_paths) <= 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'story_body_len') then
    alter table public.story_submissions add constraint story_body_len
      check (char_length(story) >= 1 and char_length(story) <= 12000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'story_contributor_contact_len') then
    alter table public.story_submissions add constraint story_contributor_contact_len
      check (char_length(contributor_contact) >= 3 and char_length(contributor_contact) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'story_contributor_name_len') then
    alter table public.story_submissions add constraint story_contributor_name_len
      check (char_length(contributor_name) >= 1 and char_length(contributor_name) <= 160);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'story_location_len') then
    alter table public.story_submissions add constraint story_location_len
      check (location is null or char_length(location) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'story_status_allowed') then
    alter table public.story_submissions add constraint story_status_allowed
      check (status = any (array['pending','reviewing','needs_review','approved','rejected','published','archived']));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'story_title_len') then
    alter table public.story_submissions add constraint story_title_len
      check (char_length(title) >= 1 and char_length(title) <= 180);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'resume_achievements_len') then
    alter table public.resume_support_submissions add constraint resume_achievements_len
      check (achievements is null or char_length(achievements) <= 5000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resume_education_len') then
    alter table public.resume_support_submissions add constraint resume_education_len
      check (char_length(education) >= 1 and char_length(education) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resume_experience_len') then
    alter table public.resume_support_submissions add constraint resume_experience_len
      check (char_length(work_experience) >= 1 and char_length(work_experience) <= 10000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resume_languages_len') then
    alter table public.resume_support_submissions add constraint resume_languages_len
      check (languages is null or char_length(languages) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resume_school_len') then
    alter table public.resume_support_submissions add constraint resume_school_len
      check (char_length(school) >= 1 and char_length(school) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resume_status_allowed') then
    alter table public.resume_support_submissions add constraint resume_status_allowed
      check (status = any (array['pending','in_progress','completed','declined','archived']));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resume_target_len') then
    alter table public.resume_support_submissions add constraint resume_target_len
      check (char_length(target_job) >= 1 and char_length(target_job) <= 220);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resume_training_len') then
    alter table public.resume_support_submissions add constraint resume_training_len
      check (training is null or char_length(training) <= 5000);
  end if;
end $$;

create index if not exists story_submissions_status_created_idx
  on public.story_submissions (status, created_at desc);
create index if not exists resume_support_status_created_idx
  on public.resume_support_submissions (status, created_at desc);
create index if not exists resume_support_professional_submission_idx
  on public.resume_support_submissions (professional_submission_id);

drop trigger if exists story_submissions_updated_at on public.story_submissions;
create trigger story_submissions_updated_at
  before update on public.story_submissions
  for each row execute function public.set_updated_at();

drop trigger if exists resume_support_submissions_updated_at on public.resume_support_submissions;
create trigger resume_support_submissions_updated_at
  before update on public.resume_support_submissions
  for each row execute function public.set_updated_at();

alter table public.story_submissions enable row level security;
alter table public.resume_support_submissions enable row level security;
revoke all on table public.story_submissions from anon, authenticated;
revoke all on table public.resume_support_submissions from anon, authenticated;

drop policy if exists admin_manage_story on public.story_submissions;
create policy admin_manage_story on public.story_submissions
  for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists admin_manage_resume on public.resume_support_submissions;
create policy admin_manage_resume on public.resume_support_submissions
  for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

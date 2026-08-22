-- Sambal Tina community contributions.
--
-- The dictionary page can already take a word or a correction and show a
-- contributor roll. This is the table behind it.
--
-- Intake is the edge function, which runs as the service role; the browser
-- never reads this table. Contributor names reach the public page only through
-- the function's read-only contributors endpoint, and only once an admin has
-- approved the row. Contact details are therefore unreachable from the client
-- by construction rather than by remembering to filter them.
create table if not exists public.dictionary_submissions (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null default ('MC-D-' || upper(substr(replace((gen_random_uuid())::text, '-', ''), 1, 10))),
  submission_type text not null default 'new_entry'
    check (submission_type in ('new_entry', 'correction')),
  headword text not null,
  filipino_meaning text,
  english_meaning text,
  contribution_details text,
  example_usage text,
  contributor_name text not null,
  contributor_contact text not null,
  credit_name text,
  credit_consent boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'reviewing', 'needs_review', 'approved', 'rejected', 'published', 'archived')),
  verification_notes text,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dictionary_submissions is
  'Community word and correction submissions for the Sambal Tina dictionary. Nothing is published automatically: a contributor is credited publicly only after an admin sets the status to approved or published, and only when credit_consent is true.';
comment on column public.dictionary_submissions.contributor_contact is
  'Private. For verification only. Never exposed to the public site.';
comment on column public.dictionary_submissions.credit_name is
  'Optional display name for the public contributors list. Falls back to contributor_name.';

create unique index if not exists dictionary_submissions_reference_code_key
  on public.dictionary_submissions (reference_code);

-- The contributors endpoint filters on status and consent; the admin list
-- sorts by recency.
create index if not exists dictionary_submissions_credited_idx
  on public.dictionary_submissions (status, created_at desc)
  where credit_consent;
create index if not exists dictionary_submissions_created_at_idx
  on public.dictionary_submissions (created_at desc);

alter table public.dictionary_submissions enable row level security;

-- Mirrors admin_manage_story: signed-in admins only. anon gets nothing.
drop policy if exists admin_manage_dictionary on public.dictionary_submissions;
create policy admin_manage_dictionary on public.dictionary_submissions
  for all to authenticated
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
  with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

revoke all on public.dictionary_submissions from anon;

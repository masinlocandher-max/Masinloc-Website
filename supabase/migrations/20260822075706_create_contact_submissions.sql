-- Contact messages from the public site.
--
-- There is no inbox integration and no auto-reply: a message lands here, an
-- admin reads it in the console and gets back to the sender themselves. That
-- is the whole design. Nothing about a message is ever shown publicly.
create table if not exists public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null default ('MC-C-' || upper(substr(replace((gen_random_uuid())::text, '-', ''), 1, 10))),
  sender_name text not null,
  sender_email text not null,
  sender_phone text,
  topic text not null default 'general'
    check (topic in ('general', 'business', 'language', 'history', 'correction', 'media', 'other')),
  subject text,
  message text not null,
  status text not null default 'new'
    check (status in ('new', 'reading', 'replied', 'closed', 'spam', 'archived')),
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.contact_submissions is
  'Messages sent through the public contact form. Read by an admin in the console, who replies to the sender directly. Never published, never surfaced on the public site.';
comment on column public.contact_submissions.sender_email is
  'Private. The address an admin replies to. Never exposed publicly.';

create unique index if not exists contact_submissions_reference_code_key
  on public.contact_submissions (reference_code);
create index if not exists contact_submissions_created_at_idx
  on public.contact_submissions (created_at desc);
create index if not exists contact_submissions_status_idx
  on public.contact_submissions (status, created_at desc);

alter table public.contact_submissions enable row level security;

drop policy if exists admin_manage_contact on public.contact_submissions;
create policy admin_manage_contact on public.contact_submissions
  for all to authenticated
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
  with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

revoke all on public.contact_submissions from anon;

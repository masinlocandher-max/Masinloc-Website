-- The editable dictionary layer.
--
-- The 5,222-entry archive is a static file built from the transcription and
-- is deliberately immutable: it is a record of what the source says. This
-- table is everything an editor adds on top — a new word, a corrected
-- reading, a gloss the archive never carried — and the public page merges it
-- over the archive at read time.
--
-- Keeping the two apart is the point. The archive keeps saying what the
-- source said; corrections are visibly corrections, attributed and dated,
-- rather than a silent rewrite of the record.
create table if not exists public.dictionary_entries (
  id uuid primary key default gen_random_uuid(),
  tina text not null,
  pos text,
  en text,
  fil text,
  example text,
  example_en text,
  note text,
  -- How this entry relates to the archive, so the page can label it honestly.
  layer text not null default 'living'
    check (layer in ('living', 'correction', 'new')),
  credit_name text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'retired')),
  internal_notes text,
  source_submission_id uuid references public.dictionary_submissions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dictionary_entries is
  'Editor-maintained Sambal Tina entries layered over the static archive. Only status=published rows are readable by the public, and only through the safe columns granted below.';
comment on column public.dictionary_entries.layer is
  'living = speaker-confirmed usage; correction = corrects an archive reading; new = a word the archive does not carry.';
comment on column public.dictionary_entries.internal_notes is
  'Private editorial notes. Never granted to anon.';

create index if not exists dictionary_entries_published_idx
  on public.dictionary_entries (status, tina);
create index if not exists dictionary_entries_updated_idx
  on public.dictionary_entries (updated_at desc);

alter table public.dictionary_entries enable row level security;

-- Editors manage everything.
drop policy if exists admin_manage_dictionary_entries on public.dictionary_entries;
create policy admin_manage_dictionary_entries on public.dictionary_entries
  for all to authenticated
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin')
  with check ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

-- The public reads published rows only. Row-level access is not enough on its
-- own: without column grants a reader could still select internal_notes off a
-- published row, so the private columns are simply never granted.
drop policy if exists public_read_published_entries on public.dictionary_entries;
create policy public_read_published_entries on public.dictionary_entries
  for select to anon, authenticated
  using (status = 'published');

revoke all on public.dictionary_entries from anon;
grant select (id, tina, pos, en, fil, example, example_en, note, layer,
              credit_name, status, updated_at)
  on public.dictionary_entries to anon;

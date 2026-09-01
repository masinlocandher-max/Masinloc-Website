-- Shared Masinloc Connect bookmark state for the mobile experience.
-- This stores only references to canonical website content. It does not copy
-- Marketplace, Mabayani, or Sambal Tina records into a second content source.

create table if not exists public.saved_content (
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('marketplace', 'mabayani', 'dictionary')),
  content_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, content_type, content_key)
);

alter table public.saved_content enable row level security;

drop policy if exists saved_content_own_select on public.saved_content;
create policy saved_content_own_select
  on public.saved_content
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists saved_content_own_insert on public.saved_content;
create policy saved_content_own_insert
  on public.saved_content
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists saved_content_own_delete on public.saved_content;
create policy saved_content_own_delete
  on public.saved_content
  for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists saved_content_user_type_created_idx
  on public.saved_content(user_id, content_type, created_at desc);

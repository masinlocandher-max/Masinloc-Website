-- Keep public dictionary reads anonymous-only, while authenticated table
-- privileges are reserved by RLS for app_metadata.role = 'admin'.
drop policy if exists public_read_published_entries on public.dictionary_entries;
create policy public_read_published_entries on public.dictionary_entries
  for select to anon
  using (status = 'published');

grant select, insert, update on public.dictionary_entries to authenticated;
grant select, update on public.contact_submissions to authenticated;

-- The admin UI treats security events as read-only. Remove the older broad
-- policy and keep only the explicit admin SELECT policy created by the repo.
drop policy if exists admin_manage_security_events on public.security_events;
grant select on public.security_events to authenticated;
revoke update, delete on public.security_events from authenticated;

-- Production had duplicate dashboard-era copies of the same indexes.
drop index if exists public.security_events_created_idx;
drop index if exists public.security_events_severity_created_idx;

-- Cover the dictionary_entries -> dictionary_submissions foreign key.
create index if not exists dictionary_entries_source_submission_id_idx
  on public.dictionary_entries(source_submission_id);

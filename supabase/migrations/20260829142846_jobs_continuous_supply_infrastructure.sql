create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table if not exists public.job_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.job_providers(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed','skipped')),
  source_items_seen integer not null default 0 check (source_items_seen >= 0),
  jobs_selected integer not null default 0 check (jobs_selected >= 0),
  jobs_inserted integer not null default 0 check (jobs_inserted >= 0),
  jobs_updated integer not null default 0 check (jobs_updated >= 0),
  jobs_expired integer not null default 0 check (jobs_expired >= 0),
  pages_fetched integer not null default 0 check (pages_fetched >= 0),
  message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create index if not exists job_sync_runs_provider_started_idx on public.job_sync_runs(provider_id, started_at desc);
alter table public.job_sync_runs enable row level security;

revoke all on public.job_sync_runs from anon, authenticated;
grant select on public.job_sync_runs to authenticated;

drop policy if exists "Admins can read job sync runs" on public.job_sync_runs;
create policy "Admins can read job sync runs"
on public.job_sync_runs for select
to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

comment on table public.job_sync_runs is 'Internal audit log for recurring official-source job supply refreshes.';
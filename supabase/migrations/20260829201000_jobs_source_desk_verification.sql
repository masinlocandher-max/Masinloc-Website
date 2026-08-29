alter table public.external_jobs add column if not exists verification_status text not null default 'draft';
alter table public.external_jobs add column if not exists source_checked_at timestamptz;
alter table public.external_jobs add column if not exists verification_method text;
alter table public.external_jobs add column if not exists closing_date timestamptz;
alter table public.external_jobs add column if not exists stale_after timestamptz;
alter table public.external_jobs add column if not exists curator_note text;
alter table public.external_jobs add column if not exists last_seen_active_at timestamptz;
alter table public.external_jobs add column if not exists curator_user_id uuid references auth.users(id) on delete set null;
alter table public.external_jobs add column if not exists verified_by_user_id uuid references auth.users(id) on delete set null;

do $$ begin
  alter table public.external_jobs add constraint external_jobs_verification_status_check check (verification_status in ('draft','verified','live','needs_recheck','expired','rejected'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.external_jobs add constraint external_jobs_verification_method_check check (verification_method is null or verification_method in ('official_source','provider_api','provider_embed','manual_check','other'));
exception when duplicate_object then null; end $$;

create index if not exists external_jobs_verification_status_idx on public.external_jobs (verification_status);
create index if not exists external_jobs_closing_date_idx on public.external_jobs (closing_date);
create index if not exists external_jobs_stale_after_idx on public.external_jobs (stale_after);

drop policy if exists external_jobs_public_read on public.external_jobs;
create policy external_jobs_public_read
on public.external_jobs
for select
to anon, authenticated
using (
  verification_status = 'live'
  and is_active = true
  and cache_expires_at > now()
  and (closing_date is null or closing_date > now())
  and (stale_after is null or stale_after > now())
  and exists (
    select 1
    from public.job_providers p
    where p.id = external_jobs.provider_id
      and p.status in ('testing','live')
  )
);

update public.job_providers
set status='testing', integration_type='curated', render_mode='linkout', application_mode='handoff', updated_at=now()
where code in ('philjobnet','csc','dmw');
create unique index if not exists job_sync_runs_one_running_provider_idx
on public.job_sync_runs(provider_id)
where status = 'running';
create table if not exists public.job_sync_control (
  provider_code text primary key references public.job_providers(code) on delete cascade,
  secret_sha256 text not null check (secret_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

alter table public.job_sync_control enable row level security;
revoke all on public.job_sync_control from anon, authenticated;
grant select on public.job_sync_control to service_role;

do $$
declare
  sync_secret text;
begin
  select decrypted_secret into sync_secret
  from vault.decrypted_secrets
  where name = 'jobs_supply_sync_key'
  limit 1;

  if sync_secret is null then
    sync_secret := encode(gen_random_bytes(32), 'hex');
    perform vault.create_secret(sync_secret, 'jobs_supply_sync_key', 'Masinloc Connect Jobs recurring supply worker');
  end if;

  insert into public.job_sync_control(provider_code, secret_sha256, updated_at)
  values ('philjobnet', encode(digest(sync_secret, 'sha256'), 'hex'), now())
  on conflict (provider_code) do update
  set secret_sha256 = excluded.secret_sha256,
      updated_at = excluded.updated_at;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'jobs-supply-sync-philjobnet') then
    perform cron.unschedule('jobs-supply-sync-philjobnet');
  end if;
end $$;

select cron.schedule(
  'jobs-supply-sync-philjobnet',
  '17 */6 * * *',
  $cron$
  select net.http_post(
    url := 'https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/jobs-supply-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'jobs_supply_sync_key' limit 1)
    ),
    body := jsonb_build_object('trigger', 'cron', 'scheduled_at', now()),
    timeout_milliseconds := 30000
  );
  $cron$
);
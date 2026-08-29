update public.job_providers
set integration_type = 'api', updated_at = now()
where code = 'dmw';

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
  values ('dmw', encode(digest(sync_secret, 'sha256'), 'hex'), now())
  on conflict (provider_code) do update
  set secret_sha256 = excluded.secret_sha256,
      updated_at = excluded.updated_at;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'jobs-supply-sync-dmw') then
    perform cron.unschedule('jobs-supply-sync-dmw');
  end if;
end $$;

select cron.schedule(
  'jobs-supply-sync-dmw',
  '47 */6 * * *',
  $cron$
  select net.http_post(
    url := 'https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/jobs-supply-sync-dmw',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'jobs_supply_sync_key' limit 1)
    ),
    body := jsonb_build_object('trigger', 'cron', 'scheduled_at', now()),
    timeout_milliseconds := 30000
  );
  $cron$
);

-- What the edge function needs before it can serve a single request.
--
-- submit-masinloc calls two things that were never in this repository, because
-- they were made by hand in the Supabase dashboard: the rate-limit RPC and the
-- security log it writes to. Every POST goes through checkRate() first, and a
-- missing RPC is not a soft failure there — it throws, and the visitor gets a
-- 500 on a perfectly good form. So the deploy is not reproducible until the
-- two live here with everything else.
--
-- Both are created ONLY IF ABSENT. If the dashboard versions already exist,
-- this migration leaves them exactly as they are: `if not exists` on the
-- tables, and a catalogue check rather than `create or replace` on the
-- function, so a working production RPC is never swapped for this one on the
-- assumption that they match.

-- --- rate limiting -----------------------------------------------------------

-- One row per (IP, category) fingerprint. The fingerprint reaching this table
-- is already a SHA-256 of `ip|category` computed in the edge function, so no
-- address is stored here even in principle.
create table if not exists public.submission_rate_limits (
  fingerprint text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.submission_rate_limits is
  'Sliding submission counter, keyed by a hash of IP and category. Written only by the edge function''s service role. No raw address is stored.';

create index if not exists submission_rate_limits_window_idx
  on public.submission_rate_limits (window_started_at);

alter table public.submission_rate_limits enable row level security;
revoke all on public.submission_rate_limits from anon, authenticated;

-- Returns true when the request is within the limit. The whole decision is one
-- statement so two simultaneous submissions cannot both read the same count and
-- both be allowed through.
do $migration$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'check_submission_rate_limit'
  ) then
    execute $fn$
      create function public.check_submission_rate_limit(
        p_fingerprint text,
        p_limit integer default 8,
        p_window_seconds integer default 900
      ) returns boolean
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        v_count integer;
        v_expired boolean;
      begin
        insert into public.submission_rate_limits
          (fingerprint, window_started_at, request_count, updated_at)
        values (p_fingerprint, now(), 1, now())
        on conflict (fingerprint) do update set
          -- A window older than p_window_seconds is finished: start a new one
          -- at one request rather than carrying the old count forward.
          window_started_at = case
            when submission_rate_limits.window_started_at
                 < now() - make_interval(secs => p_window_seconds)
            then now()
            else submission_rate_limits.window_started_at
          end,
          request_count = case
            when submission_rate_limits.window_started_at
                 < now() - make_interval(secs => p_window_seconds)
            then 1
            else submission_rate_limits.request_count + 1
          end,
          updated_at = now()
        returning request_count into v_count;

        return v_count <= p_limit;
      end;
      $body$;
    $fn$;

    -- The edge function calls this as the service role. Nobody else needs it,
    -- and a SECURITY DEFINER function executable by anon would be a way to
    -- write to the table from outside.
    revoke all on function public.check_submission_rate_limit(text, integer, integer)
      from public, anon, authenticated;
    grant execute on function public.check_submission_rate_limit(text, integer, integer)
      to service_role;
  end if;
end
$migration$;

-- --- the security log --------------------------------------------------------

-- Blocked origins, honeypot hits, failed bot verification, oversized bodies.
-- Written by the edge function and read by an admin; never by the browser.
--
-- Retention is in the rows themselves rather than in a cron job the repository
-- cannot see: the function sweeps expired rows on roughly 2% of requests.
-- A raw address is kept only for high and critical events and only for 30 days
-- (raw_ip_expires_at, after which the sweep nulls it); the whole row goes at 90
-- (expires_at). The hash stays either way, which is enough to recognise a
-- repeat offender without holding onto who they are.
create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  severity text not null
    check (severity in ('low', 'medium', 'high', 'critical')),
  category text,
  ip_hash text,
  ip_address text,
  raw_ip_expires_at timestamptz,
  user_agent text,
  origin text,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.security_events is
  'Abuse and rejection log written by submit-masinloc. Read by admins only. Raw IPs are kept for high/critical events for 30 days; rows expire at 90.';
comment on column public.security_events.ip_hash is
  'SHA-256 of the client address. Always present, so repeat activity is recognisable without retaining the address itself.';
comment on column public.security_events.ip_address is
  'Raw address, high and critical severity only, nulled after raw_ip_expires_at.';

create index if not exists security_events_created_at_idx
  on public.security_events (created_at desc);
create index if not exists security_events_severity_idx
  on public.security_events (severity, created_at desc);
create index if not exists security_events_expiry_idx
  on public.security_events (expires_at);

alter table public.security_events enable row level security;

drop policy if exists admin_read_security_events on public.security_events;
create policy admin_read_security_events on public.security_events
  for select to authenticated
  using ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = 'admin');

revoke all on public.security_events from anon;

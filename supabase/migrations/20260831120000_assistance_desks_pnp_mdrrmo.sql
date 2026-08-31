-- Masinloc Connect assistance desks: PNP and MDRRMO.
--
-- WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT.
--
-- This is a non-emergency channel. A resident writes to a desk about something
-- that does not need somebody dispatched right now — a follow-up on a blotter
-- entry, a recurring hazard, a request for assistance or information — and a
-- desk officer reads it when they next sit down at the console.
--
-- It is NOT an emergency reporting system and nothing in this schema should
-- ever be repurposed into one without a monitored on-call rota behind it. A
-- web form that looks like a way to summon help, and is read the next working
-- day, is worse than no form at all: somebody types instead of dialling. The
-- resident-facing page leads with the hotlines for exactly that reason, and
-- report_kind has no 'emergency' value on purpose.
--
-- HONESTY ABOUT DELIVERY. A report is 'submitted' until a desk member actually
-- opens it, at which point it becomes 'received'. The resident is never told an
-- office has their message before an officer has looked at it. That is the
-- whole reason acknowledged_at and acknowledged_by exist rather than a boolean
-- somebody could set optimistically.
--
-- ACCESS. Residents never read this table. Writes arrive through the
-- submit-masinloc Edge Function under the service role, which already carries
-- the origin allowlist, rate limiting, Turnstile and hashed-IP security
-- logging; opening an anon insert policy here would route around all four. A
-- resident checks their own report through a SECURITY DEFINER function that
-- requires both the reference code and a 128-bit token, so the table is never
-- enumerable.

-- --------------------------------------------------------------------------
-- desks
-- --------------------------------------------------------------------------

create table if not exists public.assistance_desks (
  code text primary key,
  name text not null,
  full_name text not null,
  -- The hotline is the escalation path shown beside every report in the
  -- console: if a desk officer opens something that turns out to be urgent,
  -- the number to call is on screen rather than in another tab.
  hotline text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.assistance_desks (code, name, full_name, hotline)
values
  ('pnp', 'PNP Masinloc', 'Philippine National Police, Masinloc Municipal Police Station', '0998-598-5516'),
  ('mdrrmo', 'MDRRMO', 'Municipal Disaster Risk Reduction and Management Office', '0921-405-9748')
on conflict (code) do nothing;

-- --------------------------------------------------------------------------
-- who staffs a desk
-- --------------------------------------------------------------------------

-- Membership is a row rather than a claim in app_metadata. Two reasons: a
-- desk's roster changes without minting new tokens, and revoking access takes
-- effect on the next query instead of when a session happens to expire.
create table if not exists public.assistance_desk_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  desk_code text not null references public.assistance_desks(code) on delete cascade,
  desk_role text not null default 'officer',
  created_at timestamptz not null default now(),
  primary key (user_id, desk_code)
);

do $$ begin
  alter table public.assistance_desk_members
    add constraint assistance_desk_members_role_check
    check (desk_role in ('officer', 'supervisor'));
exception when duplicate_object then null; end $$;

create index if not exists assistance_desk_members_desk_idx
  on public.assistance_desk_members (desk_code);

-- Used by every policy below, so it is stable, minimal, and cannot be shadowed
-- by a table of the same name in a caller's search_path.
create or replace function public.is_assistance_desk_member(p_desk_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.assistance_desk_members m
    where m.user_id = auth.uid()
      and m.desk_code = p_desk_code
  );
$$;

revoke all on function public.is_assistance_desk_member(text) from public, anon;
grant execute on function public.is_assistance_desk_member(text) to authenticated;

-- --------------------------------------------------------------------------
-- the reports
-- --------------------------------------------------------------------------

create table if not exists public.assistance_reports (
  id uuid primary key default gen_random_uuid(),
  -- Same shape as every other reference code on this site (MC-<letter>-…), so
  -- a resident reading one over the phone to a desk officer is reading
  -- something the office already recognises. A for assistance.
  reference_code text not null unique
    default ('MC-A-' || upper(substr(replace((gen_random_uuid())::text, '-', ''), 1, 10))),
  -- 128 bits. The resident holds this; it is the only thing that lets them
  -- read their own report back, so the table cannot be walked by guessing
  -- reference codes.
  access_token uuid not null default gen_random_uuid(),
  desk_code text not null references public.assistance_desks(code),

  report_kind text not null,
  subject text not null,
  body text not null,
  barangay text,
  -- Optional. Somebody reporting a recurring hazard may reasonably not want to
  -- leave a name, and a desk can still act on the report.
  reporter_name text,
  reporter_contact text,

  status text not null default 'submitted',
  -- Set the moment a desk member first opens the report, by trigger rather
  -- than by the console remembering to. Until then the resident is told, in
  -- those words, that nobody at the desk has opened it yet.
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  desk_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.assistance_reports
    add constraint assistance_reports_kind_check
    check (report_kind in (
      'blotter_followup',   -- PNP: following up something already reported
      'safety_concern',     -- PNP: a non-urgent public safety concern
      'hazard_report',      -- MDRRMO: a hazard that is not an active emergency
      'assistance_request', -- either: help or support being asked for
      'information'         -- either: a question for the desk
    ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.assistance_reports
    add constraint assistance_reports_status_check
    check (status in ('submitted', 'received', 'in_progress', 'closed'));
exception when duplicate_object then null; end $$;

-- A report that names no way to reply is still worth accepting, but one that
-- gives a contact must give something usable rather than a single character.
do $$ begin
  alter table public.assistance_reports
    add constraint assistance_reports_contact_check
    check (reporter_contact is null or length(btrim(reporter_contact)) >= 5);
exception when duplicate_object then null; end $$;

create index if not exists assistance_reports_desk_status_idx
  on public.assistance_reports (desk_code, status, created_at desc);
create index if not exists assistance_reports_reference_idx
  on public.assistance_reports (reference_code);

-- --------------------------------------------------------------------------
-- audit trail
-- --------------------------------------------------------------------------

-- Append-only. Who opened a report and when it changed hands is exactly the
-- kind of record that matters after the fact, so nothing here can be updated
-- or deleted by anybody, including a supervisor.
create table if not exists public.assistance_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.assistance_reports(id) on delete cascade,
  desk_code text not null references public.assistance_desks(code),
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists assistance_report_events_report_idx
  on public.assistance_report_events (report_id, created_at desc);

-- --------------------------------------------------------------------------
-- triggers
-- --------------------------------------------------------------------------

create or replace function public.touch_assistance_report()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();

  -- The desk cannot be moved after the fact: a report addressed to MDRRMO
  -- staying addressed to MDRRMO is what makes the per-desk policies mean
  -- anything.
  if new.desk_code is distinct from old.desk_code then
    raise exception 'a report cannot be reassigned to another desk';
  end if;

  -- Acknowledgement is a fact about a person having looked, so it is stamped
  -- here on the first move off 'submitted' rather than trusted to the client.
  if old.status = 'submitted' and new.status <> 'submitted' and new.acknowledged_at is null then
    new.acknowledged_at := now();
    new.acknowledged_by := auth.uid();
  end if;

  if new.status = 'closed' and new.closed_at is null then
    new.closed_at := now();
  end if;

  if new.status <> 'closed' then
    new.closed_at := null;
  end if;

  if new.status is distinct from old.status then
    insert into public.assistance_report_events
      (report_id, desk_code, actor_user_id, event_type, from_status, to_status)
    values (new.id, new.desk_code, auth.uid(), 'status_change', old.status, new.status);
  end if;

  return new;
end;
$$;

drop trigger if exists assistance_reports_touch on public.assistance_reports;
create trigger assistance_reports_touch
  before update on public.assistance_reports
  for each row execute function public.touch_assistance_report();

-- --------------------------------------------------------------------------
-- resident status lookup
-- --------------------------------------------------------------------------

-- Both halves required, and the token compared in full. Returns the status and
-- nothing that would let one resident learn anything about another's report.
create or replace function public.assistance_report_status(
  p_reference_code text,
  p_access_token uuid
)
returns table (
  reference_code text,
  desk_code text,
  status text,
  acknowledged boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.reference_code,
         r.desk_code,
         r.status,
         r.acknowledged_at is not null,
         r.created_at,
         r.updated_at
  from public.assistance_reports r
  where r.reference_code = p_reference_code
    and r.access_token = p_access_token;
$$;

revoke all on function public.assistance_report_status(text, uuid) from public;
grant execute on function public.assistance_report_status(text, uuid) to anon, authenticated;

-- --------------------------------------------------------------------------
-- row level security
-- --------------------------------------------------------------------------

alter table public.assistance_desks enable row level security;
alter table public.assistance_desk_members enable row level security;
alter table public.assistance_reports enable row level security;
alter table public.assistance_report_events enable row level security;

-- Desks: a signed-in desk member sees the desks, so the console can label
-- itself and show the escalation hotline. Nothing here is sensitive, but there
-- is no reason for anon to enumerate it either.
drop policy if exists assistance_desks_member_read on public.assistance_desks;
create policy assistance_desks_member_read
  on public.assistance_desks for select to authenticated
  using (public.is_assistance_desk_member(code));

-- Membership: you can see that you are a member. You cannot see the rest of
-- the roster, and you cannot add yourself — membership is granted out of band.
drop policy if exists assistance_desk_members_self_read on public.assistance_desk_members;
create policy assistance_desk_members_self_read
  on public.assistance_desk_members for select to authenticated
  using (user_id = auth.uid());

-- Reports: a desk member reads and updates only their own desk's reports.
-- There is no insert policy and no delete policy for anyone. Inserts arrive
-- through the Edge Function under the service role, which bypasses RLS; a
-- report, once made, is never destroyed from the console.
drop policy if exists assistance_reports_desk_read on public.assistance_reports;
create policy assistance_reports_desk_read
  on public.assistance_reports for select to authenticated
  using (public.is_assistance_desk_member(desk_code));

drop policy if exists assistance_reports_desk_update on public.assistance_reports;
create policy assistance_reports_desk_update
  on public.assistance_reports for update to authenticated
  using (public.is_assistance_desk_member(desk_code))
  with check (public.is_assistance_desk_member(desk_code));

-- Events: readable by the desk they belong to, and insertable by that desk so
-- an officer can leave a note. Never updatable, never deletable.
drop policy if exists assistance_report_events_desk_read on public.assistance_report_events;
create policy assistance_report_events_desk_read
  on public.assistance_report_events for select to authenticated
  using (public.is_assistance_desk_member(desk_code));

drop policy if exists assistance_report_events_desk_insert on public.assistance_report_events;
create policy assistance_report_events_desk_insert
  on public.assistance_report_events for insert to authenticated
  with check (
    public.is_assistance_desk_member(desk_code)
    and actor_user_id = auth.uid()
  );

-- --------------------------------------------------------------------------
-- grants
-- --------------------------------------------------------------------------

-- anon is given nothing on any of these tables. Its only route in is the
-- Edge Function, and its only route back out is assistance_report_status.
revoke all on public.assistance_desks from anon;
revoke all on public.assistance_desk_members from anon;
revoke all on public.assistance_reports from anon;
revoke all on public.assistance_report_events from anon;

grant select on public.assistance_desks to authenticated;
grant select on public.assistance_desk_members to authenticated;
grant select, update on public.assistance_reports to authenticated;
grant select, insert on public.assistance_report_events to authenticated;

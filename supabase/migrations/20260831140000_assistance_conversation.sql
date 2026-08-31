-- Turn an assistance report into a conversation.
--
-- WHY THIS IS NOT A CHAT APP. A chat interface makes a promise that a form
-- does not: that somebody is on the other end, more or less now. This one is
-- not, and must never look like it is. There is no presence, no typing
-- indicator, no "online" state, and nothing in this schema to build one from —
-- because the honest thing to show a resident is when the desk last actually
-- replied, not a green dot. The resident-facing thread says how long a message
-- has been waiting, and the emergency hotlines stay above all of it.
--
-- WHAT IT ADDS. A report becomes a thread. Both sides can add to it: the
-- resident through two SECURITY DEFINER functions gated on the reference code
-- and their 128-bit token, the desk through ordinary RLS as a desk member. The
-- original report body stays where it is on assistance_reports — it is the
-- thing that opened the thread, not the first message in it — so nothing about
-- the existing acknowledgement logic changes.

-- --------------------------------------------------------------------------
-- messages
-- --------------------------------------------------------------------------

create table if not exists public.assistance_messages (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.assistance_reports(id) on delete cascade,
  -- Who is speaking, recorded as a role rather than inferred from whether
  -- author_user_id is null. A desk message always carries the officer's id;
  -- a resident message never can, because residents have no account.
  sender text not null,
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

do $$ begin
  alter table public.assistance_messages
    add constraint assistance_messages_sender_check
    check (sender in ('resident', 'desk'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.assistance_messages
    add constraint assistance_messages_body_check
    check (length(btrim(body)) between 1 and 4000);
exception when duplicate_object then null; end $$;

-- A desk message must name its author; a resident message must not carry one,
-- since there is no account behind it and a stray id would misattribute a
-- resident's words to an officer.
do $$ begin
  alter table public.assistance_messages
    add constraint assistance_messages_author_check
    check (
      (sender = 'desk' and author_user_id is not null)
      or (sender = 'resident' and author_user_id is null)
    );
exception when duplicate_object then null; end $$;

create index if not exists assistance_messages_report_idx
  on public.assistance_messages (report_id, created_at);

-- --------------------------------------------------------------------------
-- what a new message does to the report
-- --------------------------------------------------------------------------

-- Kept on the report so the console can sort a queue by "who is waiting on us"
-- without counting rows per thread on every load.
alter table public.assistance_reports
  add column if not exists last_message_at timestamptz;
alter table public.assistance_reports
  add column if not exists last_message_sender text;
alter table public.assistance_reports
  add column if not exists desk_reply_count integer not null default 0;

do $$ begin
  alter table public.assistance_reports
    add constraint assistance_reports_last_sender_check
    check (last_message_sender is null or last_message_sender in ('resident', 'desk'));
exception when duplicate_object then null; end $$;

create or replace function public.touch_assistance_thread()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.assistance_reports r
  set last_message_at = new.created_at,
      last_message_sender = new.sender,
      desk_reply_count = r.desk_reply_count + (case when new.sender = 'desk' then 1 else 0 end),
      updated_at = now(),
      -- A desk officer replying has, self-evidently, opened the report. Stamping
      -- it here as well as on the status trigger means an officer who answers
      -- without touching the status buttons still turns the resident-facing
      -- "nobody has opened it yet" into something true.
      acknowledged_at = case
        when new.sender = 'desk' and r.acknowledged_at is null then now()
        else r.acknowledged_at end,
      acknowledged_by = case
        when new.sender = 'desk' and r.acknowledged_by is null then new.author_user_id
        else r.acknowledged_by end,
      status = case
        when new.sender = 'desk' and r.status = 'submitted' then 'received'
        -- A resident writing again on a thread the desk had closed reopens it.
        -- Leaving it closed would file a live question where nobody looks.
        when new.sender = 'resident' and r.status = 'closed' then 'in_progress'
        else r.status end
  where r.id = new.report_id;

  return new;
end;
$$;

drop trigger if exists assistance_messages_touch on public.assistance_messages;
create trigger assistance_messages_touch
  after insert on public.assistance_messages
  for each row execute function public.touch_assistance_thread();

-- --------------------------------------------------------------------------
-- the resident's side
-- --------------------------------------------------------------------------

-- Reading the thread. Reference code and full token, both required, exactly as
-- assistance_report_status already works. Returns the report and its messages
-- in one call so the page cannot render a half-loaded conversation.
create or replace function public.assistance_thread(
  p_reference_code text,
  p_access_token uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'reference_code', r.reference_code,
    'desk_code', r.desk_code,
    'subject', r.subject,
    'body', r.body,
    'status', r.status,
    'acknowledged', r.acknowledged_at is not null,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sender', m.sender,
               'body', m.body,
               'created_at', m.created_at
             ) order by m.created_at)
      from public.assistance_messages m
      where m.report_id = r.id
    ), '[]'::jsonb)
  )
  from public.assistance_reports r
  where r.reference_code = p_reference_code
    and r.access_token = p_access_token;
$$;

revoke all on function public.assistance_thread(text, uuid) from public;
grant execute on function public.assistance_thread(text, uuid) to anon, authenticated;

-- Replying. The token is the authorisation, and it is 128 bits — you cannot
-- write into a thread you do not hold the key to. On top of that a throttle,
-- because a token that leaked should not become a way to fill a desk's queue:
-- at most 20 resident messages on a thread, and no more than one every ten
-- seconds. Both are deliberately generous for a person and useless for a loop.
create or replace function public.assistance_reply(
  p_reference_code text,
  p_access_token uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_report public.assistance_reports%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_count integer;
  v_last timestamptz;
begin
  select * into v_report
  from public.assistance_reports
  where reference_code = p_reference_code
    and access_token = p_access_token;

  -- One answer for "no such thread" and "wrong key", so neither confirms the
  -- other exists.
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if length(v_body) < 1 or length(v_body) > 4000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_body');
  end if;

  select count(*), max(created_at) into v_count, v_last
  from public.assistance_messages
  where report_id = v_report.id and sender = 'resident';

  if v_count >= 20 then
    return jsonb_build_object('ok', false, 'error', 'thread_full');
  end if;

  if v_last is not null and v_last > now() - interval '10 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_fast');
  end if;

  insert into public.assistance_messages (report_id, sender, body)
  values (v_report.id, 'resident', v_body);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.assistance_reply(text, uuid, text) from public;
grant execute on function public.assistance_reply(text, uuid, text) to anon, authenticated;

-- --------------------------------------------------------------------------
-- row level security
-- --------------------------------------------------------------------------

alter table public.assistance_messages enable row level security;

-- A desk member reads and writes messages on their own desk's threads only.
-- Residents never touch this table directly; their two functions are the only
-- way in, and both demand the token.
drop policy if exists assistance_messages_desk_read on public.assistance_messages;
create policy assistance_messages_desk_read
  on public.assistance_messages for select to authenticated
  using (exists (
    select 1 from public.assistance_reports r
    where r.id = assistance_messages.report_id
      and public.is_assistance_desk_member(r.desk_code)
  ));

-- An officer may only post as the desk, and only as themselves. Without the
-- sender check a console bug could file an officer's words as the resident's,
-- inside the record a complaint would later be read from.
drop policy if exists assistance_messages_desk_insert on public.assistance_messages;
create policy assistance_messages_desk_insert
  on public.assistance_messages for insert to authenticated
  with check (
    sender = 'desk'
    and author_user_id = auth.uid()
    and exists (
      select 1 from public.assistance_reports r
      where r.id = assistance_messages.report_id
        and public.is_assistance_desk_member(r.desk_code)
    )
  );

-- No update policy and no delete policy, for anybody. What was said in a
-- thread stays as it was said; a correction is another message.

revoke all on public.assistance_messages from anon;
grant select, insert on public.assistance_messages to authenticated;

-- Fidelity assertion for the recovered pre-repository objects.
--
-- business_submissions, professional_submissions, the two professional
-- challenge tables, the profile-code allocator, story_submissions and
-- resume_support_submissions all predate this repository. Their migrations here
-- (20260816000000, 20260816000001, 20260816000002, 20260902090000) were
-- written by reading the live schema, so "it replays without error" is not
-- enough: the from-zero rebuild has to land on the same catalog state that
-- production actually has.
--
-- This renders every column, default, constraint, index, trigger, policy, RLS
-- flag, browser-role grant and function body for those objects into one sorted
-- text block and hashes it. The expected hash was taken from the hosted project
-- by running this identical projection there.
--
-- To re-verify against production later, run the SELECT below through the
-- Supabase MCP execute_sql tool and compare hashes. A mismatch means the repo
-- and production have drifted; drop the md5() to diff the two blocks line by
-- line and see where.

do $fidelity$
declare
  v_fp text;
  v_lines integer;
  v_expected constant text := '63b33eb4f65d4642cde627854ca08565';
begin
  with objs(t) as (values
    ('business_submissions'),('professional_submissions'),
    ('professional_duplicate_challenges'),('professional_recovery_challenges'),
    ('masinloc_profile_code_sequences'),
    ('story_submissions'),('resume_support_submissions'))
  select md5(string_agg(line, chr(10) order by line)), count(*)
    into v_fp, v_lines
  from (
    select 'COL ' || c.relname || ' ' || a.attname || ' ' || format_type(a.atttypid,a.atttypmod)
           || case when a.attnotnull then ' NN' else '' end
           || coalesce(' DEF ' || pg_get_expr(d.adbin,d.adrelid),'') as line
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
    join objs on objs.t=c.relname
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    union all
    select 'CON ' || rel.relname || ' ' || con.conname || ' ' || pg_get_constraintdef(con.oid)
    from pg_constraint con
    join pg_class rel on rel.oid=con.conrelid
    join pg_namespace n on n.oid=rel.relnamespace and n.nspname='public'
    join objs on objs.t=rel.relname
    union all
    select 'IDX ' || indexdef from pg_indexes i join objs on objs.t=i.tablename where i.schemaname='public'
    union all
    select 'TRG ' || t.tgrelid::regclass::text || ' ' || pg_get_triggerdef(t.oid)
    from pg_trigger t
    join pg_class rel on rel.oid=t.tgrelid
    join pg_namespace n on n.oid=rel.relnamespace and n.nspname='public'
    join objs on objs.t=rel.relname
    where not t.tgisinternal
    union all
    select 'POL ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || roles::text
           || ' USING(' || coalesce(qual,'') || ') CHECK(' || coalesce(with_check,'') || ')'
    from pg_policies p join objs on objs.t=p.tablename where p.schemaname='public'
    union all
    select 'RLS ' || c.relname || ' ' || c.relrowsecurity::text
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
    join objs on objs.t=c.relname
    union all
    -- Browser roles must hold nothing on any of these tables.
    select 'GRANT ' || table_name || ' ' || grantee || ' ' || privilege_type
    from information_schema.role_table_grants g join objs on objs.t=g.table_name
    where g.table_schema='public' and grantee in ('anon','authenticated','service_role')
    union all
    select 'FN ' || p.proname || ' ' || md5(pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
    where p.proname in ('set_updated_at','next_masinloc_profile_code','sync_professional_employer_visibility')
  ) s;

  if v_fp is distinct from v_expected then
    raise exception
      'recovered schema does not match production: got % over % lines, expected %',
      v_fp, v_lines, v_expected;
  end if;
  raise notice 'recovered schema matches production (% over % lines)', v_fp, v_lines;
end
$fidelity$;

-- ---------------------------------------------------------------------------
-- Second assertion: the buyer-account ordering path (20260903000000).
--
-- Separate from the block above because it covers objects that live inside
-- tables this repository already owns -- two added columns, their keys and
-- indexes, the tightened staff-insert policy, and the three RPCs the live
-- pos-order function calls. Same method, same reason: replaying without error
-- is not the same as landing on what production runs.
-- ---------------------------------------------------------------------------
do $buyer$
declare
  v_fp text;
  v_lines integer;
  v_expected constant text := '827836f39c4c298d41ffb85cbc911636';
begin
  select md5(string_agg(line, chr(10) order by line)), count(*)
    into v_fp, v_lines
  from (
    select 'COL ' || c.relname || ' ' || a.attname || ' ' || format_type(a.atttypid,a.atttypmod) as line
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where (c.relname='pos_orders' and a.attname='buyer_user_id')
       or (c.relname='pos_chat_messages' and a.attname='sender_user_id')
    union all
    select 'CON ' || rel.relname || ' ' || con.conname || ' ' || pg_get_constraintdef(con.oid)
    from pg_constraint con
    join pg_class rel on rel.oid=con.conrelid
    join pg_namespace n on n.oid=rel.relnamespace and n.nspname='public'
    where con.conname in ('pos_orders_buyer_user_id_fkey','pos_chat_messages_sender_user_id_fkey')
    union all
    select 'IDX ' || indexdef from pg_indexes
    where schemaname='public'
      and indexname in ('idx_pos_orders_buyer_user_id','pos_chat_sender_user_idx')
    union all
    select 'POL ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || roles::text
           || ' CHECK(' || coalesce(with_check,'') || ')'
    from pg_policies
    where schemaname='public' and tablename='pos_chat_messages' and policyname='pos_chat_staff_insert'
    union all
    select 'FN ' || p.proname || ' ' || md5(pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
    where p.proname in ('pos_attach_buyer_to_order_internal','pos_buyer_tracking_internal','pos_buyer_message_internal')
  ) s;

  if v_fp is distinct from v_expected then
    raise exception
      'buyer-account path does not match production: got % over % lines, expected %',
      v_fp, v_lines, v_expected;
  end if;
  raise notice 'buyer-account path matches production (% over % lines)', v_fp, v_lines;
end
$buyer$;

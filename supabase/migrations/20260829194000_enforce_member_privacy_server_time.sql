create or replace function public.enforce_member_privacy_server_time()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.privacy_policy_version is not null and (
    tg_op = 'INSERT'
    or old.privacy_policy_version is distinct from new.privacy_policy_version
    or old.privacy_accepted_at is distinct from new.privacy_accepted_at
  ) then
    new.privacy_accepted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists member_profiles_privacy_server_time on public.member_profiles;
create trigger member_profiles_privacy_server_time
before insert or update of privacy_policy_version, privacy_accepted_at on public.member_profiles
for each row execute function public.enforce_member_privacy_server_time();

revoke all on function public.enforce_member_privacy_server_time() from public, anon;
grant execute on function public.enforce_member_privacy_server_time() to authenticated;

comment on function public.enforce_member_privacy_server_time() is 'Overrides any client-supplied privacy acknowledgement timestamp with database time.';

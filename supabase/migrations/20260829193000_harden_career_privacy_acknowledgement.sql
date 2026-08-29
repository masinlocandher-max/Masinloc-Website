create or replace function public.acknowledge_masinloc_privacy(p_version text)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_version is null or char_length(btrim(p_version)) < 1 or char_length(p_version) > 120 then
    raise exception 'invalid privacy version';
  end if;

  insert into public.member_profiles(user_id, privacy_policy_version, privacy_accepted_at)
  values (auth.uid(), btrim(p_version), now())
  on conflict (user_id) do update set
    privacy_policy_version = excluded.privacy_policy_version,
    privacy_accepted_at = now();
end;
$$;

revoke all on function public.acknowledge_masinloc_privacy(text) from public, anon;
grant execute on function public.acknowledge_masinloc_privacy(text) to authenticated;

comment on function public.acknowledge_masinloc_privacy(text) is 'Records the authenticated Masinloc Connect member privacy acknowledgement using database time rather than a client-supplied timestamp.';

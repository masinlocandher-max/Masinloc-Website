-- A trigger function is an implementation detail, not a public RPC.
--
-- PostgreSQL invokes this function through trg_pos_marketplace_publish_limit;
-- table writers do not need EXECUTE on the trigger function itself. Leaving the
-- default PUBLIC grant in place exposed a SECURITY DEFINER entry point at
-- /rest/v1/rpc/pos_enforce_marketplace_publish_limit, even though a trigger
-- function cannot be used meaningfully as a standalone RPC.
--
-- The guard keeps the website migration history replayable in environments
-- where the separately delivered POS schema has not been installed.
do $$
begin
  if to_regprocedure('public.pos_enforce_marketplace_publish_limit()') is not null then
    execute 'revoke all on function public.pos_enforce_marketplace_publish_limit() from public, anon, authenticated';
    execute 'grant execute on function public.pos_enforce_marketplace_publish_limit() to postgres, service_role';
  end if;
end
$$;

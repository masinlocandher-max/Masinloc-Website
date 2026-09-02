-- Corrective migration: converge a from-scratch rebuild on production.
--
-- 20260823151416_harden_professional_visibility_function_and_fk_indexes.sql ran
--   alter function public.sync_professional_employer_visibility() set search_path = public;
-- but the live function carries `search_path = public, pg_temp`, so something
-- after that migration widened it back and was never captured here. A rebuild
-- from the repository alone therefore ended one setting short of production.
--
-- The historical migration is left byte-for-byte as the record of what
-- production actually executed; this migration restores the live setting on top
-- of it. Against production it is a no-op — the value is already what it sets.
--
-- Pinning pg_temp explicitly (rather than letting it default to the front of the
-- search path) is the safer of the two states: a SECURITY DEFINER-adjacent
-- trigger function should never resolve an unqualified name against a
-- caller-created temp object first.

alter function public.sync_professional_employer_visibility()
  set search_path = public, pg_temp;

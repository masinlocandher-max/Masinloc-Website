-- The submit-masinloc Edge Function logs a security event tagged with the
-- submission category it was handling. Adding the 'assistance' category to
-- that function without widening this constraint would make every blocked
-- origin, rate-limit hit and honeypot trip on the new desk form fail its own
-- insert — so the abuse that the log exists to record would be the one thing
-- it could not write down. scripts/check-backend-contract.py caught it.
do $$ begin
  alter table public.security_events
  drop constraint if exists security_events_category_check;

  alter table public.security_events
  add constraint security_events_category_check
  check (
    category is null
    or category in ('business','story','dictionary','contact','professional','resume','assistance')
  );
exception when undefined_table then null; end $$;

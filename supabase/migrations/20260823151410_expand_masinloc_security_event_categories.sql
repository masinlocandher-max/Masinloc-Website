alter table public.security_events
  drop constraint if exists security_events_category_check;

alter table public.security_events
  add constraint security_events_category_check
  check (
    category is null
    or category in ('business','story','dictionary','contact','professional','resume')
  );

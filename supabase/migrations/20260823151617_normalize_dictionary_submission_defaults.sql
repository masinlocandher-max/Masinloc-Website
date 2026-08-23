alter table public.dictionary_submissions
  alter column reference_code set default ('MC-L-' || upper(substr(replace((gen_random_uuid())::text, '-', ''), 1, 10))),
  alter column submission_type set default 'new_entry';

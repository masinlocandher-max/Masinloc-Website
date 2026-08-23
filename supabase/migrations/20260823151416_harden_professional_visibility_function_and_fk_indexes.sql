alter function public.sync_professional_employer_visibility() set search_path = public;

create index if not exists dictionary_entries_source_submission_id_idx
  on public.dictionary_entries(source_submission_id);

create index if not exists professional_duplicate_challenges_submission_idx
  on public.professional_duplicate_challenges(professional_submission_id);

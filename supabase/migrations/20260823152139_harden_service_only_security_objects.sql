-- Defense-in-depth for Masinloc production security state.
-- These tables and RPCs are internal implementation details used only by trusted Edge Functions.

revoke all privileges on table public.submission_rate_limits from anon, authenticated;
revoke all privileges on table public.masinloc_profile_code_sequences from anon, authenticated;
revoke all privileges on table public.professional_duplicate_challenges from anon, authenticated;
revoke all privileges on table public.professional_recovery_challenges from anon, authenticated;

revoke execute on function public.check_submission_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.next_masinloc_profile_code() from public, anon, authenticated;

-- Trigger helpers do not need to be callable by browser-facing roles.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.sync_professional_employer_visibility() from public, anon, authenticated;

comment on table public.submission_rate_limits is 'Internal abuse-prevention state. Service-role only; browser roles are explicitly denied.';
comment on table public.masinloc_profile_code_sequences is 'Internal profile-code allocator state. Service-role only; browser roles are explicitly denied.';
comment on table public.professional_duplicate_challenges is 'Internal duplicate-verification challenge state. Service-role only; browser roles are explicitly denied.';
comment on table public.professional_recovery_challenges is 'Internal profile-recovery challenge state. Service-role only; browser roles are explicitly denied.';

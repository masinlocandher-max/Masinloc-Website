# delete-mobile-account

Authenticated Edge Function used by the Masinloc Connect mobile app and public account-deletion page.

It deletes optional user-owned profile, saved-content, saved-job and career/resume data, removes active app/POS access relationships where safe, then soft-deletes the Supabase Auth identity. Emergency-response records and required financial/audit records are intentionally retained when operational recordkeeping requires them.

The function requires a valid user JWT and keeps the service-role key server-side.

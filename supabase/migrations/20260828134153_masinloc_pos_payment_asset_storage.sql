insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pos-payment-assets','pos-payment-assets',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists pos_payment_assets_read on storage.objects;
drop policy if exists pos_payment_assets_insert on storage.objects;
drop policy if exists pos_payment_assets_update on storage.objects;
drop policy if exists pos_payment_assets_delete on storage.objects;

create policy pos_payment_assets_read on storage.objects for select to authenticated
using (
  bucket_id='pos-payment-assets'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.pos_has_role(((storage.foldername(name))[1])::uuid,array['owner','manager'])
);
create policy pos_payment_assets_insert on storage.objects for insert to authenticated
with check (
  bucket_id='pos-payment-assets'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.pos_has_role(((storage.foldername(name))[1])::uuid,array['owner','manager'])
);
create policy pos_payment_assets_update on storage.objects for update to authenticated
using (
  bucket_id='pos-payment-assets'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.pos_has_role(((storage.foldername(name))[1])::uuid,array['owner','manager'])
)
with check (
  bucket_id='pos-payment-assets'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.pos_has_role(((storage.foldername(name))[1])::uuid,array['owner','manager'])
);
create policy pos_payment_assets_delete on storage.objects for delete to authenticated
using (
  bucket_id='pos-payment-assets'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.pos_has_role(((storage.foldername(name))[1])::uuid,array['owner','manager'])
);

revoke all on function public.pos_public_storefront(text) from public,anon,authenticated;
revoke all on function public.pos_public_menu(text) from public,anon,authenticated;
grant execute on function public.pos_public_storefront(text) to service_role;
grant execute on function public.pos_public_menu(text) to service_role;

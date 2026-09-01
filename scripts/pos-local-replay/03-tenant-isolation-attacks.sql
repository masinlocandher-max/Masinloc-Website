\set ON_ERROR_STOP 0
\pset pager off
\t on

select v as ua from public.qa_ids where k='user_a' \gset
select v as ma from public.qa_ids where k='merchant_a' \gset
select v as mb from public.qa_ids where k='merchant_b' \gset
select v as ob from public.qa_ids where k='outlet_b' \gset
select v as pa from public.qa_ids where k='product_a' \gset
select v as pb from public.qa_ids where k='product_b' \gset
select v as ordb from public.qa_ids where k='order_b' \gset
select id as lb from public.marketplace_listings where pos_merchant_id = (select v from public.qa_ids where k='merchant_b') \gset

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'ua','role','authenticated')::text, true);

\echo '### W1 UPDATE B product'
savepoint s; update public.pos_products set price=1 where id=:'pb'; rollback to s;
\echo '### W2 DELETE B product'
savepoint s; delete from public.pos_products where id=:'pb'; rollback to s;
\echo '### W3 INSERT order for B'
savepoint s; insert into public.pos_orders(merchant_id,outlet_id,source,fulfillment,customer_name,status,payment_status) values (:'mb',:'ob','pos','dine_in','Injected','awaiting_payment','unpaid'); rollback to s;
\echo '### W4 INSERT staff chat into B order'
savepoint s; insert into public.pos_chat_messages(order_id,merchant_id,sender_type,message) values (:'ordb',:'mb','staff','A speaking as B'); rollback to s;
\echo '### W5 UPDATE B marketplace listing directly'
savepoint s; update public.marketplace_listings set name='HIJACKED' where id=:'lb'; rollback to s;

\echo '### R1 pos_update_marketplace_profile(B)'
savepoint s; select public.pos_update_marketplace_profile(:'mb','food-drinks','Somewhere',null,'hijacked',null,null); rollback to s;
\echo '### R2 pos_get_marketplace_profile(B)'
savepoint s; select public.pos_get_marketplace_profile(:'mb'); rollback to s;
\echo '### R3 marketplace_admin_link_pos(B listing -> A)'
savepoint s; select public.marketplace_admin_link_pos(:'lb', :'ma'); rollback to s;
\echo '### R4 pos_advance_order(B order)'
savepoint s; select public.pos_advance_order(:'ordb','preparing'); rollback to s;
\echo '### R5 pos_confirm_payment(B order)'
savepoint s; select public.pos_confirm_payment(:'ordb','FAKE-REF'); rollback to s;
\echo '### R6 pos_cancel_unpaid_order(B order)'
savepoint s; select public.pos_cancel_unpaid_order(:'ordb','because'); rollback to s;
\echo '### R7 pos_record_inventory_movement(B product)'
savepoint s; select public.pos_record_inventory_movement(:'pb',5,'restock',null); rollback to s;
\echo '### R8 pos_create_staff_order(B)'
savepoint s; select public.pos_create_staff_order(:'mb',:'ob','dine_in','X','[{"product_id":"00000000-0000-0000-0000-000000000000","quantity":1}]'::jsonb); rollback to s;
\echo '### R9 pos_dashboard(B)'
savepoint s; select public.pos_dashboard(:'mb'); rollback to s;
\echo '### R10 pos_clock_in on B'
savepoint s; select public.pos_clock_in(:'mb',:'ob',null); rollback to s;
\echo '### R11 pos_open_cash_session on B'
savepoint s; select public.pos_open_cash_session(:'mb',:'ob',0); rollback to s;

\echo '### P1 forged/zero/null merchant uuid through the gate'
savepoint s; select public.pos_is_member('00000000-0000-0000-0000-000000000000') as zero_uuid, public.pos_is_member(null) as null_uuid; rollback to s;
\echo '### P2 RPC with a merchant uuid that does not exist'
savepoint s; select public.pos_dashboard('00000000-0000-0000-0000-000000000000'); rollback to s;

\echo '### L1 direct stock edit on OWN product (ledger guard)'
savepoint s; update public.pos_products set stock_on_hand=9999 where id=:'pa'; rollback to s;
\echo '### L2 direct loyalty/metric edit on OWN customer (ledger guard)'
savepoint s; update public.pos_customers set points_balance=9999 where merchant_id=:'ma'; rollback to s;
\echo '### L3 hard DELETE own product (soft-archive policy)'
savepoint s; delete from public.pos_products where id=:'pa'; rollback to s;

rollback;

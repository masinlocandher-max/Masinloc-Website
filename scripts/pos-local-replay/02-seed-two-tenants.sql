-- Two isolated merchants with a full object graph each, so cross-tenant reads
-- and writes have something real to hit. Runs as postgres (RLS bypassed) —
-- this is fixture setup, not part of the test.

do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  ma uuid; mb uuid; oa uuid; ob uuid; ca uuid; cb uuid;
  pa uuid; pb uuid; orda uuid; ordb uuid;
begin
  insert into auth.users(id,email,aud,role) values (ua,'a@test.invalid','authenticated','authenticated'),(ub,'b@test.invalid','authenticated','authenticated');

  insert into public.pos_merchants(name,slug,status,eligibility_status,is_test,approved_at)
    values ('Kitchen A','kitchen-a','active','verified',true,now()) returning id into ma;
  insert into public.pos_merchants(name,slug,status,eligibility_status,is_test,approved_at)
    values ('Kitchen B','kitchen-b','active','verified',true,now()) returning id into mb;

  insert into public.pos_memberships(merchant_id,user_id,role,status) values (ma,ua,'owner','active'),(mb,ub,'owner','active');

  insert into public.pos_outlets(merchant_id,name,code,ordering_enabled,dine_in_enabled,pickup_enabled)
    values (ma,'Outlet A','MAIN',true,true,true) returning id into oa;
  insert into public.pos_outlets(merchant_id,name,code,ordering_enabled,dine_in_enabled,pickup_enabled)
    values (mb,'Outlet B','MAIN',true,true,true) returning id into ob;

  insert into public.pos_categories(merchant_id,name) values (ma,'Meals') returning id into ca;
  insert into public.pos_categories(merchant_id,name) values (mb,'Meals') returning id into cb;

  insert into public.pos_products(merchant_id,category_id,name,price,track_inventory,stock_on_hand)
    values (ma,ca,'A Adobo',150,true,10) returning id into pa;
  insert into public.pos_products(merchant_id,category_id,name,price,track_inventory,stock_on_hand)
    values (mb,cb,'B Sinigang',180,true,10) returning id into pb;

  insert into public.pos_payment_methods(merchant_id,outlet_id,method,label) values (ma,oa,'cash','Cash'),(mb,ob,'cash','Cash');

  insert into public.pos_customers(merchant_id,display_name,phone) values (ma,'Cust A','0917000000A');
  insert into public.pos_customers(merchant_id,display_name,phone) values (mb,'Cust B','0917000000B');

  insert into public.pos_orders(merchant_id,outlet_id,source,fulfillment,customer_name,status,payment_status,subtotal,total)
    values (ma,oa,'pos','dine_in','Walk-in A','awaiting_payment','unpaid',150,150) returning id into orda;
  insert into public.pos_orders(merchant_id,outlet_id,source,fulfillment,customer_name,status,payment_status,subtotal,total)
    values (mb,ob,'pos','dine_in','Walk-in B','awaiting_payment','unpaid',180,180) returning id into ordb;

  insert into public.pos_payments(order_id,merchant_id,method,amount,status) values (orda,ma,'cash',150,'pending'),(ordb,mb,'cash',180,'pending');
  insert into public.pos_chat_messages(order_id,merchant_id,sender_type,message) values (orda,ma,'staff','A internal note'),(ordb,mb,'staff','B internal note');
  insert into public.pos_audit_events(merchant_id,actor_type,action) values (ma,'system','a.event'),(mb,'system','b.event');

  create table if not exists public.qa_ids(k text primary key, v uuid);
  insert into public.qa_ids values
    ('user_a',ua),('user_b',ub),('merchant_a',ma),('merchant_b',mb),
    ('outlet_a',oa),('outlet_b',ob),('product_a',pa),('product_b',pb),
    ('order_a',orda),('order_b',ordb)
  on conflict (k) do update set v=excluded.v;
end $$;

select k, v from public.qa_ids order by k;

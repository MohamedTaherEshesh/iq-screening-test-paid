-- Test script OMS-MND-261126-12 / -13. Runs inside a transaction and ROLLS BACK: leaves no data behind.
-- Updated for OMS-MND-261126-14: registrations carry org_type; choosing exams at registration is optional (old T3d removed).
begin;
do $$
declare r jsonb; cid uuid; ok boolean; p record; b record;
begin
  -- T1 anon can register a company with 2 exams
  set local role anon;
  r := public.corporate_register('{"org_type":"company","company_name":"Test Co CMC","registration_no":"CR-1","country":"eg","city":"Cairo","employees":"51-200","contact_name":"HR Lead","email":"HR@TestCo.example","phone":"+20 100 000 0000","consent":"yes","language":"ar","exams":[{"exam":"university-iq-preparation","seats":25},{"exam":"university-cognitive-skills","seats":10}]}');
  assert r->>'reference' like 'CORP-%' and (r->>'seats')::int = 35, 'T1 register';
  -- T2 same email again is refused
  begin perform public.corporate_register('{"org_type":"company","company_name":"Dup","country":"EG","contact_name":"Xx","email":"hr@testco.example","phone":"+201000000000","consent":"yes","exams":[{"exam":"university-iq-preparation","seats":1}]}'); ok := false;
  exception when others then ok := sqlerrm = 'email_registered'; end; assert ok, 'T2 duplicate email';
  -- T3 unknown exam, bad email, no consent, no exam are refused and leave nothing
  begin perform public.corporate_register('{"org_type":"company","company_name":"Bad","country":"EG","contact_name":"Xx","email":"a@b.co","phone":"+201000000000","consent":"yes","exams":[{"exam":"nope","seats":1}]}'); ok := false; exception when others then ok := sqlerrm = 'unknown_exam'; end; assert ok, 'T3a unknown exam';
  begin perform public.corporate_register('{"org_type":"company","company_name":"Bad","country":"EG","contact_name":"Xx","email":"not-an-email","phone":"+201000000000","consent":"yes","exams":[{"exam":"university-iq-preparation","seats":1}]}'); ok := false; exception when others then ok := sqlerrm = 'invalid_fields'; end; assert ok, 'T3b bad email';
  begin perform public.corporate_register('{"org_type":"company","company_name":"Bad","country":"EG","contact_name":"Xx","email":"c@d.co","phone":"+201000000000","exams":[{"exam":"university-iq-preparation","seats":1}]}'); ok := false; exception when others then ok := sqlerrm = 'consent_required'; end; assert ok, 'T3c consent';
  -- T4 anon cannot read tables or call admin functions
  begin perform 1 from public.corporate_accounts; ok := false; exception when insufficient_privilege then ok := true; end; assert ok, 'T4a read refused';
  begin perform public.set_corporate_price(gen_random_uuid(), 'x', 100, 'x'); ok := false; exception when insufficient_privilege then ok := true; end; assert ok, 'T4b admin fn refused';
  assert (select count(*) from public.corporate_exam_catalog()) >= 2, 'T4c catalog visible to anon';
  reset role;
  select id into cid from public.corporate_accounts where lower(email) = 'hr@testco.example';
  assert (select count(*) from public.corporate_accounts where company_name = 'Bad') = 0, 'T3 nothing stored';
  assert (select country from public.corporate_accounts where id = cid) = 'EG', 'T1 country upper';
  -- T5 no company price -> global price
  select * into p from public.current_corporate_price(cid, 'university-iq-preparation'); assert p.source = 'global', 'T5 global fallback';
  -- T6 new company price: activate 8.00, then 7.50 -> old closes at the same moment, history 2 rows
  perform public.set_corporate_price(cid, 'university-iq-preparation', 800, 'owner', 'negotiated');
  r := public.set_corporate_price(cid, 'university-iq-preparation', 750, 'owner', 'renewed');
  assert (select count(*) from public.corporate_price_history where company_id = cid) = 2, 'T6 history';
  assert (select count(*) from public.corporate_price_history where company_id = cid and valid_to is null) = 1, 'T6 one open';
  assert (select valid_to from public.corporate_price_history where company_id = cid and amount_cents = 800) = (select valid_from from public.corporate_price_history where company_id = cid and amount_cents = 750), 'T6 close = open time';
  select * into p from public.current_corporate_price(cid, 'university-iq-preparation'); assert p.source = 'company' and p.amount_cents = 750, 'T6 current';
  -- T7 seats only for active companies; unit price stored; balance never below 0
  begin perform public.grant_corporate_seats(cid, 'university-iq-preparation', 25, 'owner'); ok := false; exception when others then ok := sqlerrm = 'Company is not active'; end; assert ok, 'T7a pending refused';
  perform public.set_corporate_status(cid, 'active', 'owner');
  r := public.grant_corporate_seats(cid, 'university-iq-preparation', 25, 'owner', 'PO 1');
  assert (r->>'balance')::int = 25 and (r->'entry'->>'unit_usd_cents')::int = 750 and r->'entry'->>'price_source' = 'company', 'T7b grant';
  r := public.grant_corporate_seats(cid, 'university-cognitive-skills', 10, 'owner');
  assert r->'entry'->>'price_source' = 'global' and (r->'entry'->>'unit_usd_cents')::int = 1000, 'T7c global unit price';
  begin perform public.grant_corporate_seats(cid, 'university-iq-preparation', -26, 'owner'); ok := false; exception when others then ok := sqlerrm = 'Balance cannot go below zero'; end; assert ok, 'T7d no negative';
  select * into b from public.corporate_balances() where company_id = cid and exam_tag = 'university-iq-preparation'; assert b.balance = 25, 'T7e balance';
  -- T8 back to global price closes the company price
  perform public.set_corporate_price(cid, 'university-iq-preparation', null, 'owner');
  select * into p from public.current_corporate_price(cid, 'university-iq-preparation'); assert p.source = 'global', 'T8 back to global';
  raise notice 'OMS-MND-261126-12/13: ALL TESTS PASSED';
end $$;
rollback;

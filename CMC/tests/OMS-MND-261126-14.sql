-- Test OMS-MND-261126-14 (rolls back, leaves no data)
begin;
do $$
declare r jsonb; ok boolean; c record;
begin
  set local role anon;
  -- T1 full registration without exams (exams come later in the offer request)
  r := public.corporate_register('{"org_type":"government","company_name":"Test Authority CMC","registration_no":"GOV-1","tax_no":"300-123-456","country":"sa","city":"Riyadh","address":"King Fahd Rd, Riyadh","website":"https://authority.example","employees":"1000+","contact_name":"HR Lead","email":"hr@authority.example","phone":"+966 55 000 0000","billing_email":"Billing@Authority.example","consent":"yes"}');
  assert r->>'reference' like 'CORP-%' and (r->>'exams')::int = 0, 'T1 register without exams';
  -- T2 organisation type is required and must be known
  begin perform public.corporate_register('{"company_name":"No Type","country":"EG","contact_name":"Xx","email":"n@t.co","phone":"+201000000000","consent":"yes"}'); ok := false; exception when others then ok := sqlerrm = 'invalid_fields'; end; assert ok, 'T2a org type required';
  begin perform public.corporate_register('{"org_type":"club","company_name":"Bad Type","country":"EG","contact_name":"Xx","email":"b@t.co","phone":"+201000000000","consent":"yes"}'); ok := false; exception when others then ok := sqlerrm = 'invalid_fields'; end; assert ok, 'T2b unknown org type';
  -- T3 bad billing email refused
  begin perform public.corporate_register('{"org_type":"company","company_name":"Bad Billing","country":"EG","contact_name":"Xx","email":"bb@t.co","phone":"+201000000000","billing_email":"nope","consent":"yes"}'); ok := false; exception when others then ok := sqlerrm = 'invalid_fields'; end; assert ok, 'T3 billing email';
  -- T4 exams still accepted when given
  r := public.corporate_register('{"org_type":"company","company_name":"With Exams","country":"EG","contact_name":"Xx","email":"we@t.co","phone":"+201000000000","consent":"yes","exams":[{"exam":"university-iq-preparation","seats":5}]}');
  assert (r->>'seats')::int = 5, 'T4 exams optional but accepted';
  reset role;
  select * into c from public.corporate_accounts where email = 'hr@authority.example';
  assert c.org_type = 'government' and c.tax_no = '300-123-456' and c.billing_email = 'billing@authority.example' and c.country = 'SA' and c.address is not null and c.website is not null, 'T5 fields stored';
  assert (select count(*) from public.corporate_accounts where company_name in ('No Type','Bad Type','Bad Billing')) = 0, 'T6 nothing stored for refused';
  raise notice 'OMS-MND-261126-14: ALL TESTS PASSED';
end $$;
rollback;

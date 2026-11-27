-- Test OMS-MND-261127-01 (rolls back)
begin;
do $$
declare r jsonb; ok boolean; t text;
begin
  foreach t in array array['enterprise','gov_authority','university','international_org','financial','individual','other','company'] loop
    r := public.corporate_register(jsonb_build_object('org_type', t, 'company_name', 'Org ' || t, 'country', 'SA', 'contact_name', 'Test Person', 'email', t || '@t27.example', 'phone', '+966500000000', 'consent', 'yes'));
    assert r->>'reference' like 'CORP-%', 'T1 accepted ' || t;
  end loop;
  begin perform public.corporate_register('{"org_type":"club","company_name":"Bad","country":"SA","contact_name":"Xx","email":"bad@t27.example","phone":"+966500000000","consent":"yes"}'); ok := false;
  exception when others then ok := sqlerrm = 'invalid_fields'; end; assert ok, 'T2 unknown type refused';
  begin insert into public.corporate_accounts(reference, org_type, company_name, country, contact_name, email, phone) values ('X1', 'club', 'Bad', 'SA', 'Xx', 'x@t.co', '+966500000000'); ok := false;
  exception when check_violation then ok := true; end; assert ok, 'T3 table check';
  assert (select org_type from public.corporate_accounts where email = 'international_org@t27.example') = 'international_org', 'T4 stored code';
  raise notice 'OMS-MND-261127-01: ALL TESTS PASSED';
end $$;
rollback;

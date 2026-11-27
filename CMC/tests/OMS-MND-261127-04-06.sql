-- Test OMS-MND-261127-04 and -06 (rolls back)
begin;
do $$
declare r jsonb; tok text; tok2 text; code text; cid uuid; cid2 uuid; ok boolean; port jsonb; i int; ref1 text; ref2 text;
begin
  r := public.corporate_register(jsonb_build_object('org_type', 'enterprise', 'company_name', 'Svc Co', 'country', 'EG', 'contact_name', 'Test Person', 'email', 'svc@t27.example', 'phone', '+20 1093897115', 'consent', 'yes'));
  select id into cid from public.corporate_accounts where reference = r->>'reference'; ref1 := r->>'reference';
  -- 04: pending company cannot sign in
  assert public.corporate_request_code(ref1, 'svc@t27.example') is null, 'T1 pending gets no code';
  update public.corporate_accounts set status = 'active' where id = cid;
  code := public.corporate_request_code(ref1, ' SVC@t27.example ')->>'code';
  assert code ~ '^[0-9]{6}$', 'T2 code format';
  assert public.corporate_request_code(ref1, 'stranger@t27.example') is null, 'T2b email not admin of this company gets no code';
  assert public.corporate_request_code('CORP-000000-00000', 'svc@t27.example') is null, 'T2c wrong company code gets no code';
  assert public.corporate_lookup(lower(ref1))->>'company' = 'Svc Co', 'T2d company code shows name';
  assert public.corporate_request_code(null, 'svc@t27.example')->>'reference' = ref1, 'T2f email only finds the company';
  assert public.corporate_request_code('', 'stranger@t27.example') is null, 'T2g email only, not an admin: no code';
  code := public.corporate_request_code('', 'svc@t27.example')->>'code';
  assert (public.corporate_verify_code(null, 'svc@t27.example', code)->>'ok')::boolean, 'T2h email only sign-in works';
  begin perform public.corporate_lookup('CORP-000000-00000'); ok := false; exception when others then ok := sqlerrm = 'unknown_company'; end; assert ok, 'T2e unknown code';
  code := public.corporate_request_code(ref1, 'svc@t27.example')->>'code';
  assert not exists (select 1 from public.corporate_login_codes where code_hash = code or code_hash = public.corp_hash(code)), 'T3 code stored only as company-bound hash';
  r := public.corporate_verify_code(ref1, 'svc@t27.example', case when code = '000000' then '000001' else '000000' end);
  assert r->>'ok' = 'false', 'T4 wrong code refused';
  r := public.corporate_verify_code(ref1, 'svc@t27.example', code);
  tok2 := r->>'token'; assert r->>'ok' = 'true' and tok2 ~ '^[0-9a-f]{64}$', 'T5 right code gives session';
  begin perform public.corporate_verify_code(ref1, 'svc@t27.example', code); ok := false; exception when others then ok := sqlerrm = 'invalid_code'; end; assert ok, 'T6 used code refused';
  assert public.corporate_company_for_token(tok2) = cid, 'T7 session resolves to its company';
  -- 06
  port := public.corporate_portal(tok2);
  assert jsonb_array_length(port->'services') = 5, 'T9 five services listed: ' || (port->'services')::text;
  assert port->'services'->0->>'code' = 'assessment' and port->'services'->0->>'status' = 'open', 'T10 assessment open first';
  r := public.corporate_request_service(tok2, '{"service":"assessment","lines":{"cognitive_university":20,"mindproof_manager":80},"notes":"Q1 hiring"}');
  assert (r->>'total')::int = 100 and r->>'reference' like 'SRQ-%', 'T11 request 100';
  r := public.corporate_request_service(tok2, '{"service":"assessment","lines":{"cognitive_c_level":100,"mindproof_c_level":0}}');
  assert (r->>'total')::int = 100, 'T12 second request';
  port := public.corporate_portal(tok2);
  assert jsonb_array_length(port->'requests') = 2 and (port->'requests'->1->'lines'->>'mindproof_manager')::int = 80, 'T13 history kept with lines';
  assert (select sum(total_qty) from public.corporate_service_requests where company_id = cid and request_year = extract(year from now())::int) = 200, 'T14 year total';
  begin perform public.corporate_request_service(tok2, '{"service":"training","lines":{"x":1}}'); ok := false; exception when others then ok := sqlerrm = 'service_closed'; end; assert ok, 'T15 soon service refused';
  begin perform public.corporate_request_service(tok2, '{"service":"assessment","lines":{"cognitive_junior":0,"mindproof_junior":0}}'); ok := false; exception when others then ok := sqlerrm = 'quantity_required'; end; assert ok, 'T16 zero refused';
  begin perform public.corporate_request_service(tok2, '{"service":"assessment","lines":{"cognitive_junior":-5}}'); ok := false; exception when others then ok := sqlerrm = 'invalid_fields'; end; assert ok, 'T17 negative refused';
  begin perform public.corporate_request_service(tok2, '{"service":"assessment","lines":{"hacker":5}}'); ok := false; exception when others then ok := sqlerrm = 'invalid_fields'; end; assert ok, 'T18 unknown item refused';
  begin perform public.corporate_request_service(tok2, '{"service":"assessment","lines":{"cognitive_junior":2.5}}'); ok := false; exception when others then ok := sqlerrm = 'invalid_fields'; end; assert ok, 'T19 fraction refused';
  perform public.set_service_request_status((port->'requests'->0->>'reference'), 'in_process', 'owner');
  assert (select status from public.corporate_service_requests where reference = port->'requests'->0->>'reference') = 'in_process', 'T20 admin status';
  -- second company: its admin cannot see company 1
  r := public.corporate_register(jsonb_build_object('org_type', 'sme', 'company_name', 'Other Co', 'country', 'SA', 'contact_name', 'Other Person', 'email', 'other@t27.example', 'phone', '+966 500000000', 'consent', 'yes'));
  select id into cid2 from public.corporate_accounts where reference = r->>'reference'; ref2 := r->>'reference';
  update public.corporate_accounts set status = 'active' where id = cid2;
  code := public.corporate_request_code(ref2, 'other@t27.example')->>'code';
  tok := public.corporate_verify_code(ref2, 'other@t27.example', code)->>'token';
  assert jsonb_array_length(public.corporate_portal(tok)->'requests') = 0 and public.corporate_portal(tok)->'company'->>'name' = 'Other Co', 'T21 company 2 sees only itself';
  assert public.corporate_request_code(ref1, 'other@t27.example') is null, 'T21b admin of company 2 cannot get a code for company 1';
  -- wrong code 5 times kills the code
  code := public.corporate_request_code(ref2, 'other@t27.example')->>'code';
  for i in 1..5 loop perform public.corporate_verify_code(ref2, 'other@t27.example', case when code = '000000' then '000001' else '000000' end); end loop;
  begin perform public.corporate_verify_code(ref2, 'other@t27.example', code); ok := false; exception when others then ok := sqlerrm = 'invalid_code'; end; assert ok, 'T22 code dead after 5 wrong tries';
  -- admin email change: old session closed, old email cannot sign in, new email can
  perform public.corporate_change_admin_email(cid, 'new.admin@t27.example', 'owner', 'previous admin left');
  begin perform public.corporate_portal(tok2); ok := false; exception when others then ok := sqlerrm = 'invalid_session'; end; assert ok, 'T23 old admin session closed';
  assert public.corporate_request_code(ref1, 'svc@t27.example') is null, 'T24 old email no longer admin';
  assert public.corporate_request_code(ref1, 'new.admin@t27.example')->>'code' ~ '^[0-9]{6}$', 'T25 new admin gets code';
  assert (select count(*) from public.corporate_email_changes where company_id = cid) = 1, 'T26 change logged';
  begin perform public.corporate_change_admin_email(cid, 'other@t27.example', 'owner'); ok := false; exception when others then ok := sqlerrm = 'Email used by another company'; end; assert ok, 'T27 cannot take another company email';
  -- extra admin added by OMSAZE admin can sign in; removed admin is locked out
  perform public.corporate_add_admin(cid2, 'hr@t27.example', 'owner');
  code := public.corporate_request_code(ref2, 'hr@t27.example')->>'code';
  tok2 := public.corporate_verify_code(ref2, 'hr@t27.example', code)->>'token';
  assert public.corporate_company_for_token(tok2) = cid2, 'T27b added admin signs in';
  begin perform public.corporate_add_admin(cid2, 'HR@t27.example', 'owner'); ok := false; exception when others then ok := sqlerrm = 'Already an admin'; end; assert ok, 'T27c no duplicate admin';
  perform public.corporate_remove_admin(cid2, 'hr@t27.example', 'owner');
  begin perform public.corporate_company_for_token(tok2); ok := false; exception when others then ok := sqlerrm = 'invalid_session'; end; assert ok, 'T27d removed admin locked out';
  assert public.corporate_request_code(ref2, 'hr@t27.example') is null, 'T27e removed admin gets no code';
  -- registration notice once
  assert public.corporate_claim_registration_notice((select reference from public.corporate_accounts where id = cid2))->>'email' = 'other@t27.example', 'T28 notice claimed';
  assert public.corporate_claim_registration_notice((select reference from public.corporate_accounts where id = cid2)) is null, 'T29 notice only once';
  update public.corporate_accounts set status = 'suspended' where id = cid2;
  begin perform public.corporate_portal(tok); ok := false; exception when others then ok := sqlerrm = 'invalid_session'; end; assert ok, 'T30 suspended company locked out';
  raise notice 'OMS-MND-261127-04/06: ALL TESTS PASSED';
end $$;
rollback;

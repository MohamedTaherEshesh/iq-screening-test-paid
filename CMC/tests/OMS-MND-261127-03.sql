-- Test OMS-MND-261127-03 (rolls back)
begin;
do $$
declare r jsonb; ok boolean;
begin
  r := public.corporate_register(jsonb_build_object('org_type', 'enterprise', 'company_name', 'Total Co', 'country', 'EG', 'contact_name', 'Test Person', 'email', 'total@t27.example', 'phone', '+20 1093897115', 'exam_takers', '11', 'consent', 'yes'));
  assert (select exam_takers from public.corporate_accounts where reference = r->>'reference') = 11, 'T1 total stored';
  r := public.corporate_register(jsonb_build_object('org_type', 'sme', 'company_name', 'Blank Co', 'country', 'EG', 'contact_name', 'Test Person', 'email', 'blank@t27.example', 'phone', '+20 1093897115', 'exam_takers', '', 'consent', 'yes'));
  assert (select exam_takers from public.corporate_accounts where reference = r->>'reference') is null, 'T2 empty is null';
  begin perform public.corporate_register(jsonb_build_object('org_type', 'sme', 'company_name', 'Neg Co', 'country', 'EG', 'contact_name', 'Test Person', 'email', 'neg@t27.example', 'phone', '+20 1093897115', 'exam_takers', '-3', 'consent', 'yes')); ok := false;
  exception when others then ok := sqlerrm = 'invalid_fields'; end; assert ok, 'T3 negative refused';
  begin perform public.corporate_register(jsonb_build_object('org_type', 'sme', 'company_name', 'Txt Co', 'country', 'EG', 'contact_name', 'Test Person', 'email', 'txt@t27.example', 'phone', '+20 1093897115', 'exam_takers', 'ten', 'consent', 'yes')); ok := false;
  exception when others then ok := sqlerrm = 'invalid_fields'; end; assert ok, 'T4 text refused';
  raise notice 'OMS-MND-261127-03: ALL TESTS PASSED';
end $$;
rollback;

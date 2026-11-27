-- Test OMS-MND-261127-07 (rolls back). Needs -04 and -06.
begin;
do $$
declare r jsonb; tok text; code text; cid uuid; ok boolean; ref1 text; ref2 text; port jsonb; i int; b1 bigint; b2 bigint;
begin
  r := public.corporate_register(jsonb_build_object('org_type', 'enterprise', 'company_name', 'Bal Co', 'country', 'EG', 'contact_name', 'Test Person', 'email', 'bal@t27.example', 'phone', '+20 1093897115', 'consent', 'yes'));
  select id into cid from public.corporate_accounts where reference = r->>'reference';
  update public.corporate_accounts set status = 'active' where id = cid;
  code := public.corporate_request_code('bal@t27.example')->>'code';
  tok := public.corporate_verify_code('bal@t27.example', code)->>'token';
  ref1 := public.corporate_request_service(tok, '{"service":"assessment","lines":{"mindproof_manager":80,"cognitive_manager":20}}')->>'reference';
  ref2 := public.corporate_request_service(tok, '{"service":"assessment","lines":{"mindproof_manager":5}}')->>'reference';
  assert (select status from public.corporate_service_requests where reference = ref1) = 'new', 'T1 starts as new';
  begin perform public.corporate_mark_request_paid(ref1, 'owner'); ok := false; exception when others then ok := sqlerrm = 'Request must be approved first'; end; assert ok, 'T2 paid needs approved';
  perform public.set_service_request_status(ref1, 'in_process', 'owner');
  perform public.set_service_request_status(ref1, 'approved', 'owner');
  r := public.corporate_mark_request_paid(ref1, 'owner', 12, 150000, 'INV-1');
  assert (r->>'items')::int = 2, 'T3 two balance lines';
  begin perform public.set_service_request_status(ref1, 'new', 'owner'); ok := false; exception when others then ok := sqlerrm = 'Request is paid'; end; assert ok, 'T4 paid is final';
  -- owner example: book 2 -> available drops, actual stays; exams run -> both drop
  b1 := (public.corporate_book_seat(cid, 'mindproof_manager', now() + interval '2 days', 'sat')->>'booking')::bigint;
  b2 := (public.corporate_book_seat(cid, 'mindproof_manager', now() + interval '4 days', 'mon')->>'booking')::bigint;
  assert (select available_balance from public.corporate_request_balances where reference = ref1 and item_code = 'mindproof_manager') = 78, 'T5 available 80-2=78';
  assert (select actual_balance from public.corporate_request_balances where reference = ref1 and item_code = 'mindproof_manager') = 80, 'T6 actual stays 80';
  perform public.corporate_use_booking(b1); perform public.corporate_use_booking(b2);
  assert (select actual_balance from public.corporate_request_balances where reference = ref1 and item_code = 'mindproof_manager') = 78
     and (select available_balance from public.corporate_request_balances where reference = ref1 and item_code = 'mindproof_manager') = 78, 'T7 after exams actual = available = 78';
  b1 := (public.corporate_book_seat(cid, 'mindproof_manager', null, 'x')->>'booking')::bigint;
  perform public.corporate_cancel_booking(b1);
  assert (select available_balance from public.corporate_request_balances where reference = ref1 and item_code = 'mindproof_manager') = 78, 'T8 cancelled booking frees the seat';
  begin perform public.corporate_use_booking(b1); ok := false; exception when others then ok := sqlerrm = 'not_booked'; end; assert ok, 'T9 cancelled booking cannot be used';
  begin perform public.corporate_book_seat(cid, 'cognitive_university', null, 'x'); ok := false; exception when others then ok := sqlerrm = 'no_balance'; end; assert ok, 'T10 no balance for unpaid item';
  -- second paid request expiring sooner is used first; fully used
  perform public.set_service_request_status(ref2, 'approved', 'owner');
  perform public.corporate_mark_request_paid(ref2, 'owner', 1);
  for i in 1..5 loop perform public.corporate_use_booking((public.corporate_book_seat(cid, 'mindproof_manager', null, 's')->>'booking')::bigint); end loop;
  assert (select state from public.corporate_request_balances where reference = ref2) = 'fully_used', 'T11 first to expire used first, then fully used';
  assert (select actual_balance from public.corporate_request_balances where reference = ref1 and item_code = 'mindproof_manager') = 78, 'T12 longer request untouched';
  -- expiry
  update public.corporate_service_requests set valid_until = now() - interval '1 day' where reference = ref1;
  assert (select state from public.corporate_request_balances where reference = ref1 and item_code = 'cognitive_manager') = 'expired', 'T13 expired';
  begin perform public.corporate_book_seat(cid, 'cognitive_manager', null, 'x'); ok := false; exception when others then ok := sqlerrm = 'no_balance'; end; assert ok, 'T14 expired balance not bookable';
  port := public.corporate_portal(tok);
  assert (port->'requests'->1->'balance'->'mindproof_manager'->>'available')::int = 78 and (port->'requests'->1->'balance'->'mindproof_manager'->>'actual')::int = 78, 'T15 portal shows both balances';
  raise notice 'OMS-MND-261127-07: ALL TESTS PASSED';
end $$;
rollback;

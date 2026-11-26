-- Test OMS-MND-261126-16 (rolls back)
begin;
do $$
declare ok boolean; r jsonb; sid uuid;
begin
  -- adult exam: 18+ ok, 17 refused
  insert into public.university_challenge_sessions(exam_tag, candidate_birthdate, candidate_gender, started_at) values ('university-iq-preparation', (now() - interval '18 years 1 day')::date, 'female', now());
  begin insert into public.university_challenge_sessions(exam_tag, candidate_birthdate, started_at) values ('university-cognitive-skills', (now() - interval '17 years')::date, now()); ok := false; exception when others then ok := sqlerrm = 'age_rule_adult'; end; assert ok, 'T1 under 18 refused on adult exam';
  -- junior exam: 10-17 ok, 18 and 9 refused
  insert into public.university_challenge_sessions(exam_tag, candidate_birthdate, candidate_gender, started_at) values ('junior-reasoning-score', (now() - interval '12 years')::date, 'male', now());
  begin insert into public.university_challenge_sessions(exam_tag, candidate_birthdate, started_at) values ('junior-cognitive-assessment', (now() - interval '18 years 1 day')::date, now()); ok := false; exception when others then ok := sqlerrm = 'age_rule_junior'; end; assert ok, 'T2 18 refused on junior';
  begin insert into public.university_challenge_sessions(exam_tag, candidate_birthdate, started_at) values ('junior-cognitive-assessment', (now() - interval '9 years')::date, now()); ok := false; exception when others then ok := sqlerrm = 'age_rule_junior'; end; assert ok, 'T3 9 refused on junior';
  -- gender must be male or female
  begin insert into public.university_challenge_sessions(exam_tag, candidate_birthdate, candidate_gender, started_at) values ('university-iq-preparation', '1990-01-01', 'x', now()); ok := false; exception when check_violation then ok := true; end; assert ok, 'T4 gender values';
  -- results register copies gender
  insert into public.university_challenge_sessions(exam_tag, candidate_birthdate, candidate_gender, started_at, submitted, result, answers, answer_key) values ('university-iq-preparation', '1990-01-01', 'female', now(), true, '{"correct":1}', '[1]', '{1}') returning id into sid;
  perform public.record_exam_result(s) from public.university_challenge_sessions s where s.id = sid;
  assert (select candidate_gender from public.exam_results where session_id = sid) = 'female', 'T5 gender in results';
  -- corporate counts
  set local role anon;
  r := public.corporate_register('{"org_type":"company","company_name":"Gender Co","country":"EG","contact_name":"Xx","email":"g@t.co","phone":"+201000000000","consent":"yes","male_count":"40","female_count":"35"}');
  begin perform public.corporate_register('{"org_type":"company","company_name":"Neg Co","country":"EG","contact_name":"Xx","email":"n@t.co","phone":"+201000000000","consent":"yes","male_count":"-1"}'); ok := false; exception when others then ok := sqlerrm = 'invalid_fields'; end; assert ok, 'T6 negative count refused';
  reset role;
  assert (select male_count = 40 and female_count = 35 from public.corporate_accounts where email = 'g@t.co'), 'T7 counts stored';
  raise notice 'OMS-MND-261126-16: ALL TESTS PASSED';
end $$;
rollback;

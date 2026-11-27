-- Test OMS-MND-261126-20 and -21 (rolls back). Needs -16 applied first.
begin;
do $$
declare sid uuid; ok boolean;
begin
  -- -21: undisclosed accepted, other values refused
  insert into public.university_challenge_sessions(exam_tag, candidate_birthdate, candidate_gender, started_at) values ('university-iq-preparation', '1990-01-01', 'undisclosed', now()) returning id into sid;
  begin insert into public.university_challenge_sessions(exam_tag, candidate_birthdate, candidate_gender, started_at) values ('university-iq-preparation', '1990-01-01', 'other', now()); ok := false; exception when check_violation then ok := true; end; assert ok, 'T1 gender values';
  -- -20: consent defaults to false; opt-in stored; copied to results register
  assert (select research_share_consent = false from public.university_challenge_sessions where id = sid), 'T2 default no sharing';
  update public.university_challenge_sessions set research_share_consent = true, research_notice_version = 'research-notice-v1-draft', research_consent_at = now() where id = sid;
  insert into public.exam_results(session_id, exam_tag, candidate_gender) values (sid, 'university-iq-preparation', 'undisclosed');
  assert (select research_share_consent and candidate_gender = 'undisclosed' from public.exam_results where session_id = sid), 'T3 consent and undisclosed in register';
  raise notice 'OMS-MND-261126-20/21: ALL TESTS PASSED';
end $$;
rollback;

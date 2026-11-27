-- Test OMS-MND-261126-18 (rolls back)
begin;
do $$
declare sid uuid := gen_random_uuid(); r record; v int;
begin
  insert into public.university_challenge_sessions(id, exam_tag, language, started_at, submitted, answers, answer_key, item_codes)
    values (sid, 'university-iq-preparation', 'en', now(), false, '[null,null]', '{2,0}', '{Q-A,Q-B}');
  insert into public.exam_item_responses(session_id, position, item_code, item_version) values (sid, 0, 'Q-A', 3), (sid, 1, 'Q-B', 1);
  -- view question 0, then move to 1 after 4.2 s
  perform public.log_item_view(sid, 0, null, null);
  perform public.log_item_view(sid, 1, 0, 4200);
  select * into r from public.exam_item_responses where session_id = sid and position = 0;
  assert r.visits = 1 and r.visible_ms = 4200 and r.first_shown_at is not null, 'T1 view and visible time';
  -- hidden-tab flush on the same question adds time without a visit
  perform public.log_item_view(sid, 1, 1, 900);
  select * into r from public.exam_item_responses where session_id = sid and position = 1;
  assert r.visits = 1 and r.visible_ms = 900, 'T2 same-question flush';
  -- slice cap 30 minutes
  perform public.log_item_view(sid, null, 1, 7200000);
  assert (select visible_ms from public.exam_item_responses where session_id = sid and position = 1) = 900 + 1800000, 'T3 cap';
  -- answers: first answer, change, same answer again
  perform public.log_item_answer(sid, 0, 1);
  perform public.log_item_answer(sid, 0, 2);
  perform public.log_item_answer(sid, 0, 2);
  select * into r from public.exam_item_responses where session_id = sid and position = 0;
  assert r.answer = 2 and r.answer_changes = 1 and r.first_answered_at is not null and r.answered_at >= r.first_answered_at, 'T4 answer changes';
  -- stats view: correctness against the session key, version kept
  assert (select is_correct and item_version = 3 from public.exam_item_response_stats where session_id = sid and position = 0), 'T5 stats view';
  -- question version bumps only on content change
  insert into public.question_bank(legacy_id, prompt_en, options_en, correct_index, status, version) values ('T18-X', 'p', '["a","b","c","d"]', 0, 'draft', 1);
  update public.question_bank set status = 'needs_fix' where legacy_id = 'T18-X';
  assert (select version from public.question_bank where legacy_id = 'T18-X') = 1, 'T6 status change keeps version';
  update public.question_bank set correct_index = 1 where legacy_id = 'T18-X';
  assert (select version from public.question_bank where legacy_id = 'T18-X') = 2, 'T7 content change bumps version';
  -- browser roles cannot read the log or call the writers
  assert not has_table_privilege('anon', 'public.exam_item_responses', 'select'), 'T8 anon no read';
  assert not has_function_privilege('authenticated', 'public.log_item_view(uuid,int,int,int)', 'execute'), 'T9 no browser writes';
  -- cascade delete with session
  delete from public.university_challenge_sessions where id = sid;
  assert not exists (select 1 from public.exam_item_responses where session_id = sid), 'T10 cascade';
  raise notice 'OMS-MND-261126-18: ALL TESTS PASSED';
end $$;
rollback;

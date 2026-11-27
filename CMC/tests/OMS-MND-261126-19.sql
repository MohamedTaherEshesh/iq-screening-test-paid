-- Test OMS-MND-261126-19 (rolls back)
begin;
do $$
declare qid uuid; ok boolean;
begin
  insert into public.question_bank(legacy_id, prompt_en, options_en, correct_index, status, version) values ('T19-X', 'p', '["a","b","c","d"]', 0, 'draft', 1) returning id into qid;
  insert into public.question_reviews(question_id, reviewer_name, reviewer_role, decision, criteria) values (qid, 'Second solver', 'ai', 'approve', '{"single_correct":true}');
  insert into public.question_reviews(question_id, reviewer_name, reviewer_role, reviewer_credentials, decision, notes) values (qid, 'Dr. Reviewer', 'expert', 'PhD psychometrics', 'fix', 'Option C ambiguous');
  assert (select legacy_id = 'T19-X' and item_version = 1 from public.question_reviews where reviewer_role = 'ai' and question_id = qid), 'T1 fill legacy id and version';
  assert (select latest_decision = 'fix' and ai_approvals = 1 and expert_approvals = 0 and reviews_this_version = 2 from public.question_review_status where question_id = qid), 'T2 status view';
  begin update public.question_reviews set decision = 'approve' where question_id = qid; ok := false; exception when others then ok := sqlerrm = 'question_reviews_append_only'; end; assert ok, 'T3 no edits';
  begin delete from public.question_reviews where question_id = qid; ok := false; exception when others then ok := sqlerrm = 'question_reviews_append_only'; end; assert ok, 'T4 no deletes';
  begin insert into public.question_reviews(question_id, reviewer_name, reviewer_role, decision) values (qid, 'X Y', 'student', 'approve'); ok := false; exception when check_violation then ok := true; end; assert ok, 'T5 role values';
  assert not has_table_privilege('authenticated', 'public.question_reviews', 'select'), 'T6 no browser access';
  raise notice 'OMS-MND-261126-19: ALL TESTS PASSED';
end $$;
rollback;

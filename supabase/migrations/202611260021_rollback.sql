-- Rollback OMS-MND-261126-21 (back to the -16 rule: male/female only; undisclosed rows become null first)
begin;
update public.university_challenge_sessions set candidate_gender = null where candidate_gender = 'undisclosed';
update public.exam_results set candidate_gender = null where candidate_gender = 'undisclosed';
alter table public.university_challenge_sessions drop constraint if exists university_challenge_sessions_candidate_gender_check;
alter table public.university_challenge_sessions add constraint university_challenge_sessions_candidate_gender_check check (candidate_gender in ('male','female'));
alter table public.exam_results drop constraint if exists exam_results_candidate_gender_check;
alter table public.exam_results add constraint exam_results_candidate_gender_check check (candidate_gender in ('male','female'));
commit;

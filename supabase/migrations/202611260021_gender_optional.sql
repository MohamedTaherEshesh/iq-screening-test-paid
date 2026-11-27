-- OMS-MND-261126-21: gender becomes optional, with "prefer not to say" (stored as 'undisclosed').
-- Used only for anonymised fairness analysis (DIF); never on certificates, reports or emails.
-- Requires OMS-MND-261126-16 (adds the column with a male/female check) to be applied first.
begin;
alter table public.university_challenge_sessions drop constraint if exists university_challenge_sessions_candidate_gender_check;
alter table public.university_challenge_sessions add constraint university_challenge_sessions_candidate_gender_check
  check (candidate_gender in ('male','female','undisclosed'));
alter table public.exam_results drop constraint if exists exam_results_candidate_gender_check;
alter table public.exam_results add constraint exam_results_candidate_gender_check
  check (candidate_gender in ('male','female','undisclosed'));
commit;

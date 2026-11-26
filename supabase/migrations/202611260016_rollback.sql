-- Rollback OMS-MND-261126-16
begin;
drop trigger if exists trg_exam_age_rule on public.university_challenge_sessions;
drop function if exists public.trg_exam_age_rule();
-- then re-run record_exam_result from 202611260005 and corporate_register from 202611260014, then:
alter table public.university_challenge_sessions drop column if exists candidate_gender;
alter table public.exam_results drop column if exists candidate_gender;
alter table public.corporate_accounts drop column if exists male_count, drop column if exists female_count;
commit;

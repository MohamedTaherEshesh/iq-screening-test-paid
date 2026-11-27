-- Rollback OMS-MND-261126-20
begin;
drop trigger if exists trg_exam_results_consent on public.exam_results;
drop function if exists public.trg_exam_results_consent();
alter table public.exam_results drop column if exists research_share_consent;
alter table public.university_challenge_sessions drop column if exists research_notice_version,
  drop column if exists research_share_consent, drop column if exists research_consent_at;
commit;

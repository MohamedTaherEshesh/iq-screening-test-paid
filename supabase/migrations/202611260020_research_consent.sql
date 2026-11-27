-- OMS-MND-261126-20: research notice and optional consent to share anonymised results with academic partners.
-- Every candidate sees the notice (anonymised statistics for test quality and fairness); sharing with external
-- academic partners is opt-in. Wording is a draft pending legal review (notice version recorded per session).
begin;
alter table public.university_challenge_sessions
  add column if not exists research_notice_version text,
  add column if not exists research_share_consent boolean not null default false,
  add column if not exists research_consent_at timestamptz;
alter table public.exam_results
  add column if not exists research_share_consent boolean not null default false;
-- keep the register in step (record_exam_result is not changed; a trigger copies the flag)
create or replace function public.trg_exam_results_consent() returns trigger language plpgsql as $$
begin
  select coalesce(s.research_share_consent, false) into new.research_share_consent
    from public.university_challenge_sessions s where s.id = new.session_id;
  new.research_share_consent := coalesce(new.research_share_consent, false);
  return new;
end $$;
drop trigger if exists trg_exam_results_consent on public.exam_results;
create trigger trg_exam_results_consent before insert or update of session_id on public.exam_results
  for each row execute function public.trg_exam_results_consent();
commit;

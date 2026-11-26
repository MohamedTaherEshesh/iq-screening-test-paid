-- OMS-MND-261126-07: how long each submitted exam took, in seconds (start to submit, capped at the time limit).
-- Rollback: alter table public.exam_results drop column duration_seconds, drop column time_limit_seconds;
--           and re-run 202611260005 to restore the earlier trigger function.
alter table public.exam_results add column if not exists duration_seconds int, add column if not exists time_limit_seconds int;
comment on column public.exam_results.duration_seconds is 'OMS-MND-261126-07: seconds from exam start to submit, capped at the time limit. Null when the start or submit time is unknown (exams before 2026-11-19 saved submit = start).';

create or replace function public.exam_duration_seconds(p_started timestamptz, p_submitted timestamptz, p_expires timestamptz) returns int
language sql immutable as $$
  select case when p_started is null or p_submitted is null or p_submitted <= p_started then null
              else round(extract(epoch from least(p_submitted, coalesce(p_expires, p_submitted)) - p_started))::int end
$$;

create or replace function public.trg_exam_result_duration() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.university_challenge_sessions;
begin
  select * into s from public.university_challenge_sessions where id = new.session_id;
  new.duration_seconds := public.exam_duration_seconds(s.started_at, s.submitted_at, s.expires_at);
  new.time_limit_seconds := case when s.expires_at is not null and s.started_at is not null then round(extract(epoch from s.expires_at - s.started_at))::int end;
  return new;
end $$;
revoke all on function public.trg_exam_result_duration() from public, anon, authenticated;
drop trigger if exists trg_exam_result_duration on public.exam_results;
create trigger trg_exam_result_duration before insert on public.exam_results
  for each row execute function public.trg_exam_result_duration();

-- Backfill (allowed: the guard only protects score columns).
update public.exam_results r set
  duration_seconds = public.exam_duration_seconds(s.started_at, s.submitted_at, s.expires_at),
  time_limit_seconds = round(extract(epoch from s.expires_at - s.started_at))::int
from public.university_challenge_sessions s where s.id = r.session_id;

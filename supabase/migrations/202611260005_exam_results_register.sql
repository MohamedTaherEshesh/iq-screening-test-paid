-- OMS-MND-261126-05: keep one permanent result record per submitted exam (for reports, accreditation and university partnerships).
-- Additive only. Filled automatically by a trigger when an exam is submitted, so no edge function change is needed.
-- Rollback: drop trigger trg_record_exam_result on public.university_challenge_sessions;
--           drop table public.exam_results; drop function public.trg_record_exam_result(), public.record_exam_result(public.university_challenge_sessions), public.trg_guard_exam_results();

create table if not exists public.exam_results (
  session_id        uuid primary key references public.university_challenge_sessions(id) on delete restrict,
  candidate_id      uuid not null,
  exam_tag          text not null,
  language          text,
  candidate_name    text,
  candidate_country text,
  candidate_city    text,
  candidate_age     int,
  started_at        timestamptz,
  submitted_at      timestamptz,
  total_items       int not null,
  answered          int not null,
  correct           int not null,
  percent_correct   numeric(5,2),
  per_domain        jsonb,
  item_codes        text[],
  item_domains      text[],
  item_outcomes     smallint[],   -- per question in the order shown: 1 correct, 0 wrong, null unanswered
  timed_out         boolean,
  recorded_at       timestamptz not null default now()
);
comment on table public.exam_results is 'OMS-MND-261126-05: one permanent, read-only result record per submitted exam. Score fields cannot be changed or deleted.';
alter table public.exam_results enable row level security;
revoke all on public.exam_results from anon, authenticated;
create index if not exists exam_results_submitted_idx on public.exam_results(submitted_at desc);
create index if not exists exam_results_exam_idx on public.exam_results(exam_tag);

create or replace function public.record_exam_result(ss public.university_challenge_sessions) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; outcomes smallint[] := '{}'; answered int := 0; correct int := 0; a jsonb; i int;
begin
  if not (ss.submitted is true and ss.result is not null) then return; end if;
  n := coalesce(array_length(ss.answer_key, 1), 0);
  for i in 1..n loop
    a := ss.answers -> (i - 1);
    if a is null or jsonb_typeof(a) <> 'number' then outcomes := array_append(outcomes, null::smallint);
    else
      answered := answered + 1;
      if (a #>> '{}')::int = ss.answer_key[i] then correct := correct + 1; outcomes := array_append(outcomes, 1::smallint);
      else outcomes := array_append(outcomes, 0::smallint); end if;
    end if;
  end loop;
  insert into public.exam_results(session_id, candidate_id, exam_tag, language, candidate_name, candidate_country, candidate_city, candidate_age,
    started_at, submitted_at, total_items, answered, correct, percent_correct, per_domain, item_codes, item_domains, item_outcomes, timed_out)
  values (ss.id, ss.candidate_id, ss.exam_tag, ss.language, ss.candidate_name, ss.candidate_country, ss.candidate_city,
    case when ss.candidate_birthdate is null then null else extract(year from age(ss.started_at::date, ss.candidate_birthdate))::int end,
    ss.started_at, ss.submitted_at, n, answered, coalesce((ss.result->>'correct')::int, correct),
    case when n > 0 then round(coalesce((ss.result->>'correct')::int, correct) * 100.0 / n, 2) end,
    ss.result->'perDomain', ss.item_codes, ss.domains, outcomes, coalesce((ss.result->>'timedOut')::boolean, false))
  on conflict (session_id) do nothing;
end $$;
revoke all on function public.record_exam_result(public.university_challenge_sessions) from public, anon, authenticated;

create or replace function public.trg_record_exam_result() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Never block an exam submit: if recording fails, the submit still succeeds and a warning is logged.
  begin perform public.record_exam_result(new);
  exception when others then raise warning 'OMS-MND-261126-05 record_exam_result failed for %: %', new.id, sqlerrm; end;
  return new;
end $$;
revoke all on function public.trg_record_exam_result() from public, anon, authenticated;

drop trigger if exists trg_record_exam_result on public.university_challenge_sessions;
create trigger trg_record_exam_result after insert or update of submitted, result on public.university_challenge_sessions
  for each row execute function public.trg_record_exam_result();

-- The score part of a record is permanent: no edits, no deletes.
create or replace function public.trg_guard_exam_results() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'exam_results records are permanent (OMS-MND-261126-05)'; end if;
  if (new.session_id, new.candidate_id, new.exam_tag, new.started_at, new.submitted_at, new.total_items, new.answered, new.correct, new.item_codes, new.item_outcomes)
     is distinct from (old.session_id, old.candidate_id, old.exam_tag, old.started_at, old.submitted_at, old.total_items, old.answered, old.correct, old.item_codes, old.item_outcomes)
  then raise exception 'exam_results scores are permanent (OMS-MND-261126-05)'; end if;
  return new;
end $$;
revoke all on function public.trg_guard_exam_results() from public, anon, authenticated;
drop trigger if exists trg_guard_exam_results on public.exam_results;
create trigger trg_guard_exam_results before update or delete on public.exam_results
  for each row execute function public.trg_guard_exam_results();

-- Backfill every exam already submitted. Sessions are only read, never changed.
select public.record_exam_result(s) from public.university_challenge_sessions s where s.submitted is true and s.result is not null;

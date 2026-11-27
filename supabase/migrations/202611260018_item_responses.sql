-- OMS-MND-261126-18: per-question response log for accreditation evidence (ITC / AERA-APA-NCME Standards ch. 6 and 12).
-- For every question shown in a session we keep: which question and which version, when it was first and last shown,
-- total visible time, number of visits, first and last answer time, the final answer and how many times it changed.
-- Rows are written only by the exam edge function (service role). No browser access.
begin;

-- 1) Question versions: bump question_bank.version and updated_at whenever the scored content changes.
create or replace function public.trg_question_bank_version() returns trigger
language plpgsql as $$
begin
  if (new.prompt_en, new.prompt_ar, new.options_en, new.options_ar, new.correct_index, new.visual_grid)
     is distinct from (old.prompt_en, old.prompt_ar, old.options_en, old.options_ar, old.correct_index, old.visual_grid) then
    new.version := coalesce(old.version, 1) + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_question_bank_version on public.question_bank;
create trigger trg_question_bank_version before update on public.question_bank
  for each row execute function public.trg_question_bank_version();

-- 2) Response log.
create table if not exists public.exam_item_responses (
  session_id        uuid not null references public.university_challenge_sessions(id) on delete cascade,
  position          smallint not null check (position between 0 and 199),
  item_code         text not null,
  item_version      int not null default 1,
  first_shown_at    timestamptz,
  last_shown_at     timestamptz,
  visible_ms        int not null default 0 check (visible_ms >= 0),
  visits            int not null default 0 check (visits >= 0),
  first_answered_at timestamptz,
  answered_at       timestamptz,
  answer            smallint check (answer between 0 and 7),
  answer_changes    int not null default 0 check (answer_changes >= 0),
  primary key (session_id, position)
);
create index if not exists exam_item_responses_item_idx on public.exam_item_responses(item_code, item_version);
alter table public.exam_item_responses enable row level security;
revoke all on public.exam_item_responses from anon, authenticated;

-- 3) Writers (service role only). One visible-time slice is capped at 30 minutes to drop clock glitches.
create or replace function public.log_item_view(p_session uuid, p_position int, p_prev int, p_prev_ms int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_prev is not null and p_prev_ms is not null and p_prev_ms > 0 then
    update exam_item_responses set visible_ms = visible_ms + least(p_prev_ms, 1800000)
     where session_id = p_session and position = p_prev;
  end if;
  if p_position is not null and p_position is distinct from p_prev then
    update exam_item_responses
       set first_shown_at = coalesce(first_shown_at, now()), last_shown_at = now(), visits = visits + 1
     where session_id = p_session and position = p_position;
  end if;
end $$;

create or replace function public.log_item_answer(p_session uuid, p_position int, p_answer int)
returns void language plpgsql security definer set search_path = public as $$
begin
  update exam_item_responses
     set answer_changes = answer_changes + case when answer is not null and answer is distinct from p_answer then 1 else 0 end,
         answer = p_answer,
         first_answered_at = case when p_answer is null then first_answered_at else coalesce(first_answered_at, now()) end,
         answered_at = now(),
         first_shown_at = coalesce(first_shown_at, now())
   where session_id = p_session and position = p_position;
end $$;
revoke all on function public.log_item_view(uuid,int,int,int) from public, anon, authenticated;
revoke all on function public.log_item_answer(uuid,int,int) from public, anon, authenticated;
grant execute on function public.log_item_view(uuid,int,int,int) to service_role;
grant execute on function public.log_item_answer(uuid,int,int) to service_role;

-- 4) Read view for analysis: seconds to first answer and visible seconds per item.
create or replace view public.exam_item_response_stats with (security_invoker = true) as
select r.*, s.exam_tag, s.language, s.submitted,
       extract(epoch from (r.first_answered_at - r.first_shown_at)) as seconds_to_first_answer,
       r.visible_ms / 1000.0 as visible_seconds,
       (r.answer is not null and r.answer = s.answer_key[r.position + 1]) as is_correct
  from public.exam_item_responses r join public.university_challenge_sessions s on s.id = r.session_id;
revoke all on public.exam_item_response_stats from anon, authenticated;
commit;

-- OMS-MND-261126-19: question review log (who reviewed which question version, against which criteria, with what decision).
-- Append-only audit trail for the technical manual (item development and review evidence).
begin;
create table if not exists public.question_reviews (
  id             bigint generated always as identity primary key,
  question_id    uuid not null references public.question_bank(id) on delete cascade,
  legacy_id      text,
  item_version   int,
  reviewer_name  text not null check (length(trim(reviewer_name)) between 2 and 120),
  reviewer_role  text not null check (reviewer_role in ('ai','expert','owner')),
  reviewer_credentials text,
  decision       text not null check (decision in ('approve','fix','reject')),
  criteria       jsonb not null default '{}'::jsonb,
  notes          text,
  created_at     timestamptz not null default now()
);
create index if not exists question_reviews_question_idx on public.question_reviews(question_id, created_at desc);
alter table public.question_reviews enable row level security;
revoke all on public.question_reviews from anon, authenticated;

-- Fill legacy_id and the current question version; refuse edits and deletes (append-only).
create or replace function public.trg_question_reviews_fill() returns trigger language plpgsql as $$
begin
  select q.legacy_id, coalesce(q.version, 1) into new.legacy_id, new.item_version from public.question_bank q where q.id = new.question_id;
  return new;
end $$;
drop trigger if exists trg_question_reviews_fill on public.question_reviews;
create trigger trg_question_reviews_fill before insert on public.question_reviews for each row execute function public.trg_question_reviews_fill();

create or replace function public.trg_question_reviews_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'question_reviews_append_only';
end $$;
drop trigger if exists trg_question_reviews_append_only on public.question_reviews;
create trigger trg_question_reviews_append_only before update or delete on public.question_reviews
  for each row execute function public.trg_question_reviews_append_only();

-- Latest review summary per question and version.
create or replace view public.question_review_status with (security_invoker = true) as
select q.id as question_id, q.legacy_id, coalesce(q.version, 1) as item_version, q.status,
       count(r.id) filter (where r.item_version = coalesce(q.version, 1)) as reviews_this_version,
       count(r.id) filter (where r.item_version = coalesce(q.version, 1) and r.reviewer_role = 'expert' and r.decision = 'approve') as expert_approvals,
       count(r.id) filter (where r.item_version = coalesce(q.version, 1) and r.reviewer_role = 'ai' and r.decision = 'approve') as ai_approvals,
       (array_agg(r.decision order by r.created_at desc, r.id desc) filter (where r.item_version = coalesce(q.version, 1)))[1] as latest_decision,
       max(r.created_at) as last_reviewed_at
  from public.question_bank q left join public.question_reviews r on r.question_id = q.id
 group by q.id;
revoke all on public.question_review_status from anon, authenticated;
commit;

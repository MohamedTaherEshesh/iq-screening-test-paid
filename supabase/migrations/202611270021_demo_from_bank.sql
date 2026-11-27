-- OMS-MND-261127-21  Demo questions come from the real question bank at the exam's difficulty (owner 2026-11-27 14:32Z).
-- Staging cbklbucvidcutshhmwjy only. Waits for owner approval before it is run.
-- * Each demo = 5 approved questions of that exam (Cognitive or MindProof), 5 DIFFERENT domains,
--   difficulty mix like the full exam: 1 easy, 3 medium, 1 hard (falls back to medium if a band is empty).
-- * No repeats: never a question (or the same idea) the person already got in an earlier demo or in a real exam.
--   The real exam will also skip demo questions once university-challenge is redeployed (same change ID).
-- * Still 2 demos per verified email per exam, still enforced here. Correct answers never go to the browser.
-- * Only questions that exist in both English and Arabic (or are English-only by rule) are used.
-- * Does not change question_bank, exams, payments or certificates. The old demo_questions table is kept but unused.
begin;
alter table public.demo_runs add column if not exists item_ids text[];
alter table public.demo_runs add column if not exists answer_key smallint[];

create or replace function public.demo_domain_label(d text) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_array(
    case d when 'numerical' then 'Numerical reasoning' when 'analytical' then 'Analytical reasoning' when 'visual' then 'Visual reasoning'
           when 'spatial' then 'Spatial reasoning' when 'logical' then 'Logical reasoning' when 'linguistic' then 'Verbal reasoning'
           when 'creative' then 'Creative problem solving' when 'critical' then 'Critical thinking' else d end,
    case d when 'numerical' then 'الاستدلال العددي' when 'analytical' then 'الاستدلال التحليلي' when 'visual' then 'الاستدلال البصري'
           when 'spatial' then 'التخيل المكاني' when 'logical' then 'الاستدلال المنطقي' when 'linguistic' then 'الاستدلال اللغوي'
           when 'creative' then 'حل المشكلات الإبداعي' when 'critical' then 'التفكير النقدي' else d end) $$;

create or replace function public.demo_start(p_exam_tag text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text; v_used int; v_run uuid;
  v_seen text[]; v_seen_fp text[]; v_domains text[] := '{}'; v_pick text[] := '{}'; v_diff text; v_id text; v_dom text;
  v_q jsonb; v_ids text[]; v_key smallint[];
begin
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is null then raise exception 'sign_in_required' using errcode = '28000'; end if;
  if p_exam_tag not in ('university-iq-preparation','university-cognitive-skills') then
    raise exception 'unknown_exam' using errcode = '22023'; end if;
  insert into public.demo_usage as d (email, exam_tag, used_count) values (v_email, p_exam_tag, 1)
  on conflict (email, exam_tag) do update set used_count = d.used_count + 1, last_at = now()
    where d.used_count < 2
  returning d.used_count into v_used;
  if v_used is null then raise exception 'demo_limit_reached' using errcode = 'P0001'; end if;

  -- Everything this person already saw: earlier demos (any exam) and real exams (any exam).
  select coalesce(array_agg(distinct c), '{}') into v_seen from (
    select unnest(item_codes) c from public.university_challenge_sessions where candidate_id = v_uid
    union select unnest(item_ids) from public.demo_runs where (user_id = v_uid or email = v_email) and item_ids is not null) s;
  select coalesce(array_agg(distinct idea_fingerprint), '{}') into v_seen_fp
    from public.question_bank where legacy_id = any(v_seen) and idea_fingerprint is not null;

  foreach v_diff in array array['hard','easy','medium','medium','medium'] loop
    v_id := null;
    select q.legacy_id, q.domain into v_id, v_dom from public.question_bank q
    where q.status = 'reviewed_approved' and p_exam_tag = any(q.exam_tags) and q.difficulty = v_diff
      and q.legacy_id is not null and q.prompt_en is not null and (q.english_only or q.prompt_ar ~ '[؀-ۿ]')
      and jsonb_typeof(q.options_en) = 'array' and jsonb_typeof(q.options_ar) = 'array'
      and jsonb_array_length(q.options_en) between 2 and 6 and jsonb_array_length(q.options_ar) = jsonb_array_length(q.options_en)
      and not (q.domain = any(v_domains)) and not (q.legacy_id = any(v_seen))
      and (q.idea_fingerprint is null or not (q.idea_fingerprint = any(v_seen_fp)))
    order by random() limit 1;
    if v_id is null and v_diff <> 'medium' then  -- band empty for this person: take a medium one instead
      select q.legacy_id, q.domain into v_id, v_dom from public.question_bank q
      where q.status = 'reviewed_approved' and p_exam_tag = any(q.exam_tags) and q.difficulty = 'medium'
        and q.legacy_id is not null and q.prompt_en is not null and (q.english_only or q.prompt_ar ~ '[؀-ۿ]')
        and jsonb_typeof(q.options_en) = 'array' and jsonb_typeof(q.options_ar) = 'array'
        and jsonb_array_length(q.options_en) between 2 and 6 and jsonb_array_length(q.options_ar) = jsonb_array_length(q.options_en)
        and not (q.domain = any(v_domains)) and not (q.legacy_id = any(v_seen))
        and (q.idea_fingerprint is null or not (q.idea_fingerprint = any(v_seen_fp)))
      order by random() limit 1;
    end if;
    if v_id is null then raise exception 'demo_no_questions' using errcode = 'P0001'; end if;  -- rolls back the count too
    v_pick := v_pick || v_id; v_domains := v_domains || v_dom;
  end loop;

  with s as (select q.*, row_number() over (order by random()) rn from public.question_bank q where q.legacy_id = any(v_pick))
  select jsonb_agg(jsonb_build_object('id', s.rn, 'domain', public.demo_domain_label(s.domain),
           'question', jsonb_build_array(s.prompt_en, coalesce(s.prompt_ar, s.prompt_en)),
           'options', (select jsonb_agg(jsonb_build_object('en', e.v #>> '{}', 'ar', s.options_ar -> (e.i::int - 1) #>> '{}') order by e.i)
                       from jsonb_array_elements(s.options_en) with ordinality e(v, i)),
           'englishOnly', s.english_only, 'grid', s.visual_grid) order by s.rn),
         array_agg(s.legacy_id order by s.rn), array_agg(s.correct_index::smallint order by s.rn)
    into v_q, v_ids, v_key from s;

  insert into public.demo_runs (user_id, email, exam_tag, run_no, set_no, item_ids, answer_key)
  values (v_uid, v_email, p_exam_tag, v_used, 0, v_ids, v_key) returning id into v_run;
  return jsonb_build_object('runId', v_run, 'runNo', v_used, 'remaining', 2 - v_used, 'questions', v_q);
end $$;

create or replace function public.demo_submit(p_run_id uuid, p_answers smallint[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.demo_runs; v_score int := 0; v_total int; v_used int;
begin
  select * into r from public.demo_runs where id = p_run_id and user_id = auth.uid() for update;
  if not found then raise exception 'run_not_found' using errcode = 'P0002'; end if;
  if r.submitted_at is not null then raise exception 'already_submitted' using errcode = 'P0001'; end if;
  if r.answer_key is not null then
    v_total := coalesce(array_length(r.answer_key, 1), 0);
    for i in 1..v_total loop if p_answers[i] = r.answer_key[i] then v_score := v_score + 1; end if; end loop;
  else  -- runs started before this change
    select count(*) filter (where p_answers[q.position] = q.answer), count(*) into v_score, v_total
    from public.demo_questions q where q.set_no = r.set_no;
  end if;
  update public.demo_runs set submitted_at = now(), answers = p_answers, score = v_score where id = r.id;
  select used_count into v_used from public.demo_usage where email = r.email and exam_tag = r.exam_tag;
  return jsonb_build_object('score', v_score, 'total', v_total, 'remaining', 2 - coalesce(v_used,0));
end $$;

revoke all on function public.demo_start(text), public.demo_submit(uuid, smallint[]), public.demo_domain_label(text) from public, anon;
grant execute on function public.demo_start(text), public.demo_submit(uuid, smallint[]) to authenticated;
commit;

-- OMS-MND-261126-10  Strict demo limit enforced in the database (owner approved 2026-11-26 16:51Z)
-- Adds 3 tables + 3 functions. Does NOT touch question_bank, exam_results, exam_payments, certificates or prices.
-- Identity = the signed-in, email-verified account (same sign-in as the real exam). Limit = 2 demos per exam per email, forever.
begin;

create table public.demo_questions (
  id smallint primary key,
  set_no smallint not null check (set_no in (1,2)),
  position smallint not null check (position between 1 and 5),
  domain_en text not null, domain_ar text not null,
  question_en text not null, question_ar text not null,
  options jsonb not null check (jsonb_typeof(options)='array' and jsonb_array_length(options)=4),
  answer smallint not null check (answer between 0 and 3),
  english_only boolean not null default false,
  unique (set_no, position)
);

create table public.demo_usage (
  email text not null,
  exam_tag text not null check (exam_tag in ('university-iq-preparation','university-cognitive-skills')),
  used_count smallint not null default 0 check (used_count between 0 and 2),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (email, exam_tag)
);

create table public.demo_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text not null,
  exam_tag text not null,
  run_no smallint not null check (run_no in (1,2)),
  set_no smallint not null,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  answers smallint[],
  score smallint,
  unique (email, exam_tag, run_no)
);

-- Locked down: no direct reads or writes from the website; only the functions below.
alter table public.demo_questions enable row level security;
alter table public.demo_usage enable row level security;
alter table public.demo_runs enable row level security;
revoke all on public.demo_questions, public.demo_usage, public.demo_runs from anon, authenticated;

insert into public.demo_questions (id, set_no, position, domain_en, domain_ar, question_en, question_ar, options, answer, english_only) values
  (1, 1, 1, 'Numerical', 'الاستدلال العددي', 'A shirt costs 80. Its price goes up by 25%, then down by 20%. What is the new price?', 'سعر قميص 80. زاد السعر 25% ثم انخفض 20%. كم السعر الجديد؟', '[{"en":"76","ar":"76"},{"en":"80","ar":"80"},{"en":"84","ar":"84"},{"en":"88","ar":"88"}]'::jsonb, 1, false),
  (3, 1, 2, 'Logical', 'الاستدلال المنطقي', 'All roses are flowers. Some flowers fade quickly. Which statement MUST be true?', 'كل الورود زهور. بعض الزهور تذبل بسرعة. أي عبارة يجب أن تكون صحيحة؟', '[{"en":"Some roses fade quickly","ar":"بعض الورود تذبل بسرعة"},{"en":"All flowers are roses","ar":"كل الزهور ورود"},{"en":"No rose fades quickly","ar":"لا توجد وردة تذبل بسرعة"},{"en":"None of these must be true","ar":"لا شيء مما سبق صحيح بالضرورة"}]'::jsonb, 3, false),
  (5, 1, 3, 'Analytical', 'الاستدلال التحليلي', 'Ali, Sara and Omar sit in a row of three seats. Sara is not at either end. Omar sits to the left of Ali. Who sits at the left end?', 'علي وسارة وعمر يجلسون في صف من ثلاثة مقاعد. سارة ليست في أي طرف. عمر يجلس على يسار علي. من يجلس في الطرف الأيسر؟', '[{"en":"Ali","ar":"علي"},{"en":"Sara","ar":"سارة"},{"en":"Omar","ar":"عمر"},{"en":"Cannot be determined","ar":"لا يمكن التحديد"}]'::jsonb, 2, false),
  (7, 1, 4, 'Visual', 'الاستدلال البصري', 'Which shape comes next?  ▲ ■ ● ▲ ■ ● ▲ …', 'ما الشكل التالي؟  ▲ ■ ● ▲ ■ ● ▲ …', '[{"en":"▲","ar":"▲"},{"en":"■","ar":"■"},{"en":"●","ar":"●"},{"en":"◆","ar":"◆"}]'::jsonb, 1, false),
  (9, 1, 5, 'Creative problem solving', 'حل المشكلات الإبداعي', 'What can you hold in your left hand but never in your right hand?', 'ما الشيء الذي يمكنك أن تمسكه بيدك اليسرى ولا يمكنك أبدا أن تمسكه بيدك اليمنى؟', '[{"en":"A coin","ar":"عملة معدنية"},{"en":"Your right elbow","ar":"كوعك الأيمن"},{"en":"A pen","ar":"قلم"},{"en":"A key","ar":"مفتاح"}]'::jsonb, 1, false),
  (2, 2, 1, 'Numerical', 'الاستدلال العددي', 'What comes next? 3, 6, 11, 18, 27, …', 'ما الرقم التالي؟ 3، 6، 11، 18، 27، …', '[{"en":"36","ar":"36"},{"en":"38","ar":"38"},{"en":"40","ar":"40"},{"en":"42","ar":"42"}]'::jsonb, 1, false),
  (4, 2, 2, 'Logical', 'الاستدلال المنطقي', 'If it rains, the ground gets wet. The ground is not wet. What follows?', 'إذا أمطرت، تبتل الأرض. الأرض ليست مبتلة. ما النتيجة؟', '[{"en":"It rained","ar":"أمطرت"},{"en":"It did not rain","ar":"لم تمطر"},{"en":"It will rain soon","ar":"ستمطر قريبا"},{"en":"Nothing can be concluded","ar":"لا يمكن استنتاج شيء"}]'::jsonb, 1, false),
  (6, 2, 3, 'Spatial', 'التخيل المكاني', 'On a standard die, opposite faces always add up to 7. Which number is opposite the 2?', 'في حجر النرد العادي، مجموع كل وجهين متقابلين 7. ما الرقم المقابل للرقم 2؟', '[{"en":"3","ar":"3"},{"en":"4","ar":"4"},{"en":"5","ar":"5"},{"en":"6","ar":"6"}]'::jsonb, 2, false),
  (8, 2, 4, 'Linguistic', 'الاستدلال اللغوي', 'Choose the word closest in meaning to BRIEF.', 'Choose the word closest in meaning to BRIEF.', '[{"en":"Short","ar":"Short"},{"en":"Bright","ar":"Bright"},{"en":"Heavy","ar":"Heavy"},{"en":"Calm","ar":"Calm"}]'::jsonb, 0, true),
  (10, 2, 5, 'Critical thinking', 'التفكير النقدي', 'Ice cream sales and swimming accidents both rise in summer. What is the best explanation?', 'تزيد مبيعات الآيس كريم وحوادث السباحة معا في الصيف. ما أفضل تفسير؟', '[{"en":"Ice cream causes accidents","ar":"الآيس كريم يسبب الحوادث"},{"en":"Accidents make people buy ice cream","ar":"الحوادث تجعل الناس يشترون الآيس كريم"},{"en":"Hot weather increases both","ar":"الطقس الحار يزيد الاثنين"},{"en":"It is pure chance","ar":"مجرد صدفة"}]'::jsonb, 2, false);

create or replace function public.demo_status(p_exam_tag text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_email text; v_used int;
begin
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then raise exception 'sign_in_required' using errcode = '28000'; end if;
  select used_count into v_used from public.demo_usage where email = v_email and exam_tag = p_exam_tag;
  return jsonb_build_object('used', coalesce(v_used,0), 'remaining', 2 - coalesce(v_used,0), 'max', 2);
end $$;

create or replace function public.demo_start(p_exam_tag text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text; v_used int; v_run uuid; v_set int; v_q jsonb;
begin
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is null then raise exception 'sign_in_required' using errcode = '28000'; end if;
  if p_exam_tag not in ('university-iq-preparation','university-cognitive-skills') then
    raise exception 'unknown_exam' using errcode = '22023'; end if;
  -- Atomic check-and-count: the row lock makes two tabs at once still count separately; the WHERE stops at 2.
  insert into public.demo_usage as d (email, exam_tag, used_count) values (v_email, p_exam_tag, 1)
  on conflict (email, exam_tag) do update set used_count = d.used_count + 1, last_at = now()
    where d.used_count < 2
  returning d.used_count into v_used;
  if v_used is null then raise exception 'demo_limit_reached' using errcode = 'P0001'; end if;
  v_set := v_used;  -- demo 1 = set 1, demo 2 = set 2 (different questions)
  insert into public.demo_runs (user_id, email, exam_tag, run_no, set_no) values (v_uid, v_email, p_exam_tag, v_used, v_set)
  returning id into v_run;
  select jsonb_agg(jsonb_build_object('id', q.id, 'domain', jsonb_build_array(q.domain_en, q.domain_ar),
           'question', jsonb_build_array(q.question_en, q.question_ar), 'options', q.options, 'englishOnly', q.english_only)
         order by q.position) into v_q
  from public.demo_questions q where q.set_no = v_set;
  -- Correct answers are never sent to the browser.
  return jsonb_build_object('runId', v_run, 'runNo', v_used, 'remaining', 2 - v_used, 'questions', v_q);
end $$;

create or replace function public.demo_submit(p_run_id uuid, p_answers smallint[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.demo_runs; v_score int; v_total int; v_used int;
begin
  select * into r from public.demo_runs where id = p_run_id and user_id = auth.uid() for update;
  if not found then raise exception 'run_not_found' using errcode = 'P0002'; end if;
  if r.submitted_at is not null then raise exception 'already_submitted' using errcode = 'P0001'; end if;
  select count(*) filter (where p_answers[q.position] = q.answer), count(*) into v_score, v_total
  from public.demo_questions q where q.set_no = r.set_no;
  update public.demo_runs set submitted_at = now(), answers = p_answers, score = v_score where id = r.id;
  select used_count into v_used from public.demo_usage where email = r.email and exam_tag = r.exam_tag;
  return jsonb_build_object('score', v_score, 'total', v_total, 'remaining', 2 - coalesce(v_used,0));
end $$;

revoke all on function public.demo_status(text), public.demo_start(text), public.demo_submit(uuid, smallint[]) from public, anon;
grant execute on function public.demo_status(text), public.demo_start(text), public.demo_submit(uuid, smallint[]) to authenticated;

commit;

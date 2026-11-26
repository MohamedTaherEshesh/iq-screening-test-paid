-- OMS-MND-261126-16  Gender for every exam taker, age rule per level, male/female counts on corporate registration.
-- NOT APPLIED. Needs the owner's words "موافق على قاعدة البيانات" (backup step in the RUN file).
-- Age rule (owner 2026-11-26 19:38Z): Junior exams (exam_tag starting 'junior-') only ages 10 to 17;
-- every other exam only ages 18 and over. Enforced here for new sessions (defence in depth; the exam function checks it too).
-- Existing rows are not changed and not checked.
-- Rollback: supabase/migrations/202611260016_rollback.sql
begin;
alter table public.university_challenge_sessions add column if not exists candidate_gender text check (candidate_gender in ('male','female'));
alter table public.exam_results add column if not exists candidate_gender text check (candidate_gender in ('male','female'));
alter table public.corporate_accounts
  add column if not exists male_count   int check (male_count between 0 and 1000000),
  add column if not exists female_count int check (female_count between 0 and 1000000);

-- Age per level for new sessions.
create or replace function public.trg_exam_age_rule() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare a int;
begin
  if new.candidate_birthdate is null then raise exception 'age_required'; end if;
  a := extract(year from age(coalesce(new.started_at, now())::date, new.candidate_birthdate))::int;
  if new.exam_tag like 'junior-%' then
    if a < 10 or a > 17 then raise exception 'age_rule_junior'; end if;
  elsif a < 18 then raise exception 'age_rule_adult';
  end if;
  return new;
end $$;
drop trigger if exists trg_exam_age_rule on public.university_challenge_sessions;
create trigger trg_exam_age_rule before insert on public.university_challenge_sessions for each row execute function public.trg_exam_age_rule();

-- Results register copies the gender (same body as OMS-MND-261126-05 plus candidate_gender).
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
  insert into public.exam_results(session_id, candidate_id, exam_tag, language, candidate_name, candidate_country, candidate_city, candidate_age, candidate_gender,
    started_at, submitted_at, total_items, answered, correct, percent_correct, per_domain, item_codes, item_domains, item_outcomes, timed_out)
  values (ss.id, ss.candidate_id, ss.exam_tag, ss.language, ss.candidate_name, ss.candidate_country, ss.candidate_city,
    case when ss.candidate_birthdate is null then null else extract(year from age(ss.started_at::date, ss.candidate_birthdate))::int end, ss.candidate_gender,
    ss.started_at, ss.submitted_at, n, answered, coalesce((ss.result->>'correct')::int, correct),
    case when n > 0 then round(coalesce((ss.result->>'correct')::int, correct) * 100.0 / n, 2) end,
    ss.result->'perDomain', ss.item_codes, ss.domains, outcomes, coalesce((ss.result->>'timedOut')::boolean, false))
  on conflict (session_id) do nothing;
end $$;
revoke all on function public.record_exam_result(public.university_challenge_sessions) from public, anon, authenticated;

-- Corporate registration stores expected male/female employee counts (optional).
create or replace function public.corporate_register(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.corporate_accounts; e jsonb; tag text; n int; total int := 0; ref text; i int := 0; ex int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'invalid_request'; end if;
  if coalesce(p->>'consent','') <> 'yes' then raise exception 'consent_required'; end if;
  if coalesce(p->>'org_type','') not in ('company','organization','government','education') then raise exception 'invalid_fields'; end if;
  perform pg_advisory_xact_lock(hashtextextended('corporate-register', 71));
  if (select count(*) from public.corporate_accounts where created_at > now() - interval '10 minutes') >= 30 then raise exception 'busy'; end if;
  if exists (select 1 from public.corporate_accounts where lower(email) = lower(trim(p->>'email')) and status in ('pending','active')) then raise exception 'email_registered'; end if;
  ex := case when jsonb_typeof(p->'exams') = 'array' then jsonb_array_length(p->'exams') else 0 end;
  if ex > 20 then raise exception 'invalid_fields'; end if;
  loop
    ref := 'CORP-' || to_char(now() at time zone 'UTC', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 5));
    exit when not exists (select 1 from public.corporate_accounts where reference = ref);
    i := i + 1; if i > 5 then raise exception 'busy'; end if;
  end loop;
  insert into public.corporate_accounts(reference, org_type, company_name, registration_no, tax_no, country, city, address, website, sector, employees,
                                        contact_name, contact_title, email, phone, billing_email, notes, language, male_count, female_count)
  values (ref, p->>'org_type', trim(p->>'company_name'), nullif(trim(p->>'registration_no'), ''), nullif(trim(p->>'tax_no'), ''),
          upper(trim(p->>'country')), nullif(trim(p->>'city'), ''), nullif(trim(p->>'address'), ''), nullif(trim(p->>'website'), ''),
          nullif(trim(p->>'sector'), ''), nullif(trim(p->>'employees'), ''), trim(p->>'contact_name'), nullif(trim(p->>'contact_title'), ''),
          lower(trim(p->>'email')), trim(p->>'phone'), nullif(lower(trim(p->>'billing_email')), ''), nullif(trim(p->>'notes'), ''),
          case when p->>'language' = 'ar' then 'ar' else 'en' end,
          nullif(p->>'male_count', '')::int, nullif(p->>'female_count', '')::int)
  returning * into c;
  if ex > 0 then
    for e in select * from jsonb_array_elements(p->'exams') loop
      tag := e->>'exam'; n := (e->>'seats')::int;
      if not exists (select 1 from public.exam_price_history h where h.exam_tag = tag and h.valid_to is null) then raise exception 'unknown_exam'; end if;
      insert into public.corporate_exam_requests(company_id, exam_tag, seats_requested) values (c.id, tag, n);
      total := total + n;
    end loop;
  end if;
  return jsonb_build_object('reference', c.reference, 'status', c.status, 'exams', ex, 'seats', total);
exception
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_fields';
  when unique_violation then raise exception 'email_registered';
end $$;
revoke all on function public.corporate_register(jsonb) from public;
grant execute on function public.corporate_register(jsonb) to anon, authenticated;
commit;

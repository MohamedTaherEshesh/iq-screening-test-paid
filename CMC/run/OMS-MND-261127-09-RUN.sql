-- OMS-MND-261127-09  Fix: admin page shows no companies or service requests; exam prices for all 10 exams; no "IQ" wording.
-- Cause: in this project `revoke all ... from public` also removes the service role's right to run a function
-- (there is no default grant). The admin-analytics edge function runs as the service role, so every admin
-- action and the corporate balance query failed with "permission denied", and the page hid the sections.
-- Changes:
--  1) grant execute to service_role on the functions the edge functions call (server-side only; anon and
--     authenticated stay revoked).
--  2) Rename the price variable Price_University_IQ_Preparation -> Price_University_MindProof_Reasoning_Score
--     (label only; prices and payment links use exam_tag and price id, which do not change).
--  3) set_exam_price can set the FIRST price of any of the 10 MindProof exams (before: only exams that
--     already had a price). Variable name Price_<Level>_<Type>.
-- Rollback: 202611270009_rollback.sql.
begin;

grant execute on function
  public.current_exam_price(text),
  public.assert_exam_price_quote(jsonb, text),
  public.set_exam_price(text, int, text, text),
  public.current_corporate_price(uuid, text),
  public.corporate_balances(),
  public.corporate_exam_catalog(),
  public.set_corporate_price(uuid, text, int, text, text),
  public.set_corporate_status(uuid, text, text, text),
  public.grant_corporate_seats(uuid, text, int, text, text),
  public.corporate_request_code(text, text),
  public.corporate_change_admin_email(uuid, text, text, text),
  public.corporate_add_admin(uuid, text, text, text),
  public.corporate_remove_admin(uuid, text, text, text),
  public.corporate_claim_registration_notice(text),
  public.set_service_request_status(text, text, text, text),
  public.corporate_mark_request_paid(text, text, int, int, text),
  public.corporate_book_seat(uuid, text, timestamptz, text),
  public.corporate_use_booking(bigint, text),
  public.corporate_cancel_booking(bigint)
to service_role;

update public.exam_price_history set variable_name = 'Price_University_MindProof_Reasoning_Score'
 where variable_name = 'Price_University_IQ_Preparation';

create or replace function public.exam_price_variable(p_exam_tag text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case p_exam_tag
    when 'university-iq-preparation'            then 'Price_University_MindProof_Reasoning_Score'
    when 'university-cognitive-skills'          then 'Price_University_Cognitive_Skills'
    when 'junior-reasoning-score'               then 'Price_Junior_MindProof_Reasoning_Score'
    when 'junior-cognitive-assessment'          then 'Price_Junior_Cognitive_Assessment'
    when 'manager-reasoning-score'              then 'Price_Manager_MindProof_Reasoning_Score'
    when 'manager-cognitive-assessment'         then 'Price_Manager_Cognitive_Assessment'
    when 'senior-manager-reasoning-score'       then 'Price_Senior_Manager_MindProof_Reasoning_Score'
    when 'senior-manager-cognitive-assessment'  then 'Price_Senior_Manager_Cognitive_Assessment'
    when 'c-level-reasoning-score'              then 'Price_C_Level_MindProof_Reasoning_Score'
    when 'c-level-cognitive-assessment'         then 'Price_C_Level_Cognitive_Assessment'
  end
$$;
revoke all on function public.exam_price_variable(text) from public, anon, authenticated;
grant execute on function public.exam_price_variable(text) to service_role;

create or replace function public.set_exam_price(p_exam_tag text, p_amount_cents int, p_changed_by text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t timestamptz := clock_timestamp(); old public.exam_price_history; nw public.exam_price_history; v text;
begin
  if p_amount_cents is null or p_amount_cents < 100 or p_amount_cents > 100000 then raise exception 'Price must be between 1 and 1000 USD'; end if;
  perform pg_advisory_xact_lock(hashtextextended('exam-price:' || coalesce(p_exam_tag, ''), 61));
  select * into old from public.exam_price_history where exam_tag = p_exam_tag and valid_to is null for update;
  if not found then
    -- OMS-MND-261127-09: first price for one of the 10 known exams.
    v := public.exam_price_variable(p_exam_tag);
    if v is null then raise exception 'Unknown exam %', p_exam_tag; end if;
    insert into public.exam_price_history(variable_name, exam_tag, amount_cents, valid_from, changed_by, note)
    values (v, p_exam_tag, p_amount_cents, t, left(p_changed_by, 200), coalesce(left(p_note, 500), 'First price')) returning * into nw;
    return jsonb_build_object('changed', true, 'previous', null, 'current', to_jsonb(nw));
  end if;
  if old.amount_cents = p_amount_cents then return jsonb_build_object('changed', false, 'current', to_jsonb(old)); end if;
  update public.exam_price_history set valid_to = t where id = old.id;
  insert into public.exam_price_history(variable_name, exam_tag, amount_cents, valid_from, changed_by, note)
  values (old.variable_name, p_exam_tag, p_amount_cents, t, left(p_changed_by, 200), left(p_note, 500)) returning * into nw;
  return jsonb_build_object('changed', true, 'previous', to_jsonb(old) || jsonb_build_object('valid_to', t), 'current', to_jsonb(nw));
end $$;
revoke all on function public.set_exam_price(text, int, text, text) from public, anon, authenticated;
grant execute on function public.set_exam_price(text, int, text, text) to service_role;

select 'OMS-MND-261127-09 applied' as result,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('corporate_balances','set_exam_price','corporate_request_code','corporate_mark_request_paid')
      and has_function_privilege('service_role', p.oid, 'execute')) as service_role_ok_of_4,
  (select count(*) from public.exam_price_history where variable_name ~* 'IQ') as iq_names_left;
commit;

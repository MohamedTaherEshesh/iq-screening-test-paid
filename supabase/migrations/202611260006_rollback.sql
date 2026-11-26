-- OMS-MND-261126-06 rollback: the reserve_exam_payment body before this change (fixed USD 10).
CREATE OR REPLACE FUNCTION public.reserve_exam_payment(p_test_id uuid, p_candidate uuid, p_quote jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.exam_payments; s public.university_challenge_sessions;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text,29));
  select * into s from public.university_challenge_sessions where id = p_test_id;
  if not found or s.candidate_id <> p_candidate or s.submitted is not true or s.result is null then
    return null;
  end if;
  select * into t from public.exam_payments where test_id = p_test_id;
  if found then
    if t.candidate_id <> p_candidate then return null; end if;
    return to_jsonb(t) || jsonb_build_object('existing', true);
  end if;
  perform public.assert_sandbox_usd_quote(p_quote);
  insert into public.exam_payments(candidate_id, test_id, amount_cents, usd_cents, fx_rate, fx_as_of, fx_source)
  values (p_candidate, p_test_id, (p_quote->>'amountCents')::int, 1000, (p_quote->>'rate')::numeric, (p_quote->>'asOf')::timestamptz, p_quote->>'source')
  returning * into t;
  return to_jsonb(t) || jsonb_build_object('existing', false);
end $function$;

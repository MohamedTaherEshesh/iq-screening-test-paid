-- OMSAZE STAGING ONLY / REVIEW ONLY / NEVER execute on production.
-- This function expects FULLY SERVER-SCORED inputs from the staging submit handler.
-- Service role only. The browser must never call the function.
BEGIN;
DO $g$
BEGIN
  IF to_regclass('public.submissions') IS NULL OR to_regclass('public.test_sessions') IS NULL THEN
    RAISE EXCEPTION 'Staging base schema not installed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.submissions LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.test_sessions LIMIT 1) THEN
    RAISE EXCEPTION 'This migration requires an empty staging database; manual review needed';
  END IF;
END $g$;

CREATE UNIQUE INDEX IF NOT EXISTS staging_submissions_one_per_test
  ON public.submissions (test_id) WHERE test_id IS NOT NULL;

CREATE FUNCTION public.staging_create_scored_submission(
  p_test_id uuid, p_name text, p_email text, p_phone text,
  p_gender text, p_birth_date date, p_lang text,
  p_result jsonb, p_report_html text, p_amount_cents integer,
  p_late boolean
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
  v_test public.test_sessions%ROWTYPE;
  v_sub_id uuid;
BEGIN
  IF p_test_id IS NULL OR p_name IS NULL OR length(btrim(p_name)) < 3
     OR p_email IS NULL OR p_phone IS NULL OR p_birth_date IS NULL
     OR p_lang NOT IN ('en','ar') OR p_result IS NULL OR
     jsonb_typeof(p_result) <> 'object' OR p_report_html IS NULL OR
     length(p_report_html) = 0 OR length(p_report_html) > 1000000 OR
     p_amount_cents IS NULL OR p_amount_cents < 1 OR p_amount_cents > 1000000 OR
     p_late IS NULL THEN
    RAISE EXCEPTION 'Invalid server-scored submission values';
  END IF;

  SELECT * INTO v_test
  FROM public.test_sessions
  WHERE id = p_test_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown test session'; END IF;
  IF v_test.submitted THEN RAISE EXCEPTION 'Test already submitted'; END IF;
  IF v_test.lang NOT IN (p_lang,'fr') THEN
    RAISE EXCEPTION 'Unexpected session language';
  END IF;

  -- Atomic insert + submitted=true; an insert exception rolls both operations back.
  INSERT INTO public.submissions (
    name, email, phone, gender, birth_date, lang, result, report_html,
    status, amount_cents, test_id, test_started_at
  ) VALUES (
    p_name, p_email, p_phone, p_gender, p_birth_date, p_lang, p_result, p_report_html,
    CASE WHEN p_late THEN 'check_required' ELSE 'pending_payment' END,
    p_amount_cents, p_test_id, v_test.started_at
  )
  RETURNING id INTO v_sub_id;
  UPDATE public.test_sessions SET submitted = true WHERE id = p_test_id;
  RETURN v_sub_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.staging_create_scored_submission(
  uuid,text,text,text,text,date,text,jsonb,text,integer,boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staging_create_scored_submission(
  uuid,text,text,text,text,date,text,jsonb,text,integer,boolean
) TO service_role;
COMMIT;

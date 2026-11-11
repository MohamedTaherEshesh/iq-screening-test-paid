-- OMSAZE DEVELOPMENT / STAGING ONLY. DO NOT RUN ON PRODUCTION.
-- Review and execute ONLY in Supabase project: omsaze-staging.
-- Requires existing empty public.submissions, public.test_sessions, public.visitors tables.
-- This creates a durable test-email outbox and atomic paid->queued transition.
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.submissions') IS NULL OR
     to_regclass('public.test_sessions') IS NULL OR
     to_regclass('public.visitors') IS NULL THEN
    RAISE EXCEPTION 'Base staging tables missing; refusing migration';
  END IF;
  IF to_regclass('public.staging_email_outbox') IS NOT NULL THEN
    RAISE EXCEPTION 'Outbox already exists; review migration state before proceeding';
  END IF;
  -- Extra fail-closed safeguard against accidentally operating on populated production.
  IF EXISTS (SELECT 1 FROM public.submissions LIMIT 1) OR
     EXISTS (SELECT 1 FROM public.test_sessions LIMIT 1) OR
     EXISTS (SELECT 1 FROM public.visitors LIMIT 1) THEN
    RAISE EXCEPTION 'Expected EMPTY staging database. Never run this on production.';
  END IF;
END
$guard$;

CREATE TABLE public.staging_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'candidate_report'
    CHECK (kind IN ('candidate_report')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 6 CHECK (max_attempts BETWEEN 1 AND 12),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, kind)
);
CREATE INDEX staging_email_outbox_due_idx
  ON public.staging_email_outbox (available_at, created_at)
  WHERE status IN ('pending','processing');

ALTER TABLE public.staging_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staging_email_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staging_email_outbox TO service_role;

-- Only callable via trusted service-role after validating Paymob's sandbox HMAC.
-- Transaction holds the submission row lock while changing status and enqueueing.
CREATE FUNCTION public.staging_record_verified_payment(
  p_submission_id uuid,
  p_order_id bigint,
  p_transaction_id bigint,
  p_amount_cents integer
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
  v_sub public.submissions%ROWTYPE;
BEGIN
  IF p_submission_id IS NULL OR p_order_id IS NULL OR p_order_id <= 0 OR
     p_transaction_id IS NULL OR p_transaction_id <= 0 OR
     p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN 'invalid_event';
  END IF;

  SELECT * INTO v_sub FROM public.submissions
    WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  -- Never overwrite already-paid data with a mismatched event.
  IF v_sub.status = 'paid' AND
     (v_sub.paymob_order_id IS DISTINCT FROM p_order_id OR
      v_sub.amount_cents IS DISTINCT FROM p_amount_cents) THEN
    RETURN 'paid_event_conflict';
  END IF;

  IF v_sub.paymob_order_id IS DISTINCT FROM p_order_id THEN
    RETURN 'order_mismatch'; -- includes missing saved order ID: retry/reconcile
  END IF;

  IF v_sub.amount_cents IS DISTINCT FROM p_amount_cents THEN
    IF v_sub.status <> 'paid' THEN
      UPDATE public.submissions SET status = 'check_required'
        WHERE id = p_submission_id;
    END IF;
    RETURN 'amount_mismatch';
  END IF;

  IF v_sub.status = 'check_required' THEN RETURN 'review_required'; END IF;
  IF v_sub.status NOT IN ('paid', 'pending_payment', 'failed') THEN RETURN 'ineligible'; END IF;

  IF v_sub.status <> 'paid' THEN
    UPDATE public.submissions
      SET status = 'paid', paymob_txn_id = p_transaction_id, paid_at = now()
      WHERE id = p_submission_id;
  END IF;

  -- Same transaction as payment status. Unique constraint makes duplicate
  -- callbacks safe and lets a later valid callback repair a missing queue row.
  INSERT INTO public.staging_email_outbox (submission_id, kind)
    VALUES (p_submission_id, 'candidate_report')
    ON CONFLICT (submission_id, kind) DO NOTHING;

  IF v_sub.status = 'paid' THEN RETURN 'already_paid'; END IF;
  RETURN 'paid_and_queued';
END
$fn$;

CREATE FUNCTION public.staging_claim_email_jobs(p_limit integer DEFAULT 1)
RETURNS TABLE(outbox_id uuid, submission_id uuid, attempt_no integer, lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF p_limit < 1 OR p_limit > 5 THEN RAISE EXCEPTION 'invalid claim limit'; END IF;

  -- A crashed worker must not leave final-exhausted jobs forever in processing.
  UPDATE public.staging_email_outbox q
  SET status = 'failed', updated_at = now(),
      last_error = 'Delivery lease expired after maximum attempts',
      lease_expires_at = NULL, lease_token = NULL
  WHERE q.status = 'processing' AND q.lease_expires_at < now()
    AND q.attempts >= q.max_attempts;

  RETURN QUERY
  WITH ready AS (
    SELECT q.id
    FROM public.staging_email_outbox q
    WHERE q.attempts < q.max_attempts
      AND (
        (q.status = 'pending' AND q.available_at <= now()) OR
        (q.status = 'processing' AND q.lease_expires_at < now())
      )
    ORDER BY q.available_at, q.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.staging_email_outbox q
    SET status = 'processing', attempts = q.attempts + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '2 minutes',
        updated_at = now()
    FROM ready
    WHERE q.id = ready.id
    RETURNING q.id, q.submission_id, q.attempts, q.lease_token
  )
  SELECT c.id, c.submission_id, c.attempts, c.lease_token FROM claimed c;
END
$fn$;

CREATE FUNCTION public.staging_mark_email_sent(
  p_outbox_id uuid, p_lease_token uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
BEGIN
  UPDATE public.staging_email_outbox
  SET status = 'sent', sent_at = now(), last_error = NULL,
      lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_outbox_id AND lease_token = p_lease_token AND status = 'processing'
    AND lease_expires_at > now();
  RETURN FOUND;
END
$fn$;

CREATE FUNCTION public.staging_mark_email_failed(
  p_outbox_id uuid, p_lease_token uuid, p_error text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
BEGIN
  UPDATE public.staging_email_outbox q
  SET status = CASE WHEN q.attempts >= q.max_attempts THEN 'failed' ELSE 'pending' END,
      last_error = left(COALESCE(p_error, 'unknown delivery failure'), 500),
      available_at = now() + (power(2, least(q.attempts, 8)) * interval '1 minute'),
      lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE q.id = p_outbox_id AND q.lease_token = p_lease_token AND q.status = 'processing'
    AND q.lease_expires_at > now();
  RETURN FOUND;
END
$fn$;

REVOKE ALL ON FUNCTION public.staging_record_verified_payment(uuid,bigint,bigint,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staging_claim_email_jobs(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staging_mark_email_sent(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staging_mark_email_failed(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staging_record_verified_payment(uuid,bigint,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.staging_claim_email_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.staging_mark_email_sent(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.staging_mark_email_failed(uuid,uuid,text) TO service_role;

COMMIT;

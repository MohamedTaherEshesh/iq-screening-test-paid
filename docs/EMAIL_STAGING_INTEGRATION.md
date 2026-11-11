# OMSAZE staging email integration — DEVELOPMENT ONLY

This branch contains a candidate `supabase/functions/_shared/mail.ts` and regression tests.
**It has not been deployed**, and no SMTP send or payment test has been performed.

## Safety guarantees
- Production repo branch `main` was not edited.
- Production Supabase `iq-screening` and Paymob remain untouched.
- Delivery is **disabled by default**. The code throws if `OMSAZE_EMAIL_MODE` is missing or differs from `smtp`.
- To enable test delivery after separate review, all of these must be set in the **staging project only**:
  - `OMSAZE_ENVIRONMENT=staging`
  - `SUPABASE_URL=https://cbklbucvidcutshhmwjy.supabase.co` (Supabase-injected; verify it)
  - `OMSAZE_EMAIL_MODE=smtp`
  - `OMSAZE_TEST_RECIPIENT=<dedicated safe test mailbox>`
  - `SMTP_USER`, `SMTP_PASS` (staging-only test account; never commit secrets)
- All sent mail is routed exclusively to `OMSAZE_TEST_RECIPIENT`. Candidate email is ignored as a destination.
- The email is a *test* message; no owner BCC is used.

## Compatibility review before deployment
1. The original `sendReport` accepted `{email,name,report_html}`. The new version **requires `result`**, to generate a certificate with actual server-calculated data. Update all server callers in the staging function code first. No default 0 IQ/score is silently fabricated.
2. `sendOwnerSummary` now has explicit `hours` type; verify the caller's totals structure.
3. The staging certificate generator intentionally removes indicative IQ and percentile badges pending psychometric validation.
4. Report HTML attached to the email must only come from the server-side result pipeline and must be reviewed for arbitrary markup before active email sending.
5. A transactional email outbox / retry workflow has **not** yet been implemented. It needs a separate staging-only migration, delivery status and idempotency tests.
6. Supabase staging Edge Functions are **not yet deployed**. The new files alone do not provide operational email delivery.
7. Ensure that the Deno npm compatibility version and SMTP transport are tested in the actual staging runtime.
8. Tests: `deno test tests/mail_staging_test.ts` (requires Deno + external npm dependency). These tests were added, but have **not been run in Supabase**.

## Next stage
Recover all dependent Edge Function source files to the development branch, update their imports/call contracts, add an outbox state machine, deploy only to `omsaze-staging`, and perform sandbox-only delivery and retry tests with synthetic data.

# OMSAZE staging submit integration — review status

**Development branch only. NOT DEPLOYED. No Paymob transaction or SMTP delivery was performed.**

## Implemented prototypes
- `submit/index.ts`: validates registration and answers, regenerates questions and grades using server-only seed + answer key, preserves provisional scoring, creates stored report, atomically claims the test with `staging_create_scored_submission`, then calls test-only Paymob intention API and persists its order ID before returning a checkout URL.
- `paymob-staging.ts`: requires `sk_test_`/`pk_test_` credentials and an integration that Paymob reports as `live:false`.
- `paymob-webhook/index.ts`: requires test mode and verifies callback HMAC, saved order ID, integration ID, EGP amount and non-live, non-pending successful state.
- `staging_email_outbox` and email worker: queue delivery upon verified paid transition; sender routes only to test mailbox.
- Two migrations are REVIEW_ONLY and have not been executed.

## Blockers and caveats
1. `_shared/engine.ts` and `_shared/report.ts` are not currently in the GitHub development branch. Their source was previously supplied for review, but **do not publish the server-side engine/answer generation logic to a public repository without an exposure review**. Store backend source in private deployment pipeline/repo or publish as deployment artifact only.
2. The current `start-test` function has not been reconstructed/deployed in staging. The `submit` prototype cannot run without it.
3. The migrations require an empty dedicated staging DB, manual SQL review, and review of grants/status checks.
4. The prototype has not undergone Deno typechecking, integration tests, or live sandbox callbacks. Static checks are not a substitute for executed tests.
5. The Paymob 'creation succeeded but order ID persistence failed' race requires a reconciler. It currently returns a safe 503 without checkout URL, but can leave a pending order. The callback returns 503 for unmatched orders.
6. A failed payment start marks the saved submission failed; repeated submission is rejected. A dedicated trusted retry/recovery flow is still needed.
7. End-to-end email may be delivered more than once after a lease expiry or crash; a robust idempotency strategy and manual retry visibility are needed.
8. This repository may be public. Never commit Paymob HMAC secrets, test passwords, service keys or candidate data.
9. The currently provisional IQ/percentile values and career categories are not validated standardized norms.
10. Current CORS is a browser restriction, not authentication; rate limits and session ownership verification are still needed.

## Before any deployment
- Inspect and validate all current production source in read-only mode (especially start-test, report, engine and Paymob fields) and reconstruct privately.
- Fix remaining payment mismatch and retry cases and test them with synthetic inputs.
- Configure staging secrets **inside omsaze-staging only**, never in chats or GitHub.
- Run local Deno checks and SQL tests on the empty staging project.
- Deploy to `omsaze-staging` only after review; keep main, original Supabase and production Paymob unchanged.

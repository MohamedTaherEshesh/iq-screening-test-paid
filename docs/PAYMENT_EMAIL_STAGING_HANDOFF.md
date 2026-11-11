# OMSAZE — Staging-only payment-to-email handoff (NOT DEPLOYED)

## Implemented on development branch
1. `supabase/migrations/202611120001_staging_email_outbox_REVIEW_ONLY.sql` defines private durable outbox, constrained state, unique (submission_id,kind), and transaction-level payment-to-outbox RPC.
2. `supabase/functions/_shared/staging-db.ts` refuses to execute unless SUPABASE_URL identifies the separate `omsaze-staging` Supabase project and OMSAZE_ENVIRONMENT=staging.
3. `supabase/functions/paymob-webhook/index.ts` checks a Paymob-style SHA-512 HMAC and sandbox integration ID before looking up the saved order; only successful verified callbacks invoke atomic paid+queued RPC. This is a staging prototype, **not validated against genuine sandbox callbacks**.
4. `supabase/functions/staging-email-worker/index.ts` requires a 32+ character worker secret and claims jobs with leases. The mail adapter allows SMTP delivery only to a dedicated test mailbox under the correct staging project.
5. `supabase/functions/_shared/mail.ts` prepares report and completion certificate attachments.

## NOT done — deployment blockers
- **The current production submit/index.ts has not been recovered in full.** An older archived submit accepted reportHtml from browser; DO NOT restore that code. Current server-side grading and answer keys must remain authoritative.
- Staging Edge Functions are NOT deployed and no end-to-end workflow has been run.
- No Paymob sandbox keys or integration were configured or tested. Never use production Paymob secrets for these prototypes.
- No scheduler for the mail worker is configured. Do not expose its secret to frontend/browser or commit it.
- The SQL migration is **review-only** and has NOT been executed.
- SMTP and report HTML attachments need testing in the staging Deno runtime.
- **At-least-once delivery**: SMTP can accept mail before a worker crash or lease expiration. A retry may duplicate delivery; exactly-once delivery is NOT guaranteed.
- **Callback/order race**: an authenticated callback arriving before paymob_order_id is persisted returns 503. An eventual Paymob redelivery or a trusted reconciler will be necessary; this edge case is not solved fully.
- Callback HMAC concatenation, flag types and payment identifier binding need validation against Paymob's actual sandbox callback schema.
- Any approval to execute the SQL migration must be limited to the empty `omsaze-staging` database. Even guard checks cannot identify a project reliably from SQL alone.
- The certificate has no third-party verification service, and should remain a completion record.

## Safe next steps
1. Review the current server-side `submit/index.ts`, `_shared/paymob.ts` and `paymob-webhook/index.ts` from Production in read-only mode, without exposing credentials.
2. Update only development branch to integrate the current grading pipeline and trusted sandbox checkout.
3. Validate state transitions, duplicate and out-of-order callbacks, and fake data in local tests.
4. Review the staging-only migration and then, with explicit project verification, execute only in `omsaze-staging`.
5. Deploy only to staging and run synthetic sandbox tests. No production changes until tested and separately approved.

## Security note
Secrets belong in Supabase staging project secrets; never write SMTP app passwords, Paymob HMAC strings or service-role keys into GitHub files or chat.

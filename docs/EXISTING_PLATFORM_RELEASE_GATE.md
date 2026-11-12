# OMSAZE T - Existing Platform Release Gate

Release policy agreed by the user, 2026-11-12: Implement all discovered fixes in the existing platform, after staging sanity checks and a verified backup, then promote to `main` only when safe.

## Verified code backup
- Existing public repository: `MohamedTaherEshesh/iq-screening-test-paid`.
- Backup branch: `backup/pre-omsaze-t-2026-11-12`.
- Original main SHA captured: `ae96e6be19f69355d47778b813f342b5d44e7704`.
- Backup was independently compared with main and found identical at creation.
- A GitHub branch is a **code backup only**; it does not back up the hosted Supabase production database, Edge Function deployments, Supabase configuration, secrets or Paymob setup.

## Platform scope
- OMSAZE T is a multi-assessment platform, with eight types in the catalog.
- University IQ Preparation is the FIRST pilot, not the only OMSAZE T product.
- Improve the existing index.html, owner.html, consent and payment/report experience without discarding existing working features.
- Keep confidential engine and answer keys in the private `omsaze-staging-backend` repository.
- Do not accept same-template number/name changes or paraphrases of the same reasoning method as different items.

## Promotion gates - all required
1. Correctly separate all eight catalog categories, keeping unready types disabled. University pilot content needs genuine reviewed conceptual diversity. Confirm zero repeated solving concepts per session.
2. Confirm build/typecheck and executable tests pass for backend and frontend; current static reviews alone DO NOT qualify.
3. Verify correct test start, server-side scoring, timer, retakes/idempotency, language support, registration and consent with synthetic data.
4. Review Supabase migrations in the isolated `omsaze-staging` project; confirm RLS, privileges, RPC permissions, uniqueness, no sensitive information exposed.
5. Verify Paymob sandbox only: happy path, invalid HMAC, mismatched amount, duplicate callback, callback/order race, refund/failure handling, retry/reconciliation.
6. Verify report access controls, non-disclosure of server answer keys, private attachment handling, safe certificate text and correct provisional scoring caveats.
7. Verify staging-only SMTP to a test recipient; retries, duplicate-send risk and monitoring, plus owner notices.
8. Verify responsive frontend and owner dashboard; check accessibility, Arabic/English and operational error handling.
9. Verify live Supabase data and Edge Function configuration are backed up with a recoverable, verified method before touching production; keep secrets out of GitHub.
10. Prepare staged rollout, production migration review, smoke tests, and a rollback plan including how to restore code, functions and data. Obtain user sign-off for the tested release.

## Current blockers
- The **approved question bank is empty** in the private repository; strict `start-test` deliberately refuses to serve unreviewed or repeated questions.
- University bank is not yet complete and must not be substituted with the old five-ability 50-item generator.
- Staging migrations remain REVIEW_ONLY and have not been executed.
- Staging functions have not been deployed or end-to-end tested; Paymob sandbox and test mail not configured.
- Existing site still needs a working assessment-type selector, secure result endpoint and per-type dashboard adaptation.

## Strict boundary
Do not merge to main or deploy to live GitHub Pages, Supabase production or real Paymob until *all* release gates pass. Approved changes belong on development and isolated staging first.

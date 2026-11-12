# OMSAZE T — Release to existing MAIN only after successful tests

**Release intent confirmed by user (2026-11-12):** all **approved, applicable** bug fixes, quality improvements and new product features developed for OMSAZE T must ultimately update the **already-released existing product**, not remain permanently in a separate staging project.

## Repository mapping
- Existing published GitHub Pages frontend: `MohamedTaherEshesh/iq-screening-test-paid` (`main`).
- Public frontend development branch: `development`.
- Private backend: `MohamedTaherEshesh/omsaze-staging-backend` (`development`).
- Isolated staging database and Edge Functions: `omsaze-staging`.
- Current **live** Supabase system: `iq-screening`. Do not change before release gate.
- Live Paymob and SMTP credentials must never be used in staging.

## Already created code backup
- Git branch: `backup/main-2026-11-12-before-omsaze-t-catalog-ae96e6b`
- Exact pre-release production Git commit: `ae96e6be19f69355d47778b813f342b5d44e7704`.
- This is a Git/code backup only; it is NOT a Supabase database backup, user-data backup or Paymob configuration snapshot.
- Do NOT delete or rewrite the backup branch. Revalidate branch head before deployment.

## Required successful tests / acceptance checks before updating live MAIN
- [ ] Private-backend Deno typecheck and actual unit/integration tests pass, including `strict-bank`, `submit`, webhook and mail worker.
- [ ] University IQ Preparation content: human-reviewed original questions with genuinely distinct solution concepts. No superficial reskinning with new numbers, phrases or names. Reject undersized banks rather than repeating templates.
- [ ] Existing functionalities preserved (legacy screens, admin/stats, result viewing, accessibility, bilingual content as applicable).
- [ ] New assessment catalog and University-first flow tested in staging browser on desktop and mobile; no unintended enabled products.
- [ ] Correct scoring, one test session / one submission, accurate totals, timeout behavior, declined/failed payments, duplicate/out-of-order Paymob callbacks tested.
- [ ] Test-mode Paymob checkout completed using sandbox integration only; no live charges.
- [ ] SMTP restricted to staging test recipient; success, failure and retry behavior tested.
- [ ] Authorization/privacy tested, including access to reports by submission ID and other security findings.
- [ ] Staging schema migrations and SQL function permissions tested, with no leaked service-role key or question-answer secrets.
- [ ] Data retention and reporting design checked; original production data preserved.
- [ ] **Independent backup of production Supabase database** taken and checked, together with a rollback/restore plan and production Edge Function/config snapshots, before any production data/functions migration.
- [ ] Final production release diff reviewed and approved by owner; release and rollback procedures documented.
- [ ] Deploy live backend/database via a separate controlled process only after the tests and production backup; switch public `main` only when the compatible live backend is ready.
- [ ] Post-release smoke checks and monitoring pass.

## Safe release composition (critical)
The public `development` branch currently contains **server source, migrations and prototype secrets guards** alongside frontend work. **Do not merge it wholesale into public `main`**. Create a clean release PR/branch containing only approved *public frontend* assets, site pages and non-sensitive deployment configuration. The server-side question engine and answer keys MUST remain in the **private** backend repository/deployment environment.

Do not overwrite the existing production backend with staging-only code: staging functions include hard-coded staging project guards and test-payment restrictions, and would intentionally fail in production. Production-safe backend implementation, env configuration, database migration and release must be separately adapted/reviewed.

## State as of 2026-11-12
- [x] Code backup branch created and exact SHA confirmed.
- [x] Static source checks of catalog preview passed (12 checks).
- [ ] Browser QA, Deno tests, SQL tests, Paymob/SMTP sandbox end-to-end verification.
- [ ] Separate production Supabase DB backup and live release approval.
- **Public `main` intentionally remains at `ae96e6be19f69355d47778b813f342b5d44e7704`.**

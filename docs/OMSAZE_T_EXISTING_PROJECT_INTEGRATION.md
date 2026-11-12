# OMSAZE T — Integration into the EXISTING site

## Explicit user requirement
Changes must be carried into the **existing OMSAZE/MindProof project** as appropriate, not only the separate private backend. University IQ Preparation is the first pilot in a planned eight-assessment OMSAZE T platform. No cosmetic question re-use is allowed.

## Existing repository and protection
- Existing public frontend repository: `MohamedTaherEshesh/iq-screening-test-paid`
- Deploying GitHub Pages branch: `main`. **Do not modify before tested release approval.**
- All preparatory frontend work on `development` branch only.
- Production Supabase `iq-screening` and live Paymob must remain unchanged.
- Private server-only source: `MohamedTaherEshesh/omsaze-staging-backend` at `development`.
- Isolated Supabase project: `omsaze-staging`.

## Changes made in the existing project (development branch)
- `assessment-catalog.js`: public labels and IDs for eight assessments, all `enabled:false`.
- `assessments.html`: standalone responsive catalog preview with University first pilot, no active test button, no payments, no Supabase requests and no private backend logic.
- Kept existing `index.html` legacy test flow intact to avoid a premature change to the production-like test registration UX.

## Integration gates — pending
1. Align the frontend catalog with the versioned private backend catalog through tests. Do not duplicate sensitive question contents in this public repo.
2. Design University IQ Preparation questions with true solution-method uniqueness, reviewer approval, and original content. University is not the legacy 50-question five-ability engine.
3. Finalize the University session length, language availability, consent, scoring and payment flow; do not infer these from the old test.
4. Add explicit assessment selection to the existing frontend on `development`, then connect only the enabled assessment to the reviewed staging backend with server-enforced assessment IDs and sessions.
5. Make `owner.html` recognize assessment types and reporting **without changing production statistics**.
6. Test end-to-end in isolated Supabase and test-mode payment/mail with synthetic users; audit result ownership and idempotency.
7. Get explicit approval before merging or deploying any updated UI or functions to production.

## Current status
The existing site's catalog preview is **not connected to backend**. No production deployment or database migration has occurred. All catalog entries fail closed.

## Security
No question bank, correct answer key, reviewer information, Supabase service key, HMAC secret, SMTP password or candidate data may be added to the public frontend repository.

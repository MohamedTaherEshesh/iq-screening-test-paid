# Email verification before the practice exam

`verification.html` is the current bilingual preview entry point. It shows the latest requested 60-question/60-minute format across eight domains. The earlier university.html remains an archived 70-question proposal, not the current launch specification; its engine is not silently used as a fallback. The bank target is 10,000 original concepts; that expansion has not been completed.

Sequence: acknowledgement -> email -> server-issued code -> verification -> start eligibility. The code expires in five minutes, is single-use, and permits an initial send plus three resends (with server cooldown/abuse controls). Exam elapsed/remaining timers are separate and do not start during this sequence.

`email-verification-client.js` calls only the new isolated broker. It stores browser binding, flow state and native verified session/proof in sessionStorage; it never stores raw OTP input. `startHeaders()` supplies the native session and signed start proof. Client state is not authorization: all start handlers and the DB INSERT trigger validate/consume proof independently.

The public config contains no private secrets and remains disabled pending real delivery setup. The preview does not simulate a sent email or a successful verification. The exam Start button remains disabled until the actual 60-question engine, bank review and E2E are ready. Production index.html is unchanged.

Backend setup, staged deployment status, verification guarantees and remaining manual Auth/Resend settings are documented in the private backend `docs/EMAIL_VERIFICATION_STAGE.md` on branch fix/email-verification. Four new client tests plus the existing three client tests pass. No real code has been sent or inbox arrival verified by these tests.

# Revised University testing page — not yet enabled

The user tested the production homepage linked in chat, not a new staging exam. That route still runs the legacy 50-question engine. Its 20 generator families cannot satisfy the no-repeated-ideas rule. The management dashboard does not modify that exam.

This isolated branch adds `university.html` and its public UI/config, with a link from `assessments.html`. The original `index.html`, existing functions and production `main` remain unchanged. Do not merge the entire development branch into main.

The revised contract is **70 questions, 10 in each of seven domains, with a provisional 105-minute total timer**. The timer is a proposed 90 seconds per question on average, not a separate question timeout and not an official exam format. Domain labels are numerical, analytical, visual, spatial imagination, logical, linguistic, and creative problem solving. General/fluid intelligence is not claimed as a separately validated score.

The new UI only calls `/university-challenge`, never `/start-test`. It rejects a 50-question payload, the wrong policy/timer or missing domain coverage. No legacy fallback. Questions and scores remain server-side. Responses include only public prompts/options and raw practice results.

Configuration stays disabled. Before enabling a separately hosted staging preview:

1. Review the backend `fix/university-70-quality-and-exposure` branch and its unapplied migration.
2. Supply a genuinely reviewed/versioned bank and sufficient distinct ideas in every domain/difficulty/language.
3. Configure staging email OTP; provision invited test accounts with server-managed `app_metadata.omsaze_staging_tester=true`. Configure a code email template; no automatic signup from the test page.
4. Configure the matching exact staging CORS origin and public publishable key; never a service-role key.
5. Apply/deploy only to the isolated staging project after review, perform authenticated E2E and iPhone usability testing, then enable the pilot.
6. Production remains a separate proposal requiring tests, backup/restore evidence and explicit owner approval.

The UI refreshes expiring sign-in tokens during the 105-minute session. Saved server answers survive a page reload; local unsaved choices do not count. Server-side deadlines and submitted state cannot be extended by changing the phone clock or flagging questions. A failed submission can be retried without regrading/changing the first result.

The existing management dashboard still uses browser-local records; it is not a central feedback intake API.

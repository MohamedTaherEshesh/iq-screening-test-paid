// DEVELOPMENT / STAGING ONLY. Invoke with a private worker secret (never browser).
// Test mailbox is selected by mail.ts, not by candidate or database rows.
import { sendReport } from "../_shared/mail.ts";
import { requireStaging, stagingDb, timingSafeEqual } from "../_shared/staging-db.ts";

const reply = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);
  try {
    requireStaging();
    const expected = Deno.env.get("OMSAZE_WORKER_SECRET");
    const received = req.headers.get("x-omsaze-worker-secret") ?? "";
    if (!expected || expected.length < 32 || !timingSafeEqual(expected, received)) {
      return reply({ error: "unauthorized" }, 401);
    }
    if (Deno.env.get("OMSAZE_EMAIL_MODE") !== "smtp") {
      return reply({ error: "test email disabled" }, 503);
    }

    const db = stagingDb();
    const { data: jobs, error: claimErr } = await db.rpc("staging_claim_email_jobs", { p_limit: 1 });
    if (claimErr) throw claimErr;
    if (!Array.isArray(jobs) || jobs.length === 0) return reply({ ok: true, claimed: 0 });

    const job = jobs[0] as { outbox_id: string; submission_id: string; lease_token: string };
    try {
      const { data: sub, error: queryErr } = await db.from("submissions")
        .select("name,email,result,report_html,status").eq("id", job.submission_id).maybeSingle();
      if (queryErr || !sub || sub.status !== "paid") throw new Error("paid submission missing");
      const result = sub.result;
      if (!result || typeof result !== "object") throw new Error("invalid calculated result");
      await sendReport({
        name: sub.name, email: sub.email, report_html: sub.report_html,
        result: {
          date: result.date, correct: result.correct, total: result.total,
          iq: result.iq, pctl: result.pctl,
        },
      });
      const { data: marked, error: updateErr } = await db.rpc("staging_mark_email_sent", {
        p_outbox_id: job.outbox_id, p_lease_token: job.lease_token,
      });
      if (updateErr || marked !== true) {
        // SMTP could have accepted the message before a claim expires.
        // An expired claim must never be silently marked as sent.
        throw new Error("SMTP accepted but outbox confirmation failed; review possible duplicate");
      }
      return reply({ ok: true, claimed: 1, sent: 1 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown email error";
      console.error("staging mail job failed", message);
      const { data: marked, error: updateErr } = await db.rpc("staging_mark_email_failed", {
        p_outbox_id: job.outbox_id, p_lease_token: job.lease_token,
        p_error: message,
      });
      if (updateErr || marked !== true) {
        console.error("staging worker: lease expired or error marking failed");
        return reply({ ok: false, claimed: 1, needs_review: true }, 503);
      }
      return reply({ ok: false, claimed: 1, retry_scheduled: true }, 503);
    }
  } catch (err) {
    console.error("staging mail worker failed", err instanceof Error ? err.message : "unknown error");
    return reply({ error: "staging worker unavailable" }, 503);
  }
});

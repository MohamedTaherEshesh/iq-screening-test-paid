// Run on a developer machine with Deno: deno test tests/mail_staging_test.ts
// These are pure template tests; they never connect to SMTP or Supabase.
import { buildReportMail, buildOwnerMail } from "../supabase/functions/_shared/mail.ts";

const assert = (yes: unknown, message: string) => { if (!yes) throw new Error(message); };
const recipient = "testing@example.test";

Deno.test("candidate HTML escapes names; reports go only to the test mailbox", () => {
  const name = '<img src=x onerror="alert(1)"> Jane';
  const msg = buildReportMail({
    name, email: "real-candidate@example.com",
    report_html: "<div>Server-generated test report</div>",
    result: { date: "2026-11-12", correct: 32, total: 50, iq: 100, pctl: 50 },
  }, recipient);
  assert(msg.to === recipient, "not sent to the single test recipient");
  assert(msg.html.includes("&lt;img"), "HTML escaping missing");
  assert(!msg.html.includes("<img"), "raw candidate markup in email body");
  assert(msg.attachments.length === 2, "missing report or certificate");
  assert(!msg.attachments[0].content.includes("Indicative IQ"), "unvalidated IQ badge reappeared");
  assert(msg.attachments[0].content.includes("32/50"), "raw score missing");
});

Deno.test("missing result cannot silently produce a zero-score certificate", () => {
  let rejected = false;
  try {
    buildReportMail({ name: "Example Test", email: "example@example.test",
      report_html: "<div>report</div>", result: undefined as never }, recipient);
  } catch { rejected = true; }
  assert(rejected, "missing score must fail");
});

Deno.test("owner summary escapes names and handles hourly totals", () => {
  const b = { count: 1, egp: 50 };
  const msg = buildOwnerMail({
    day: b, week: b, month: b, year: b, inception: b, today: "2026-11-12", hours: { "13": b },
  }, { name: "<script>alert(1)</script>", amount_cents: 5000 }, recipient);
  assert(msg.to === recipient, "wrong mailbox");
  assert(msg.html.includes("&lt;script&gt;"), "owner name not escaped");
  assert(!msg.html.includes("<script>"), "injected script tag");
  assert(msg.html.includes("13:00"), "hourly breakdown missing");
});

Deno.test("invalid hourly totals are rejected", () => {
  const b = { count: 1, egp: 50 };
  let rejected = false;
  try {
    buildOwnerMail({
      day: b, week: b, month: b, year: b, inception: b,
      today: "2026-11-12", hours: { "<script>": b },
    }, { name: "Example", amount_cents: 5000 }, recipient);
  } catch { rejected = true; }
  assert(rejected, "invalid hourly label must fail");
});

// OMSAZE DEVELOPMENT prototype; STAGING ONLY; NOT DEPLOYED.
// Preserves server-side grading. Do not ship before dependency, sandbox and DB tests.
import { buildTest, ABIL, TOTAL } from "../_shared/engine.ts";
import { reportHtml } from "../_shared/report.ts";
import { startPaymobSandbox } from "../_shared/paymob-staging.ts";
import { requireStaging, stagingDb } from "../_shared/staging-db.ts";

const TOTAL_SECONDS = TOTAL * 30;
const GRACE_SECONDS = 120;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^\+?[0-9\s-]{7,20}$/;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
function parseBirthDate(value: unknown): string | null {
  if (typeof value !== "string" || !isoDate.test(value)) return null;
  const dt = new Date(value + "T00:00:00Z");
  return !Number.isFinite(dt.getTime()) || dt.toISOString().slice(0, 10) !== value ? null : value;
}
function ageInYears(birth: string, now = new Date()): number {
  const dt = new Date(birth + "T00:00:00Z");
  let age = now.getUTCFullYear() - dt.getUTCFullYear();
  const m = now.getUTCMonth() - dt.getUTCMonth();
  if (m < 0 || m === 0 && now.getUTCDate() < dt.getUTCDate()) age--;
  return age;
}
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z / Math.SQRT2));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
type Payload = {
  testId?: unknown; reg?: Record<string, unknown>; answers?: unknown;
  lang?: unknown;
};
export function validateSubmission(body: Payload): {
  testId: string; name: string; email: string; phone: string; birth: string;
  gender: string; answers: (number | null)[];
} {
  const reg = body.reg;
  if (!reg || typeof reg !== "object") throw new Error("invalid registration");
  const name = String(reg.name ?? "").trim();
  const email = String(reg.email ?? "").trim();
  const phone = String(reg.phone ?? "").trim();
  const birth = parseBirthDate(reg.birth);
  const testId = String(body.testId ?? "");
  if (name.length < 3 || name.length > 200 || !emailRegex.test(email) ||
      email.length > 254 || !phoneRegex.test(phone) || !birth ||
      ageInYears(birth) < 5 || ageInYears(birth) > 100 ||
      !uuidRegex.test(testId)) throw new Error("invalid registration");
  const raw = body.answers;
  if (!Array.isArray(raw) || raw.length !== TOTAL ||
      raw.some(v => v !== null && !(Number.isInteger(v) && v >= 0 && v <= 3))) {
    throw new Error("invalid answers");
  }
  const gender = typeof reg.gender === "string" ? reg.gender.slice(0, 30) : "";
  return { testId, name, email, phone, birth, gender, answers: raw as (number | null)[] };
}
function serverScore(test: {
  seed: number | string; lang: string; answer_key: unknown;
  started_at: string;
}, answers: (number | null)[], name: string, email: string, phone: string) {
  const seed = Number(test.seed);
  if (!Number.isSafeInteger(seed)) throw new Error("invalid server test seed");
  const built = buildTest(seed, test.lang === "ar" ? "ar" : "en");
  const key = test.answer_key;
  if (!Array.isArray(key) || key.length !== TOTAL ||
      key.some(a => !Number.isInteger(a) || a < 0 || a > 3) ||
      !Array.isArray(built.questions) || built.questions.length !== TOTAL) {
    throw new Error("invalid server answer key");
  }
  const per: Record<string, {c: number; n: number}> = {};
  ABIL.forEach(a => { per[a] = {c: 0, n: 0}; });
  let correct = 0, unanswered = 0;
  built.questions.forEach((q, i) => {
    if (!per[q.ability]) throw new Error("unexpected question ability");
    per[q.ability].n++;
    if (answers[i] === null) unanswered++;
    else if (answers[i] === key[i]) { correct++; per[q.ability].c++; }
  });
  const normMean = Number(Deno.env.get("NORM_MEAN") ?? "25");
  const normSd = Number(Deno.env.get("NORM_SD") ?? "8");
  if (!Number.isFinite(normMean) || !Number.isFinite(normSd) || normSd <= 0)
    throw new Error("invalid provisional norms");
  const elapsed = Math.round((Date.now() - Date.parse(test.started_at)) / 1000);
  if (!Number.isFinite(elapsed) || elapsed < -30) throw new Error("invalid session start");
  const late = elapsed > TOTAL_SECONDS + GRACE_SECONDS;
  const z = (correct - normMean) / normSd;
  const result = {
    correct, total: TOTAL, pct: Math.round(correct / TOTAL * 100),
    iq: Math.round(100 + 15 * z), pctl: Math.round(normalCdf(z) * 100),
    per, unanswered, elapsed, late, date: new Date().toISOString().slice(0, 10),
  };
  return {result, late, report: reportHtml(result, {name, email, phone}, "")};
}

Deno.serve(async (req) => {
  // No wildcard CORS. Only configured development origin may initiate submissions.
  const origin = req.headers.get("origin") ?? "";
  const allowed = Deno.env.get("OMSAZE_STAGING_ORIGIN") ?? "";
  const cors = origin && allowed && origin === allowed
    ? { "access-control-allow-origin": allowed,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type,authorization,apikey" } : {};
  if (req.method === "OPTIONS") return new Response(null, {
    status: origin === allowed && !!allowed ? 204 : 403, headers: cors,
  });
  if (req.method !== "POST") return json({error:"method not allowed"},405);
  if (origin && origin !== allowed) return json({error:"origin not allowed"},403);
  try {
    requireStaging();
    if (Deno.env.get("OMSAZE_PAYMENTS_MODE") !== "sandbox") {
      return json({error:"sandbox payments disabled"},503);
    }
    const raw = await req.text();
    if (raw.length > 20_000) return json({error:"request too large"},413);
    let body: Payload;
    try { body = JSON.parse(raw); } catch { return json({error:"invalid json"},400); }
    let parsed: ReturnType<typeof validateSubmission>;
    try { parsed = validateSubmission(body); }
    catch { return json({error:"invalid registration or answers"},400); }

    const sb = stagingDb();
    const {data: test,error: tErr} = await sb.from("test_sessions")
      .select("id,lang,seed,answer_key,started_at,submitted")
      .eq("id",parsed.testId).maybeSingle();
    if (tErr) throw tErr;
    if (!test) return json({error:"unknown test"},404);
    if (test.submitted) return json({error:"already submitted"},409);

    // Server computes score. Browser only supplies responses and registration.
    const scored = serverScore(test,parsed.answers,parsed.name,parsed.email,parsed.phone);
    // The current report generator displays a report verification code.
    // It is a session reference, NOT a cryptographically verifiable certificate.
    const report = reportHtml(scored.result,{
      name:parsed.name,email:parsed.email,phone:parsed.phone
    }, test.id);

    const amountCents = Number(Deno.env.get("PRICE_EGP_CENTS") ?? "5000");
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 1000000)
      throw new Error("invalid staging price");
    const {data: submissionId,error: saveErr} = await sb.rpc("staging_create_scored_submission",{
      p_test_id:test.id,p_name:parsed.name,p_email:parsed.email,p_phone:parsed.phone,
      p_gender:parsed.gender,p_birth_date:parsed.birth,
      p_lang:test.lang === "ar" ? "ar" : "en",
      p_result:scored.result,p_report_html:report,p_amount_cents:amountCents,
      p_late:scored.late,
    });
    if (saveErr) {
      // Concurrent submissions and data errors must not create another payment.
      console.error("staging submission claim failed",saveErr.message);
      return json({error:"submission could not be claimed; retry requires support"},409);
    }
    if (typeof submissionId !== "string") throw new Error("invalid submission receipt");
    if (scored.late) return json({error:"time limit exceeded; review required"},409);

    let orderId: number;
    let paymentUrl: string;
    try {
      const pay = await startPaymobSandbox({
        id:submissionId,amountCents,name:parsed.name,email:parsed.email,phone:parsed.phone,
      });
      orderId = pay.orderId; paymentUrl = pay.paymentUrl;
    } catch {
      await sb.from("submissions").update({status:"failed"})
        .eq("id",submissionId).eq("status","pending_payment");
      return json({error:"sandbox checkout could not be started; no payment was initiated"},502);
    }

    const {data:saved,error:orderErr} = await sb.from("submissions")
      .update({paymob_order_id:orderId})
      .eq("id",submissionId).eq("status","pending_payment")
      .select("id").maybeSingle();
    if (orderErr || !saved) {
      // A Paymob sandbox order may exist but isn't linked to a submission.
      // Do not return paymentUrl; do not create another order automatically.
      console.error("staging Paymob order could not be persisted", orderErr?.message ?? "row unavailable");
      return json({error:"sandbox payment setup incomplete; manual reconciliation required"},503);
    }
    return new Response(JSON.stringify({submissionId,paymentUrl}),{
      status:200,headers:{"content-type":"application/json","cache-control":"no-store",...cors}
    });
  } catch (err) {
    console.error("staging submit unavailable",err instanceof Error ? err.message : "unknown error");
    return json({error:"staging submission unavailable"},503);
  }
});

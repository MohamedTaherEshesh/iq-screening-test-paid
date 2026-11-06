import { json, preflight, db } from "../_shared/common.ts";
import { startPaymob } from "../_shared/paymob.ts";

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }

  const reg = body.reg ?? {};
  const name = String(reg.name ?? "").trim();
  const email = String(reg.email ?? "").trim();
  const phone = String(reg.phone ?? "").trim();
  if (name.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+?[0-9\s-]{7,20}$/.test(phone)) {
    return json({ error: "invalid registration" }, 400);
  }
  const reportHtml = String(body.reportHtml ?? "");
  if (!reportHtml || reportHtml.length > 400_000) return json({ error: "invalid report" }, 400);

  const amountCents = Number(Deno.env.get("PRICE_EGP_CENTS") ?? "5000"); // set to the EGP equivalent of 1 USD
  const sb = db();
  const { data: sub, error } = await sb.from("submissions").insert({
    name, email, phone,
    gender: String(reg.gender ?? ""),
    birth_date: reg.birth || null,
    lang: String(body.lang ?? "en"),
    result: body.result ?? {},
    report_html: reportHtml,
    status: "pending_payment",
    amount_cents: amountCents,
  }).select("id").single();
  if (error || !sub) return json({ error: "could not save" }, 500);

  try {
    const pay = await startPaymob({ id: sub.id, amountCents, name, email, phone });
    await sb.from("submissions").update({ paymob_order_id: pay.orderId }).eq("id", sub.id);
    return json({ submissionId: sub.id, paymentUrl: pay.paymentUrl });
  } catch (e) {
    console.error("payment start failed", e);
    await sb.from("submissions").update({ status: "failed" }).eq("id", sub.id);
    return json({ error: "payment could not be started" }, 502);
  }
});

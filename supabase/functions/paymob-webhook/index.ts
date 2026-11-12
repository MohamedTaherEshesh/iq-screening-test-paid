// DEVELOPMENT ONLY. Deploy to omsaze-staging ONLY after sandbox credentials + QA.
// This handler never calls Paymob or sends emails. It records verified callbacks
// through a transactional RPC that queues a separate email-delivery job.
import { stagingDb, requireStaging, timingSafeEqual } from "../_shared/staging-db.ts";

const SIGNED_FIELDS = [
  "amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction",
  "id", "integration_id", "is_3d_secure", "is_auth", "is_capture", "is_refunded",
  "is_standalone_payment", "is_voided", "order.id", "owner", "pending",
  "source_data.pan", "source_data.sub_type", "source_data.type", "success",
] as const;

function nested(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((v, key) =>
    v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined, obj);
}

async function verifyHmac(obj: Record<string, unknown>, signature: string): Promise<boolean> {
  const hex = signature.toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(hex)) return false;
  const secret = Deno.env.get("PAYMOB_SANDBOX_HMAC_SECRET");
  if (!secret) throw new Error("sandbox HMAC secret is not configured");
  const message = SIGNED_FIELDS.map(k => {
    const v = nested(obj, k);
    if (v == null) return "";
    if (typeof v === "boolean") return v ? "true" : "false";
    return String(v);
  }).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const expected = Array.from(new Uint8Array(sig), x => x.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected, hex);
}

const response = (data: unknown, code = 200): Response =>
  new Response(JSON.stringify(data), { status: code, headers: { "content-type": "application/json" } });

Deno.serve(async req => {
  if (req.method !== "POST") return response({ error: "method not allowed" }, 405);
  try {
    requireStaging();
    if (Deno.env.get("OMSAZE_PAYMENTS_MODE") !== "sandbox") {
      return response({ error: "sandbox payments disabled" }, 503);
    }
    const raw = await req.text();
    if (raw.length > 80_000) return response({ error: "payload too large" }, 413);
    const payload = JSON.parse(raw);
    const obj = payload?.obj;
    if (!obj || typeof obj !== "object" || Array.isArray(obj) ||
        !await verifyHmac(obj, new URL(req.url).searchParams.get("hmac") ?? "")) {
      return response({ error: "unauthorized" }, 401);
    }

    const expectedIntegration = Number(Deno.env.get("PAYMOB_SANDBOX_INTEGRATION_ID"));
    if (!Number.isSafeInteger(expectedIntegration) || expectedIntegration <= 0 ||
        Number(obj.integration_id) !== expectedIntegration || obj.currency !== "EGP") {
      return response({ error: "wrong sandbox integration or currency" }, 422);
    }

    const orderId = Number(nested(obj, "order.id"));
    const txnId = Number(obj.id);
    const amount = Number(obj.amount_cents);
    if (![orderId, txnId, amount].every(v => Number.isSafeInteger(v) && v > 0)) {
      return response({ error: "invalid callback amounts or ids" }, 422);
    }
    const sb = stagingDb();
    const { data: sub, error: lookupErr } = await sb.from("submissions")
      .select("id,status").eq("paymob_order_id", orderId).maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!sub) {
      // An out-of-order webhook may arrive before submit saves the order ID.
      // Do NOT create a paid submission or acknowledge as delivered.
      return response({ error: "unmatched verified sandbox order; reconcile first" }, 503);
    }

    if (obj.is_live !== false || obj.pending !== false || obj.error_occured !== false ||
        obj.success !== true || obj.is_refunded === true || obj.is_voided === true) {
      // No paid transition. Failure/refund handling needs dedicated reviewed state machine.
      return response({ ok: true, ignored: "not a confirmed successful payment" });
    }
    const { data, error } = await sb.rpc("staging_record_verified_payment", {
      p_submission_id: sub.id,
      p_order_id: orderId,
      p_transaction_id: txnId,
      p_amount_cents: amount,
    });
    if (error) throw error;
    if (data === "paid_and_queued" || data === "already_paid") return response({ ok: true, state: data });
    // Never silently accept mismatched orders, amounts, or unresolved states.
    return response({ ok: false, state: data }, 409);
  } catch (err) {
    console.error("staging callback failure", err instanceof Error ? err.message : "unknown error");
    return response({ error: "staging callback unavailable" }, 503);
  }
});

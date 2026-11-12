// Staging-only Paymob Unified Checkout. Do not import production paymob.ts.
// Paymob test/live share the same API endpoint: the KEY/INTEGRATION controls mode.
// Test mode is enforced here and validated against returned payment_methods.live.
import { requireStaging } from "./staging-db.ts";

const INTENTION_URL = "https://accept.paymob.com/v1/intention/";
const CHECKOUT_URL = "https://accept.paymob.com/unifiedcheckout/";
const CALLBACK_URL = "https://cbklbucvidcutshhmwjy.supabase.co/functions/v1/paymob-webhook";

export function sandboxConfig() {
  requireStaging();
  if (Deno.env.get("OMSAZE_PAYMENTS_MODE") !== "sandbox") {
    throw new Error("Sandbox checkout is disabled");
  }
  const secretKey = Deno.env.get("PAYMOB_SANDBOX_SECRET_KEY") ?? "";
  const publicKey = Deno.env.get("PAYMOB_SANDBOX_PUBLIC_KEY") ?? "";
  const integrationId = Number(Deno.env.get("PAYMOB_SANDBOX_INTEGRATION_ID"));
  if (!secretKey.startsWith("sk_test_") || !publicKey.startsWith("pk_test_") ||
      !Number.isSafeInteger(integrationId) || integrationId < 1) {
    throw new Error("Only valid-looking Paymob TEST credentials are permitted");
  }
  return { secretKey, publicKey, integrationId };
}

export async function startPaymobSandbox(
  opts: { id: string; amountCents: number; name: string; email: string; phone: string },
): Promise<{ orderId: number; paymentUrl: string }> {
  const { secretKey, publicKey, integrationId } = sandboxConfig();
  if (!/^[0-9a-f-]{36}$/i.test(opts.id) ||
      !Number.isSafeInteger(opts.amountCents) || opts.amountCents < 1 ||
      opts.amountCents > 1000000) throw new Error("Invalid sandbox checkout request");
  const parts = opts.name.trim().split(/\s+/);
  const NA = "NA";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let reply: Response;
  try {
    reply = await fetch(INTENTION_URL, {
      method: "POST",
      headers: { Authorization: `Token ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: opts.amountCents, currency: "EGP", payment_methods: [integrationId],
        items: [{ name: "OMSAZE sandbox cognitive screening", amount: opts.amountCents,
          description: "Synthetic staging report", quantity: 1 }],
        billing_data: {
          apartment: NA, floor: NA, street: NA, building: NA,
          shipping_method: NA, postal_code: NA, city: "Cairo", country: "EG", state: NA,
          first_name: parts[0], last_name: parts.slice(1).join(" ") || NA,
          email: opts.email, phone_number: opts.phone,
        },
        special_reference: opts.id, extras: { submission_id: opts.id },
        notification_url: CALLBACK_URL,
      }),
      signal: controller.signal,
    });
  } finally { clearTimeout(timeout); }

  if (!reply.ok) {
    // Never log the full Paymob body: it may contain payment details or tokens.
    throw new Error(`Paymob sandbox intention failed (HTTP ${reply.status})`);
  }
  const intention: unknown = await reply.json();
  if (!intention || typeof intention !== "object") throw new Error("Invalid sandbox intention response");
  const obj = intention as Record<string, unknown>;
  const orderId = Number(obj.intention_order_id);
  const clientSecret = obj.client_secret;
  const methods = obj.payment_methods;
  if (!Number.isSafeInteger(orderId) || orderId < 1 ||
      typeof clientSecret !== "string" || !clientSecret.includes("_test_") ||
      !Array.isArray(methods) ||
      !methods.some(m => m && typeof m === "object" &&
        Number((m as Record<string, unknown>).integration_id) === integrationId &&
        (m as Record<string, unknown>).live === false)) {
    throw new Error("Paymob did not return a confirmed TEST integration and client secret");
  }
  return {
    orderId,
    paymentUrl: `${CHECKOUT_URL}?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(clientSecret)}`,
  };
}

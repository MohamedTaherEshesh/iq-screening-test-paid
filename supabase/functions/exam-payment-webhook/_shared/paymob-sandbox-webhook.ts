export const PAYMOB_SIGNED_FIELDS = [
  "amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction",
  "id", "integration_id", "is_3d_secure", "is_auth", "is_capture", "is_refunded",
  "is_standalone_payment", "is_voided", "order.id", "owner", "pending",
  "source_data.pan", "source_data.sub_type", "source_data.type", "success",
] as const;
function nestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, name) => value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[name] : undefined, obj);
}
function signedText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Invalid sandbox HMAC field");
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid sandbox HMAC number");
  return String(value);
}
export function paymobSignedMessage(body: Record<string, unknown>): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid Paymob signed object");
  return PAYMOB_SIGNED_FIELDS.map(key => signedText(nestedValue(body, key))).join("");
}
function fixedTimeHexMatch(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i=0; i<actual.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
export async function verifyPaymobSandboxHmac(body: Record<string, unknown>, hmacHex: unknown, secret: unknown): Promise<boolean> {
  if (typeof hmacHex !== "string" || !/^[0-9a-fA-F]{128}$/.test(hmacHex) || typeof secret !== "string" || secret.length < 16) return false;
  const message = paymobSignedMessage(body);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-512"}, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message)));
  const expected = Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
  return fixedTimeHexMatch(hmacHex.toLowerCase(),expected);
}

// Staging-only database connection. Never import from production functions.
import { createClient } from "npm:@supabase/supabase-js@2";

const STAGING_URL = "https://cbklbucvidcutshhmwjy.supabase.co";

export function requireStaging(): void {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  if (url !== STAGING_URL || Deno.env.get("OMSAZE_ENVIRONMENT") !== "staging") {
    throw new Error("OMSAZE staging guard: refusing operation outside isolated staging project");
  }
}

export function stagingDb() {
  requireStaging();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) throw new Error("Missing staging service-role secret");
  return createClient(STAGING_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// OMS-MND-261126-04: verification details printed on the certificate (code + QR link to the public verify page).
// The code comes from public.exam_results (made by the database when the exam is submitted).
// The certificate date is the exam date (submit time), so every copy of a certificate shows the same date.
const DEFAULT_VERIFY_URL = 'https://staging.omsaze.com/verify.html';

export async function certificateVerification(db: any, testId: string, session: Record<string, unknown> | null) {
  const at = String(session?.submitted_at || session?.started_at || new Date().toISOString());
  const date = /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : new Date().toISOString().slice(0, 10);
  let code: string | undefined;
  try {
    const { data } = await db.from('exam_results').select('verification_code').eq('session_id', testId).maybeSingle();
    if (typeof data?.verification_code === 'string' && /^MP-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(data.verification_code)) code = data.verification_code;
  } catch { /* certificate still works without the QR */ }
  const base = (Deno.env.get('OMSAZE_CERT_VERIFY_URL') || DEFAULT_VERIFY_URL).trim();
  const url = code && /^https:\/\/[a-z0-9.-]+\/[\w./-]*$/i.test(base) ? `${base}?c=${code}` : undefined;
  return { date, code: url ? code : undefined, url };
}

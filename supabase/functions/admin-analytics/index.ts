// OMS-MND-261125-06: owner-only analytics for the OMSAZE admin page (dev/preview/omsaze.com /admin.html).
//
// Security model
// - Only the owner email can sign in. Sign-in = one-time code emailed by this function (possession)
//   plus, when the ADMIN_DASHBOARD_PASSCODE secret is set, a passcode (knowledge). Both checked here, server side.
//   The code is bound to a signed 10-minute challenge, so no database table is needed.
// - A successful sign-in returns a signed token valid for 30 minutes (HMAC, server secret). Every data call checks it.
// - Only the OMSAZE site origins may call this from a browser. Responses are never cached.
// - Answer keys and payment-card data are never returned. Scores are returned from exam_results (OMS-MND-261126-05).
// - setPrice (OMS-MND-261126-06) changes a Price_<ExamName> variable; it needs a valid admin token.
// - setCorporateStatus / setCorporatePrice / grantSeats (OMS-MND-261126-12/-13) manage corporate accounts; admin token required.
// - Self-contained: everything it imports is in ./_shared.
//
// Deploy (owner, from C:\Users\DELL\iq-screening-test-paid after `git pull`):
//   npx supabase functions deploy admin-analytics --project-ref cbklbucvidcutshhmwjy --no-verify-jwt
import { stagingDb, requireStaging, timingSafeEqual } from './_shared/staging-db.ts';
import { resolveVerificationSecret, verificationHash } from './_shared/email-verification.ts';
import { sendAdminCode } from './_shared/admin-mail.ts';

const ADMIN_EMAIL = 'mohamedtahereshesh@gmail.com';
const TOKEN_SCOPE = 'omsaze-admin-analytics';
const TOKEN_TTL_SECONDS = 30 * 60;
const CODE_TTL_SECONDS = 10 * 60;
const MAX_ROWS = 5000;
const ALLOWED_ORIGINS = new Set([
  'https://dev.omsaze.com',
  'https://preview.omsaze.com',
  'https://omsaze.com',
  'https://www.omsaze.com',
]);

const b64 = (s: string) => btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const unb64 = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signToken(secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const encoded = b64(JSON.stringify({ v: 1, scope: TOKEN_SCOPE, email: ADMIN_EMAIL, exp }));
  return encoded + '.' + await verificationHash(secret, TOKEN_SCOPE, encoded);
}
async function tokenOk(raw: string | null, secret: string): Promise<boolean> {
  if (!raw || raw.length > 600) return false;
  const [encoded, sig, ...extra] = raw.split('.');
  if (extra.length || !encoded || !sig) return false;
  if (!timingSafeEqual(sig, await verificationHash(secret, TOKEN_SCOPE, encoded))) return false;
  try {
    const p = JSON.parse(unb64(encoded));
    return p?.v === 1 && p.scope === TOKEN_SCOPE && p.email === ADMIN_EMAIL && Number.isSafeInteger(p.exp) && p.exp * 1000 > Date.now();
  } catch { return false; }
}

async function newChallenge(secret: string): Promise<{ challenge: string; code: string }> {
  const encoded = b64(JSON.stringify({ v: 1, scope: 'admin-otp', n: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS }));
  const challenge = encoded + '.' + await verificationHash(secret, 'admin-otp-challenge', encoded);
  return { challenge, code: await codeFor(secret, challenge) };
}
async function codeFor(secret: string, challenge: string): Promise<string> {
  const h = await verificationHash(secret, 'admin-otp-code', challenge);
  return String(parseInt(h.slice(0, 12), 16) % 1000000).padStart(6, '0');
}
async function challengeOk(raw: string, secret: string): Promise<boolean> {
  if (!raw || raw.length > 400) return false;
  const [encoded, sig, ...extra] = raw.split('.');
  if (extra.length || !encoded || !sig) return false;
  if (!timingSafeEqual(sig, await verificationHash(secret, 'admin-otp-challenge', encoded))) return false;
  try { const p = JSON.parse(unb64(encoded)); return p?.v === 1 && p.scope === 'admin-otp' && Number.isSafeInteger(p.exp) && p.exp * 1000 > Date.now(); } catch { return false; }
}

function ageAt(birth: string | null, at: string): number | null {
  if (!birth) return null;
  const b = new Date(birth + 'T00:00:00Z'), d = new Date(at);
  if (isNaN(b.getTime()) || isNaN(d.getTime())) return null;
  let a = d.getUTCFullYear() - b.getUTCFullYear();
  const m = d.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && d.getUTCDate() < b.getUTCDate())) a--;
  return a >= 0 && a < 120 ? a : null;
}

async function emailsById(sb: ReturnType<typeof stagingDb>, ids: Set<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.size) return out;
  for (let page = 1; page <= 20 && out.size < ids.size; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) if (ids.has(u.id) && u.email) out.set(u.id, u.email);
    if (data.users.length < 1000) break;
  }
  return out;
}

async function loadData(sb: ReturnType<typeof stagingDb>) {
  const [pay, sessions, visits, results, prices, genders, corp, corpReq, corpPrices, corpBal, corpLedger] = await Promise.all([
    sb.from('exam_payments')
      .select('id,candidate_id,test_id,state,paymob_order_id,transaction_id,amount_cents,usd_cents,fx_rate,created_at,updated_at,report_emailed_at')
      .order('created_at', { ascending: false }).limit(MAX_ROWS),
    sb.from('university_challenge_sessions')
      .select('id,exam_tag,language,candidate_name,candidate_birthdate,candidate_country,candidate_city,submitted,started_at,submitted_at')
      .order('started_at', { ascending: false }).limit(MAX_ROWS),
    sb.from('site_visits').select('created_at,path,country').order('created_at', { ascending: false }).limit(MAX_ROWS * 4),
    // OMS-MND-261126-05/-07/-04: permanent result records (score, domains, duration, certificate status).
    sb.from('exam_results')
      .select('session_id,candidate_id,exam_tag,language,candidate_name,candidate_country,candidate_city,candidate_age,started_at,submitted_at,total_items,answered,correct,percent_correct,per_domain,timed_out,duration_seconds,time_limit_seconds,verification_code,certificate_status,certificate_issued_at,certificate_valid_until')
      .order('submitted_at', { ascending: false }).limit(MAX_ROWS),
    // OMS-MND-261126-06: Price_<ExamName> variables with full history.
    sb.from('exam_price_history').select('id,variable_name,exam_tag,currency,amount_cents,valid_from,valid_to,changed_by,note')
      .order('valid_from', { ascending: false }).limit(1000),
    // OMS-MND-261126-16: gender per result (separate query so the page still loads before the DB change).
    sb.from('exam_results').select('session_id,candidate_gender').limit(MAX_ROWS),
    // OMS-MND-261126-12/-13: corporate accounts, requested exams, company prices, seat balances and ledger.
    sb.from('corporate_accounts').select('*') /* '*' so it works before and after OMS-MND-261126-14 adds columns */
      .order('created_at', { ascending: false }).limit(MAX_ROWS),
    sb.from('corporate_exam_requests').select('company_id,exam_tag,seats_requested').limit(MAX_ROWS * 4),
    sb.from('corporate_price_history').select('id,company_id,exam_tag,amount_cents,valid_from,valid_to,changed_by,note').order('valid_from', { ascending: false }).limit(2000),
    sb.rpc('corporate_balances'),
    sb.from('corporate_seat_ledger').select('id,company_id,exam_tag,seats,kind,unit_usd_cents,price_source,note,created_by,created_at').order('created_at', { ascending: false }).limit(2000),
  ]);
  if (pay.error || sessions.error) throw new Error('data unavailable');

  const byTest = new Map<string, any>();
  for (const s of sessions.data ?? []) byTest.set(s.id, s);
  const emails = await emailsById(sb, new Set([...(pay.data ?? []), ...(results.data ?? [])].map((p: any) => p.candidate_id)));
  const genderBy = new Map<string, string>();
  if (!genders.error) for (const g of genders.data ?? []) if (g.candidate_gender) genderBy.set(g.session_id, g.candidate_gender);
  const payByTest = new Map<string, any>();
  for (const p of pay.data ?? []) payByTest.set(p.test_id, p);

  const payments = (pay.data ?? []).map((p: any) => {
    const s = byTest.get(p.test_id) ?? {};
    const at = p.state === 'paid' || p.state === 'refunded' ? p.updated_at : p.created_at;
    return {
      id: p.id, source: 'MindProof', state: p.state,
      egp: (p.amount_cents ?? 0) / 100, usd: p.usd_cents == null ? null : p.usd_cents / 100, fx: p.fx_rate,
      created_at: p.created_at, at, order_id: p.paymob_order_id, txn_id: p.transaction_id,
      exam: s.exam_tag ?? null, lang: s.language ?? null,
      name: s.candidate_name ?? null, email: emails.get(p.candidate_id) ?? null,
      country: s.candidate_country ?? null, city: s.candidate_city ?? null,
      age: ageAt(s.candidate_birthdate ?? null, p.created_at),
      exam_submitted: s.submitted ?? null, report_emailed_at: p.report_emailed_at,
    };
  });

  const exams = (sessions.data ?? []).map((s: any) => ({
    at: s.started_at, exam: s.exam_tag, submitted: !!s.submitted, country: s.candidate_country ?? null,
  }));

  const resultRows = (results.data ?? []).map((r: any) => ({
    id: r.session_id, gender: genderBy.get(r.session_id) ?? null, at: r.submitted_at ?? r.started_at, started_at: r.started_at, exam: r.exam_tag, lang: r.language,
    name: r.candidate_name, email: emails.get(r.candidate_id) ?? null, country: r.candidate_country, city: r.candidate_city, age: r.candidate_age,
    total: r.total_items, answered: r.answered, correct: r.correct, percent: r.percent_correct == null ? null : Number(r.percent_correct),
    domains: r.per_domain ?? {}, timed_out: !!r.timed_out, duration_s: r.duration_seconds, limit_s: r.time_limit_seconds,
    cert_code: r.verification_code, cert_status: r.certificate_status, cert_issued: r.certificate_issued_at, cert_valid_until: r.certificate_valid_until,
    payment: payByTest.get(r.session_id)?.state ?? null,
  }));

  return {
    payments, exams, results: resultRows, resultsAvailable: !results.error,
    prices: (prices.data ?? []).map((p: any) => ({ id: p.id, variable: p.variable_name, exam: p.exam_tag, currency: p.currency, usd: p.amount_cents / 100, from: p.valid_from, to: p.valid_to, by: p.changed_by, note: p.note })),
    pricesAvailable: !prices.error,
    corporateAvailable: !corp.error && !corpReq.error && !corpPrices.error && !corpBal.error && !corpLedger.error,
    corporate: corp.error ? [] : (corp.data ?? []).map((c: any) => ({
      id: c.id, ref: c.reference, org_type: c.org_type ?? null, company: c.company_name, reg_no: c.registration_no, tax_no: c.tax_no ?? null, address: c.address ?? null, website: c.website ?? null, billing_email: c.billing_email ?? null, country: c.country, city: c.city, sector: c.sector,
      employees: c.employees, male_count: c.male_count ?? null, female_count: c.female_count ?? null, contact: c.contact_name, title: c.contact_title, email: c.email, phone: c.phone, notes: c.notes, lang: c.language,
      status: c.status, status_at: c.status_changed_at, status_note: c.status_note, at: c.created_at,
      requests: (corpReq.data ?? []).filter((r: any) => r.company_id === c.id).map((r: any) => ({ exam: r.exam_tag, seats: r.seats_requested })),
      balances: ((corpBal.data ?? []) as any[]).filter((b) => b.company_id === c.id).map((b) => ({ exam: b.exam_tag, granted: b.granted, used: b.used, balance: b.balance })),
      prices: (corpPrices.data ?? []).filter((p: any) => p.company_id === c.id).map((p: any) => ({ id: p.id, exam: p.exam_tag, usd: p.amount_cents / 100, from: p.valid_from, to: p.valid_to, by: p.changed_by, note: p.note })),
      ledger: (corpLedger.data ?? []).filter((l: any) => l.company_id === c.id).map((l: any) => ({ exam: l.exam_tag, seats: l.seats, kind: l.kind, unit_usd: l.unit_usd_cents == null ? null : l.unit_usd_cents / 100, source: l.price_source, note: l.note, by: l.created_by, at: l.created_at })),
    })),
    visits: (visits.data ?? []).map((v: any) => ({ at: v.created_at, path: v.path, country: v.country })),
    notes: {
      environment: 'MindProof staging (Paymob sandbox). There is no separate production database yet.',
      paid_time: 'Paid and refunded payments are dated by their last status change (updated_at); others by creation time.',
      country_age: 'Country and age are self-reported by the candidate at registration (age from birth date at payment time).',
    },
    serverNow: new Date().toISOString(),
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.has(origin);
  const cors: Record<string, string> = allowed ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type,x-omsaze-admin-token',
    'access-control-max-age': '600',
  } : {};
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'origin', ...cors },
  });
  if (req.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!allowed) return reply({ error: 'Origin not permitted' }, 403);

  try {
    requireStaging();
    const secret = await resolveVerificationSecret();
    const raw = await req.text();
    if (raw.length > 1024) return reply({ error: 'Request too large' }, 413);
    let body: Record<string, unknown>;
    try { body = raw ? JSON.parse(raw) : {}; } catch { return reply({ error: 'Invalid request' }, 400); }
    const sb = stagingDb();
    const passcode = Deno.env.get('ADMIN_DASHBOARD_PASSCODE') ?? '';

    if (body.action === 'config') return reply({ passcodeRequired: passcode.length >= 8 });

    if (body.action === 'requestAccess') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const { challenge, code } = await newChallenge(secret);
      if (email !== ADMIN_EMAIL) { await sleep(600); return reply({ requested: true, challenge }); } // same shape: never confirms the owner address
      let sent = false;
      try { sent = await sendAdminCode(ADMIN_EMAIL, code); } catch (e) { console.error('admin-analytics send code failed:', e instanceof Error ? e.message : 'unknown'); }
      if (!sent) return reply({ error: 'The code email could not be sent. Please try again in a minute.' }, 502);
      return reply({ requested: true, challenge });
    }

    if (body.action === 'verifyAccess') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const code = String(body.code ?? '').trim();
      const challenge = String(body.challenge ?? '');
      const given = String(body.passcode ?? '');
      const passOk = passcode.length < 8 || timingSafeEqual(given, passcode);
      const ok = email === ADMIN_EMAIL && /^\d{6}$/.test(code) && await challengeOk(challenge, secret) && timingSafeEqual(code, await codeFor(secret, challenge)) && passOk;
      if (!ok) { await sleep(900); return reply({ error: 'Incorrect code or passcode.' }, 401); }
      return reply({ adminToken: await signToken(secret), expiresInSeconds: TOKEN_TTL_SECONDS });
    }

    if (body.action === 'data') {
      if (!await tokenOk(req.headers.get('x-omsaze-admin-token'), secret)) return reply({ error: 'Sign-in required or expired.' }, 401);
      return reply(await loadData(sb));
    }

    // OMS-MND-261126-06: change an exam price. Old row closes at the change time, new row opens at the same time.
    if (body.action === 'setPrice') {
      if (!await tokenOk(req.headers.get('x-omsaze-admin-token'), secret)) return reply({ error: 'Sign-in required or expired.' }, 401);
      const exam = String(body.exam ?? '');
      const usd = Number(body.usd);
      const cents = Math.round(usd * 100);
      if (!/^[a-z0-9-]{3,80}$/.test(exam)) return reply({ error: 'Unknown exam.' }, 400);
      if (!Number.isFinite(usd) || Math.abs(usd * 100 - cents) > 1e-6 || cents < 100 || cents > 100000) return reply({ error: 'Enter a price between 1 and 1000 USD, with at most 2 decimals.' }, 400);
      const note = String(body.note ?? '').slice(0, 300);
      const { data, error } = await sb.rpc('set_exam_price', { p_exam_tag: exam, p_amount_cents: cents, p_changed_by: ADMIN_EMAIL, p_note: note || null });
      if (error) return reply({ error: /Unknown exam/.test(error.message) ? 'Unknown exam.' : 'The price could not be saved.' }, 400);
      return reply({ ok: true, result: data });
    }

    // OMS-MND-261126-12/-13: corporate accounts (status, company price, seats). Admin token required.
    if (body.action === 'setCorporateStatus' || body.action === 'setCorporatePrice' || body.action === 'grantSeats') {
      if (!await tokenOk(req.headers.get('x-omsaze-admin-token'), secret)) return reply({ error: 'Sign-in required or expired.' }, 401);
      const company = String(body.company ?? '');
      if (!/^[0-9a-f-]{36}$/.test(company)) return reply({ error: 'Unknown company.' }, 400);
      const note = String(body.note ?? '').slice(0, 300) || null;
      if (body.action === 'setCorporateStatus') {
        const status = String(body.status ?? '');
        if (!['pending', 'active', 'suspended', 'rejected'].includes(status)) return reply({ error: 'Unknown status.' }, 400);
        const { data, error } = await sb.rpc('set_corporate_status', { p_company: company, p_status: status, p_changed_by: ADMIN_EMAIL, p_note: note });
        if (error) return reply({ error: 'The status could not be saved.' }, 400);
        return reply({ ok: true, result: data });
      }
      const exam = String(body.exam ?? '');
      if (!/^[a-z0-9-]{3,80}$/.test(exam)) return reply({ error: 'Unknown exam.' }, 400);
      if (body.action === 'setCorporatePrice') {
        let cents: number | null = null;
        if (body.usd !== null) {
          const usd = Number(body.usd);
          cents = Math.round(usd * 100);
          if (!Number.isFinite(usd) || Math.abs(usd * 100 - cents) > 1e-6 || cents < 100 || cents > 100000) return reply({ error: 'Enter a price between 1 and 1000 USD, with at most 2 decimals.' }, 400);
        }
        const { data, error } = await sb.rpc('set_corporate_price', { p_company: company, p_exam_tag: exam, p_amount_cents: cents, p_changed_by: ADMIN_EMAIL, p_note: note });
        if (error) return reply({ error: /Unknown/.test(error.message) ? 'Unknown company or exam.' : 'The price could not be saved.' }, 400);
        return reply({ ok: true, result: data });
      }
      const seats = Number(body.seats);
      if (!Number.isInteger(seats) || seats === 0 || Math.abs(seats) > 10000) return reply({ error: 'Seats must be a whole number between -10000 and 10000, not 0.' }, 400);
      const { data, error } = await sb.rpc('grant_corporate_seats', { p_company: company, p_exam_tag: exam, p_seats: seats, p_changed_by: ADMIN_EMAIL, p_note: note });
      if (error) {
        const m = error.message ?? '';
        return reply({ error: /not active/.test(m) ? 'Activate the company first.' : /below zero/.test(m) ? 'The balance cannot go below zero.' : 'The seats could not be saved.' }, 400);
      }
      return reply({ ok: true, result: data });
    }

    return reply({ error: 'Unknown action' }, 400);
  } catch {
    return reply({ error: 'Admin analytics unavailable right now.' }, 503);
  }
});

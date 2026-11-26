// OMS-MND-261125-06: sends the admin sign-in code straight to the owner.
// Same providers and secrets as the MindProof report mail (OMSAZE_VERIFICATION_PROVIDER = gmail | resend).
// The Supabase Auth email hook is NOT used: it only serves the candidate verification flow and rejects other emails.
import { requireStaging } from './staging-db.ts';

export async function sendAdminCode(to: string, code: string): Promise<boolean> {
  requireStaging();
  const subject = 'OMSAZE admin sign-in code: ' + code;
  const text = `Your OMSAZE admin sign-in code is ${code}.\nIt expires in 10 minutes. Enter it with your passcode on the admin page.\nIf you did not ask for this code, ignore this email and consider changing your admin passcode.`;
  const html = `<div style="font-family:Arial,sans-serif;color:#102D46"><p style="font-size:13px;letter-spacing:2px;color:#9a7a35;margin:0">OMSAZE ADMIN</p><h2 style="margin:6px 0 14px">Your sign-in code</h2><p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:0 0 14px">${code}</p><p>It expires in 10 minutes. Enter it with your passcode on the admin page.</p><p style="color:#667085;font-size:13px">If you did not ask for this code, ignore this email and consider changing your admin passcode.</p></div>`;
  const provider = Deno.env.get('OMSAZE_VERIFICATION_PROVIDER');
  if (provider === 'gmail') {
    const user = (Deno.env.get('OMSAZE_GMAIL_SENDER') ?? '').trim().toLowerCase();
    if (user !== 'mohamedtahereshesh@gmail.com') throw new Error('Gmail sender mismatch');
    const pass = (Deno.env.get('OMSAZE_GMAIL_APP_PASSWORD') ?? '').replace(/\s/g, '');
    if (!/^[a-zA-Z0-9]{16}$/.test(pass)) throw new Error('Gmail app password is not configured');
    const nodemailer = (await import('npm:nodemailer@10.5.0')).default;
    const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true } });
    try {
      const r = await transport.sendMail({ from: { name: 'OMSAZE Admin', address: user }, to, subject, text, html });
      return Array.isArray(r.accepted) && r.accepted.some((v: unknown) => typeof v === 'string' && v.toLowerCase() === to);
    } finally { transport.close(); }
  }
  if (provider === 'resend') {
    const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('OMSAZE_VERIFICATION_FROM');
    if (!key || !from) throw new Error('Resend sender is not configured');
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html }), signal: AbortSignal.timeout(12000),
    });
    return r.ok;
  }
  throw new Error('Mail provider is not configured');
}

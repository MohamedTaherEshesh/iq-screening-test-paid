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

// OMS-MND-261127-04: emails to a company admin (registration received, approved, sign-in code, admin email changed).
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export type CompanyMailKind = 'received' | 'approved' | 'code' | 'admin_changed';
export async function sendCompanyMail(to: string, kind: CompanyMailKind, o: { company: string; contact: string; reference: string; lang: string; link: string; code?: string }): Promise<boolean> {
  requireStaging();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || to.length > 200) return false;
  const ar = o.lang === 'ar';
  const T: Record<CompanyMailKind, [string, string, string, string]> = {
    received: ['OMSAZE: we received your company registration', 'OMSAZE: استلمنا تسجيل شركتكم',
      `We received the registration of ${o.company}. Your company code is ${o.reference}: keep it, you need it to sign in. This email (${to}) is the company admin. We will review the registration and email you within 2 working days.`,
      `استلمنا تسجيل ${o.company}. كود الشركة هو ${o.reference}: احتفظ به، ستحتاجه للدخول. هذا البريد (${to}) هو مسؤول الشركة. سنراجع التسجيل ونراسلكم خلال يومي عمل.`],
    approved: ['Your OMSAZE registration is approved: select the service you are looking for', 'تم قبول تسجيل شركتكم لدى OMSAZE: اختر الخدمة التي تحتاجها',
      `The registration of ${o.company} is approved. Open the service request page, enter your company code ${o.reference}, then this email, and the verification code we send you. Then select the service you are looking for. You can come back and send a new request any time.`,
      `تم قبول تسجيل ${o.company}. افتح صفحة طلب الخدمات، واكتب كود الشركة ${o.reference} ثم هذا البريد ثم رمز التحقق الذي نرسله لك، واختر الخدمة التي تحتاجها. يمكنك العودة وإرسال طلب جديد في أي وقت.`],
    code: [`OMSAZE company sign-in code: ${o.code}`, `رمز دخول الشركة من OMSAZE: ${o.code}`,
      `Your sign-in code for ${o.company} is ${o.code}. It expires in 10 minutes. If you did not ask for it, ignore this email.`,
      `رمز الدخول الخاص بـ ${o.company} هو ${o.code}. ينتهي خلال 10 دقائق. إذا لم تطلبه تجاهل هذه الرسالة.`],
    admin_changed: ['OMSAZE: you are now a company admin', 'OMSAZE: أصبحت مسؤولًا عن الشركة',
      `At your company's request, this email is now an admin of ${o.company} on OMSAZE. Sign in on the service request page with company code ${o.reference} and this email.`,
      `بناءً على طلب شركتكم، أصبح هذا البريد مسؤولًا عن ${o.company} لدى OMSAZE. ادخل على صفحة طلب الخدمات بكود الشركة ${o.reference} وهذا البريد.`],
  };
  const [sEn, sAr, bEn, bAr] = T[kind];
  const subject = ar ? sAr : sEn, intro = ar ? bAr : bEn;
  const hi = ar ? `مرحبًا ${o.contact}،` : `Dear ${o.contact},`;
  const btn = ar ? 'صفحة طلب الخدمات' : 'Service request page';
  const sign = ar ? 'فريق خدمة عملاء OMSAZE' : 'OMSAZE Customer Service Team';
  const big = kind === 'code' ? `<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:0 0 14px">${esc(o.code ?? '')}</p>` : '';
  const button = kind === 'code' ? '' : `<p style="margin:22px 0"><a href="${esc(o.link)}" style="background:#102D46;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:700">${esc(btn)}</a></p>`;
  const text = `${hi}\n\n${intro}\n\n${kind === 'code' ? '' : o.link + '\n\n'}${sign}`;
  const html = `<div dir="${ar ? 'rtl' : 'ltr'}" style="font-family:Arial,sans-serif;color:#102D46;max-width:560px"><p style="font-size:13px;letter-spacing:2px;color:#9a7a35;margin:0">OMSAZE</p><p>${esc(hi)}</p><p>${esc(intro)}</p>${big}${button}<p>${esc(sign)}</p></div>`;
  const provider = Deno.env.get('OMSAZE_VERIFICATION_PROVIDER');
  if (provider === 'gmail') {
    const user = (Deno.env.get('OMSAZE_GMAIL_SENDER') ?? '').trim().toLowerCase();
    const pass = (Deno.env.get('OMSAZE_GMAIL_APP_PASSWORD') ?? '').replace(/\s/g, '');
    if (!user || !/^[a-zA-Z0-9]{16}$/.test(pass)) throw new Error('Gmail sender is not configured');
    const nodemailer = (await import('npm:nodemailer@10.5.0')).default;
    const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true } });
    try {
      const r = await transport.sendMail({ from: { name: 'OMSAZE', address: user }, to, subject, text, html });
      return Array.isArray(r.accepted) && r.accepted.length > 0;
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

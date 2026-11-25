import {normalizeEmail} from './email-verification.ts';

export async function notifyOwner(subject: string, html: string): Promise<void> {
  const user = normalizeEmail(Deno.env.get('OMSAZE_GMAIL_SENDER'));
  if (user !== 'mohamedtahereshesh@gmail.com') throw new Error('Staging Gmail sender mismatch');
  const pass = (Deno.env.get('OMSAZE_GMAIL_APP_PASSWORD') ?? '').replace(/\s/g, '');
  if (!/^[a-zA-Z0-9]{16}$/.test(pass)) throw new Error('Gmail app password is not configured');
  const nodemailer = (await import('npm:nodemailer@10.5.0')).default;
  const transport = nodemailer.createTransport({host:'smtp.gmail.com', port:465, secure:true, auth:{user, pass}, connectionTimeout:8000, greetingTimeout:8000, socketTimeout:15000, tls:{minVersion:'TLSv1.2', rejectUnauthorized:true}});
  try {
    const result = await transport.sendMail({ from: {name:'OMSAZE Alerts', address:user}, to: user, subject, html });
    if (!(Array.isArray(result.accepted) && result.accepted.some((v: unknown) => typeof v === 'string' && v.toLowerCase() === user))) {
      throw new Error('Owner alert was not accepted by the mail provider');
    }
  } finally { transport.close(); }
}

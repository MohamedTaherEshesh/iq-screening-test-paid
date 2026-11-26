/** Staging email ownership verification. Never treats browser flags as proof. */
export const EMAIL_VERIFICATION_POLICY = Object.freeze({
  acknowledgementVersion: 'omsaze-practice-v1', codeSeconds: 300,
  proofSeconds: 600, maximumSends: 4, maximumResends: 3,
  cooldownSeconds: 60, rateWindowSeconds: 1800, maximumAttempts: 5,
});
export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('Invalid email');
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error('Invalid email');
  return email;
}
export function requireVerificationSecret(secret: unknown): string {
  if (typeof secret !== 'string' || secret.length < 40) throw new Error('Verification secret unavailable');
  return secret;
}
/** A staging-only, domain-separated subkey avoids copying root secrets into chat. */
export async function resolveVerificationSecret():Promise<string>{
 const configured=Deno.env.get('OMSAZE_EMAIL_VERIFICATION_SECRET');
 if(configured)return requireVerificationSecret(configured);
 if(Deno.env.get('SUPABASE_URL')!=='https://cbklbucvidcutshhmwjy.supabase.co'||Deno.env.get('OMSAZE_ENVIRONMENT')!=='staging'||Deno.env.get('OMSAZE_EMAIL_VERIFICATION_KEY_MODE')!=='hook-hkdf-v1')throw Error('Verification secret unavailable');
 const encoded=(Deno.env.get('OMSAZE_EMAIL_HOOK_SECRET')??'').replace(/^v1,whsec_/,'');
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('Hook key unavailable');
 const root=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
 if(root.length<32)throw Error('Hook key unavailable');
 const key=await crypto.subtle.importKey('raw',root,'HKDF',false,['deriveBits']);
 const derived=await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('cbklbucvidcutshhmwjy'),info:new TextEncoder().encode('omsaze/email-verification/subkey/v1')},key,256);
 return [...new Uint8Array(derived)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export const isBrowserSecret = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export async function verificationHash(secret: string, purpose: string, value: string): Promise<string> {
  requireVerificationSecret(secret);
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(purpose+'\n'+value)));
  return [...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');
}
const b64 = (s: string): string => btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const unb64 = (s: string): string => atob(s.replace(/-/g,'+').replace(/_/g,'/'));
export type EmailStartProof = {
  v: 1; scope: 'omsaze-staging-exam-start'; requestId: string;
  candidateId: string; emailHash: string; acknowledgement: string; exp: number;
};
export async function signEmailStartProof(payload: EmailStartProof, secret: string): Promise<string> {
  const encoded=b64(JSON.stringify(payload));
  return encoded+'.'+await verificationHash(secret,'exam-start-proof',encoded);
}
export async function verifyEmailStartProof(raw: unknown, secret: string, candidateId: string, email: string, nowMs=Date.now()): Promise<EmailStartProof> {
  if(typeof raw!=='string'||raw.length>2000)throw Error('Verified email is required before starting');
  const [encoded,signature,...extra]=raw.split('.');
  if(extra.length||!encoded||!/^[a-f0-9]{64}$/.test(signature??''))throw Error('Invalid verification proof');
  const expected=await verificationHash(secret,'exam-start-proof',encoded);
  let different=0;for(let n=0;n<64;n++)different|=expected.charCodeAt(n)^signature.charCodeAt(n);
  if(different)throw Error('Invalid verification proof');
  let p:EmailStartProof;try{p=JSON.parse(unb64(encoded))}catch{throw Error('Invalid verification proof')}
  if(!p||Object.keys(p).sort().join('|')!=='acknowledgement|candidateId|emailHash|exp|requestId|scope|v'||
    p.v!==1||p.scope!=='omsaze-staging-exam-start'||!isUuid(p.requestId)||!isUuid(p.candidateId)||p.candidateId!==candidateId||
    p.acknowledgement!==EMAIL_VERIFICATION_POLICY.acknowledgementVersion||
    !Number.isSafeInteger(p.exp)||p.exp*1000<=nowMs||p.exp*1000>nowMs+601000||
    p.emailHash!==await verificationHash(secret,'email',normalizeEmail(email)))throw Error('Expired or mismatched email verification');
  return p;
}
export function parseEmailAction(raw: unknown): Record<string,unknown> {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid verification request');
  const b=raw as Record<string,unknown>;
  if(!['request','resend','verify'].includes(String(b.action))||!isBrowserSecret(b.browserSecret))throw Error('Invalid verification request');
  normalizeEmail(b.email);
  if(b.action==='request'&&(b.acknowledgement!==EMAIL_VERIFICATION_POLICY.acknowledgementVersion||b.accepted!==true))throw Error('Acknowledgement required');
  if(b.action!=='request'&&!isUuid(b.requestId))throw Error('Invalid verification request');
  if(b.action==='verify'&&(typeof b.code!=='string'||!/^\d{6}$/.test(b.code)))throw Error('Enter the six-digit verification code');
  return b;
}

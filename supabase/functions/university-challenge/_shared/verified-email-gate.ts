import {stagingDb} from './staging-db.ts';
import {normalizeEmail,requireVerificationSecret,verificationHash,verifyEmailStartProof} from './email-verification.ts';
export class EmailVerificationRequired extends Error {
  constructor(){super('Confirm your email before starting the exam');this.name='EmailVerificationRequired';}
}
export async function requireVerifiedEmailStart(req: Request) {
  try{
    const authorization=req.headers.get('authorization')??'';
    if(!authorization.startsWith('Bearer '))throw Error();
    const sb=stagingDb();
    const {data:{user},error}=await sb.auth.getUser(authorization.slice(7));
    if(error||!user?.email||!user.email_confirmed_at)throw Error();
    const secret=requireVerificationSecret(Deno.env.get('OMSAZE_EMAIL_VERIFICATION_SECRET'));
    const proof=await verifyEmailStartProof(req.headers.get('x-omsaze-email-proof'),secret,user.id,user.email);
    const {data:flow,error:flowError}=await sb.from('email_verification_flows').select('id,candidate_id,email_hash,state,proof_expires_at,consumed_session').eq('id',proof.requestId).single();
    if(flowError||!flow||flow.candidate_id!==user.id||flow.state!=='verified'||flow.email_hash!==await verificationHash(secret,'email',normalizeEmail(user.email))||Date.parse(flow.proof_expires_at)<=Date.now())throw Error();
    return {candidateId:user.id,email:normalizeEmail(user.email),verificationId:proof.requestId,consumedSession:flow.consumed_session as string|null};
  }catch{throw new EmailVerificationRequired()}
}
export async function requireVerifiedSession(req: Request) {
  try{
    const authorization=req.headers.get('authorization')??'';
    if(!authorization.startsWith('Bearer '))throw Error();
    const sb=stagingDb();
    const {data:{user},error}=await sb.auth.getUser(authorization.slice(7));
    if(error||!user?.email||!user.email_confirmed_at)throw Error();
    return {candidateId:user.id,email:normalizeEmail(user.email)};
  }catch{throw new EmailVerificationRequired()}
}

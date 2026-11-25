import {stagingDb} from './staging-db.ts';
import {normalizeEmail} from './email-verification.ts';
export class EmailVerificationRequired extends Error {
  constructor(){super('Confirm your email before continuing');this.name='EmailVerificationRequired';}
}
export async function requireVerifiedSession(req: Request) {
  try {
    const authorization=req.headers.get('authorization')??'';
    if(!authorization.startsWith('Bearer '))throw Error();
    const sb=stagingDb();
    const {data:{user},error}=await sb.auth.getUser(authorization.slice(7));
    if(error||!user?.email||!user.email_confirmed_at)throw Error();
    return {candidateId:user.id,email:normalizeEmail(user.email)};
  }catch{throw new EmailVerificationRequired()}
}

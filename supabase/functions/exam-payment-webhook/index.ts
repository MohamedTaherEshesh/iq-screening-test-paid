import {requireStaging,stagingDb} from './_shared/staging-db.ts';
import {paymentTestConfig,paymentTestOutcome} from './_shared/payment-test-contract.ts';
import {verifyPaymobSandboxHmac} from './_shared/paymob-sandbox-webhook.ts';
import {certificatePdfBytes} from './_shared/certificate.ts';
import {deliverReportMail, computeDomainStats} from './_shared/report-mail.ts';

async function sendReportIfNewlyPaid(db: ReturnType<typeof stagingDb>, orderId: number) {
  try {
    const { data: payment } = await db.from('exam_payments')
      .select('id,state,test_id,candidate_id,report_emailed_at')
      .eq('paymob_order_id', orderId).maybeSingle();
    if (!payment || payment.state !== 'paid' || payment.report_emailed_at) return;

    const { data: { user }, error: userErr } = await db.auth.admin.getUserById(payment.candidate_id);
    if (userErr || !user?.email) return;
    const email = user.email.toLowerCase();

    const { data: session } = await db.from('university_challenge_sessions')
      .select('candidate_name,result,submitted,answers,domains,answer_key,submitted_at,started_at')
      .eq('id', payment.test_id).maybeSingle();
    if (!session || !session.submitted || !session.result) return;
    const r = session.result as Record<string, unknown>;
    const correct = Number(r.correct);
    const answerKey = (session.answer_key ?? []) as number[];
    const total = answerKey.length;
    if (!Number.isInteger(correct) || correct < 0 || correct > total || total < 1) return;
    const answersArr = (session.answers ?? []) as (number|null)[];
    const domainsArr = (session.domains ?? []) as string[];
    const domainStats = computeDomainStats(answersArr, domainsArr, answerKey);
    const attempted = domainStats.reduce((s, x) => s + x.attempted, 0);
    const skipped = total - attempted;
    const name = (session.candidate_name as string) || email;

    const certBytes = await certificatePdfBytes({name, date: new Date().toISOString().slice(0,10), correct, total, pctl: 0, iq: 0});
    await deliverReportMail({
      email, name, runId: String(payment.test_id), correct, total, attempted, skipped,
      submittedAt: (session.submitted_at as string) || (session.started_at as string) || new Date().toISOString(),
      domainStats, certificateBytes: certBytes,
    });
    await db.from('exam_payments').update({report_emailed_at: new Date().toISOString()}).eq('id', payment.id);
  } catch (e) {
    console.error('auto report-email after payment failed', e instanceof Error ? e.message : 'unknown');
  }
}

Deno.serve(async req=>{
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 if(req.method!=='POST')return reply({error:'POST required'},405);
 try{
  requireStaging();const config=paymentTestConfig();if(!config.enabled||!config.configured)return reply({error:'Payments disabled'},503);
  const raw=await req.text();if(raw.length>80000)return reply({error:'Payload too large'},413);
  let data;try{data=JSON.parse(raw)}catch{return reply({error:'Invalid payload'},400)}
  if(data?.type!=='TRANSACTION'||!data.obj||typeof data.obj!=='object'||Array.isArray(data.obj))return reply({error:'Transaction required'},400);
  if(!await verifyPaymobSandboxHmac(data.obj,new URL(req.url).searchParams.get('hmac'),config.hmac))return reply({error:'Invalid signature'},401);
  let event;try{event=paymentTestOutcome(data.obj,config.integration)}catch{return reply({error:'Wrong payment data'},422)}
  const db=stagingDb();
  const {data:state,error}=await db.rpc('record_exam_payment_event',{p_txn:event.transaction,p_order:event.order,p_integration:config.integration,p_amount:event.amount,p_currency:'EGP',p_outcome:event.outcome});
  if(error)return reply({error:'Could not record callback'},503);
  if(state==='invalid'||state==='conflict')return reply({error:'Conflicting callback'},409);
  if(state==='paid') await sendReportIfNewlyPaid(db, event.order);
  return reply({ok:true,state});
 }catch{return reply({error:'Callback unavailable'},503)}
});

// Real pay-to-unlock gate for a finished exam session, using Paymob SANDBOX
// (test-mode) keys only -- no real money moves. Separate from paymob-test,
// which stays a standalone plumbing exercise that never unlocks anything.
import {requireVerifiedSession, EmailVerificationRequired} from './_shared/payment-session-gate.ts';
import {requireStaging, stagingDb} from './_shared/staging-db.ts';
import {isKnownStagingOrigin} from './_shared/staging-origins.ts';
import {paymentTestConfig, createPaymentTestIntention} from './_shared/payment-test-contract.ts';
import {currentSignedPrice, verifyPriceQuote, currentExamPrice, PriceChanged, DEFAULT_EXAM_TAG} from './_shared/usd-egp-price.ts';
import {certificateVerification} from './_shared/certificate-verify.ts';
import {isUuid, resolveVerificationSecret} from './_shared/email-verification.ts';
import {certificatePdfBytes} from './_shared/certificate.ts';
import {deliverReportMail, computeDomainStats} from './_shared/report-mail.ts';
import {safeFileName, isoDateUtc} from './_shared/brand.ts';
import {notifyOwner} from './_shared/owner-notify.ts';

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

function json(body: unknown, status: number, cors: Record<string,string>) {
  return new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json','cache-control':'no-store','vary':'origin',...cors}});
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const originAllowed = isKnownStagingOrigin(origin);
  const cors: Record<string,string> = originAllowed ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,apikey',
  } : {};
  const reply = (body: unknown, status: number) => json(body, status, cors);
  if (req.method === 'OPTIONS') return new Response(null, {status: originAllowed?204:403, headers:{'cache-control':'no-store','vary':'origin',...cors}});
  if (req.method !== 'POST') return reply({error:'Method not allowed'}, 405);
  if (!originAllowed) return reply({error:'Staging origin not permitted'}, 403);

  try {
    requireStaging();
    const raw = await req.text();
    if (raw.length > 2048) return reply({error:'Request too large'}, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return reply({error:'Invalid JSON'}, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({error:'Invalid request'}, 400);
    const b = body as Record<string, unknown>;

    let candidateId: string; let email: string;
    try {
      const verified = await requireVerifiedSession(req);
      candidateId = verified.candidateId; email = verified.email;
    } catch (e) {
      if (e instanceof EmailVerificationRequired) return reply({error: e.message}, 403);
      throw e;
    }

    const db = stagingDb();

    // Exam of a finished session owned by this candidate (OMS-MND-261126-06: each exam has its own price).
    const examTagOf = async (testId: unknown): Promise<string|null> => {
      if (!isUuid(testId)) return null;
      const { data } = await db.from('university_challenge_sessions').select('exam_tag').eq('id', testId).eq('candidate_id', candidateId).maybeSingle();
      return (data?.exam_tag as string) || null;
    };

    if (b.action === 'quote') {
      const examTag = (await examTagOf(b.testId)) ?? DEFAULT_EXAM_TAG;
      try { return reply({price: await currentSignedPrice(db, examTag)}, 200); }
      catch { return reply({error:'The live USD→EGP conversion quote is unavailable right now.'}, 503); }
    }

    if (b.action === 'status') {
      if (!isUuid(b.testId)) return reply({error:'Invalid test reference'}, 400);
      const { data, error } = await db.from('exam_payments')
        .select('id,state,paymob_order_id,transaction_id,created_at,amount_cents,usd_cents,fx_rate,fx_as_of,fx_source,report_emailed_at')
        .eq('test_id', b.testId).eq('candidate_id', candidateId).maybeSingle();
      if (error) return reply({error:'Could not read payment status'}, 503);
      return reply({payment: data ?? null}, 200);
    }

    if (b.action === 'create') {
      if (!isUuid(b.testId)) return reply({error:'Invalid test reference'}, 400);
      const config = paymentTestConfig();
      if (!config.enabled || !config.configured) return reply({error:'Payment is not configured. No checkout was created.', code:'SANDBOX_NOT_CONFIGURED'}, 503);
      const examTag = await examTagOf(b.testId);
      if (!examTag) return reply({error:'This exam session is not eligible for payment (not found, not yours, or not finished yet).'}, 409);
      let quote;
      try { quote = await verifyPriceQuote(b.price, await resolveVerificationSecret(), await currentExamPrice(db, examTag), examTag); }
      catch (e) {
        if (e instanceof PriceChanged) return reply({error: e.message, code:'PRICE_CHANGED'}, 409);
        return reply({error:'Refresh the conversion quote and try again.', code:'QUOTE_REFRESH_REQUIRED'}, 409);
      }

      const { data: reserved, error: reserveError } = await db.rpc('reserve_exam_payment', {p_test_id: b.testId, p_candidate: candidateId, p_quote: quote});
      if (reserveError || !reserved) return reply({error:'This exam session is not eligible for payment (not found, not yours, or not finished yet).'}, 409);
      if (reserved.existing && (reserved.amount_cents !== quote.amountCents)) {
        return reply({error:'This order has a different locked conversion. Refresh the quote to confirm the current price.', code:'LOCKED_PRICE'}, 409);
      }
      if (reserved.existing) {
        if (reserved.state === 'paid') return reply({id: reserved.id, state: 'paid'}, 200);
        if (reserved.state === 'ready' && reserved.checkout_url) return reply({id: reserved.id, checkoutUrl: reserved.checkout_url, mode:'sandbox'}, 200);
        return reply({id: reserved.id, state: reserved.state, error:'This payment attempt already exists. Check its status.'}, 409);
      }
      try {
        const intention = await createPaymentTestIntention(reserved.id, email, config, reserved.amount_cents, fetch, 'exam-payment-webhook', '/exam-payment/');
        const { data: attached, error } = await db.rpc('attach_exam_payment', {p_test_id: b.testId, p_candidate: candidateId, p_order: intention.orderId, p_integration: config.integration, p_checkout: intention.url});
        if (error || ['conflict','invalid'].includes(attached)) throw Error('Unable to attach payment order');
        return reply({id: reserved.id, checkoutUrl: intention.url, mode:'sandbox', amountCents: reserved.amount_cents}, 200);
      } catch {
        await db.from('exam_payments').update({state:'failed'}).eq('test_id', b.testId).eq('candidate_id', candidateId).eq('state','creating');
        return reply({error:'Paymob checkout could not be confirmed. The report remains locked.'}, 503);
      }
    }

    if (b.action === 'certificate') {
      if (!isUuid(b.testId)) return reply({error:'Invalid test reference'}, 400);
      const { data: payment } = await db.from('exam_payments').select('state').eq('test_id', b.testId).eq('candidate_id', candidateId).maybeSingle();
      if (!payment || payment.state !== 'paid') return reply({error:'Payment has not been confirmed yet. The certificate is not available.'}, 403);
      const { data: session } = await db.from('university_challenge_sessions').select('candidate_name,result,submitted,language,submitted_at,started_at,exam_tag').eq('id', b.testId).eq('candidate_id', candidateId).maybeSingle();
      if (!session || !session.submitted || !session.result) return reply({error:'Exam result not found.'}, 404);
      const r = session.result as Record<string, unknown>;
      const correct = Number(r.correct);
      const total = 70;
      if (!Number.isInteger(correct) || correct < 0 || correct > total) return reply({error:'Score unavailable for certificate.'}, 500);
      const name = (session.candidate_name as string) || email;
      const lang = session.language === 'ar' ? 'ar' as const : 'en' as const;
      let bytes: Uint8Array;
      try {
        const v = await certificateVerification(db, b.testId as string, session);
        bytes = await certificatePdfBytes({name, date: v.date, correct, total, pctl: 0, iq: 0, lang, verifyCode: v.code, verifyUrl: v.url, examTag: session.exam_tag as string});
      } catch { return reply({error:'Could not generate certificate.'}, 500); }
      const filename = `OMSAZE-${safeFileName(name)}-${isoDateUtc()}-Certificate.pdf`;
      return new Response(bytes, {status:200, headers:{'content-type':'application/pdf','content-disposition':`attachment; filename="${filename.replace(/"/g,'')}"`,'cache-control':'no-store','vary':'origin',...cors}});
    }

    if (b.action === 'email') {
      if (!isUuid(b.testId)) return reply({error:'Invalid test reference'}, 400);
      const { data: payment } = await db.from('exam_payments').select('id,state').eq('test_id', b.testId).eq('candidate_id', candidateId).maybeSingle();
      if (!payment || payment.state !== 'paid') return reply({error:'Payment has not been confirmed yet. The report cannot be emailed.'}, 403);
      const { data: session } = await db.from('university_challenge_sessions')
        .select('candidate_name,result,submitted,answers,domains,answer_key,submitted_at,started_at,language,exam_tag')
        .eq('id', b.testId).eq('candidate_id', candidateId).maybeSingle();
      if (!session || !session.submitted || !session.result) return reply({error:'Exam result not found.'}, 404);
      const r = session.result as Record<string, unknown>;
      const correct = Number(r.correct);
      const answerKey = (session.answer_key ?? []) as number[];
      const total = answerKey.length;
      if (!Number.isInteger(correct) || correct < 0 || correct > total || total < 1) return reply({error:'Score unavailable.'}, 500);
      const answersArr = (session.answers ?? []) as (number|null)[];
      const domainsArr = (session.domains ?? []) as string[];
      const domainStats = computeDomainStats(answersArr, domainsArr, answerKey);
      const attempted = domainStats.reduce((s, x) => s + x.attempted, 0);
      const skipped = total - attempted;
      const name = (session.candidate_name as string) || email;
      const lang = session.language === 'ar' ? 'ar' as const : 'en' as const;
      let certBytes: Uint8Array;
      try {
        const v = await certificateVerification(db, b.testId as string, session);
        certBytes = await certificatePdfBytes({name, date: v.date, correct, total, pctl: 0, iq: 0, lang, verifyCode: v.code, verifyUrl: v.url, examTag: session.exam_tag as string});
      } catch { return reply({error:'Could not generate certificate.'}, 500); }
      try {
        await deliverReportMail({
          email, name, runId: String(b.testId), correct, total, attempted, skipped,
          submittedAt: (session.submitted_at as string) || (session.started_at as string) || new Date().toISOString(),
          domainStats, certificateBytes: certBytes, lang, examTag: session.exam_tag as string,
        });
      } catch (e) {
        console.error('report email failed', e instanceof Error ? e.message : 'unknown');
        return reply({error:'Could not send the email right now. Try again shortly.'}, 503);
      }
      await db.from('exam_payments').update({report_emailed_at: new Date().toISOString()}).eq('id', payment.id);
      return reply({sent: true}, 200);
    }

    if (b.action === 'notify-missing') {
      if (!isUuid(b.testId)) return reply({error:'Invalid test reference'}, 400);
      const { data: payment } = await db.from('exam_payments').select('id,state,report_emailed_at').eq('test_id', b.testId).eq('candidate_id', candidateId).maybeSingle();
      if (!payment || payment.state !== 'paid') return reply({error:'Payment has not been confirmed yet.'}, 403);
      try {
        await notifyOwner('OMSAZE staging — candidate reports missing report email',
          `<p>Candidate <b>${esc(email)}</b> says they did not receive their report &amp; certificate email.</p>` +
          `<p>Test: ${esc(b.testId)}<br>Payment: ${esc(payment.id)} (state: ${esc(payment.state)})<br>` +
          `Previously emailed at: ${esc(payment.report_emailed_at ?? 'never')}<br>Reported at: ${esc(new Date().toISOString())}</p>`);
      } catch (e) {
        console.error('owner notify failed', e instanceof Error ? e.message : 'unknown');
        return reply({error:'Could not notify the team right now. Try again shortly.'}, 503);
      }
      return reply({notified: true}, 200);
    }

    return reply({error:'Unknown action'}, 400);
  } catch (err) {
    if (err instanceof EmailVerificationRequired) return reply({error: err.message}, 403);
    console.error('exam-payment error', err instanceof Error ? err.message : 'unknown');
    return reply({error:'Payment service unavailable'}, 503);
  }
});

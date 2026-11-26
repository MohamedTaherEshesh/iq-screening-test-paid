import {requireVerifiedEmailStart, requireVerifiedSession, EmailVerificationRequired} from './_shared/verified-email-gate.ts';
import {requireStaging, stagingDb} from './_shared/staging-db.ts';
import {isKnownStagingOrigin} from './_shared/staging-origins.ts';
import {verifyChallengeTestToken} from './_shared/university-challenge-test-access.ts';
import {optionOrder, shuffledOptions, shownCorrectIndex} from './_shared/option-order.ts';

const KNOWN_EXAM_TAGS = ['university-cognitive-skills', 'university-iq-preparation'] as const;
type ExamTag = typeof KNOWN_EXAM_TAGS[number];
function resolveExamTag(raw: unknown): ExamTag {
  return (KNOWN_EXAM_TAGS as readonly string[]).includes(raw as string) ? (raw as ExamTag) : 'university-cognitive-skills';
}
const POLICY = {id:'university-advanced-70-v1', questionCount:70, durationSeconds:6300} as const;
const DOMAINS = ['numerical','analytical','visual','spatial','logical','linguistic','creative'] as const;
const PER_DOMAIN = 10;

function json(body: unknown, status: number, cors: Record<string,string>) {
  return new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json','cache-control':'no-store','vary':'origin',...cors}});
}

function shuffle<T>(arr: T[]): T[] {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function ageYearsOf(isoDate: string, nowMs: number): number {
  const birthMs = Date.parse(isoDate + 'T00:00:00Z');
  return (nowMs - birthMs) / (365.25 * 24 * 3600 * 1000);
}

function cleanOptionalText(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, maxLen);
  return trimmed.length ? trimmed : null;
}

// Pay-to-reveal (owner decision 2026-11-25): the score is never sent to the browser until the
// exam's payment is confirmed as paid. Before that, only completion facts are returned.
async function isPaid(sb: ReturnType<typeof stagingDb>, testId: string, candidateId: string): Promise<boolean> {
  const { data, error } = await sb.from('exam_payments').select('state')
    .eq('test_id', testId).eq('candidate_id', candidateId).maybeSingle();
  return !error && data?.state === 'paid';
}
function lockedResult(result: Record<string, any>) {
  const unanswered = Number(result?.unanswered ?? 0);
  return {locked: true, answered: POLICY.questionCount - unanswered, unanswered, timedOut: !!result?.timedOut};
}
async function visibleResult(sb: ReturnType<typeof stagingDb>, testId: string, candidateId: string, result: Record<string, any> | null) {
  if (!result) return null;
  return (await isPaid(sb, testId, candidateId)) ? {...result, locked: false} : lockedResult(result);
}

async function buildQuestionsFor(sb: ReturnType<typeof stagingDb>, existing: Record<string, any>, language: string) {
  const { data: items, error: itemsErr } = await sb.from('question_bank')
    .select('legacy_id, domain, correct_index, options_en, options_ar, prompt_en, prompt_ar, visual_grid')
    .in('legacy_id', existing.item_codes);
  if (itemsErr || !items) return null;
  const byCode = new Map(items.map((it: any) => [it.legacy_id, it]));
  // OMS-MND-261126-03: sessions created before option shuffling stored the bank's answer positions.
  // If every stored key equals the bank key, the session is unshuffled and keeps the bank order on resume.
  const codes = existing.item_codes as string[];
  const key = (existing.answer_key ?? []) as number[];
  const shuffled = codes.some((c, i) => key[i] !== (byCode.get(c) as any)?.correct_index);
  return (existing.item_codes as string[]).map((code: string) => {
    const it: any = byCode.get(code);
    const prompt = language === 'ar' ? it?.prompt_ar : it?.prompt_en;
    const bankOptions = language === 'ar' ? it?.options_ar : it?.options_en;
    const options = shuffled ? shuffledOptions(bankOptions, optionOrder(existing.id, code, bankOptions?.length ?? 4)) : bankOptions;
    return {itemCode: code, domain: it?.domain, difficulty: 4, prompt, options, grid: it?.visual_grid ?? undefined};
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const originAllowed = isKnownStagingOrigin(origin);
  const cors: Record<string,string> = originAllowed ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,apikey,x-omsaze-email-proof,x-omsaze-challenge-test-token',
  } : {};
  const reply = (body: unknown, status: number) => json(body, status, cors);
  if (req.method === 'OPTIONS') return new Response(null, {status: originAllowed?204:403, headers:{'cache-control':'no-store','vary':'origin',...cors}});
  if (req.method !== 'POST') return reply({error:'Method not allowed'}, 405);
  if (!originAllowed) return reply({error:'Staging origin not permitted'}, 403);

  try {
    requireStaging();

    const size = Number(req.headers.get('content-length') ?? 0);
    if (size > 2048) return reply({error:'Request too large'}, 413);
    const raw = await req.text();
    if (raw.length > 2048) return reply({error:'Request too large'}, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return reply({error:'Invalid JSON'}, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({error:'Invalid request'}, 400);
    const b = body as Record<string, unknown>;
    const action = b.action;
    const EXAM_TAG = resolveExamTag(b.examTag);

    let candidateId: string; let emailVerificationId: string | null = null;
    const testToken = req.headers.get('x-omsaze-challenge-test-token');
    const configuredTestToken = Deno.env.get('OMSAZE_UNIVERSITY_CHALLENGE_TEST_TOKEN');
    const testOk = !!(testToken && configuredTestToken && verifyChallengeTestToken(testToken, configuredTestToken));
    try {
      if (action === 'start') {
        const verified = await requireVerifiedEmailStart(req);
        candidateId = verified.candidateId; emailVerificationId = verified.verificationId;
      } else {
        const verified = await requireVerifiedSession(req);
        candidateId = verified.candidateId;
      }
    } catch (gateErr) {
      if (testOk) {
        candidateId = '00000000-0000-4000-8000-000000000001';
      } else if (gateErr instanceof EmailVerificationRequired) {
        return reply({error: gateErr.message}, 403);
      } else {
        throw gateErr;
      }
    }

    const sb = stagingDb();

    if (action === 'start') {
      const language = b.language;
      if (language !== 'en' && language !== 'ar') return reply({error:'Invalid language'}, 400);
      const forceNew = b.forceNew === true;

      let existing: Record<string, any> | null = null;
      if (!forceNew) {
        // First: an in-progress, unexpired session for this candidate+exam resumes as before.
        const { data: inProgress } = await sb.from('university_challenge_sessions')
          .select('*')
          .eq('candidate_id', candidateId)
          .eq('exam_tag', EXAM_TAG)
          .eq('submitted', false)
          .gt('expires_at', new Date().toISOString())
          .order('started_at', {ascending:false})
          .limit(1)
          .maybeSingle();

        existing = inProgress;
        // Otherwise: fall back to the candidate's most recently SUBMITTED session for this
        // exam, regardless of expiry, so a closed tab (which drops sessionStorage) still
        // leads back to the result/certificate/payment screen instead of a dead end or an
        // accidental new attempt. A submitted session's timer no longer matters for viewing.
        if (!existing) {
          const { data: completed } = await sb.from('university_challenge_sessions')
            .select('*')
            .eq('candidate_id', candidateId)
            .eq('exam_tag', EXAM_TAG)
            .eq('submitted', true)
            .order('started_at', {ascending:false})
            .limit(1)
            .maybeSingle();
          existing = completed;
        }
      }
      // forceNew===true deliberately skips both lookups above, so a candidate who
      // explicitly asked for a brand-new attempt always gets a freshly generated
      // session instead of being routed back to a prior in-progress or completed one.
      // This never bypasses payment: a new session still has its own report lock.

      if (existing) {
        const questions = await buildQuestionsFor(sb, existing, language);
        if (!questions) return reply({error:'Unable to resume session'}, 503);
        return reply({
          testId: existing.id,
          policy: POLICY,
          questions,
          answers: existing.answers,
          expiresAt: existing.expires_at,
          serverNow: new Date().toISOString(),
          result: await visibleResult(sb, existing.id, candidateId, existing.result ?? null),
        }, 200);
      }

      const candidateName = typeof b.candidateName === 'string' ? b.candidateName.trim() : '';
      if (candidateName.length < 2 || candidateName.length > 120) return reply({error:'Enter your full name.'}, 400);
      const candidateBirthdate = typeof b.candidateBirthdate === 'string' ? b.candidateBirthdate : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(candidateBirthdate)) return reply({error:'Enter a valid date of birth.'}, 400);
      const nowMs = Date.now();
      const age = ageYearsOf(candidateBirthdate, nowMs);
      if (!Number.isFinite(age) || age < 5 || age > 100) return reply({error:'Age must be between 5 and 100 years.'}, 400);
      // Optional pilot demographics only - never used for scoring, access control, or question selection.
      const candidateCountry = cleanOptionalText(b.candidateCountry, 64);
      const candidateCity = cleanOptionalText(b.candidateCity, 80);

      const promptCol = language === 'ar' ? 'prompt_ar' : 'prompt_en';
      // OMS-MND-261126-03: questions this candidate already received in ANY earlier exam (IQ Preparation or
      // Cognitive Skills, finished or not), and questions with the same idea fingerprint,
      // are never issued again.
      const { data: pastSessions } = await sb.from('university_challenge_sessions')
        .select('item_codes').eq('candidate_id', candidateId);
      const seen = new Set<string>((pastSessions ?? []).flatMap((p: any) => Array.isArray(p.item_codes) ? p.item_codes : []));
      const seenIdeas = new Set<string>();
      const seenList = [...seen];
      for (let i = 0; i < seenList.length; i += 300) {
        const { data: fps } = await sb.from('question_bank').select('idea_fingerprint').in('legacy_id', seenList.slice(i, i + 300));
        (fps ?? []).forEach((f: any) => { if (f.idea_fingerprint) seenIdeas.add(f.idea_fingerprint); });
      }
      const wasSeen = (q: any) => seen.has(q.legacy_id) || (!!q.idea_fingerprint && seenIdeas.has(q.idea_fingerprint));
      const selectedByDomain: Record<string, any[]> = {};
      for (const domain of DOMAINS) {
        // legacy_id doubles as this session's item code, so rows without one
        // (a data-entry gap in the approved pool) must be excluded here -
        // otherwise two different questions collapse to the same "null" code,
        // corrupting both the 70-unique-item invariant and session resume.
        const { data: pool, error: poolErr } = await sb.from('question_bank')
          .select('legacy_id, domain, correct_index, options_en, options_ar, prompt_en, prompt_ar, visual_grid, idea_fingerprint')
          .eq('status', 'reviewed_approved')
          .eq('domain', domain)
          .contains('exam_tags', [EXAM_TAG])
          .not('legacy_id', 'is', null)
          .not(promptCol, 'is', null);
        if (poolErr) return reply({error:'Question bank unavailable'}, 503);
        if (!pool || pool.length < PER_DOMAIN) {
          return reply({error: `Insufficient approved ${language} content for domain ${domain}: ${pool?.length ?? 0} available, ${PER_DOMAIN} required`}, 503);
        }
        // Owner rule 2026-11-26: no repeats at all. If a section has fewer than 10 questions this candidate
        // has never seen, no new exam is issued (the page already says so) instead of reusing questions.
        const unseen = shuffle(pool.filter((q: any) => !wasSeen(q)));
        if (unseen.length < PER_DOMAIN) {
          return reply({error: language === 'ar'
            ? 'لا توجد أسئلة جديدة كافية لك الآن. ستتوفر امتحانات جديدة مع إضافة أسئلة جديدة إلى البنك.'
            : 'There are not enough new questions for you right now. New exams will open as new questions are added.'}, 409);
        }
        selectedByDomain[domain] = unseen.slice(0, PER_DOMAIN);
      }
      const allSelected = shuffle(DOMAINS.flatMap((d) => selectedByDomain[d]));
      const itemCodes = allSelected.map((q) => q.legacy_id);
      const domainsArr = allSelected.map((q) => q.domain);
      // Session id is created here so the option order (seeded by it) is known before saving the answer key.
      const sessionId = crypto.randomUUID();
      const orders = allSelected.map((q) => optionOrder(sessionId, q.legacy_id, (language === 'ar' ? q.options_ar : q.options_en)?.length ?? 4));
      const answerKey = allSelected.map((q, i) => shownCorrectIndex(q.correct_index, orders[i]));
      const expiresAt = new Date(nowMs + POLICY.durationSeconds * 1000).toISOString();
      const answersInit = new Array(POLICY.questionCount).fill(null);

      if (new Set(itemCodes).size !== POLICY.questionCount) {
        return reply({error:'Question bank integrity check failed: duplicate item codes selected'}, 503);
      }

      const { data: inserted, error: insertErr } = await sb.from('university_challenge_sessions')
        .insert({
          id: sessionId,
          started_at: new Date(nowMs).toISOString(),
          candidate_id: candidateId,
          email_verification_id: emailVerificationId,
          exam_tag: EXAM_TAG,
          language,
          candidate_name: candidateName,
          candidate_birthdate: candidateBirthdate,
          candidate_country: candidateCountry,
          candidate_city: candidateCity,
          item_codes: itemCodes,
          domains: domainsArr,
          answer_key: answerKey,
          answers: answersInit,
          expires_at: expiresAt,
        })
        .select('id')
        .single();
      if (insertErr || !inserted) return reply({error:'Unable to create session'}, 503);

      const questions = allSelected.map((q) => ({
        itemCode: q.legacy_id,
        domain: q.domain,
        difficulty: 4,
        prompt: language === 'ar' ? q.prompt_ar : q.prompt_en,
        options: shuffledOptions(language === 'ar' ? q.options_ar : q.options_en, orders[allSelected.indexOf(q)]),
        grid: q.visual_grid ?? undefined,
      }));

      return reply({
        testId: inserted.id,
        policy: POLICY,
        questions,
        answers: answersInit,
        expiresAt,
        serverNow: new Date(nowMs).toISOString(),
      }, 200);
    }

    if (action === 'answer') {
      const testId = b.testId; const index = b.index; const answer = b.answer;
      if (typeof testId !== 'string' || !Number.isInteger(index) || (index as number) < 0 || (index as number) > 69) {
        return reply({error:'Invalid answer request'}, 400);
      }
      if (answer !== null && (!Number.isInteger(answer) || (answer as number) < 0 || (answer as number) > 3)) {
        return reply({error:'Invalid answer value'}, 400);
      }
      const { data: sess, error: sessErr } = await sb.from('university_challenge_sessions')
        .select('id, candidate_id, submitted, expires_at, answers')
        .eq('id', testId).eq('candidate_id', candidateId).maybeSingle();
      if (sessErr || !sess) return reply({error:'Session not found'}, 404);
      if (sess.submitted) return reply({saved:false, error:'Session already submitted'}, 409);
      if (new Date(sess.expires_at).getTime() <= Date.now()) return reply({saved:false, error:'Session expired'}, 410);
      const answers = Array.isArray(sess.answers) ? [...sess.answers] : new Array(POLICY.questionCount).fill(null);
      answers[index as number] = answer;
      const { error: updErr } = await sb.from('university_challenge_sessions').update({answers}).eq('id', testId);
      if (updErr) return reply({saved:false}, 503);
      return reply({saved:true}, 200);
    }

    if (action === 'result') {
      // Re-read the result after payment. Returns the full score only once the payment is paid.
      const testId = b.testId;
      if (typeof testId !== 'string') return reply({error:'Invalid result request'}, 400);
      const { data: sess, error: sessErr } = await sb.from('university_challenge_sessions')
        .select('id, submitted, result').eq('id', testId).eq('candidate_id', candidateId).maybeSingle();
      if (sessErr || !sess || !sess.submitted || !sess.result) return reply({error:'Result not found'}, 404);
      return reply({result: await visibleResult(sb, testId, candidateId, sess.result)}, 200);
    }

    if (action === 'finish') {
      const testId = b.testId;
      if (typeof testId !== 'string') return reply({error:'Invalid finish request'}, 400);
      const { data: sess, error: sessErr } = await sb.from('university_challenge_sessions')
        .select('*').eq('id', testId).eq('candidate_id', candidateId).maybeSingle();
      if (sessErr || !sess) return reply({error:'Session not found'}, 404);
      if (sess.submitted && sess.result) return reply({result: await visibleResult(sb, testId, candidateId, sess.result)}, 200);

      const answers: (number|null)[] = Array.isArray(sess.answers) ? sess.answers : [];
      const answerKey: number[] = sess.answer_key;
      const domains: string[] = sess.domains;
      let correct = 0; let unanswered = 0;
      const perDomain: Record<string, {correct:number}> = {};
      for (const d of DOMAINS) perDomain[d] = {correct:0};
      for (let i=0;i<answerKey.length;i++){
        if (answers[i] === null || answers[i] === undefined) { unanswered++; continue; }
        if (answers[i] === answerKey[i]) { correct++; perDomain[domains[i]].correct++; }
      }
      const timedOut = new Date(sess.expires_at).getTime() <= Date.now();
      const result = {
        correct, unanswered,
        percentCorrect: Math.round((correct / answerKey.length) * 100),
        perDomain, timedOut,
      };
      const { error: updErr } = await sb.from('university_challenge_sessions')
        .update({submitted:true, result, submitted_at: new Date().toISOString()}).eq('id', testId);
      if (updErr) return reply({error:'Unable to save result'}, 503);
      return reply({result: await visibleResult(sb, testId, candidateId, result)}, 200);
    }

    return reply({error:'Unknown action'}, 400);
  } catch (err) {
    if (err instanceof EmailVerificationRequired) return reply({error: err.message}, 403);
    console.error('university-challenge error', err instanceof Error ? err.message : 'unknown');
    return reply({error:'University challenge unavailable'}, 503);
  }
});

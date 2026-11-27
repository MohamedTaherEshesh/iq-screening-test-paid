import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { Buffer } from 'node:buffer';
import { requireStaging } from './staging-db.ts';
import { normalizeEmail } from './email-verification.ts';
import { safeFileName, isoDateUtc, winAnsiSafe } from './brand.ts';
import { loadBrand, OMS, SIGNER } from './omsaze-pdf-brand.ts';
import { hasArabic, loadArabicFonts, mirrorPage } from './rtl-pdf.ts';
import { examName } from './exam-names.ts';

export type DomainStat = { domain: string; correct: number; attempted: number; skipped: number; total: number };

const DOMAIN_LABEL: Record<string, string> = {
  numerical: 'Numerical', analytical: 'Analytical', visual: 'Visual', spatial: 'Spatial',
  logical: 'Logical', linguistic: 'Linguistic', creative: 'Creative problem solving',
};
const DOMAIN_LABEL_AR: Record<string, string> = {
  numerical: 'الاستدلال العددي', analytical: 'الاستدلال التحليلي', visual: 'الاستدلال البصري', spatial: 'التخيل المكاني',
  logical: 'الاستدلال المنطقي', linguistic: 'الاستدلال اللغوي', creative: 'حل المشكلات الإبداعي', critical: 'التفكير النقدي',
};
const DOMAIN_TECHNIQUE_AR: Record<string, string> = {
  numerical: 'أعد بناء العملية الحسابية، وتحقق من الوحدات، وقارن كل البدائل.',
  analytical: 'اكتب القيود، واستبعد التوزيعات التي لا تتوافق معها.',
  visual: 'اختبر القاعدة المقترحة للصف أو التراكب على كل مثال مكتمل.',
  spatial: 'تابع وجها أو اتجاها مرجعيا واحدا، وافصل الدوران عن الانعكاس.',
  logical: 'افصل النتائج المؤكدة عن الاحتمالات، وابحث عن مثال مضاد.',
  linguistic: 'اقرأ الصياغة بدقة، واجعل كل استنتاج واضحا ومكتوبا.',
  creative: 'جرب طريقة تمثيل مختلفة أو مثالا مضادا صغيرا.',
};
const DOMAIN_TECHNIQUE: Record<string, string> = {
  numerical: 'Rebuild the calculation, check units, and compare every alternative.',
  analytical: 'List the constraints and eliminate incompatible assignments.',
  visual: 'Test the proposed row or overlay rule in every complete example.',
  spatial: 'Track one reference face or direction; separate rotation from reflection.',
  logical: 'Separate guaranteed conclusions from possibilities; look for counterexamples.',
  linguistic: 'Read the wording closely and make each inference explicit.',
  creative: 'Try a different representation or a small counterexample.',
};

export function computeDomainStats(answers: (number | null | undefined)[], domains: string[], answerKey: number[]): DomainStat[] {
  const order: string[] = [];
  const byDomain = new Map<string, DomainStat>();
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i];
    if (!byDomain.has(d)) { byDomain.set(d, { domain: d, correct: 0, attempted: 0, skipped: 0, total: 0 }); order.push(d); }
    const stat = byDomain.get(d)!;
    stat.total++;
    const a = answers[i];
    if (a === null || a === undefined) { stat.skipped++; continue; }
    stat.attempted++;
    if (a === answerKey[i]) stat.correct++;
  }
  return order.map(d => byDomain.get(d)!);
}

function band(correct: number, attempted: number, total: number, ar = false) {
  const t = (en: string, a: string) => (ar ? a : en);
  if (attempted === 0) return { label: t('No response evidence', 'لا توجد إجابات مسجلة'), color: rgb(0.8, 0.82, 0.84), text: rgb(0.4, 0.44, 0.48), takeaway: t('No attempts recorded here yet -- reviewed items in this domain would give this report something to read.', 'لم تسجل محاولات في هذا المجال بعد، وحل أسئلة فيه سيعطي التقرير ما يقرؤه.') };
  const pct = total > 0 ? (correct / total) * 100 : 0;
  if (pct >= 75) return { label: t('Higher key agreement', 'تطابق مرتفع'), color: rgb(0, 0.651, 0.651), text: rgb(0.055, 0.5, 0.455), takeaway: t('Already a strength in this sample -- occasional review keeps it sharp.', 'نقطة قوة في هذه العينة، والمراجعة من وقت لآخر تحافظ عليها.') };
  if (pct >= 40) return { label: t('Mixed key agreement', 'تطابق متوسط'), color: rgb(0.78, 0.54, 0.09), text: rgb(0.706, 0.325, 0.035), takeaway: t('On track -- a few more reviewed items here would sharpen this further.', 'على الطريق الصحيح، وبعض الأسئلة الإضافية هنا ستحسنه أكثر.') };
  return { label: t('Review recommended', 'يوصى بالمراجعة'), color: rgb(0.753, 0.314, 0.302), text: rgb(0.706, 0.137, 0.094), takeaway: t('Priority for focused review -- revisit the method itself, not just more attempts.', 'أولوية للمراجعة المركزة: راجع طريقة الحل نفسها، وليس فقط عدد المحاولات.') };
}

function priorityDomains(stats: DomainStat[]): DomainStat[] {
  return [...stats].sort((a, b) => {
    const ra = a.total ? a.correct / a.total : 0, rb = b.total ? b.correct / b.total : 0;
    if (ra !== rb) return ra - rb;
    const sa = a.total ? a.skipped / a.total : 0, sb = b.total ? b.skipped / b.total : 0;
    if (sa !== sb) return sb - sa;
    return a.domain.localeCompare(b.domain);
  }).slice(0, 3);
}

export type ReportMail = {
  email: string; name: string; runId: string;
  correct: number; total: number; attempted: number; skipped: number;
  submittedAt: string;
  domainStats: DomainStat[];
  certificateBytes: Uint8Array;
  // 'ar' gives an Arabic report and email; file names stay ASCII (OMS-MND-261126-01). English is the default.
  lang?: 'en' | 'ar';
  // OMS-MND-261126-08: exam ID, used only to print the exam's display name.
  examTag?: string | null;
};

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  } catch { return iso; }
}
function pct1(n: number, d: number): string {
  return d > 0 ? (Math.round((n / d) * 1000) / 10).toFixed(1) : '0.0';
}
function polar(cx: number, cy: number, angleDeg: number, r: number) {
  const rad = (Math.PI / 180) * angleDeg;
  return { x: cx + r * Math.sin(rad), y: cy + r * Math.cos(rad) };
}

const NAVY = OMS.NAVY;
const TEAL = OMS.BLUE;
const CORAL = rgb(0.753, 0.314, 0.302);
const GRAY_BG = rgb(0.949, 0.957, 0.969);
const GRAY_LINE = rgb(0.918, 0.925, 0.937);
const MUTED = rgb(0.4, 0.44, 0.48);
const MUTED2 = rgb(0.596, 0.631, 0.663);
const BODY = rgb(0.114, 0.161, 0.224);
const PAGE_W = 595.28, PAGE_H = 841.89; // A4 portrait
const MARGIN = 48;

function wrapText(text: string, maxWidth: number, size: number, f: any): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (f.widthOfTextAtSize(test, size) > maxWidth && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function drawParagraph(page: any, text: string, x: number, y: number, maxWidth: number, size: number, f: any, color: any, leading: number): number {
  const lines = wrapText(text, maxWidth, size, f);
  lines.forEach((l, i) => page.drawText(l, { x, y: y - i * leading, size, font: f, color }));
  return y - lines.length * leading;
}

async function reportPdfBytes(d: ReportMail): Promise<Uint8Array> {
  const ar = d.lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);
  const DL = ar ? DOMAIN_LABEL_AR : DOMAIN_LABEL;
  const DT = ar ? DOMAIN_TECHNIQUE_AR : DOMAIN_TECHNIQUE;
  const pdf = await PDFDocument.create();
  const arabicName = hasArabic(d.name);
  const name = arabicName ? String(d.name).trim() : winAnsiSafe(d.name);
  pdf.setTitle(t(`OMSAZE Practice Report - ${name}`, `تقرير التدريب من OMSAZE - ${name}`));
  const B = await loadBrand(pdf);
  const AR = ar || arabicName ? await loadArabicFonts(pdf) : null;
  const font = ar && AR ? AR.font : B.font;
  const bold = ar && AR ? AR.bold : B.bold;
  const display = ar && AR ? AR.bold : B.display;
  const nameFont = arabicName && AR ? AR.bold : bold;
  const logoImg = B.logo;
  const logoDims = logoImg.scale(30 / logoImg.height);

  const N = d.total, C = d.correct, A = d.attempted, S = d.skipped, W = Math.max(0, A - C);
  const domains = d.domainStats;
  const nD = domains.length;
  const top3 = priorityDomains(domains);
  const strongest = domains.length
    ? [...domains].sort((a, b) => (b.total ? b.correct / b.total : 0) - (a.total ? a.correct / a.total : 0) || a.domain.localeCompare(b.domain))[0]
    : null;
  const rates = domains.map(x => (x.total ? x.correct / x.total : 0));
  const minRate = rates.length ? Math.min(...rates) : 0, maxRate = rates.length ? Math.max(...rates) : 0;
  const minDomain = domains.find(x => (x.total ? x.correct / x.total : 0) === minRate);
  const maxDomain = domains.find(x => (x.total ? x.correct / x.total : 0) === maxRate);
  const meanRate = rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;
  const variance = rates.length ? rates.reduce((s, r) => s + (r - meanRate) ** 2, 0) / rates.length : 0;
  const stdevPct = Math.sqrt(variance) * 100;
  const consistency = stdevPct < 12 ? t('Even', 'متقارب') : stdevPct < 24 ? t('Moderate spread', 'تفاوت متوسط') : t('Wide spread', 'تفاوت كبير');
  const consistencyNote = !domains.length
    ? t('No domain data is available to assess consistency in this run.', 'لا توجد بيانات مجالات كافية لتقييم الاتساق في هذه المحاولة.')
    : stdevPct < 12
      ? t('Domain rates stayed close together in this sample -- no domain stood far apart from the rest.', 'بقيت نسب المجالات متقاربة في هذه العينة، ولم يبتعد أي مجال كثيرا عن البقية.')
      : stdevPct < 24
        ? t('A handful of domains ran noticeably ahead of the others -- common for an early, unweighted practice run.', 'تقدمت بعض المجالات بشكل واضح على غيرها، وهذا شائع في محاولة تدريب مبكرة غير موزونة.')
        : t('Domain rates varied widely in this run. A spread this size is still within range for a short, unweighted practice sample, but it is worth a second attempt before drawing conclusions about any single domain.', 'تفاوتت نسب المجالات كثيرا في هذه المحاولة. هذا التفاوت ما زال مقبولا في عينة تدريب قصيرة غير موزونة، لكن الأفضل إجراء محاولة ثانية قبل الحكم على أي مجال منفرد.');

  function newPage() {
    const raw = pdf.addPage([PAGE_W, PAGE_H]);
    // Arabic pages are mirrored: the English left-aligned layout becomes right-aligned.
    const page: any = ar ? mirrorPage(raw, PAGE_W) : raw;
    page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: OMS.GOLD });
    return page;
  }
  function header(page: any, eyebrow: string) {
    page.drawImage(logoImg, { x: MARGIN, y: PAGE_H - 44, width: logoDims.width, height: logoDims.height });
    page.drawText(eyebrow, { x: MARGIN, y: PAGE_H - 62, size: 8.5, font: bold, color: OMS.GOLD_DARK });
  }
  function footer(page: any, pageLabel: string) {
    page.drawLine({ start: { x: MARGIN, y: 56 }, end: { x: PAGE_W - MARGIN, y: 56 }, thickness: 0.6, color: GRAY_LINE });
    page.drawText(t(`Run ${d.runId}`, `رقم المحاولة ${d.runId}`), { x: MARGIN, y: 42, size: 7.5, font, color: MUTED2 });
    const lbl = t(`qa-pdf-v4-design | ${pageLabel}`, `صفحة ${pageLabel}`);
    const w = font.widthOfTextAtSize(lbl, 7.5);
    page.drawText(lbl, { x: PAGE_W - MARGIN - w, y: 42, size: 7.5, font, color: MUTED2 });
  }
  function verificationSeal(page: any, cx: number, cy: number) {
    page.drawCircle({ x: cx, y: cy, size: 26, borderColor: TEAL, borderWidth: 1.4 });
    page.drawCircle({ x: cx, y: cy, size: 21, borderColor: TEAL, borderWidth: 0.6 });
    const k = ar ? -1 : 1; // keep the tick pointing the right way on mirrored Arabic pages
    page.drawLine({ start: { x: cx - 9 * k, y: cy + 1 }, end: { x: cx - 2 * k, y: cy - 6 }, thickness: 2, color: TEAL });
    page.drawLine({ start: { x: cx - 2 * k, y: cy - 6 }, end: { x: cx + 10 * k, y: cy + 10 }, thickness: 2, color: TEAL });
    const l1 = 'OMSAZE', l2 = 'MINDPROOF';
    page.drawText(l1, { x: cx - bold.widthOfTextAtSize(l1, 6.5) / 2, y: cy - 36, size: 6.5, font: bold, color: NAVY });
    page.drawText(l2, { x: cx - bold.widthOfTextAtSize(l2, 6.5) / 2, y: cy - 45, size: 6.5, font: bold, color: NAVY });
  }

  // ---------------- Page 1 — Overview ----------------
  {
    const page = newPage();
    header(page, t('PRACTICE INSIGHTS / OVERVIEW', 'نتائج التدريب / نظرة عامة'));
    verificationSeal(page, PAGE_W - MARGIN - 30, PAGE_H - 108);
    let y = PAGE_H - 110;
    page.drawText(t('Your practice profile', 'ملفك التدريبي'), { x: MARGIN, y, size: 24, font: display, color: NAVY });
    y -= 26;
    page.drawText(name, { x: MARGIN, y, size: 13, font: nameFont, color: NAVY });
    y -= 16;
    page.drawText(t(`Assessment: ${examName(d.examTag, 'en')}`, `الاختبار: ${examName(d.examTag, 'ar')}`), { x: MARGIN, y, size: 9.5, font: bold, color: NAVY });
    y -= 14;
    page.drawText(t(`Saved submission: ${fmtDate(d.submittedAt)}`, `تاريخ التسليم: ${fmtDate(d.submittedAt)}`), { x: MARGIN, y, size: 9.5, font, color: MUTED });
    y -= 30;

    const cardW = (PAGE_W - 2 * MARGIN - 3 * 10) / 4, cardH = 58;
    const cards: [string, string, string][] = [
      [t('DRAFT-KEY MATCHES', 'الإجابات الصحيحة'), `${C}/${N}`, t(`${pct1(C, N)}% of this sample`, `نسبة ${pct1(C, N)}% من العينة`)],
      [t('ATTEMPTED', 'الأسئلة المجابة'), `${A}/${N}`, t(`${pct1(A, N)}% response coverage`, `تغطية ${pct1(A, N)}% من الأسئلة`)],
      [t('PROPOSED DOMAINS', 'المجالات'), `${nD}`, t('Small samples; not normed', 'عينات صغيرة غير معيارية')],
      [t('CONSISTENCY', 'الاتساق'), consistency, t(`${stdevPct.toFixed(1)}pt spread`, `تفاوت ${stdevPct.toFixed(1)} نقطة`)],
    ];
    cards.forEach((c, i) => {
      const cx = MARGIN + i * (cardW + 10);
      page.drawRectangle({ x: cx, y: y - cardH, width: cardW, height: cardH, color: GRAY_BG });
      page.drawText(c[0], { x: cx + 10, y: y - 16, size: 6.5, font: bold, color: MUTED });
      page.drawText(c[1], { x: cx + 10, y: y - 34, size: 15.5, font: bold, color: NAVY });
      page.drawText(c[2], { x: cx + 10, y: y - 48, size: 7, font, color: MUTED });
    });
    y -= cardH + 28;

    page.drawText(t('How your responses were recorded', 'كيف سجلت إجاباتك'), { x: MARGIN, y, size: 12, font: bold, color: NAVY });
    y -= 18;
    const barW = PAGE_W - 2 * MARGIN, barH = 11;
    const wMatch = N ? (C / N) * barW : 0, wNon = N ? (W / N) * barW : 0, wSkip = N ? (S / N) * barW : 0;
    let bx = MARGIN;
    if (wMatch > 0) { page.drawRectangle({ x: bx, y: y - barH, width: wMatch, height: barH, color: TEAL }); bx += wMatch; }
    if (wNon > 0) { page.drawRectangle({ x: bx, y: y - barH, width: wNon, height: barH, color: CORAL }); bx += wNon; }
    if (wSkip > 0) { page.drawRectangle({ x: bx, y: y - barH, width: wSkip, height: barH, color: rgb(0.8, 0.82, 0.84) }); }
    y -= barH + 14;
    const legend: [string, any][] = [[t(`${C} key matches`, `صحيحة ${C}`), TEAL], [t(`${W} non-matches`, `غير صحيحة ${W}`), CORAL], [t(`${S} skipped`, `متروكة ${S}`), rgb(0.8, 0.82, 0.84)]];
    let lx = MARGIN;
    legend.forEach(([t, col]) => {
      page.drawRectangle({ x: lx, y: y - 7, width: 8, height: 8, color: col });
      page.drawText(t, { x: lx + 12, y: y - 7, size: 9, font, color: rgb(0.2, 0.235, 0.33) });
      lx += 12 + font.widthOfTextAtSize(t, 9) + 22;
    });
    y -= 30;

    page.drawText(t('What this sample suggests for practice', 'ماذا تقترح هذه العينة للتدريب'), { x: MARGIN, y, size: 12, font: bold, color: NAVY });
    y -= 18;
    let insight1: string;
    if (A === 0) {
      insight1 = t('Answered-item performance cannot be described: no saved selections were recorded in this run. Attempting reviewed items across domains would give this report something to describe.', 'لا يمكن وصف الأداء لأنه لم تسجل أي إجابات محفوظة في هذه المحاولة. حل أسئلة في مختلف المجالات سيعطي هذا التقرير ما يصفه.');
    } else if (C === N) {
      insight1 = t('All saved selections matched the stored draft keys in this sample. Use the practice plan for maintenance and transfer -- no lower-agreement domain was found in this run.', 'جميع الإجابات المحفوظة صحيحة في هذه العينة. استخدم خطة التدريب للمحافظة على المستوى، فلم يظهر مجال أضعف في هذه المحاولة.');
    } else {
      const first = top3[0];
      insight1 = t(`Start with ${DL[first.domain] ?? first.domain}: ${first.correct}/${first.total} draft-key matches were recorded. This is the first review priority under the report rules, not a diagnosis or a stable weakness.`, `ابدأ بمجال ${DL[first.domain] ?? first.domain}: سجلت فيه ${first.correct} إجابة صحيحة من ${first.total}. هذه أول أولوية للمراجعة حسب قواعد التقرير، وليست تشخيصا ولا نقطة ضعف ثابتة.`);
    }
    y = drawParagraph(page, insight1, MARGIN, y, PAGE_W - 2 * MARGIN, 10, font, BODY, 13) - 8;

    if (strongest && top3.length && strongest.domain !== top3[0].domain && A > 0 && C !== N) {
      const insight2 = t(`Your strongest result in this sample was ${DL[strongest.domain] ?? strongest.domain}: ${strongest.correct}/${strongest.total} matches (${pct1(strongest.correct, strongest.total)}%). Carrying that method into weaker domains is one way to use this run.`, `أقوى نتيجة لك في هذه العينة كانت في مجال ${DL[strongest.domain] ?? strongest.domain}: ${strongest.correct} صحيحة من ${strongest.total}، بنسبة ${pct1(strongest.correct, strongest.total)}%. نقل طريقة تفكيرك فيه إلى المجالات الأضعف طريقة جيدة للاستفادة من هذه المحاولة.`);
      y = drawParagraph(page, insight2, MARGIN, y, PAGE_W - 2 * MARGIN, 10, font, BODY, 13) - 8;
    }
    if (minDomain && maxDomain && minDomain.domain !== maxDomain.domain) {
      const insight3 = t(`Agreement rates ranged from ${pct1(minDomain.correct, minDomain.total)}% (${DL[minDomain.domain] ?? minDomain.domain}) to ${pct1(maxDomain.correct, maxDomain.total)}% (${DL[maxDomain.domain] ?? maxDomain.domain}) across domains in this sample.`, `تراوحت نسب الإجابات الصحيحة بين ${pct1(minDomain.correct, minDomain.total)}% في ${DL[minDomain.domain] ?? minDomain.domain} و ${pct1(maxDomain.correct, maxDomain.total)}% في ${DL[maxDomain.domain] ?? maxDomain.domain}.`);
      y = drawParagraph(page, insight3, MARGIN, y, PAGE_W - 2 * MARGIN, 10, font, BODY, 13) - 8;
    }
    if (W > 0 || S > 0) {
      const insight4 = t(`This run recorded ${W} non-matching answer${W === 1 ? '' : 's'} and ${S} skipped question${S === 1 ? '' : 's'}. A higher share of skips over non-matches often points to timing or an unfamiliar format; a higher share of non-matches often points to the reasoning method itself.`, `سجلت هذه المحاولة عدد ${W} من الإجابات غير الصحيحة و ${S} من الأسئلة المتروكة. كثرة الأسئلة المتروكة تشير غالبا إلى ضيق الوقت أو شكل سؤال غير مألوف، وكثرة الإجابات غير الصحيحة تشير غالبا إلى طريقة التفكير نفسها.`);
      y = drawParagraph(page, insight4, MARGIN, y, PAGE_W - 2 * MARGIN, 10, font, BODY, 13) - 10;
    }

    const boxH = 50;
    page.drawRectangle({ x: MARGIN, y: y - boxH, width: PAGE_W - 2 * MARGIN, height: boxH, color: rgb(0.933, 0.949, 0.949) });
    page.drawText(t('READ THE PROFILE IN CONTEXT', 'اقرأ النتائج في سياقها'), { x: MARGIN + 16, y: y - 18, size: 8, font: bold, color: NAVY });
    drawParagraph(page, t('This is a technical practice run with unapproved English draft questions. Raw key agreement is not an IQ score, percentile, pass/fail decision or validated measure of ability.', 'هذه محاولة تدريب تقنية بأسئلة تجريبية. عدد الإجابات الصحيحة ليس درجة ذكاء ولا ترتيبا مئينيا ولا قرار نجاح أو رسوب ولا مقياسا معتمدا للقدرات.'), MARGIN + 16, y - 32, PAGE_W - 2 * MARGIN - 32, 8.5, font, rgb(0.278, 0.325, 0.4), 11.5);
    footer(page, '1 / 7');
  }

  // ---------------- Page 2 — Domain performance map (radar) ----------------
  {
    const page = newPage();
    header(page, t('PRACTICE INSIGHTS / DOMAIN MAP', 'نتائج التدريب / خريطة المجالات'));
    let y = PAGE_H - 110;
    page.drawText(t('Your domain performance map', 'خريطة أدائك في المجالات'), { x: MARGIN, y, size: 24, font: display, color: NAVY });
    y -= 26;
    y = drawParagraph(page, t('Each spoke is one proposed domain; distance from the center is the share of draft-key matches recorded in that domain. The shape is a quick visual read, not a scored profile.', 'كل محور يمثل مجالا واحدا، والمسافة من المركز هي نسبة الإجابات الصحيحة في ذلك المجال. الشكل قراءة بصرية سريعة وليس ملفا مقيسا بدرجات.'), MARGIN, y, PAGE_W - 2 * MARGIN, 9.5, font, rgb(0.278, 0.325, 0.4), 13) - 10;

    if (nD >= 3) {
      const cx = PAGE_W / 2, cy = y - 190, maxR = 150;
      [0.25, 0.5, 0.75, 1.0].forEach(frac => {
        page.drawCircle({ x: cx, y: cy, size: maxR * frac, borderColor: GRAY_LINE, borderWidth: 0.7 });
      });
      const pts = domains.map((dm, i) => ({ ...polar(cx, cy, i * (360 / nD), maxR), angle: i * (360 / nD), dm }));
      pts.forEach(p => {
        page.drawLine({ start: { x: cx, y: cy }, end: { x: p.x, y: p.y }, thickness: 0.7, color: GRAY_LINE });
        const label = DL[p.dm.domain] ?? p.dm.domain;
        const lp = polar(cx, cy, p.angle, maxR + 18);
        const w = bold.widthOfTextAtSize(label, 8.5);
        let lx = lp.x - w / 2;
        if (p.angle > 70 && p.angle < 110) lx = lp.x - 2;
        if (p.angle > 250 && p.angle < 290) lx = lp.x - w + 2;
        page.drawText(label, { x: lx, y: lp.y - 3, size: 8.5, font: bold, color: NAVY });
      });
      const dataPts = domains.map((dm, i) => polar(cx, cy, i * (360 / nD), (dm.total ? dm.correct / dm.total : 0) * maxR));
      for (let i = 0; i < dataPts.length; i++) {
        page.drawLine({ start: dataPts[i], end: dataPts[(i + 1) % dataPts.length], thickness: 1.8, color: TEAL });
      }
      dataPts.forEach(p => page.drawCircle({ x: p.x, y: p.y, size: 3.2, color: TEAL }));
      y = cy - maxR - 46;
    } else {
      y -= 40;
      page.drawText(t('Not enough proposed domains were recorded in this run to draw a performance map.', 'لم تسجل مجالات كافية في هذه المحاولة لرسم خريطة الأداء.'), { x: MARGIN, y, size: 9.5, font, color: MUTED });
      y -= 30;
    }

    page.drawText(t('Consistency across domains: ', 'الاتساق بين المجالات: ') + consistency, { x: MARGIN, y, size: 11, font: bold, color: NAVY });
    y -= 16;
    drawParagraph(page, consistencyNote, MARGIN, y, PAGE_W - 2 * MARGIN, 9.5, font, BODY, 13);
    footer(page, '2 / 7');
  }

  // ---------------- Page 3 — Domain breakdown ----------------
  {
    const page = newPage();
    header(page, t('PRACTICE INSIGHTS / DOMAIN ANALYSIS', 'نتائج التدريب / تحليل المجالات'));
    let y = PAGE_H - 110;
    page.drawText(t('Your domain breakdown', 'تفاصيل أدائك في كل مجال'), { x: MARGIN, y, size: 24, font: display, color: NAVY });
    y -= 26;
    y = drawParagraph(page, t('Bars show draft-key matches divided by all questions assigned to each proposed domain, with a one-line read on what the band suggests for that domain specifically.', 'يوضح كل شريط نسبة الإجابات الصحيحة من كل أسئلة المجال، مع سطر واحد يشرح ما تعنيه هذه النسبة لذلك المجال.'), MARGIN, y, PAGE_W - 2 * MARGIN, 9.5, font, rgb(0.278, 0.325, 0.4), 13) - 14;

    domains.forEach((s) => {
      const b = band(s.correct, s.attempted, s.total, ar);
      const p = pct1(s.correct, s.total);
      const label = DL[s.domain] ?? s.domain;
      page.drawText(label, { x: MARGIN, y, size: 10.5, font: bold, color: NAVY });
      const statTxt = `${s.correct}/${s.total}  |  ${p}%`;
      const sw = bold.widthOfTextAtSize(statTxt, 10.5);
      page.drawText(statTxt, { x: PAGE_W - MARGIN - sw, y, size: 10.5, font: bold, color: b.text });
      y -= 12;
      const barW = PAGE_W - 2 * MARGIN, barH = 6;
      page.drawRectangle({ x: MARGIN, y: y - barH, width: barW, height: barH, color: GRAY_LINE });
      const fillW = s.total ? (s.correct / s.total) * barW : 0;
      if (fillW > 0) page.drawRectangle({ x: MARGIN, y: y - barH, width: fillW, height: barH, color: b.color });
      y -= barH + 10;
      page.drawText(t(`${s.attempted} attempted / ${s.skipped} skipped`, `مجابة ${s.attempted} / متروكة ${s.skipped}`), { x: MARGIN, y, size: 8, font, color: MUTED2 });
      const bandW = bold.widthOfTextAtSize(b.label, 8);
      page.drawText(b.label, { x: PAGE_W - MARGIN - bandW, y, size: 8, font: bold, color: b.text });
      y -= 13;
      y = drawParagraph(page, b.takeaway, MARGIN, y, PAGE_W - 2 * MARGIN, 8.5, font, rgb(0.278, 0.325, 0.4), 11) - 5;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: GRAY_LINE });
      y -= 11;
    });
    footer(page, '3 / 7');
  }

  // ---------------- Page 4 — Practice plan + methodology ----------------
  {
    const page = newPage();
    header(page, t('PRACTICE INSIGHTS / PRACTICE PLAN', 'نتائج التدريب / خطة التدريب'));
    let y = PAGE_H - 110;
    page.drawText(t('Turn results into practice', 'حول النتائج إلى تدريب'), { x: MARGIN, y, size: 24, font: display, color: NAVY });
    y -= 26;
    y = drawParagraph(page, t('Priorities are ordered by lowest exact domain key-agreement rate. Ties use the higher skipped share, then alphabetical domain ID.', 'رتبت الأولويات من أقل نسبة إجابات صحيحة في المجال، وعند التساوي حسب نسبة الأسئلة المتروكة الأعلى.'), MARGIN, y, PAGE_W - 2 * MARGIN, 9.5, font, rgb(0.278, 0.325, 0.4), 13) - 18;

    if (A === 0 || C === N) {
      page.drawText(t('No domain-level practice priorities apply to this run -- see the note on page 1.', 'لا توجد أولويات تدريب على مستوى المجالات لهذه المحاولة، راجع الملاحظة في الصفحة الأولى.'), { x: MARGIN, y, size: 9.5, font, color: MUTED });
      y -= 22;
    } else {
      top3.forEach((s, i) => {
        const w = Math.max(0, s.attempted - s.correct);
        const cardH = 74;
        page.drawRectangle({ x: MARGIN, y: y - cardH, width: PAGE_W - 2 * MARGIN, height: cardH, color: GRAY_BG });
        page.drawRectangle({ x: MARGIN, y: y - cardH, width: 4, height: cardH, color: CORAL });
        page.drawText(String(i + 1).padStart(2, '0'), { x: MARGIN + 18, y: y - 28, size: 18, font: bold, color: CORAL });
        const tx = MARGIN + 58;
        page.drawText(DL[s.domain] ?? s.domain, { x: tx, y: y - 16, size: 12, font: bold, color: NAVY });
        page.drawText(t(`${s.correct}/${s.total} matches | ${w} non-matches | ${s.skipped} skipped`, `صحيحة ${s.correct}/${s.total} | غير صحيحة ${w} | متروكة ${s.skipped}`), { x: tx, y: y - 29, size: 8, font, color: MUTED });
        drawParagraph(page, DT[s.domain] ?? t("Review this domain's items with a qualified reviewer.", 'راجع أسئلة هذا المجال مع مراجع مؤهل.'), tx, y - 42, PAGE_W - 2 * MARGIN - 70, 8.5, font, BODY, 11);
        page.drawText(t('Checkpoint: solve 3 reviewed parallel items and explain the reasoning.', 'نقطة تحقق: حل 3 أسئلة مشابهة واشرح طريقة تفكيرك.'), { x: tx, y: y - 64, size: 7.5, font, color: MUTED });
        y -= cardH + 10;
      });
    }

    y -= 6;
    const boxH = 102;
    page.drawRectangle({ x: MARGIN, y: y - boxH, width: PAGE_W - 2 * MARGIN, height: boxH, color: rgb(0.933, 0.949, 0.949) });
    page.drawText(t('HOW THIS REPORT IS BUILT', 'كيف أعد هذا التقرير'), { x: MARGIN + 16, y: y - 18, size: 8, font: bold, color: NAVY });
    drawParagraph(page, t('Domains are proposed, unvalidated groupings, not clinically normed subscales. Scoring counts exact matches against a draft answer key only -- there is no partial credit or time weighting. Priorities are ranked by lowest domain match rate, tie-broken by skip share, then domain ID. Color bands (teal / amber / coral / gray) describe the recorded rate only and carry no pass or fail meaning. This document and its data are generated per run and are not stored as a scored profile beyond this report.', 'المجالات تقسيمات مقترحة غير معتمدة، وليست مقاييس فرعية معيارية. يحسب التقييم الإجابات المطابقة لمفتاح الإجابة فقط، دون درجات جزئية أو وزن للوقت. ترتب الأولويات من أقل نسبة صحيحة في المجال، وعند التساوي حسب نسبة الأسئلة المتروكة. ألوان الأشرطة تصف النسبة المسجلة فقط ولا تعني نجاحا أو رسوبا. ينشأ هذا التقرير لكل محاولة ولا يحفظ كملف درجات بعده.'), MARGIN + 16, y - 32, PAGE_W - 2 * MARGIN - 32, 8.3, font, rgb(0.278, 0.325, 0.4), 11.5);
    y -= boxH + 14;

    page.drawText(t('How to use your next attempt', 'كيف تستفيد من محاولتك القادمة'), { x: MARGIN, y, size: 12, font: bold, color: NAVY });
    y -= 18;
    drawParagraph(page, t('Review the method first. Use new, reviewed questions rather than memorizing the same draft items. This run contains no response-time evidence, calibrated norms or validated IQ estimate.', 'راجع طريقة الحل أولا. تدرب على أسئلة جديدة بدلا من حفظ الأسئلة نفسها. لا تتضمن هذه المحاولة قياسا لزمن الإجابة ولا معايير مقننة ولا تقديرا معتمدا لنسبة الذكاء.'), MARGIN, y, PAGE_W - 2 * MARGIN, 9.5, font, BODY, 13);
    const sigY = MARGIN + 40;
    const fit = (img: any, maxW: number, maxH: number) => { const k = Math.min(maxW / img.width, maxH / img.height); return { width: img.width * k, height: img.height * k }; };
    const sigBlockW = 210;
    const rightX = PAGE_W - MARGIN - sigBlockW;
    const sig1 = ar ? B.signatureAr : B.signatureEn;
    if (sig1) { const dm = fit(sig1, 150, 50); page.drawImage(sig1, { x: MARGIN, y: sigY + 28, width: dm.width, height: dm.height }); }
    page.drawLine({ start: { x: MARGIN, y: sigY + 26 }, end: { x: MARGIN + sigBlockW, y: sigY + 26 }, thickness: 0.7, color: NAVY });
    page.drawText(t(SIGNER.name, 'محمد طاهر عشعش'), { x: MARGIN, y: sigY + 12, size: 10, font: bold, color: NAVY });
    page.drawText(t(SIGNER.title, SIGNER.titleAr), { x: MARGIN, y: sigY, size: 8.5, font, color: MUTED });
    page.drawLine({ start: { x: rightX, y: sigY + 26 }, end: { x: rightX + sigBlockW, y: sigY + 26 }, thickness: 0.7, color: NAVY });
    page.drawText('OMSAZE', { x: rightX, y: sigY + 12, size: 10, font: bold, color: NAVY });
    page.drawText('Digital Labs', { x: rightX, y: sigY, size: 8.5, font, color: MUTED });
    footer(page, '4 / 7');
  }


  // OMS-DEV-063: evidence-based development appendix; no changes to mail transport.
  const evidence = domains.filter(s => s.total >= 5 && s.attempted / s.total >= 0.6);
  const rate = (s: DomainStat) => s.correct / s.total;
  const ranked = [...evidence].sort((a,b) => rate(b)-rate(a) || a.domain.localeCompare(b.domain));
  const strengths = ranked.filter(s => rate(s) >= .75).slice(0,3);
  const gaps = [...ranked].reverse().filter(s => rate(s) < .75).slice(0,3);
  const limited = domains.filter(s => !evidence.includes(s));
  const label = (s: DomainStat) => (DL[s.domain] ?? t('Other assessed domain','مجال آخر مقاس')) + ' (' + s.correct + '/' + s.total + ')';
  const names = (ss: DomainStat[]) => ss.map(label).join(' | ');
  const exposure: Record<string,[string,string]> = {
    numerical: ['Compare budgets and spreadsheet calculations; check units and assumptions.','قارن الميزانيات وحسابات الجداول وتحقق من الوحدات والافتراضات.'],
    analytical: ['Map constraints in a business or study case and compare alternatives.','حدد قيود حالة دراسية أو عملية وقارن البدائل.'],
    visual: ['Interpret charts and process maps; explain the pattern with evidence.','فسر الرسوم وخرائط العمليات واشرح النمط بالأدلة.'],
    spatial: ['Practice diagrams, rotations and layout planning.','تدرب على المخططات والدوران وتخطيط المساحات.'],
    logical: ['Build decision trees and test conclusions with counterexamples.','ابن أشجار القرارات واختبر الاستنتاجات بأمثلة مضادة.'],
    linguistic: ['Summarize a briefing and distinguish claims from evidence.','لخص موجزا وميز بين الادعاءات والأدلة.'],
    creative: ['Compare alternative solutions to an unfamiliar practical problem.','قارن حلولا بديلة لمشكلة عملية غير مألوفة.'],
    critical: ['Compare sources and challenge assumptions in a short case.','قارن المصادر واختبر الافتراضات في حالة قصيرة.']
  };
  const practice = (s: DomainStat) => {const v = exposure[s.domain]; return v ? t(v[0],v[1]) : t('Review new items in this domain with a qualified reviewer.','راجع أسئلة جديدة في هذا المجال مع مراجع مؤهل.');};
  function insightPage(title: string, eyebrow: string, sections: [string,string][], number: number) {
    const page = newPage(); header(page, eyebrow);
    let y = PAGE_H-110;
    y = drawParagraph(page,title,MARGIN,y,PAGE_W-2*MARGIN,22,display,NAVY,27)-18;
    for (const [heading,body] of sections) {
      const lines = wrapText(body,PAGE_W-2*MARGIN,10.5,font);
      if(y - lines.length*15 < 80) throw new Error('development appendix layout overflow');
      y = drawParagraph(page,heading,MARGIN,y,PAGE_W-2*MARGIN,13,bold,NAVY,17)-5;
      y = drawParagraph(page,body,MARGIN,y,PAGE_W-2*MARGIN,10.5,font,BODY,15)-22;
    }
    footer(page, String(number)+' / 7');
  }
  insightPage(t('Personal SWOT profile','تحليل شخصي للقدرات'),t('DEVELOPMENT / EVIDENCE','التطوير / الأدلة'),[
    [t('Strengths in this attempt','نقاط القوة في هذه المحاولة'),strengths.length ? names(strengths) : t('No domain meets the provisional strength rule with sufficient responses.','لا يوجد مجال يستوفي قاعدة القوة الأولية مع إجابات كافية.')],
    [t('Development areas','مجالات التطوير'),gaps.length ? names(gaps) : t('No priority gap meets the current evidence rule.','لا توجد فجوة ذات أولوية وفقا لقاعدة الأدلة الحالية.')],
    [t('Opportunities to explore','فرص للاستكشاف'),strengths.length ? strengths.map(s=>practice(s)).join(' ') : t('Explore varied tasks before identifying potential strengths.','استكشف مهاما متنوعة قبل تحديد نقاط القوة المحتملة.')],
    [t('Potential challenges','التحديات المحتملة'),limited.length ? t('Limited response evidence: ','أدلة إجابة محدودة: ')+names(limited.slice(0,4)) : t('Unfamiliar formats, time pressure or language may influence performance; these were not independently measured.','قد تؤثر الصيغ غير المألوفة أو ضغط الوقت أو اللغة في الأداء ولم تقاس بصورة مستقلة.')],
    [t('Interpretation limits','حدود التفسير'),t('Rules are provisional: at least five items and 60% attempted; 75% correct marks a sample strength. These are not validated ability or population norms.','القواعد أولية: خمسة أسئلة على الأقل ومحاولة 60% منها، ونسبة 75% صحيحة مؤشر قوة في العينة وليست معيارا مقننا.')]
  ],5);
  insightPage(t('Talent and career exploration','استكشاف المواهب والمسار المهني'),t('DEVELOPMENT / EXPOSURE','التطوير / الخبرة العملية'),[
    [t('Potential talent indicators','مؤشرات المواهب المحتملة'),strengths.length ? t('Explore practical tasks supported by these measured domains: ','استكشف مهاما عملية تدعمها المجالات المقاسة التالية: ')+names(strengths) : t('There is insufficient evidence to identify a strength-based talent indicator.','لا توجد أدلة كافية لتحديد مؤشر موهبة قائم على نقاط القوة.')],
    [t('Practical applications','التطبيقات العملية'),(strengths.length?strengths:gaps).map(s=>label(s)+': '+practice(s)).join(' ') || t('Try a range of supervised learning tasks.','جرب مجموعة من المهام التعليمية تحت الإشراف.')],
    [t('Recommended exposure','الخبرات المقترحة'),gaps.map(s=>label(s)+': '+practice(s)).join(' ') || t('Maintain practice with new tasks and seek feedback.','واصل التدريب على مهام جديدة واطلب التغذية الراجعة.')],
    [t('Career interpretation','التفسير المهني'),t('Use these examples to explore academic or workplace activities appropriate to your experience. Interests, qualifications, motivation and interpersonal skills need separate evidence. Do not use this report for hiring or exclusion decisions.','استخدم الأمثلة لاستكشاف أنشطة دراسية أو مهنية تناسب خبرتك. تتطلب الميول والمؤهلات والدافعية والمهارات الشخصية أدلة مستقلة. لا يستخدم التقرير لاتخاذ قرارات التوظيف أو الاستبعاد.')]
  ],6);
  insightPage(t('30-60-90 day action plan','خطة تطوير لمدة 90 يوما'),t('DEVELOPMENT / ACTION','التطوير / العمل'),[
    [t('Days 1-30 | Foundation','الأيام 1-30 | الأساس'),t('Establish a baseline using new reviewed tasks. Schedule three short practice sessions weekly. ','حدد خط أساس بمهام جديدة مراجعة وحدد ثلاث جلسات تدريب قصيرة أسبوعيا. ')+(gaps.length?names(gaps.slice(0,2)):t('Explore all measured domains.','استكشف جميع المجالات المقاسة.'))],
    [t('Days 31-60 | Application','الأيام 31-60 | التطبيق'),(gaps.length?gaps.slice(0,2).map(practice).join(' '):t('Complete a practical case and explain the reasoning to a mentor.','أنجز حالة عملية واشرح التفكير لمرشد.'))],
    [t('Days 61-90 | Consolidation','الأيام 61-90 | التثبيت'),t('Complete a new comparable practice assessment. Compare correct, attempted and skipped counts, and document one practical example of progress.','أكمل تقييما تدريبيا جديدا قابلا للمقارنة وقارن عدد الإجابات الصحيحة والمحاولات والأسئلة المتروكة ووثق مثالا عمليا للتقدم.')],
    [t('Review with a mentor','المراجعة مع مرشد'),t('Review progress every two weeks. Adjust learning goals based on work samples and feedback, not this score alone.','راجع التقدم كل أسبوعين وعدل أهداف التعلم بناء على نماذج العمل والتغذية الراجعة وليس الدرجة وحدها.')]
  ],7);

  return pdf.save();
}

function reportSummaryHtml(d: ReportMail): string {
  const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const sigs = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:2px solid #D7B56D;padding-top:12px"><tr>
    <td style="padding-right:24px;vertical-align:bottom"><img src="https://staging.omsaze.com/assets/signature-en.png" alt="Mohamed Taher Eshesh, Founder &amp; CEO - OMSAZE" width="170" style="display:block;max-width:170px;height:auto"><div style="font-size:12px;color:#102D46;font-weight:bold;margin-top:4px">Mohamed Taher Eshesh</div><div style="font-size:11px;color:#5B6B7B">Founder &amp; CEO - OMSAZE</div></td>
    <td style="vertical-align:bottom"><img src="https://staging.omsaze.com/assets/signature-ar.png" alt="المؤسس والرئيس التنفيذي - OMSAZE" width="120" style="display:block;max-width:120px;height:auto"></td>
  </tr></table>`;
  if (d.lang === 'ar') {
    return `<div dir="rtl" lang="ar" style="font-family:Tahoma,Arial,sans-serif;color:#1D2939;max-width:560px;text-align:right">
  <p>مرحبا ${esc(d.name)}،</p>
  <p>شكرا لإتمامك اختبار التدريب من OMSAZE: <b>${esc(examName(d.examTag, 'ar'))}</b>. عدد إجاباتك الصحيحة: <b dir="ltr">${esc(d.correct)} / ${esc(d.total)}</b>.</p>
  <p>تجد مرفقا بهذه الرسالة ملفين PDF: تقرير التدريب الكامل، ويشمل النظرة العامة وخريطة الأداء وتفاصيل المجالات وخطة التدريب، وشهادة الإتمام.</p>
  <p style="color:#667085;font-size:12px">هذه محاولة تدريب تقنية ببنك أسئلة تجريبي. ليست اختبار ذكاء معتمدا ولا ترتيبا مئينيا ولا قرار نجاح أو رسوب ولا شهادة معتمدة.</p>
  <div dir="ltr">${sigs}</div>
  </div>`;
  }
  return `<div style="font-family:Arial,sans-serif;color:#1D2939;max-width:560px">
  <p>Hi ${esc(d.name)},</p>
  <p>Thanks for completing the OMSAZE practice test: <b>${esc(examName(d.examTag, 'en'))}</b>. Your saved draft-key agreement: <b>${esc(d.correct)} / ${esc(d.total)}</b>.</p>
  <p>Your full practice report (profile overview, domain performance map, domain breakdown and practice plan) and your completion certificate are both attached to this email as PDF files.</p>
  <p style="color:#667085;font-size:12px">This is a technical practice run with an unapproved draft question bank. It is not a validated IQ assessment, percentile, pass/fail decision, or accredited credential.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:2px solid #D7B56D;padding-top:12px"><tr>
    <td style="padding-right:24px;vertical-align:bottom"><img src="https://staging.omsaze.com/assets/signature-en.png" alt="Mohamed Taher Eshesh, Founder &amp; CEO - OMSAZE" width="170" style="display:block;max-width:170px;height:auto"><div style="font-size:12px;color:#102D46;font-weight:bold;margin-top:4px">Mohamed Taher Eshesh</div><div style="font-size:11px;color:#5B6B7B">Founder &amp; CEO - OMSAZE</div></td>
    <td style="vertical-align:bottom"><img src="https://staging.omsaze.com/assets/signature-ar.png" alt="المؤسس والرئيس التنفيذي - OMSAZE" width="120" style="display:block;max-width:120px;height:auto"></td>
  </tr></table>
  </div>`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function gmailSend(subject: string, html: string, recipient: string, certBytes: Uint8Array, reportBytes: Uint8Array, reportFilename: string, certFilename: string, messageIdSeed: string): Promise<boolean> {
  const user = normalizeEmail(Deno.env.get('OMSAZE_GMAIL_SENDER'));
  if (user !== 'mohamedtahereshesh@gmail.com') throw new Error('Staging Gmail sender mismatch');
  const pass = (Deno.env.get('OMSAZE_GMAIL_APP_PASSWORD') ?? '').replace(/\s/g, '');
  if (!/^[a-zA-Z0-9]{16}$/.test(pass)) throw new Error('Gmail app password is not configured');
  const nodemailer = (await import('npm:nodemailer@10.5.0')).default;
  const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true } });
  try {
    const result = await transport.sendMail({
      from: { name: 'OMSAZE', address: user }, to: recipient, subject, html,
      attachments: [
        { filename: reportFilename, content: Buffer.from(reportBytes), contentType: 'application/pdf' },
        { filename: certFilename, content: Buffer.from(certBytes), contentType: 'application/pdf' },
      ],
      messageId: '<omsaze-report-' + messageIdSeed.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 160) + '@gmail.com>',
    });
    return Array.isArray(result.accepted) && result.accepted.some((v: unknown) => typeof v === 'string' && v.toLowerCase() === recipient);
  } finally { transport.close(); }
}

async function resendSend(subject: string, html: string, recipient: string, certBytes: Uint8Array, reportBytes: Uint8Array, reportFilename: string, certFilename: string, idempotencyKey: string): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('OMSAZE_VERIFICATION_FROM');
  if (!key || !from) throw new Error('Report sender is not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json', 'idempotency-key': 'omsaze-report-' + idempotencyKey },
    body: JSON.stringify({
      from, to: [recipient], subject, html, attachments: [
        { filename: reportFilename, content: toBase64(reportBytes) },
        { filename: certFilename, content: toBase64(certBytes) },
      ]
    }),
    signal: AbortSignal.timeout(12000),
  });
  return response.ok;
}

export async function deliverReportMail(d: ReportMail): Promise<void> {
  requireStaging();
  const recipient = normalizeEmail(d.email);
  const subject = d.lang === 'ar' ? `OMSAZE — تقرير التدريب وشهادة الإتمام — ${examName(d.examTag, 'ar')}` : `OMSAZE — Your ${examName(d.examTag, 'en')} report and certificate`;
  const html = reportSummaryHtml(d);
  const reportBytes = await reportPdfBytes(d);
  const stamp = isoDateUtc();
  const safe = safeFileName(d.name);
  const reportFilename = `OMSAZE-${safe}-${stamp}-Report.pdf`;
  const certFilename = `OMSAZE-${safe}-${stamp}-Certificate.pdf`;
  let sent = false;
  if (Deno.env.get('OMSAZE_VERIFICATION_PROVIDER') === 'gmail') {
    sent = await gmailSend(subject, html, recipient, d.certificateBytes, reportBytes, reportFilename, certFilename, recipient + '-' + Date.now());
  } else if (Deno.env.get('OMSAZE_VERIFICATION_PROVIDER') === 'resend') {
    sent = await resendSend(subject, html, recipient, d.certificateBytes, reportBytes, reportFilename, certFilename, recipient + '-' + Date.now());
  } else {
    throw new Error('Report mail provider is not configured');
  }
  if (!sent) throw new Error('Report email was not accepted by the mail provider');
}

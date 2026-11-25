import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { Buffer } from 'node:buffer';
import { requireStaging } from './staging-db.ts';
import { normalizeEmail } from './email-verification.ts';
import { safeFileName, isoDateUtc, winAnsiSafe } from './brand.ts';
import { loadBrand, OMS, SIGNER } from './omsaze-pdf-brand.ts';

export type DomainStat = { domain: string; correct: number; attempted: number; skipped: number; total: number };

const DOMAIN_LABEL: Record<string, string> = {
  numerical: 'Numerical', analytical: 'Analytical', visual: 'Visual', spatial: 'Spatial',
  logical: 'Logical', linguistic: 'Linguistic', creative: 'Creative problem solving',
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

function band(correct: number, attempted: number, total: number) {
  if (attempted === 0) return { label: 'No response evidence', color: rgb(0.8, 0.82, 0.84), text: rgb(0.4, 0.44, 0.48), takeaway: 'No attempts recorded here yet -- reviewed items in this domain would give this report something to read.' };
  const pct = total > 0 ? (correct / total) * 100 : 0;
  if (pct >= 75) return { label: 'Higher key agreement', color: rgb(0, 0.651, 0.651), text: rgb(0.055, 0.5, 0.455), takeaway: 'Already a strength in this sample -- occasional review keeps it sharp.' };
  if (pct >= 40) return { label: 'Mixed key agreement', color: rgb(0.78, 0.54, 0.09), text: rgb(0.706, 0.325, 0.035), takeaway: 'On track -- a few more reviewed items here would sharpen this further.' };
  return { label: 'Review recommended', color: rgb(0.753, 0.314, 0.302), text: rgb(0.706, 0.137, 0.094), takeaway: 'Priority for focused review -- revisit the method itself, not just more attempts.' };
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
  const pdf = await PDFDocument.create();
  const name = winAnsiSafe(d.name);
  pdf.setTitle(`OMSAZE Practice Report - ${name}`);
  const B = await loadBrand(pdf);
  const font = B.font;
  const bold = B.bold;
  const display = B.display;
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
  const consistency = stdevPct < 12 ? 'Even' : stdevPct < 24 ? 'Moderate spread' : 'Wide spread';
  const consistencyNote = !domains.length
    ? 'No domain data is available to assess consistency in this run.'
    : stdevPct < 12
      ? 'Domain rates stayed close together in this sample -- no domain stood far apart from the rest.'
      : stdevPct < 24
        ? 'A handful of domains ran noticeably ahead of the others -- common for an early, unweighted practice run.'
        : 'Domain rates varied widely in this run. A spread this size is still within range for a short, unweighted practice sample, but it is worth a second attempt before drawing conclusions about any single domain.';

  function newPage() {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: OMS.GOLD });
    return page;
  }
  function header(page: any, eyebrow: string) {
    page.drawImage(logoImg, { x: MARGIN, y: PAGE_H - 44, width: logoDims.width, height: logoDims.height });
    page.drawText(eyebrow, { x: MARGIN, y: PAGE_H - 62, size: 8.5, font: bold, color: OMS.GOLD_DARK });
    const testOnly = 'TEST ONLY';
    const w = bold.widthOfTextAtSize(testOnly, 9);
    page.drawText(testOnly, { x: PAGE_W - MARGIN - w, y: PAGE_H - 50, size: 9, font: bold, color: rgb(0.278, 0.325, 0.4) });
  }
  function footer(page: any, pageLabel: string) {
    page.drawLine({ start: { x: MARGIN, y: 56 }, end: { x: PAGE_W - MARGIN, y: 56 }, thickness: 0.6, color: GRAY_LINE });
    page.drawText(`Run ${d.runId}`, { x: MARGIN, y: 42, size: 7.5, font, color: MUTED2 });
    const lbl = `qa-pdf-v4-design | ${pageLabel}`;
    const w = font.widthOfTextAtSize(lbl, 7.5);
    page.drawText(lbl, { x: PAGE_W - MARGIN - w, y: 42, size: 7.5, font, color: MUTED2 });
  }
  function verificationSeal(page: any, cx: number, cy: number) {
    page.drawCircle({ x: cx, y: cy, size: 26, borderColor: TEAL, borderWidth: 1.4 });
    page.drawCircle({ x: cx, y: cy, size: 21, borderColor: TEAL, borderWidth: 0.6 });
    page.drawLine({ start: { x: cx - 9, y: cy + 1 }, end: { x: cx - 2, y: cy - 6 }, thickness: 2, color: TEAL });
    page.drawLine({ start: { x: cx - 2, y: cy - 6 }, end: { x: cx + 10, y: cy + 10 }, thickness: 2, color: TEAL });
    const l1 = 'OMSAZE', l2 = 'VERIFIED';
    page.drawText(l1, { x: cx - bold.widthOfTextAtSize(l1, 6.5) / 2, y: cy - 36, size: 6.5, font: bold, color: NAVY });
    page.drawText(l2, { x: cx - bold.widthOfTextAtSize(l2, 6.5) / 2, y: cy - 45, size: 6.5, font: bold, color: NAVY });
  }

  // ---------------- Page 1 — Overview ----------------
  {
    const page = newPage();
    header(page, 'PRACTICE INSIGHTS / OVERVIEW');
    verificationSeal(page, PAGE_W - MARGIN - 30, PAGE_H - 108);
    let y = PAGE_H - 110;
    page.drawText('Your practice profile', { x: MARGIN, y, size: 24, font: display, color: NAVY });
    y -= 26;
    page.drawText(name, { x: MARGIN, y, size: 13, font: bold, color: NAVY });
    y -= 16;
    page.drawText(`Saved submission: ${fmtDate(d.submittedAt)}`, { x: MARGIN, y, size: 9.5, font, color: MUTED });
    y -= 30;

    const cardW = (PAGE_W - 2 * MARGIN - 3 * 10) / 4, cardH = 58;
    const cards: [string, string, string][] = [
      ['DRAFT-KEY MATCHES', `${C}/${N}`, `${pct1(C, N)}% of this sample`],
      ['ATTEMPTED', `${A}/${N}`, `${pct1(A, N)}% response coverage`],
      ['PROPOSED DOMAINS', `${nD}`, 'Small samples; not normed'],
      ['CONSISTENCY', consistency, `${stdevPct.toFixed(1)}pt spread`],
    ];
    cards.forEach((c, i) => {
      const cx = MARGIN + i * (cardW + 10);
      page.drawRectangle({ x: cx, y: y - cardH, width: cardW, height: cardH, color: GRAY_BG });
      page.drawText(c[0], { x: cx + 10, y: y - 16, size: 6.5, font: bold, color: MUTED });
      page.drawText(c[1], { x: cx + 10, y: y - 34, size: 15.5, font: bold, color: NAVY });
      page.drawText(c[2], { x: cx + 10, y: y - 48, size: 7, font, color: MUTED });
    });
    y -= cardH + 28;

    page.drawText('How your responses were recorded', { x: MARGIN, y, size: 12, font: bold, color: NAVY });
    y -= 18;
    const barW = PAGE_W - 2 * MARGIN, barH = 11;
    const wMatch = N ? (C / N) * barW : 0, wNon = N ? (W / N) * barW : 0, wSkip = N ? (S / N) * barW : 0;
    let bx = MARGIN;
    if (wMatch > 0) { page.drawRectangle({ x: bx, y: y - barH, width: wMatch, height: barH, color: TEAL }); bx += wMatch; }
    if (wNon > 0) { page.drawRectangle({ x: bx, y: y - barH, width: wNon, height: barH, color: CORAL }); bx += wNon; }
    if (wSkip > 0) { page.drawRectangle({ x: bx, y: y - barH, width: wSkip, height: barH, color: rgb(0.8, 0.82, 0.84) }); }
    y -= barH + 14;
    const legend: [string, any][] = [[`${C} key matches`, TEAL], [`${W} non-matches`, CORAL], [`${S} skipped`, rgb(0.8, 0.82, 0.84)]];
    let lx = MARGIN;
    legend.forEach(([t, col]) => {
      page.drawRectangle({ x: lx, y: y - 7, width: 8, height: 8, color: col });
      page.drawText(t, { x: lx + 12, y: y - 7, size: 9, font, color: rgb(0.2, 0.235, 0.33) });
      lx += 12 + font.widthOfTextAtSize(t, 9) + 22;
    });
    y -= 30;

    page.drawText('What this sample suggests for practice', { x: MARGIN, y, size: 12, font: bold, color: NAVY });
    y -= 18;
    let insight1: string;
    if (A === 0) {
      insight1 = 'Answered-item performance cannot be described: no saved selections were recorded in this run. Attempting reviewed items across domains would give this report something to describe.';
    } else if (C === N) {
      insight1 = 'All saved selections matched the stored draft keys in this sample. Use the practice plan for maintenance and transfer -- no lower-agreement domain was found in this run.';
    } else {
      const first = top3[0];
      insight1 = `Start with ${DOMAIN_LABEL[first.domain] ?? first.domain}: ${first.correct}/${first.total} draft-key matches were recorded. This is the first review priority under the report rules, not a diagnosis or a stable weakness.`;
    }
    y = drawParagraph(page, insight1, MARGIN, y, PAGE_W - 2 * MARGIN, 10, font, BODY, 13) - 8;

    if (strongest && top3.length && strongest.domain !== top3[0].domain && A > 0 && C !== N) {
      const insight2 = `Your strongest result in this sample was ${DOMAIN_LABEL[strongest.domain] ?? strongest.domain}: ${strongest.correct}/${strongest.total} matches (${pct1(strongest.correct, strongest.total)}%). Carrying that method into weaker domains is one way to use this run.`;
      y = drawParagraph(page, insight2, MARGIN, y, PAGE_W - 2 * MARGIN, 10, font, BODY, 13) - 8;
    }
    if (minDomain && maxDomain && minDomain.domain !== maxDomain.domain) {
      const insight3 = `Agreement rates ranged from ${pct1(minDomain.correct, minDomain.total)}% (${DOMAIN_LABEL[minDomain.domain] ?? minDomain.domain}) to ${pct1(maxDomain.correct, maxDomain.total)}% (${DOMAIN_LABEL[maxDomain.domain] ?? maxDomain.domain}) across domains in this sample.`;
      y = drawParagraph(page, insight3, MARGIN, y, PAGE_W - 2 * MARGIN, 10, font, BODY, 13) - 8;
    }
    if (W > 0 || S > 0) {
      const insight4 = `This run recorded ${W} non-matching answer${W === 1 ? '' : 's'} and ${S} skipped question${S === 1 ? '' : 's'}. A higher share of skips over non-matches often points to timing or an unfamiliar format; a higher share of non-matches often points to the reasoning method itself.`;
      y = drawParagraph(page, insight4, MARGIN, y, PAGE_W - 2 * MARGIN, 10, font, BODY, 13) - 10;
    }

    const boxH = 50;
    page.drawRectangle({ x: MARGIN, y: y - boxH, width: PAGE_W - 2 * MARGIN, height: boxH, color: rgb(0.933, 0.949, 0.949) });
    page.drawText('READ THE PROFILE IN CONTEXT', { x: MARGIN + 16, y: y - 18, size: 8, font: bold, color: NAVY });
    drawParagraph(page, 'This is a technical practice run with unapproved English draft questions. Raw key agreement is not an IQ score, percentile, pass/fail decision or validated measure of ability.', MARGIN + 16, y - 32, PAGE_W - 2 * MARGIN - 32, 8.5, font, rgb(0.278, 0.325, 0.4), 11.5);
    footer(page, '1 / 4');
  }

  // ---------------- Page 2 — Domain performance map (radar) ----------------
  {
    const page = newPage();
    header(page, 'PRACTICE INSIGHTS / DOMAIN MAP');
    let y = PAGE_H - 110;
    page.drawText('Your domain performance map', { x: MARGIN, y, size: 24, font: display, color: NAVY });
    y -= 26;
    y = drawParagraph(page, 'Each spoke is one proposed domain; distance from the center is the share of draft-key matches recorded in that domain. The shape is a quick visual read, not a scored profile.', MARGIN, y, PAGE_W - 2 * MARGIN, 9.5, font, rgb(0.278, 0.325, 0.4), 13) - 10;

    if (nD >= 3) {
      const cx = PAGE_W / 2, cy = y - 190, maxR = 150;
      [0.25, 0.5, 0.75, 1.0].forEach(frac => {
        page.drawCircle({ x: cx, y: cy, size: maxR * frac, borderColor: GRAY_LINE, borderWidth: 0.7 });
      });
      const pts = domains.map((dm, i) => ({ ...polar(cx, cy, i * (360 / nD), maxR), angle: i * (360 / nD), dm }));
      pts.forEach(p => {
        page.drawLine({ start: { x: cx, y: cy }, end: { x: p.x, y: p.y }, thickness: 0.7, color: GRAY_LINE });
        const label = DOMAIN_LABEL[p.dm.domain] ?? p.dm.domain;
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
      page.drawText('Not enough proposed domains were recorded in this run to draw a performance map.', { x: MARGIN, y, size: 9.5, font, color: MUTED });
      y -= 30;
    }

    page.drawText('Consistency across domains: ' + consistency, { x: MARGIN, y, size: 11, font: bold, color: NAVY });
    y -= 16;
    drawParagraph(page, consistencyNote, MARGIN, y, PAGE_W - 2 * MARGIN, 9.5, font, BODY, 13);
    footer(page, '2 / 4');
  }

  // ---------------- Page 3 — Domain breakdown ----------------
  {
    const page = newPage();
    header(page, 'PRACTICE INSIGHTS / DOMAIN ANALYSIS');
    let y = PAGE_H - 110;
    page.drawText('Your domain breakdown', { x: MARGIN, y, size: 24, font: display, color: NAVY });
    y -= 26;
    y = drawParagraph(page, 'Bars show draft-key matches divided by all questions assigned to each proposed domain, with a one-line read on what the band suggests for that domain specifically.', MARGIN, y, PAGE_W - 2 * MARGIN, 9.5, font, rgb(0.278, 0.325, 0.4), 13) - 14;

    domains.forEach((s) => {
      const b = band(s.correct, s.attempted, s.total);
      const p = pct1(s.correct, s.total);
      const label = DOMAIN_LABEL[s.domain] ?? s.domain;
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
      page.drawText(`${s.attempted} attempted / ${s.skipped} skipped`, { x: MARGIN, y, size: 8, font, color: MUTED2 });
      const bandW = bold.widthOfTextAtSize(b.label, 8);
      page.drawText(b.label, { x: PAGE_W - MARGIN - bandW, y, size: 8, font: bold, color: b.text });
      y -= 13;
      y = drawParagraph(page, b.takeaway, MARGIN, y, PAGE_W - 2 * MARGIN, 8.5, font, rgb(0.278, 0.325, 0.4), 11) - 5;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: GRAY_LINE });
      y -= 11;
    });
    footer(page, '3 / 4');
  }

  // ---------------- Page 4 — Practice plan + methodology ----------------
  {
    const page = newPage();
    header(page, 'PRACTICE INSIGHTS / PRACTICE PLAN');
    let y = PAGE_H - 110;
    page.drawText('Turn results into practice', { x: MARGIN, y, size: 24, font: display, color: NAVY });
    y -= 26;
    y = drawParagraph(page, 'Priorities are ordered by lowest exact domain key-agreement rate. Ties use the higher skipped share, then alphabetical domain ID.', MARGIN, y, PAGE_W - 2 * MARGIN, 9.5, font, rgb(0.278, 0.325, 0.4), 13) - 18;

    if (A === 0 || C === N) {
      page.drawText('No domain-level practice priorities apply to this run -- see the note on page 1.', { x: MARGIN, y, size: 9.5, font, color: MUTED });
      y -= 22;
    } else {
      top3.forEach((s, i) => {
        const w = Math.max(0, s.attempted - s.correct);
        const cardH = 74;
        page.drawRectangle({ x: MARGIN, y: y - cardH, width: PAGE_W - 2 * MARGIN, height: cardH, color: GRAY_BG });
        page.drawRectangle({ x: MARGIN, y: y - cardH, width: 4, height: cardH, color: CORAL });
        page.drawText(String(i + 1).padStart(2, '0'), { x: MARGIN + 18, y: y - 28, size: 18, font: bold, color: CORAL });
        const tx = MARGIN + 58;
        page.drawText(DOMAIN_LABEL[s.domain] ?? s.domain, { x: tx, y: y - 16, size: 12, font: bold, color: NAVY });
        page.drawText(`${s.correct}/${s.total} matches | ${w} non-matches | ${s.skipped} skipped`, { x: tx, y: y - 29, size: 8, font, color: MUTED });
        drawParagraph(page, DOMAIN_TECHNIQUE[s.domain] ?? "Review this domain's items with a qualified reviewer.", tx, y - 42, PAGE_W - 2 * MARGIN - 70, 8.5, font, BODY, 11);
        page.drawText('Checkpoint: solve 3 reviewed parallel items and explain the reasoning.', { x: tx, y: y - 64, size: 7.5, font, color: MUTED });
        y -= cardH + 10;
      });
    }

    y -= 6;
    const boxH = 102;
    page.drawRectangle({ x: MARGIN, y: y - boxH, width: PAGE_W - 2 * MARGIN, height: boxH, color: rgb(0.933, 0.949, 0.949) });
    page.drawText('HOW THIS REPORT IS BUILT', { x: MARGIN + 16, y: y - 18, size: 8, font: bold, color: NAVY });
    drawParagraph(page, 'Domains are proposed, unvalidated groupings, not clinically normed subscales. Scoring counts exact matches against a draft answer key only -- there is no partial credit or time weighting. Priorities are ranked by lowest domain match rate, tie-broken by skip share, then domain ID. Color bands (teal / amber / coral / gray) describe the recorded rate only and carry no pass or fail meaning. This document and its data are generated per run and are not stored as a scored profile beyond this report.', MARGIN + 16, y - 32, PAGE_W - 2 * MARGIN - 32, 8.3, font, rgb(0.278, 0.325, 0.4), 11.5);
    y -= boxH + 14;

    page.drawText('How to use your next attempt', { x: MARGIN, y, size: 12, font: bold, color: NAVY });
    y -= 18;
    drawParagraph(page, 'Review the method first. Use new, reviewed questions rather than memorizing the same draft items. This run contains no response-time evidence, calibrated norms or validated IQ estimate.', MARGIN, y, PAGE_W - 2 * MARGIN, 9.5, font, BODY, 13);
    const sigY = MARGIN + 40;
    const fit = (img: any, maxW: number, maxH: number) => { const k = Math.min(maxW / img.width, maxH / img.height); return { width: img.width * k, height: img.height * k }; };
    const sigBlockW = 210;
    const rightX = PAGE_W - MARGIN - sigBlockW;
    if (B.signatureEn) { const dm = fit(B.signatureEn, 150, 50); page.drawImage(B.signatureEn, { x: MARGIN, y: sigY + 28, width: dm.width, height: dm.height }); }
    page.drawLine({ start: { x: MARGIN, y: sigY + 26 }, end: { x: MARGIN + sigBlockW, y: sigY + 26 }, thickness: 0.7, color: NAVY });
    page.drawText(SIGNER.name, { x: MARGIN, y: sigY + 12, size: 10, font: bold, color: NAVY });
    page.drawText(SIGNER.title, { x: MARGIN, y: sigY, size: 8.5, font, color: MUTED });
    if (B.signatureAr) { const dm = fit(B.signatureAr, 130, 50); page.drawImage(B.signatureAr, { x: rightX + sigBlockW - dm.width, y: sigY + 28, width: dm.width, height: dm.height }); }
    page.drawLine({ start: { x: rightX, y: sigY + 26 }, end: { x: rightX + sigBlockW, y: sigY + 26 }, thickness: 0.7, color: NAVY });
    page.drawText('OMSAZE', { x: rightX, y: sigY + 12, size: 10, font: bold, color: NAVY });
    page.drawText('Digital Labs', { x: rightX, y: sigY, size: 8.5, font, color: MUTED });
    footer(page, '4 / 4');
  }

  return pdf.save();
}

function reportSummaryHtml(d: ReportMail): string {
  const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  return `<div style="font-family:Arial,sans-serif;color:#1D2939;max-width:560px">
  <p>Hi ${esc(d.name)},</p>
  <p>Thanks for completing the OMSAZE practice test. Your saved draft-key agreement: <b>${esc(d.correct)} / ${esc(d.total)}</b>.</p>
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
  const subject = 'OMSAZE — Your practice report and certificate';
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

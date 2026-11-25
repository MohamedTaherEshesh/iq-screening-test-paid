// OMSAZE development candidate: print-ready completion record, not a validated IQ credential.
// A4 landscape, rebranded to OMSAZE identity: Next Rise logo, navy and gold, Manrope + Source Sans 3,
// with the owner's bilingual signatures (English and Arabic).
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { winAnsiSafe } from './brand.ts';
import { loadBrand, OMS, SIGNER } from './omsaze-pdf-brand.ts';

export type CertData = { name: string; date: string; correct: number; total: number; pctl: number; iq: number };

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

function fitBox(img: any, maxW: number, maxH: number) {
  const s = Math.min(maxW / img.width, maxH / img.height);
  return { width: img.width * s, height: img.height * s };
}

export async function certificatePdfBytes(d: CertData): Promise<Uint8Array> {
  if (!d || typeof d.name !== 'string' || d.name.trim().length < 2 || d.name.length > 200) throw new Error('invalid candidate name');
  const date = d.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid certificate date');
  const dateObj = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(dateObj.getTime()) || dateObj.toISOString().slice(0, 10) !== date) throw new Error('invalid certificate date');
  if (!Number.isInteger(d.total) || d.total < 1 || d.total > 500 || !Number.isInteger(d.correct) || d.correct < 0 || d.correct > d.total) throw new Error('invalid score');

  const name = winAnsiSafe(d.name.trim());
  const C = d.correct, N = d.total;

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificate of Completion - ${name}`);
  pdf.setAuthor('OMSAZE Consulting');
  const B = await loadBrand(pdf);

  const W2 = 841.89, H2 = 595.28; // A4 landscape
  const page = pdf.addPage([W2, H2]);
  const inset = 22.68, inset2 = 6.24;
  page.drawRectangle({ x: inset, y: inset, width: W2 - 2 * inset, height: H2 - 2 * inset, borderColor: OMS.NAVY, borderWidth: 1.7 });
  page.drawRectangle({ x: inset + inset2, y: inset + inset2, width: W2 - 2 * (inset + inset2), height: H2 - 2 * (inset + inset2), borderColor: OMS.GOLD, borderWidth: 0.8 });

  function centerText(text: string, y: number, size: number, f: any, color: any) {
    const w = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (W2 - w) / 2, y, size, font: f, color });
  }
  function centerParagraph(text: string, y: number, maxWidth: number, size: number, f: any, color: any, leading: number): number {
    const lines = wrapText(text, maxWidth, size, f);
    lines.forEach((l, i) => centerText(l, y - i * leading, size, f, color));
    return y - lines.length * leading;
  }

  // Header: logo and identity line
  const logoDims = B.logo.scale(44 / B.logo.height);
  const logoY = H2 - inset - 30 - logoDims.height;
  page.drawImage(B.logo, { x: inset + 36, y: logoY, width: logoDims.width, height: logoDims.height });
  page.drawText('MINDPROOF  ·  DIGITAL LABS', { x: inset + 36 + logoDims.width + 14, y: logoY + logoDims.height / 2 - 3, size: 9.5, font: B.bold, color: OMS.GOLD_DARK });

  let y = H2 - inset - 130;
  centerText('Certificate of Completion', y, 34, B.displayX, OMS.NAVY);
  y -= 26;
  centerText('This records the participation of', y, 13.5, B.font, OMS.MUTED);
  y -= 34;
  centerText(name, y, 27, B.display, OMS.NAVY);
  const nameW = B.display.widthOfTextAtSize(name, 27);
  page.drawLine({ start: { x: (W2 - Math.min(nameW + 40, 520)) / 2, y: y - 9 }, end: { x: (W2 + Math.min(nameW + 40, 520)) / 2, y: y - 9 }, thickness: 1.2, color: OMS.GOLD });
  y -= 32;
  y = centerParagraph(`who completed the Cognitive Screening Test on ${date}, answering ${C} of ${N} questions correctly.`, y, 560, 13, B.font, OMS.INK, 18) - 16;

  // Score box
  const boxW = 190, boxH = 56;
  page.drawRectangle({ x: (W2 - boxW) / 2, y: y - boxH, width: boxW, height: boxH, color: OMS.NAVY });
  centerText(`${C}/${N}`, y - 36, 26, B.display, OMS.WHITE);
  centerText('RAW SCORE', y - 49, 8.5, B.bold, OMS.GOLD);
  y -= boxH + 8;

  // Signatures: English (left) and Arabic (right), with the issue date in the centre
  const footY = inset + 40;
  const sigMaxW = 170, sigMaxH = 62;
  const leftX = inset + 40, rightX = W2 - inset - 40 - 230;
  if (B.signatureEn) {
    const dim = fitBox(B.signatureEn, sigMaxW, sigMaxH);
    page.drawImage(B.signatureEn, { x: leftX + (230 - dim.width) / 2, y: footY + 30, width: dim.width, height: dim.height });
  }
  page.drawLine({ start: { x: leftX, y: footY + 28 }, end: { x: leftX + 230, y: footY + 28 }, thickness: 0.7, color: OMS.NAVY });
  page.drawText(SIGNER.name, { x: leftX, y: footY + 13, size: 11, font: B.bold, color: OMS.NAVY });
  page.drawText(SIGNER.title, { x: leftX, y: footY + 1, size: 9, font: B.font, color: OMS.MUTED });

  if (B.signatureAr) {
    const dim = fitBox(B.signatureAr, sigMaxW, sigMaxH);
    page.drawImage(B.signatureAr, { x: rightX + (230 - dim.width) / 2, y: footY + 30, width: dim.width, height: dim.height });
  }
  page.drawLine({ start: { x: rightX, y: footY + 28 }, end: { x: rightX + 230, y: footY + 28 }, thickness: 0.7, color: OMS.NAVY });
  page.drawText('OMSAZE', { x: rightX, y: footY + 13, size: 11, font: B.bold, color: OMS.NAVY });
  page.drawText('Digital Labs', { x: rightX, y: footY + 1, size: 9, font: B.font, color: OMS.MUTED });

  const issuedTxt = `Issued ${date}`;
  const iw = B.font.widthOfTextAtSize(issuedTxt, 11);
  page.drawText(issuedTxt, { x: (W2 - iw) / 2, y: footY + 8, size: 11, font: B.font, color: OMS.INK });

  centerText('Completion record only. Not a standardized IQ score, professional qualification, or accredited credential.', inset + 10, 8.5, B.font, OMS.MUTED);

  return pdf.save();
}

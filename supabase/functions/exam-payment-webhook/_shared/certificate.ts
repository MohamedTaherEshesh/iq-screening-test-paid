// OMSAZE development candidate: print-ready completion record, not a validated IQ credential.
// A4 landscape, rebranded to OMSAZE identity: Next Rise logo, navy and gold, Manrope + Source Sans 3,
// with the owner's bilingual signatures (English and Arabic).
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { winAnsiSafe } from './brand.ts';
import { loadBrand, OMS, SIGNER } from './omsaze-pdf-brand.ts';
import { hasArabic, loadArabicFonts, mirrorPage } from './rtl-pdf.ts';
import qrcode from 'npm:qrcode-generator@1.4.4';
import { examName } from './exam-names.ts';

// lang 'ar' gives an Arabic, right-to-left certificate (OMS-MND-261126-01). English stays the default.
// verifyCode/verifyUrl (OMS-MND-261126-04) add a QR code that opens the public verification page.
export type CertData = { name: string; date: string; correct: number; total: number; pctl: number; iq: number; lang?: 'en' | 'ar'; verifyCode?: string; verifyUrl?: string; examTag?: string | null };

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

  const ar = d.lang === 'ar';
  const arabicName = hasArabic(d.name);
  const name = arabicName ? d.name.trim() : winAnsiSafe(d.name.trim());
  const C = d.correct, N = d.total;
  const t = (en: string, arText: string) => (ar ? arText : en);

  const pdf = await PDFDocument.create();
  pdf.setTitle(t(`Certificate of Completion - ${name}`, `شهادة إتمام - ${name}`));
  pdf.setAuthor('OMSAZE Consulting');
  const brand = await loadBrand(pdf);
  const AR = ar || arabicName ? await loadArabicFonts(pdf) : null;
  // In Arabic every text font is IBM Plex Sans Arabic (it also carries Latin letters and digits).
  const B = ar && AR ? { ...brand, font: AR.font, bold: AR.bold, display: AR.bold, displayX: AR.bold } : brand;
  const nameFont = arabicName && AR ? AR.bold : B.display;

  const W2 = 841.89, H2 = 595.28; // A4 landscape
  const rawPage = pdf.addPage([W2, H2]);
  const page: any = ar ? mirrorPage(rawPage, W2) : rawPage;
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

  // Verification QR (OMS-MND-261126-04). Drawn on the raw page, never mirrored, so it always scans.
  // English: top right. Arabic: top left (the logo is on the right).
  if (d.verifyUrl && d.verifyCode && /^https:\/\//.test(d.verifyUrl)) {
    const qr = qrcode(0, 'M'); qr.addData(d.verifyUrl); qr.make();
    const n = qr.getModuleCount(), size = 64, cell = size / n;
    const qx = ar ? inset + 36 : W2 - inset - 36 - size;
    const qy = H2 - inset - 22 - size;
    rawPage.drawRectangle({ x: qx - 4, y: qy - 4, width: size + 8, height: size + 8, color: OMS.WHITE });
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) rawPage.drawRectangle({ x: qx + c * cell, y: qy + size - (r + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: OMS.NAVY });
    }
    const codeW = brand.font.widthOfTextAtSize(d.verifyCode, 6.5);
    rawPage.drawText(d.verifyCode, { x: qx + (size - codeW) / 2, y: qy - 11, size: 6.5, font: brand.font, color: OMS.INK });
    const label = t('Scan to verify', 'امسح للتحقق');
    const lw = B.font.widthOfTextAtSize(label, 7);
    const enX = W2 - inset - 36 - size + (size - lw) / 2; // mirrored to the left on Arabic pages
    page.drawText(label, { x: enX, y: qy - 21, size: 7, font: B.font, color: OMS.MUTED });
  }

  let y = H2 - inset - 130;
  centerText(t('Certificate of Completion', 'شهادة إتمام'), y, 34, B.displayX, OMS.NAVY);
  y -= 26;
  centerText(t('This records the participation of', 'تثبت هذه الشهادة مشاركة'), y, 13.5, B.font, OMS.MUTED);
  y -= 34;
  centerText(name, y, 27, nameFont, OMS.NAVY);
  const nameW = nameFont.widthOfTextAtSize(name, 27);
  page.drawLine({ start: { x: (W2 - Math.min(nameW + 40, 520)) / 2, y: y - 9 }, end: { x: (W2 + Math.min(nameW + 40, 520)) / 2, y: y - 9 }, thickness: 1.2, color: OMS.GOLD });
  y -= 32;
  y = centerParagraph(t(`who completed the ${examName(d.examTag, 'en')} assessment on ${date}, answering ${C} of ${N} questions correctly.`, `وذلك بإتمام تقييم ${examName(d.examTag, 'ar')} بتاريخ ${date}، بإجابة صحيحة عن ${C} من أصل ${N} سؤالا.`), y, 560, 13, B.font, OMS.INK, 18) - 16;

  // Score box
  const boxW = 190, boxH = 56;
  page.drawRectangle({ x: (W2 - boxW) / 2, y: y - boxH, width: boxW, height: boxH, color: OMS.NAVY });
  centerText(`${C}/${N}`, y - 36, 26, B.display, OMS.WHITE);
  centerText(t('RAW SCORE', 'الدرجة الخام'), y - 49, 8.5, B.bold, OMS.GOLD);
  y -= boxH + 8;

  // Signatures: English (left) and Arabic (right), with the issue date in the centre
  const footY = inset + 40;
  const sigMaxW = 170, sigMaxH = 62;
  const leftX = inset + 40, rightX = W2 - inset - 40 - 230;
  const sig1 = ar ? B.signatureAr : B.signatureEn, sig2 = ar ? B.signatureEn : B.signatureAr;
  if (sig1) {
    const dim = fitBox(sig1, sigMaxW, sigMaxH);
    page.drawImage(sig1, { x: leftX + (230 - dim.width) / 2, y: footY + 30, width: dim.width, height: dim.height });
  }
  page.drawLine({ start: { x: leftX, y: footY + 28 }, end: { x: leftX + 230, y: footY + 28 }, thickness: 0.7, color: OMS.NAVY });
  page.drawText(SIGNER.name, { x: leftX, y: footY + 13, size: 11, font: B.bold, color: OMS.NAVY });
  page.drawText(t(SIGNER.title, SIGNER.titleAr), { x: leftX, y: footY + 1, size: 9, font: B.font, color: OMS.MUTED });

  if (sig2) {
    const dim = fitBox(sig2, sigMaxW, sigMaxH);
    page.drawImage(sig2, { x: rightX + (230 - dim.width) / 2, y: footY + 30, width: dim.width, height: dim.height });
  }
  page.drawLine({ start: { x: rightX, y: footY + 28 }, end: { x: rightX + 230, y: footY + 28 }, thickness: 0.7, color: OMS.NAVY });
  page.drawText('OMSAZE', { x: rightX, y: footY + 13, size: 11, font: B.bold, color: OMS.NAVY });
  page.drawText('Digital Labs', { x: rightX, y: footY + 1, size: 9, font: B.font, color: OMS.MUTED });

  const issuedTxt = t(`Issued ${date}`, `صدرت بتاريخ ${date}`);
  const iw = B.font.widthOfTextAtSize(issuedTxt, 11);
  page.drawText(issuedTxt, { x: (W2 - iw) / 2, y: footY + 8, size: 11, font: B.font, color: OMS.INK });

  centerText(t('Completion record only. Not a standardized IQ score, professional qualification, or accredited credential.', 'سجل إتمام فقط. ليست درجة ذكاء معيارية ولا مؤهلا مهنيا ولا شهادة معتمدة.'), inset + 10, 8.5, B.font, OMS.MUTED);

  return pdf.save();
}

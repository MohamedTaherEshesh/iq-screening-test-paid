// Arabic (right-to-left) support for the pdf-lib report and certificate.
// pdf-lib + fontkit already shape Arabic letters and reverse an Arabic run into visual order,
// but they reverse the whole string, digits and Latin words included, and they only do so when
// the first strong letter of the string is Arabic. visualAr() pre-reverses the Latin/digit runs
// so they read correctly after that reversal. mirrorPage() wraps a page so that every drawing
// call is mirrored horizontally: left-aligned English layout becomes right-aligned Arabic layout
// without rewriting each coordinate.
import { FONT_AR_BOLD_B64, FONT_AR_REGULAR_B64 } from './arabic-fonts.ts';

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN_OR_DIGIT = /[A-Za-z0-9À-ɏ]/;

export function hasArabic(s: string): boolean { return ARABIC.test(String(s ?? '')); }

function firstStrongIsArabic(s: string): boolean {
  for (const ch of s) {
    if (ARABIC.test(ch)) return true;
    if (LATIN_OR_DIGIT.test(ch) && !/[0-9]/.test(ch)) return false;
  }
  return false;
}

// Reverse each left-to-right run (Latin words, numbers, 45/70, 64.3%, 2026-11-26) so it reads
// correctly once fontkit reverses the whole Arabic line.
export function visualAr(s: string): string {
  const text = String(s ?? '');
  if (!hasArabic(text) || !firstStrongIsArabic(text)) return text;
  return text.replace(/[A-Za-z0-9À-ɏ](?:[A-Za-z0-9À-ɏ .,:/%@+&'_|\-]*[A-Za-z0-9À-ɏ%])?/g,
    (run) => [...run].reverse().join(''));
}

function bytesOf(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.length > 64 ? out : null;
  } catch { return null; }
}

// Embeds IBM Plex Sans Arabic (regular and bold). fontkit must already be registered (loadBrand does it).
export async function loadArabicFonts(pdf: any) {
  const reg = bytesOf(FONT_AR_REGULAR_B64);
  const bold = bytesOf(FONT_AR_BOLD_B64);
  if (!reg || !bold) throw new Error('Arabic font unavailable');
  return { font: await pdf.embedFont(reg, { subset: true }), bold: await pdf.embedFont(bold, { subset: true }) };
}

// A page wrapper that mirrors x positions around the page width.
export function mirrorPage(page: any, pageWidth: number) {
  return {
    drawText(text: string, o: any) {
      const width = o.font.widthOfTextAtSize(text, o.size);
      page.drawText(visualAr(text), { ...o, x: pageWidth - o.x - width });
    },
    drawRectangle(o: any) { page.drawRectangle({ ...o, x: pageWidth - o.x - (o.width ?? 0) }); },
    drawImage(img: any, o: any) { page.drawImage(img, { ...o, x: pageWidth - o.x - o.width }); },
    drawLine(o: any) {
      page.drawLine({ ...o, start: { ...o.start, x: pageWidth - o.start.x }, end: { ...o.end, x: pageWidth - o.end.x } });
    },
    drawCircle(o: any) { page.drawCircle({ ...o, x: pageWidth - o.x }); },
  };
}

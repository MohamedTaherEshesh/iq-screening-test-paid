// OMSAZE corporate identity for the PDF report and certificate (matches omsaze.com):
// Manrope for headings, Source Sans 3 for text, OMSAZE Next Rise logo, navy and gold.
// Fonts, logo and both signatures are embedded in brand-assets.ts, so the PDFs never depend on a
// network fetch. The Helvetica and fallback-logo path below is only a last resort if decoding fails.
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import { StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { OMSAZE_LOGO_PNG_BASE64 } from './brand.ts';
import * as A from './brand-assets.ts';

export const OMS = {
  NAVY: rgb(16 / 255, 45 / 255, 70 / 255),
  GOLD: rgb(215 / 255, 181 / 255, 109 / 255),
  GOLD_DARK: rgb(154 / 255, 122 / 255, 53 / 255),
  BLUE: rgb(18 / 255, 99 / 255, 199 / 255),
  MIST: rgb(242 / 255, 245 / 255, 248 / 255),
  INK: rgb(29 / 255, 41 / 255, 57 / 255),
  MUTED: rgb(91 / 255, 107 / 255, 123 / 255),
  WHITE: rgb(1, 1, 1),
};

export const SIGNER = { name: 'Mohamed Taher Eshesh', title: 'Founder & CEO - OMSAZE', titleAr: 'المؤسس والرئيس التنفيذي - OMSAZE' };

function bytesOf(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.length > 64 ? out : null;
  } catch { return null; }
}

export async function loadBrand(pdf: any) {
  pdf.registerFontkit(fontkit);
  const reg = bytesOf(A.FONT_SOURCE_REGULAR_B64);
  const semi = bytesOf(A.FONT_SOURCE_SEMIBOLD_B64);
  const disp = bytesOf(A.FONT_MANROPE_BOLD_B64);
  const xbold = bytesOf(A.FONT_MANROPE_EXTRABOLD_B64);
  const logo = bytesOf(A.OMSAZE_SITE_LOGO_B64);
  const sigAr = bytesOf(A.SIG_AR_B64);
  const sigEn = bytesOf(A.SIG_EN_B64);
  const embed = async (bytes: Uint8Array | null, fallback: string) => {
    if (bytes) { try { return await pdf.embedFont(bytes, { subset: true }); } catch { /* fall back */ } }
    return await pdf.embedFont(fallback);
  };
  const font = await embed(reg, StandardFonts.Helvetica);
  const bold = await embed(semi, StandardFonts.HelveticaBold);
  const display = await embed(disp, StandardFonts.HelveticaBold);
  const displayX = await embed(xbold, StandardFonts.HelveticaBold);
  let logoImg: any = null;
  if (logo) { try { logoImg = await pdf.embedPng(logo); } catch { logoImg = null; } }
  if (!logoImg) logoImg = await pdf.embedPng(Uint8Array.from(atob(OMSAZE_LOGO_PNG_BASE64), c => c.charCodeAt(0)));
  const sigImg = async (b: Uint8Array | null) => { if (!b) return null; try { return await pdf.embedPng(b); } catch { return null; } };
  const signatureAr = await sigImg(sigAr);
  const signatureEn = await sigImg(sigEn);
  return { font, bold, display, displayX, logo: logoImg, signatureAr, signatureEn };
}

// OMSAZE corporate identity for the PDF report and certificate (matches omsaze.com):
// Manrope for headings, Source Sans 3 for text, OMSAZE Next Rise logo, navy and gold.
// Fonts, logo and the owner's signature are served by the MindProof site; if any fetch fails the
// PDF still renders with Helvetica and the embedded fallback logo, and without a signature image.
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import { StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { OMSAZE_LOGO_PNG_BASE64 } from './brand.ts';

const ASSET_BASE = 'https://staging.omsaze.com/';

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

async function asset(path: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(ASSET_BASE + path, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    return b.length > 64 ? b : null;
  } catch { return null; }
}

export async function loadBrand(pdf: any) {
  pdf.registerFontkit(fontkit);
  const [reg, semi, disp, xbold, logo, sigAr, sigEn] = await Promise.all([
    asset('assets/fonts/SourceSans3-Regular.ttf'),
    asset('assets/fonts/SourceSans3-SemiBold.ttf'),
    asset('assets/fonts/Manrope-Bold.ttf'),
    asset('assets/fonts/Manrope-ExtraBold.ttf'),
    asset('omsaze-logo.png'),
    asset('assets/signature-ar.png'),
    asset('assets/signature-en.png'),
  ]);
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

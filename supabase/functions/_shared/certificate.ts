// OMSAZE development candidate: print-ready completion record, not a validated IQ credential.
const esc = (s: string): string => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export type CertData = {name:string; date:string; correct:number; total:number; pctl:number; iq:number};

export function certificateHtml(d: CertData): string {
  if (!d || typeof d.name !== 'string' || d.name.trim().length < 2 || d.name.length > 200) throw new Error('invalid candidate name');
  const date = d.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid certificate date');
  const dateObj = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(dateObj.getTime()) || dateObj.toISOString().slice(0,10) !== date) throw new Error('invalid certificate date');
  if (!Number.isInteger(d.total) || d.total < 1 || d.total > 500 || !Number.isInteger(d.correct) || d.correct < 0 || d.correct > d.total) throw new Error('invalid score');
  const name = esc(d.name.trim());
  const safeDate = esc(date);
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Certificate of Completion - ',name,'</title><style>',
    '@page { size: A4 landscape; margin: 0; }',
    'body{margin:0;background:#F2F4F7;font-family:Aptos,Inter,Arial,sans-serif;color:#1D2939}',
    '.cert{position:relative;width:297mm;height:210mm;margin:0 auto;background:#fff;box-sizing:border-box;padding:16mm 22mm}',
    '.frame{position:absolute;inset:8mm;border:.6mm solid #0B1F3A;pointer-events:none}',
    '.frame:after{content:"";position:absolute;inset:2.2mm;border:.2mm solid #0070F2}',
    '.head{display:flex;align-items:center;justify-content:space-between}',
    '.brand{font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#667085}',
    'h1{text-align:center;color:#0B1F3A;font-size:44px;margin:14mm 0 4mm}',
    '.sub{text-align:center;font-size:16px;color:#667085;margin:0}',
    '.name{text-align:center;font-size:36px;font-weight:600;color:#0B1F3A;margin:8mm 0 3mm}',
    '.body{text-align:center;font-size:17px;line-height:1.6;max-width:205mm;margin:auto}',
    '.stat{background:#F2F4F7;border-radius:3mm;margin:9mm auto 6mm;padding:4mm 7mm;text-align:center;width:60mm}',
    '.stat b{display:block;color:#00A6A6;font-size:30px}.stat span{color:#667085;font-size:13px}',
    '.foot{position:absolute;left:22mm;right:22mm;bottom:16mm;display:flex;justify-content:space-between;align-items:end}',
    '.sig{border-top:.3mm solid #0B1F3A;padding-top:2mm;font-size:14px;color:#0B1F3A}',
    '.disclaimer{position:absolute;left:22mm;right:22mm;bottom:4mm;text-align:center;font-size:11px;color:#667085}',
    '@media print { body{background:white} }</style></head><body><div class="cert"><div class="frame"></div>',
    '<div class="head"><svg width="84" height="84" viewBox="0 0 100 100" aria-label="MT monogram"><text x="6" y="66" font-family="Arial" font-weight="700" font-size="56" fill="#0B1F3A">MT</text><rect x="6" y="76" width="88" height="3" fill="#0070F2"/></svg>',
    '<div class="brand">Mohamed Taher · Cognitive Screening</div></div>',
    '<h1>Certificate of Completion</h1><p class="sub">This records the participation of</p><div class="name">',name,'</div>',
    '<p class="body">who completed the Cognitive Screening Test on <b>',safeDate,'</b>, answering ',String(d.correct),' of ',String(d.total),' questions correctly.</p>',
    '<div class="stat"><b>',String(d.correct),'/',String(d.total),'</b><span>Raw score</span></div>',
    '<div class="foot"><div class="sig">Mohamed Taher<br><span style="color:#667085">Senior SAP &amp; Digital Transformation Consultant</span></div><div>Issued ',safeDate,'</div></div>',
    '<div class="disclaimer">Completion record only. Not a standardized IQ score, professional qualification, or accredited credential.</div>',
    '</div></body></html>'
  ].join('');
}

// Local check for OMS-MND-261126-17: Junior hidden from the MindProof catalog.
const { chromium } = require('playwright');
const out = process.env.SHOTS || './';
const base = process.argv[2] || 'http://localhost:8765';
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  for (const lang of ['en', 'ar']) {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    await p.addInitScript(l => { try { localStorage.setItem('omsaze-lang', l); } catch {} }, lang);
    await p.goto(base + '/index.html?lang=' + lang);
    await p.waitForTimeout(2000);
    const t = await p.evaluate(() => document.body.innerText);
    const n = await p.evaluate(() => document.querySelectorAll('#catalog h2').length);
    const bad = /Junior|الناشئ|Could not load/.test(t);
    console.log(lang, 'catalog items', n, 'junior text present:', bad);
    if (bad || n !== 8) fail++;
    await p.screenshot({ path: out + 'catalog-' + lang + '.png', fullPage: true });
  }
  const p = await b.newPage();
  await p.goto(base + '/assessments.html');
  await p.waitForTimeout(1000);
  const t2 = await p.evaluate(() => document.body.innerText);
  const err = /تعذر/.test(t2), j = /Junior|الناشئ/.test(t2);
  console.log('assessments page error:', err, 'junior:', j);
  if (err || j) fail++;
  await b.close();
  console.log(fail ? 'FAIL' : 'PASS');
  process.exit(fail);
})();

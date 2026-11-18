/* Return landing page after an exam-report-unlock checkout. Uses Paymob
   SANDBOX / test-mode keys only -- no real money moves. Reads the testId
   this browser was paying for, polls exam-payment's 'status' action, and
   links back to the University exam page where the report unlocks once
   state === 'paid'. */
const cfg=window.OMSAZE_ADVANCED70_CONFIG||{};
const APP=document.getElementById('app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function footer(){return '<footer>Sandbox / test-mode payment. Uses Paymob test keys. No real money moves in this environment.</footer>'}
function session(){try{return JSON.parse(sessionStorage.getItem('omsaze-email-verification')||'null')}catch{return null}}

async function poll(){
  const testId=sessionStorage.getItem('omsaze70-pending-test')||sessionStorage.getItem('omsaze70-session');
  const sess=session();
  if(!testId||!sess?.session?.access_token){
    APP.innerHTML=`<h1>Payment result</h1><div class="card"><div class="error">No exam payment is linked to this browser session.</div><p><a href="/university.html">Back to the exam</a></p></div>${footer()}`;
    return;
  }
  APP.innerHTML=`<h1>Payment result</h1><div class="card" id="statusCard"><p>Checking…</p></div>${footer()}`;
  let attempts=0;
  const tick=async()=>{
    attempts++;
    try{
      const r=await fetch(cfg.apiBase+'/exam-payment',{
        method:'POST',
        headers:{'content-type':'application/json',apikey:cfg.publishableKey,authorization:'Bearer '+sess.session.access_token},
        body:JSON.stringify({action:'status',testId}),
        signal:AbortSignal.timeout(15000),
      });
      const d=await r.json();
      if(!r.ok)throw Error(d.error||'Could not read the payment status.');
      render(d.payment);
      if(d.payment&&['creating','ready','pending'].includes(d.payment.state)){
        if(attempts<20)setTimeout(tick,3000);
      }
    }catch(e){
      document.getElementById('statusCard').innerHTML=`<div class="error">${esc(e.message)}</div><div class="actions"><button class="ghost" id="retry">Retry</button></div>`;
      document.getElementById('retry').onclick=tick;
    }
  };
  tick();
}
function render(p){
  if(!p){document.getElementById('statusCard').innerHTML=`<p>No payment attempt found yet.</p><p><a href="/university.html">Back to the exam</a></p>`;return}
  const egp=Number.isFinite(p.amount_cents)?(p.amount_cents/100).toFixed(2):'—';
  const stateLabel={creating:'<span class="pending">Creating…</span>',ready:'<span class="pending">Awaiting payment</span>',pending:'<span class="pending">Pending</span>',paid:'<span class="success">✓ Paid (sandbox)</span>',failed:'<span class="error" style="display:inline;padding:2px 8px">Failed</span>',refunded:'Refunded',voided:'Voided'}[p.state]||esc(p.state||'unknown');
  document.getElementById('statusCard').innerHTML=`<h2 style="margin-top:0">Payment: ${stateLabel}</h2><div class="metric"><span>Amount</span><b>${egp} EGP</b></div><div class="metric"><span>Paymob order</span><b>${esc(p.paymob_order_id??'—')}</b></div><div class="metric"><span>Transaction</span><b>${esc(p.transaction_id??'—')}</b></div><div class="metric"><span>FX rate used</span><b>${esc(p.fx_rate??'—')}</b></div>${p.state==='paid'?'<p class="success" style="margin-top:16px">Your full report is unlocked.</p>':'<p style="margin-top:16px">If payment succeeded on Paymob’s page but shows pending here, wait a few seconds for the callback, or return to the exam page and refresh.</p>'}<p><a href="/university.html">${p.state==='paid'?'View your full report':'Back to the exam'}</a></p>`;
}
poll();

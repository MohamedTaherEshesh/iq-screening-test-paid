/* Return landing page after a Paymob SANDBOX checkout. Reads the sandbox
   test id this browser created before redirecting, polls the paymob-test
   function's 'status' action, and shows the outcome. Never touches exam
   content, reports or certificates — this is the standalone sandbox
   exercise's own result page. */
const cfg=window.OMSAZE_ADVANCED70_CONFIG||{};
const APP=document.getElementById('app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function footer(){return '<footer>SANDBOX exercise only. Uses Paymob test-mode keys. No real exam, report, certificate or money is ever involved here.</footer>'}
function session(){try{return JSON.parse(sessionStorage.getItem('omsaze-email-verification')||'null')}catch{return null}}

async function poll(){
  const id=sessionStorage.getItem('omsaze-paymob-sandbox-id');
  const sess=session();
  if(!id||!sess?.session?.access_token){
    APP.innerHTML=`<h1>Sandbox result</h1><div class="card"><div class="error">No sandbox test is linked to this browser session. Start a new one from the sandbox test page.</div><p><a href="/paymob-sandbox.html">Back to sandbox test</a></p></div>${footer()}`;
    return;
  }
  APP.innerHTML=`<h1>Sandbox result</h1><div class="card" id="statusCard"><p>Checking…</p></div>${footer()}`;
  let attempts=0;
  const tick=async()=>{
    attempts++;
    try{
      const r=await fetch(cfg.apiBase+'/paymob-test',{
        method:'POST',
        headers:{'content-type':'application/json',authorization:'Bearer '+sess.session.access_token},
        body:JSON.stringify({action:'status',id}),
        signal:AbortSignal.timeout(15000),
      });
      const d=await r.json();
      if(!r.ok)throw Error(d.error||'Could not read the sandbox test status.');
      render(d);
      if(d.state==='creating'||d.state==='pending'){
        if(attempts<20)setTimeout(tick,3000);
      }
    }catch(e){
      document.getElementById('statusCard').innerHTML=`<div class="error">${esc(e.message)}</div><div class="actions"><button class="ghost" id="retry">Retry</button></div>`;
      document.getElementById('retry').onclick=tick;
    }
  };
  tick();
}
function render(d){
  const egp=Number.isFinite(d.amount_cents)?(d.amount_cents/100).toFixed(2):'—';
  const stateLabel={creating:'<span class="pending">Creating…</span>',pending:'<span class="pending">Pending</span>',ready:'<span class="pending">Awaiting payment</span>',paid:'<span class="success">✓ Paid (sandbox)</span>',failed:'<span class="error" style="display:inline;padding:2px 8px">Failed</span>'}[d.state]||esc(d.state||'unknown');
  document.getElementById('statusCard').innerHTML=`<h2 style="margin-top:0">Sandbox outcome: ${stateLabel}</h2><div class="metric"><span>Amount</span><b>${egp} EGP</b></div><div class="metric"><span>Paymob order</span><b>${esc(d.paymob_order_id??'—')}</b></div><div class="metric"><span>Transaction</span><b>${esc(d.transaction_id??'—')}</b></div><div class="metric"><span>FX rate used</span><b>${esc(d.fx_rate??'—')}</b></div><p style="margin-top:16px">This is a sandbox-only result. No real exam, report, certificate or money is involved.</p><p><a href="/paymob-sandbox.html">Run another sandbox test</a></p>`;
}
poll();

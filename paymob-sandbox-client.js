/* Standalone Paymob SANDBOX test trigger. Never creates a real exam, report or
   certificate, and never charges real money — the backend (paymob-test edge
   function) only talks to Paymob using sk_test_/pk_test_ sandbox keys and
   verifies the response is a genuine live:false test integration before
   returning a checkout URL. This page only needs a confirmed-email sign-in
   (reusing the already-enabled University pilot's email-verification
   channel) to obtain that Bearer session — it does not touch exam content. */
import {EmailVerificationClient} from './email-verification-client.js';
const cfg=window.OMSAZE_ADVANCED70_CONFIG||{},APP=document.getElementById('app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const client=new EmailVerificationClient(cfg,{storage:sessionStorage});
let human={challengeId:null,a:0,b:0,token:null,busy:false};
let language='en',busy=false;
const configured=()=>client.configured;
async function loadHumanCheck(){human.busy=true;try{const d=await client.issueHumanCheck();human={challengeId:d.challengeId,a:d.a,b:d.b,token:null,busy:false}}catch{human.busy=false}renderHumanCheck()}
function updateSendState(){const b=document.getElementById('sendCode');if(b)b.disabled=!human.token||!document.getElementById('ack')?.checked}
function renderHumanCheck(){const box=document.getElementById('humanBox');if(!box)return;if(human.token){box.innerHTML='<div class="success">✓ Human check passed.</div>';return}
 box.innerHTML=`<label for="humanAnswer">Quick check: what is ${human.a} + ${human.b}?</label><input id="humanAnswer" inputmode="numeric" style="width:90px" ${human.busy?'disabled':''}><div class="actions"><button type="button" id="humanVerify" class="ghost" ${human.busy?'disabled':''}>Check</button><button type="button" id="humanRefresh" class="ghost" ${human.busy?'disabled':''}>New puzzle</button></div>`;
 document.getElementById('humanVerify').onclick=async()=>{const v=Number(document.getElementById('humanAnswer').value);document.getElementById('humanVerify').disabled=true;try{human.token=await client.verifyHumanCheck(human.challengeId,v);renderHumanCheck();updateSendState()}catch(e){showError(e.message);document.getElementById('humanVerify').disabled=false}};
 document.getElementById('humanRefresh').onclick=()=>loadHumanCheck()}
function showError(msg){const e=document.getElementById('message');if(e){e.className='error';e.textContent=msg}}
function footer(){return '<footer>SANDBOX exercise only. Uses Paymob test-mode keys. No real exam, report, certificate or money is ever involved here.</footer>'}

function signInView(){
  APP.innerHTML=`<h1>Paymob sandbox checkout test</h1><p>This page exercises the Paymob <b>test-mode</b> integration end to end — a real sandbox checkout against Paymob, using test keys only. No real exam or money is involved.</p>${configured()?`<div class="card"><h2 style="margin-top:0">Sign in to run the test</h2><label><input type="checkbox" id="ack"> I understand this is a sandbox test with no real exam or payment.</label><label for="email">Email</label><input id="email" autocomplete="email" type="email" placeholder="you@example.com"><label>Human verification</label><div id="humanBox" class="note"></div><button id="sendCode" disabled>Send sign-in code</button><p id="message" role="status"></p></div>`:'<div class="note"><b>Not connected</b><br>This page reuses the University pilot\'s sign-in channel, which is not enabled.</div>'}${footer()}`;
  document.getElementById('ack')?.addEventListener('change',updateSendState);
  document.getElementById('sendCode')?.addEventListener('click',sendCode);
  if(configured())loadHumanCheck();
}
async function sendCode(){
  const emailEl=document.getElementById('email'),ackEl=document.getElementById('ack');
  const emailVal=emailEl.value.trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)){showError('Enter a valid email address.');return}
  if(!ackEl?.checked){showError('Please confirm the acknowledgement first.');return}
  if(!human.token){showError('Please pass the human verification check first.');return}
  emailEl.disabled=true;document.getElementById('sendCode').disabled=true;
  try{
    await client.request(emailVal,true,language,human.token);
    human={challengeId:null,a:0,b:0,token:null,busy:false};
    APP.innerHTML=`<h1>Check your email</h1><div class="card"><p>Enter the sign-in code sent to ${esc(emailVal)}.</p><label for="otp">Sign-in code</label><input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><div class="actions"><button id="verify">Continue</button><button class="ghost" id="resend">Resend</button></div><p id="message" role="status"></p></div>${footer()}`;
    document.getElementById('verify').onclick=verifyCode;
    document.getElementById('resend').onclick=async()=>{try{await client.resend();showError('A new code was sent.')}catch(e){showError(e.message)}};
  }catch(e){showError(e.message);emailEl.disabled=false;document.getElementById('sendCode').disabled=false}
}
async function verifyCode(){
  const code=document.getElementById('otp').value.trim();
  try{await client.verify(code);readyView()}catch(e){showError(e.message)}
}

async function readyView(){
  APP.innerHTML=`<h1>Paymob sandbox checkout test</h1><p>Signed in as <b dir="ltr">${esc(client.state.email||'')}</b>.</p><div class="card" id="statusCard"><p>Checking sandbox configuration…</p></div>${footer()}`;
  let readiness;
  try{
    const r=await fetch(cfg.apiBase+'/paymob-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'readiness'}),signal:AbortSignal.timeout(15000)});
    readiness=await r.json();
  }catch{renderNotReady('Could not reach the sandbox payment test service.');return}
  if(!readiness.enabled||!readiness.configured){renderNotReady('Paymob sandbox credentials are not fully configured.');return}
  if(!readiness.price){renderNotReady('The live USD→EGP conversion quote is unavailable right now. Try again shortly.');return}
  const egp=(readiness.price.quote.amountCents/100).toFixed(2);
  document.getElementById('statusCard').innerHTML=`<h2 style="margin-top:0">Ready</h2><div class="metric"><span>Test amount</span><b>$10.00 USD</b></div><div class="metric"><span>Converted (live rate)</span><b>${egp} EGP</b></div><div class="metric"><span>Rate as of</span><b>${esc(readiness.price.quote.asOf)}</b></div><p id="message" role="status"></p><div class="actions"><button id="runTest">Run sandbox checkout</button></div>`;
  document.getElementById('runTest').onclick=()=>runTest(readiness.price);
}
function renderNotReady(msg){document.getElementById('statusCard').innerHTML=`<div class="error">${esc(msg)}</div>`}

async function runTest(price){
  if(busy)return;busy=true;
  const btn=document.getElementById('runTest');if(btn)btn.disabled=true;
  const id=crypto.randomUUID();
  sessionStorage.setItem('omsaze-paymob-sandbox-id',id);
  try{
    const r=await fetch(cfg.apiBase+'/paymob-test',{
      method:'POST',
      headers:{'content-type':'application/json',authorization:'Bearer '+(client.state.session?.access_token||'')},
      body:JSON.stringify({action:'create',id,acceptTest:true,price}),
      signal:AbortSignal.timeout(20000),
    });
    const d=await r.json();
    if(!r.ok||!d.checkoutUrl)throw Error(d.error||'Could not create the sandbox checkout.');
    window.location.href=d.checkoutUrl;
  }catch(e){showError(e.message);if(btn)btn.disabled=false;busy=false}
}

if(client.verified)readyView();else signInView();

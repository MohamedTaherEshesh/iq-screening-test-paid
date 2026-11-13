/* Public staging client. All ownership, limits, expiry and start permission are enforced server-side. */
export class EmailVerificationClient {
  constructor(config,{fetcher=globalThis.fetch,storage=globalThis.sessionStorage,now=()=>Date.now()}={}){
    this.config=config;this.fetcher=fetcher;this.storage=storage;this.now=now;this.offset=0;this.busy=false;
    try{this.state=JSON.parse(storage.getItem('omsaze-email-verification')||'null')||{}}catch{this.state={}}
    if(!this.state.browserSecret)this.state.browserSecret=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
  }
  get configured(){return this.config.enabled===true&&this.config.apiBase==='https://cbklbucvidcutshhmwjy.supabase.co/functions/v1'&&typeof this.config.publishableKey==='string'&&this.config.publishableKey.length>20}
  persist(){this.storage.setItem('omsaze-email-verification',JSON.stringify(this.state))}
  async call(body){
    if(!this.configured)throw Error('Email verification is not connected yet. No code was sent.');
    if(this.busy)throw Error('Please wait for the current request.');this.busy=true;
    try{const r=await this.fetcher(this.config.apiBase+'/email-verification',{method:'POST',headers:{'content-type':'application/json',apikey:this.config.publishableKey},body:JSON.stringify({...body,email:this.state.email,browserSecret:this.state.browserSecret}),signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok)throw Error(data.error||'Verification request failed.');if(data.serverNow)this.offset=Date.parse(data.serverNow)-this.now();return data}finally{this.busy=false}
  }
  async request(email,accepted,language='ar'){
    if(accepted!==true)throw Error('Please accept the acknowledgement first.');
    const normalized=email.trim().toLowerCase();if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalized))throw Error('Enter a valid email address.');
    if(this.state.email!==normalized){const browserSecret=this.state.browserSecret;this.state={email:normalized,browserSecret}}
    this.state.email=normalized;this.state.accepted=true;this.persist();
    const data=await this.call({action:'request',accepted:true,acknowledgement:'omsaze-practice-v1',language});
    Object.assign(this.state,{requestId:data.requestId,expiresAt:data.expiresAt,resendsRemaining:data.resendsRemaining,lastSentAt:this.now()+this.offset,proof:null,session:null});this.persist();return data;
  }
  async resend(){if(!this.state.requestId)throw Error('Request a code first.');const data=await this.call({action:'resend',requestId:this.state.requestId});Object.assign(this.state,{expiresAt:data.expiresAt,resendsRemaining:data.resendsRemaining,lastSentAt:this.now()+this.offset,proof:null,session:null});this.persist();return data}
  async verify(code){if(!/^\d{6}$/.test(code))throw Error('Enter the six-digit code.');if(!this.state.requestId)throw Error('Request a code first.');const data=await this.call({action:'verify',requestId:this.state.requestId,code});if(data.verified!==true||!data.proof||!data.session?.access_token||data.email!==this.state.email)throw Error('Email verification was not completed.');Object.assign(this.state,{proof:data.proof,proofExpiresAt:data.proofExpiresAt,session:data.session});this.persist();return data}
  get verified(){return !!this.state.proof&&!!this.state.session?.access_token&&Date.parse(this.state.proofExpiresAt)>this.now()+this.offset}
  get secondsRemaining(){return Math.max(0,Math.ceil((Date.parse(this.state.expiresAt||'')-this.now()-this.offset)/1000))||0}
  get resendWaitSeconds(){return Math.max(0,Math.ceil((Number(this.state.lastSentAt||0)+60000-this.now()-this.offset)/1000))}
  startHeaders(){if(!this.verified)throw Error('Verify your email before starting the exam.');return {authorization:'Bearer '+this.state.session.access_token,'x-omsaze-email-proof':this.state.proof}}
  clear(){const browserSecret=this.state.browserSecret;this.state={browserSecret};this.persist()}
}

import {requireStaging} from './staging-db.ts';
import {isKnownStagingOrigin} from './staging-origins.ts';

export function paymentTestConfig(){
 requireStaging();
 const secret=Deno.env.get('PAYMOB_SANDBOX_SECRET_KEY')??'',publicKey=Deno.env.get('PAYMOB_SANDBOX_PUBLIC_KEY')??'',integration=Number(Deno.env.get('PAYMOB_SANDBOX_INTEGRATION_ID'));
 const hmac=Deno.env.get('PAYMOB_SANDBOX_HMAC_SECRET')??'',origin=Deno.env.get('OMSAZE_EMAIL_VERIFICATION_ORIGIN')??'';
 const configured=/^(?:[a-z]{3}_)?sk_test_[A-Za-z0-9_-]+$/.test(secret)&&/^(?:[a-z]{3}_)?pk_test_[A-Za-z0-9_-]+$/.test(publicKey)&&Number.isSafeInteger(integration)&&integration>0&&hmac.length>=16&&isKnownStagingOrigin(origin);
 return{enabled:Deno.env.get('OMSAZE_PAYMENTS_MODE')==='sandbox'&&Deno.env.get('OMSAZE_PAYMOB_TEST_ENABLED')==='true',configured,secret,publicKey,integration,hmac,origin};
}
export async function createPaymentTestIntention(id:string,email:string,config:ReturnType<typeof paymentTestConfig>,amountCents:number,fetcher:typeof fetch=fetch,webhookFn:string='paymob-test-webhook',returnPath:string='/paymob-test/'){
 if(!config.enabled||!config.configured||!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>100000000)throw Error('Paymob test is not configured');
 const response=await (fetcher??fetch)('https://accept.paymob.com/v1/intention/',{method:'POST',headers:{Authorization:'Token '+config.secret,'content-type':'application/json'},body:JSON.stringify({amount:amountCents,currency:'EGP',payment_methods:[config.integration],items:[{name:'OMSAZE USD10 converted to EGP — SANDBOX test',amount:amountCents,quantity:1}],billing_data:{first_name:'OMSAZE',last_name:'Sandbox',email,phone_number:'+201000000000',country:'EG',city:'Cairo',street:'NA',building:'NA',floor:'NA',apartment:'NA',state:'NA',postal_code:'NA'},special_reference:id,expiration:1800,notification_url:'https://cbklbucvidcutshhmwjy.supabase.co/functions/v1/'+webhookFn,redirection_url:config.origin+returnPath}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Paymob test intention was rejected');
 const data=await response.json();
 if(!Number.isSafeInteger(data.intention_order_id)||data.intention_order_id<=0||typeof data.client_secret!=='string'||!/^(?:[a-z]{3}_)?csk_test_[A-Za-z0-9_-]+$/.test(data.client_secret)||!Array.isArray(data.payment_methods)||!data.payment_methods.some((m:Record<string,unknown>)=>Number(m.integration_id)===config.integration&&m.live===false))throw Error('Paymob did not confirm a TEST integration');
 const url=new URL('https://accept.paymob.com/unifiedcheckout/');url.searchParams.set('publicKey',config.publicKey);url.searchParams.set('clientSecret',data.client_secret);
 return{orderId:data.intention_order_id as number,url:url.href};
}
export function paymentTestOutcome(o:Record<string,unknown>,integration:number){
 const order=o.order as Record<string,unknown>|undefined;
 if(Number(o.integration_id)!==integration||o.is_live!==false||o.currency!=='EGP'||!Number.isSafeInteger(o.amount_cents)||Number(o.amount_cents)<=0||Number(o.amount_cents)>100000000||!Number.isSafeInteger(o.id)||Number(o.id)<=0||!Number.isSafeInteger(order?.id)||Number(order?.id)<=0)throw Error('Wrong test transaction');
 for(const flag of ['pending','success','error_occured','is_refunded','is_voided'])if(typeof o[flag]!=='boolean')throw Error('Invalid transaction flag');
 const outcome=o.is_refunded?'refunded':o.is_voided?'voided':o.pending?'pending':o.success===true&&o.error_occured===false?'paid':'failed';
 return{transaction:o.id as number,order:order!.id as number,outcome,amount:o.amount_cents as number};
}

import {stagingDb,timingSafeEqual} from './staging-db.ts';
import {resolveVerificationSecret,verificationHash} from './email-verification.ts';
export const PRICE_USD_CENTS=1000;
export const FX_SOURCE='https://www.exchangerate-api.com';
export const FX_ENDPOINT='https://open.er-api.com/v6/latest/USD';
export type PriceQuote={scope:'omsaze-sandbox-usd-10';usdCents:1000;rate:string;asOf:string;source:string;amountCents:number;currency:'EGP';expiresAt:string};
export type SignedPrice={quote:PriceQuote;signature:string};
export function readFxFeed(d:any,now=Date.now()){
 const rate=d?.rates?.EGP,stamp=Number(d?.time_last_update_unix)*1000;
 if(d?.result!=='success'||d.base_code!=='USD'||typeof rate!=='number'||!Number.isFinite(rate)||rate<=0||rate>10000||!Number.isFinite(stamp)||stamp>now+300000||stamp<now-48*3600000)throw Error('Current USD/EGP reference rate unavailable');
 return{rate:rate.toFixed(6),asOf:new Date(stamp).toISOString(),source:FX_SOURCE};
}
export function priceFromRate(fx:{rate:string;asOf:string;source:string},now=Date.now()):PriceQuote{
 if(!/^\d{1,5}\.\d{6}$/.test(fx.rate)||Number(fx.rate)<=0||Number(fx.rate)>10000||fx.source!==FX_SOURCE||!Number.isFinite(Date.parse(fx.asOf))||Date.parse(fx.asOf)>now+300000||Date.parse(fx.asOf)<now-48*3600000)throw Error('Invalid reference rate');
 const rateMicros=BigInt(fx.rate.replace('.',''));const cents=Number((BigInt(PRICE_USD_CENTS)*rateMicros+500000n)/1000000n);
 return{scope:'omsaze-sandbox-usd-10',usdCents:1000,rate:fx.rate,asOf:fx.asOf,source:fx.source,amountCents:cents,currency:'EGP',expiresAt:new Date(now+15*60000).toISOString()};
}
function canonical(q:PriceQuote){return JSON.stringify({scope:q.scope,usdCents:q.usdCents,rate:q.rate,asOf:q.asOf,source:q.source,amountCents:q.amountCents,currency:q.currency,expiresAt:q.expiresAt})}
export async function signPriceQuote(q:PriceQuote,secret:string):Promise<SignedPrice>{return{quote:q,signature:await verificationHash(secret,'sandbox-price-quote-v1',canonical(q))}}
export async function verifyPriceQuote(raw:any,secret:string,now=Date.now()):Promise<PriceQuote>{
 const q=raw?.quote;
 if(!q||Object.keys(q).sort().join('|')!=='amountCents|asOf|currency|expiresAt|rate|scope|source|usdCents'||q.scope!=='omsaze-sandbox-usd-10'||q.usdCents!==1000||q.currency!=='EGP'||typeof q.rate!=='string'||q.source!==FX_SOURCE||typeof q.asOf!=='string'||typeof q.expiresAt!=='string'||!Number.isFinite(Date.parse(q.expiresAt))||Date.parse(q.expiresAt)<=now||Date.parse(q.expiresAt)>now+16*60000||!Number.isSafeInteger(q.amountCents))throw Error('Refresh the conversion quote before creating checkout.');
 const expected=priceFromRate(q,now);if(q.amountCents!==expected.amountCents||!timingSafeEqual(String(raw.signature||''),await verificationHash(secret,'sandbox-price-quote-v1',canonical(q))))throw Error('Invalid or altered conversion quote');
 return q;
}
export async function currentSignedPrice(db=stagingDb()):Promise<SignedPrice>{
 const now=Date.now();const {data:cached}=await db.from('sandbox_fx_cache').select('rate,rate_as_of,expires_at').eq('pair','USD_EGP').maybeSingle();
 const cacheFresh=(c:typeof cached)=>!!c&&Date.parse(c.rate_as_of)>=now-48*3600000;
 let fx;
 if(cached&&Date.parse(cached.expires_at)>now&&cacheFresh(cached)){
  fx={rate:Number(cached.rate).toFixed(6),asOf:cached.rate_as_of,source:FX_SOURCE};
 }else{
  // The 1h cache entry has expired (or there is none yet). Try a live refresh, but never let a
  // slow/unreachable third-party FX API block the pay-to-unlock flow: if the live call fails and
  // we still have a cached rate inside the 48h freshness window that priceFromRate()/readFxFeed()
  // already enforce, serve that instead of a hard error.
  try{
   const r=await fetch(FX_ENDPOINT,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('FX source unavailable');
   fx=readFxFeed(await r.json(),now);
   const{error}=await db.from('sandbox_fx_cache').upsert({pair:'USD_EGP',rate:fx.rate,rate_as_of:fx.asOf,source:FX_SOURCE,expires_at:new Date(now+3600000).toISOString()});
   if(error)console.error('fx cache upsert failed',error.message);
  }catch(liveErr){
   if(cacheFresh(cached))fx={rate:Number(cached!.rate).toFixed(6),asOf:cached!.rate_as_of,source:FX_SOURCE};
   else throw liveErr;
  }
 }
 return signPriceQuote(priceFromRate(fx,now),await resolveVerificationSecret());
}
export async function optionalSignedPrice(){try{return await currentSignedPrice()}catch{return null}}

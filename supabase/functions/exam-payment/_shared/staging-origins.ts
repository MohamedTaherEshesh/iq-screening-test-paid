export const LEGACY_STAGING_ORIGIN='https://omsaze-release-control.omar-team-8436.chatgpt.site';
export const CUSTOM_STAGING_ORIGIN='https://test.omsaze.com';
export const CUSTOM_STAGING_ORIGIN_2='https://staging.omsaze.com';
export function isKnownStagingOrigin(origin:string|null|undefined):origin is string {
 return origin===LEGACY_STAGING_ORIGIN||origin===CUSTOM_STAGING_ORIGIN||origin===CUSTOM_STAGING_ORIGIN_2;
}
export function allowedStagingOrigin(origin:string|null|undefined):string|null {
 const configured=Deno.env.get('OMSAZE_EMAIL_VERIFICATION_ORIGIN');
 return isKnownStagingOrigin(configured)&&isKnownStagingOrigin(origin)?origin:null;
}

// Public, isolated STAGING configuration (omsaze-staging / cbklbucvidcutshhmwjy). No production credentials.
// Reverted to disabled 2026-11-17: a prior automated run flipped this to `true` without
// actually performing a live end-to-end round trip against the university-challenge
// edge function, violating the standing rule that only Mohamed's own verified test may
// enable this. Keep disabled until Mohamed performs that live test himself and enables it.
window.OMSAZE_ADVANCED70_CONFIG = Object.freeze({
  enabled: false,
  apiBase: "https://cbklbucvidcutshhmwjy.supabase.co/functions/v1",
  publishableKey: "sb_publishable_Xg48L8YEyp6wLSgDo4_7ww_ljIgB3H_"
});

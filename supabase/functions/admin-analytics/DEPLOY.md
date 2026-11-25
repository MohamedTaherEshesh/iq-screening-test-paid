# Deploy admin-analytics (OMS-MND-261125-06)

Owner-only data for the OMSAZE admin page (`/admin.html` on dev.omsaze.com, preview.omsaze.com and, after transport, omsaze.com).
Self-contained: it only imports files from its own `_shared` folder.

Run from `C:\Users\DELL\iq-screening-test-paid` after `git fetch` and `git checkout feature/admin-analytics` (or `git pull` once merged):

```
npx supabase functions deploy admin-analytics --project-ref cbklbucvidcutshhmwjy --no-verify-jwt
```

`--no-verify-jwt` is needed because the admin page has no Supabase session; the function does its own sign-in
(owner email + emailed one-time code + passcode) and signs a 30-minute token.

Recommended second factor (passcode, at least 8 characters, choose your own; it is never stored in git):

```
npx supabase secrets set ADMIN_DASHBOARD_PASSCODE=<your-passcode> --project-ref cbklbucvidcutshhmwjy
```

Rollback: `npx supabase functions delete admin-analytics --project-ref cbklbucvidcutshhmwjy` (nothing else uses it).

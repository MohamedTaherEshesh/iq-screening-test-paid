# Deploy exam-payment (staging only)

Staging Supabase project: `cbklbucvidcutshhmwjy`. Run from the repo root with the Supabase CLI and the staging project linked:

```
supabase functions deploy exam-payment --project-ref cbklbucvidcutshhmwjy --no-verify-jwt=false
```

`verify_jwt` must stay on (the function checks the caller's session itself). Secrets are already set on the staging project and are not stored in this repo.

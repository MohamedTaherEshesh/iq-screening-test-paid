# Deploy exam-payment-webhook (staging only)

This is the Paymob callback. It sends the report and certificate automatically after payment, so it must be
redeployed with the new PDF and mail code (the old copy sent the old design, from verification@omsaze.com).

From the repo root, on the staging project:

```
npx supabase functions deploy exam-payment-webhook --no-verify-jwt --project-ref cbklbucvidcutshhmwjy
```

`--no-verify-jwt` must stay: Paymob calls this function without a Supabase JWT, and the function checks the HMAC itself.
The automatic email is sent only once per payment, so to test it you need a new sandbox payment.

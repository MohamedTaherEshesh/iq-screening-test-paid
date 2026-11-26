-- Rollback OMS-MND-261126-12/-13: removes only the corporate objects. Nothing else is touched.
begin;
drop function if exists public.corporate_register(jsonb), public.corporate_exam_catalog(), public.current_corporate_price(uuid, text),
  public.set_corporate_price(uuid, text, int, text, text), public.set_corporate_status(uuid, text, text, text),
  public.grant_corporate_seats(uuid, text, int, text, text), public.corporate_balances();
drop table if exists public.corporate_seat_ledger, public.corporate_price_history, public.corporate_exam_requests, public.corporate_accounts;
commit;

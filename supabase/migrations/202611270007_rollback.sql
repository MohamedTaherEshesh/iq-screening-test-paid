-- Rollback OMS-MND-261127-07. Deletes balances: export corporate_request_ledger first if any exist.
-- Paid requests go back to 'approved'. Then re-run the -06 functions corporate_portal and set_service_request_status.
begin;
drop function if exists public.corporate_cancel_booking(bigint);
drop function if exists public.corporate_use_booking(bigint, text);
drop function if exists public.corporate_book_seat(uuid, text, timestamptz, text);
drop function if exists public.corporate_mark_request_paid(text, text, int, int, text);
drop view if exists public.corporate_request_balances;
drop table if exists public.corporate_seat_bookings;
drop table if exists public.corporate_request_ledger;
update public.corporate_service_requests set status = 'approved' where status = 'paid';
alter table public.corporate_service_requests drop constraint if exists corporate_service_requests_status_check;
alter table public.corporate_service_requests add constraint corporate_service_requests_status_check check (status in ('new','in_process','approved','rejected','cancelled'));
alter table public.corporate_service_requests drop column if exists paid_at, drop column if exists valid_until, drop column if exists amount_usd_cents, drop column if exists payment_ref;
commit;

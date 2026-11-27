-- OMS-MND-261127-07  Paid in advance -> balance per service request, drawn down until fully used or expired.
-- * New request state 'paid' (after 'approved'). Marking a request paid adds one balance row per requested item
--   (e.g. 80 MindProof Manager + 20 Cognitive University) with a validity end date (default 12 months).
-- * Booking an exam takes 1 seat from the company's oldest still-valid paid request for that item (first to expire,
--   first used); taking the exam turns the booking into a ledger 'use'. Nothing is deleted.
-- * Two balances (owner 2026-11-27): ACTUAL = paid - used (seats really consumed);
--   AVAILABLE = actual - booked (exam sessions booked but not taken yet). Example: 50 paid, 2 booked -> available 48, actual 50;
--   when the 2 exams run, actual 48 = available 48. A cancelled booking returns to available.
-- * State per request: active (balance left, not expired), fully_used, expired (balance left after the end date).
-- Needs OMS-MND-261127-06. Rollback: supabase/migrations/202611270007_rollback.sql
begin;
alter table public.corporate_service_requests drop constraint if exists corporate_service_requests_status_check;
alter table public.corporate_service_requests add constraint corporate_service_requests_status_check
  check (status in ('new','in_process','approved','paid','rejected','cancelled'));
alter table public.corporate_service_requests
  add column if not exists paid_at timestamptz,
  add column if not exists valid_until timestamptz,
  add column if not exists amount_usd_cents int check (amount_usd_cents between 0 and 100000000),
  add column if not exists payment_ref text check (char_length(payment_ref) <= 120);

create table if not exists public.corporate_request_ledger (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references public.corporate_service_requests(id) on delete cascade,
  company_id  uuid not null references public.corporate_accounts(id) on delete cascade,
  item_code   text not null,
  seats       int not null check (seats <> 0 and seats between -1000000 and 1000000),
  kind        text not null check (kind in ('grant','use','adjust')),
  ref         text check (char_length(ref) <= 200),   -- e.g. exam session id for a use
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists corporate_request_ledger_req on public.corporate_request_ledger (request_id, item_code);
alter table public.corporate_request_ledger enable row level security;
revoke all on public.corporate_request_ledger from anon, authenticated;
comment on table public.corporate_request_ledger is 'OMS-MND-261127-07: balance per paid service request and item. grant (+) on payment, use (-1 per exam), adjust (+/-). Rows never edited.';

create table if not exists public.corporate_seat_bookings (
  id            bigint generated always as identity primary key,
  request_id    bigint not null references public.corporate_service_requests(id) on delete cascade,
  company_id    uuid not null references public.corporate_accounts(id) on delete cascade,
  item_code     text not null,
  scheduled_for timestamptz,
  ref           text check (char_length(ref) <= 200),
  status        text not null default 'booked' check (status in ('booked','used','cancelled')),
  created_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index if not exists corporate_seat_bookings_req on public.corporate_seat_bookings (request_id, item_code) where status = 'booked';
alter table public.corporate_seat_bookings enable row level security;
revoke all on public.corporate_seat_bookings from anon, authenticated;
comment on table public.corporate_seat_bookings is 'OMS-MND-261127-07: booked exam seats. booked lowers AVAILABLE; used lowers ACTUAL (ledger use row); cancelled frees the seat.';

create or replace view public.corporate_request_balances with (security_invoker = true) as
  with led as (
    select request_id, item_code,
           coalesce(sum(seats) filter (where kind = 'grant'), 0)::int as granted,
           coalesce(-sum(seats) filter (where kind = 'use'), 0)::int as used,
           coalesce(sum(seats), 0)::int as actual
    from public.corporate_request_ledger group by request_id, item_code),
  bk as (select request_id, item_code, count(*)::int as booked from public.corporate_seat_bookings where status = 'booked' group by request_id, item_code)
  select r.id as request_id, r.reference, r.company_id, led.item_code, r.paid_at, r.valid_until,
         led.granted, led.used, coalesce(bk.booked, 0) as booked,
         led.actual as actual_balance,
         greatest(led.actual - coalesce(bk.booked, 0), 0) as available_balance,
         led.actual as remaining,
         case when led.actual <= 0 then 'fully_used' when r.valid_until <= now() then 'expired' else 'active' end as state
  from public.corporate_service_requests r join led on led.request_id = r.id
  left join bk on bk.request_id = r.id and bk.item_code = led.item_code;
revoke all on public.corporate_request_balances from anon, authenticated;

-- Admin: mark an APPROVED request as paid (payment in advance) and open its balance.
create or replace function public.corporate_mark_request_paid(p_reference text, p_changed_by text, p_valid_months int default 12, p_amount_usd_cents int default null, p_payment_ref text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.corporate_service_requests; n int;
begin
  if p_valid_months is null or p_valid_months < 1 or p_valid_months > 36 then raise exception 'Validity must be 1 to 36 months'; end if;
  select * into r from public.corporate_service_requests where reference = p_reference for update;
  if not found then raise exception 'Unknown request'; end if;
  if r.status <> 'approved' then raise exception 'Request must be approved first'; end if;
  update public.corporate_service_requests set status = 'paid', paid_at = clock_timestamp(), valid_until = clock_timestamp() + make_interval(months => p_valid_months),
         amount_usd_cents = p_amount_usd_cents, payment_ref = left(p_payment_ref, 120),
         status_changed_at = clock_timestamp(), status_changed_by = left(p_changed_by, 200)
   where id = r.id;
  insert into public.corporate_request_ledger(request_id, company_id, item_code, seats, kind, created_by)
  select r.id, r.company_id, l.item_code, l.quantity, 'grant', left(p_changed_by, 200) from public.corporate_service_request_lines l where l.request_id = r.id and l.quantity > 0;
  get diagnostics n = row_count;
  return jsonb_build_object('reference', r.reference, 'status', 'paid', 'items', n, 'valid_until', clock_timestamp() + make_interval(months => p_valid_months));
end $$;
revoke all on function public.corporate_mark_request_paid(text, text, int, int, text) from public, anon, authenticated;

-- Book one seat for an exam session (lowers AVAILABLE only). Oldest valid paid request with available seats first.
-- Service role only (the corporate exam-session step that calls it is a later change).
create or replace function public.corporate_book_seat(p_company uuid, p_item text, p_scheduled_for timestamptz, p_ref text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b record; bid bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('corp-req-seat:' || p_company::text, 89));
  select * into b from public.corporate_request_balances
   where company_id = p_company and item_code = p_item and state = 'active' and available_balance > 0
     and (p_scheduled_for is null or p_scheduled_for < valid_until)
   order by valid_until, paid_at limit 1;
  if not found then raise exception 'no_balance'; end if;
  insert into public.corporate_seat_bookings(request_id, company_id, item_code, scheduled_for, ref) values (b.request_id, p_company, p_item, p_scheduled_for, left(p_ref, 200)) returning id into bid;
  return jsonb_build_object('booking', bid, 'reference', b.reference, 'item', p_item, 'available', b.available_balance - 1, 'actual', b.actual_balance);
end $$;
revoke all on function public.corporate_book_seat(uuid, text, timestamptz, text) from public, anon, authenticated;

-- The booked exam was taken: the seat leaves ACTUAL too (ledger use row).
create or replace function public.corporate_use_booking(p_booking bigint, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare k public.corporate_seat_bookings;
begin
  select * into k from public.corporate_seat_bookings where id = p_booking for update;
  if not found or k.status <> 'booked' then raise exception 'not_booked'; end if;
  update public.corporate_seat_bookings set status = 'used', closed_at = now() where id = k.id;
  insert into public.corporate_request_ledger(request_id, company_id, item_code, seats, kind, ref, created_by)
  values (k.request_id, k.company_id, k.item_code, -1, 'use', left(coalesce(p_ref, k.ref), 200), 'exam');
  return jsonb_build_object('booking', k.id, 'status', 'used');
end $$;
revoke all on function public.corporate_use_booking(bigint, text) from public, anon, authenticated;

-- Booking cancelled: the seat goes back to AVAILABLE.
create or replace function public.corporate_cancel_booking(p_booking bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.corporate_seat_bookings set status = 'cancelled', closed_at = now() where id = p_booking and status = 'booked';
  if not found then raise exception 'not_booked'; end if;
  return jsonb_build_object('booking', p_booking, 'status', 'cancelled');
end $$;
revoke all on function public.corporate_cancel_booking(bigint) from public, anon, authenticated;

-- Status changes other than 'paid' keep using set_service_request_status; it now refuses 'paid' and changes after payment.
create or replace function public.set_service_request_status(p_reference text, p_status text, p_changed_by text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.corporate_service_requests;
begin
  if p_status not in ('new','in_process','approved','rejected','cancelled') then raise exception 'Unknown status'; end if;
  select * into r from public.corporate_service_requests where reference = p_reference for update;
  if not found then raise exception 'Unknown request'; end if;
  if r.status = 'paid' then raise exception 'Request is paid'; end if;
  update public.corporate_service_requests set status = p_status, status_changed_at = clock_timestamp(), status_changed_by = left(p_changed_by, 200), status_note = left(p_note, 500)
   where id = r.id returning * into r;
  return jsonb_build_object('reference', r.reference, 'status', r.status);
end $$;
revoke all on function public.set_service_request_status(text, text, text, text) from public, anon, authenticated;

-- Company portal also shows the balance per request.
create or replace function public.corporate_portal(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare cid uuid; c public.corporate_accounts;
begin
  cid := public.corporate_company_for_token(p_token);
  select * into c from public.corporate_accounts where id = cid;
  return jsonb_build_object(
    'company', jsonb_build_object('name', c.company_name, 'reference', c.reference, 'contact', c.contact_name, 'language', c.language),
    'services', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name_en', s.name_en, 'name_ar', s.name_ar, 'status', s.status, 'items', s.items) order by s.sort)
                          from public.corporate_service_catalog s where s.status <> 'hidden'), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('reference', r.reference, 'service', r.service_code, 'year', r.request_year, 'total', r.total_qty,
                                   'status', r.status, 'created_at', r.created_at, 'notes', r.notes, 'paid_at', r.paid_at, 'valid_until', r.valid_until,
                                   'lines', (select jsonb_object_agg(l.item_code, l.quantity) from public.corporate_service_request_lines l where l.request_id = r.id),
                                   'balance', (select jsonb_object_agg(b.item_code, jsonb_build_object('granted', b.granted, 'used', b.used, 'booked', b.booked, 'actual', b.actual_balance, 'available', b.available_balance, 'state', b.state))
                                               from public.corporate_request_balances b where b.request_id = r.id))
                                   order by r.created_at desc, r.id desc)
                          from public.corporate_service_requests r where r.company_id = cid), '[]'::jsonb));
end $$;
revoke all on function public.corporate_portal(text) from public;
grant execute on function public.corporate_portal(text) to anon, authenticated;
commit;

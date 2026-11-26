-- OMS-MND-261126-04: public certificate verification (QR on the certificate -> verify page).
-- Each result record gets a random, unguessable code (MP-XXXX-XXXX-XXXX, 60 bits). A certificate becomes
-- "valid" when its exam is paid, and "revoked" if the payment is refunded. Valid for 24 months from issue.
-- The public function returns ONLY: name, exam, score, exam date, issue date, valid-until and status.
-- Rollback: drop function public.verify_certificate(text); drop trigger trg_exam_payment_certificate on public.exam_payments;
--   drop function public.trg_exam_payment_certificate(); alter table public.exam_results drop column verification_code,
--   drop column certificate_status, drop column certificate_issued_at, drop column certificate_valid_until, drop column revoked_reason;
--   drop function public.new_certificate_code();

create or replace function public.new_certificate_code() returns text
language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; b bytea := extensions.gen_random_bytes(12); out text := 'MP-'; i int;
begin
  for i in 0..11 loop
    out := out || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    if i in (3, 7) then out := out || '-'; end if;
  end loop;
  return out;
end $$;
revoke all on function public.new_certificate_code() from public, anon, authenticated;

alter table public.exam_results
  add column if not exists verification_code text,
  add column if not exists certificate_status text not null default 'not_issued',
  add column if not exists certificate_issued_at timestamptz,
  add column if not exists certificate_valid_until timestamptz,
  add column if not exists revoked_reason text;
update public.exam_results set verification_code = public.new_certificate_code() where verification_code is null;
alter table public.exam_results alter column verification_code set default public.new_certificate_code(),
  alter column verification_code set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'exam_results_verification_code_key') then
    alter table public.exam_results add constraint exam_results_verification_code_key unique (verification_code);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'exam_results_certificate_status_check') then
    alter table public.exam_results add constraint exam_results_certificate_status_check check (certificate_status in ('not_issued','valid','revoked'));
  end if;
end $$;

-- Payment paid -> certificate valid (24 months). Refunded -> revoked.
create or replace function public.trg_exam_payment_certificate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 -- Never block a payment callback: on any error only a warning is logged.
 begin
  if new.state = 'paid' then
    update public.exam_results set certificate_status = 'valid',
      certificate_issued_at = coalesce(certificate_issued_at, now()),
      certificate_valid_until = coalesce(certificate_valid_until, coalesce(certificate_issued_at, now()) + interval '24 months')
    where session_id = new.test_id and certificate_status = 'not_issued';
  elsif new.state = 'refunded' then
    update public.exam_results set certificate_status = 'revoked', revoked_reason = 'refunded'
    where session_id = new.test_id and certificate_status <> 'revoked';
  end if;
 exception when others then raise warning 'OMS-MND-261126-04 certificate status update failed for %: %', new.test_id, sqlerrm;
 end;
  return new;
end $$;
revoke all on function public.trg_exam_payment_certificate() from public, anon, authenticated;
drop trigger if exists trg_exam_payment_certificate on public.exam_payments;
create trigger trg_exam_payment_certificate after insert or update of state on public.exam_payments
  for each row execute function public.trg_exam_payment_certificate();

-- A result recorded after its payment (not expected, but safe) picks up the payment state.
create or replace function public.trg_exam_result_certificate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.exam_payments;
begin
  select * into p from public.exam_payments where test_id = new.session_id;
  if found and p.state = 'paid' then
    new.certificate_status := 'valid'; new.certificate_issued_at := coalesce(p.updated_at, now());
    new.certificate_valid_until := new.certificate_issued_at + interval '24 months';
  end if;
  return new;
end $$;
revoke all on function public.trg_exam_result_certificate() from public, anon, authenticated;
drop trigger if exists trg_exam_result_certificate on public.exam_results;
create trigger trg_exam_result_certificate before insert on public.exam_results
  for each row execute function public.trg_exam_result_certificate();

-- Backfill: already-paid exams get a valid certificate dated by their payment time.
update public.exam_results r set certificate_status = 'valid', certificate_issued_at = p.updated_at,
  certificate_valid_until = p.updated_at + interval '24 months'
from public.exam_payments p where p.test_id = r.session_id and p.state = 'paid' and r.certificate_status = 'not_issued';
update public.exam_results r set certificate_status = 'revoked', revoked_reason = 'refunded'
from public.exam_payments p where p.test_id = r.session_id and p.state = 'refunded';

-- Public lookup used by the verify page (anyone with the code from the QR).
create or replace function public.verify_certificate(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c text; r public.exam_results;
begin
  c := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if left(c, 2) = 'MP' then c := substr(c, 3); end if;
  if c !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$' then return jsonb_build_object('status', 'not_found'); end if;
  c := 'MP-' || substr(c, 1, 4) || '-' || substr(c, 5, 4) || '-' || substr(c, 9, 4);
  select * into r from public.exam_results where verification_code = c;
  if not found or r.certificate_status = 'not_issued' then return jsonb_build_object('status', 'not_found'); end if;
  if r.certificate_status = 'revoked' then return jsonb_build_object('status', 'revoked', 'code', c); end if;
  return jsonb_build_object(
    'status', case when r.certificate_valid_until < now() then 'expired' else 'valid' end,
    'code', c,
    'name', r.candidate_name,
    'exam', r.exam_tag,
    'correct', r.correct,
    'total', r.total_items,
    'percent', r.percent_correct,
    'exam_date', to_char(r.submitted_at at time zone 'UTC', 'YYYY-MM-DD'),
    'issued_on', to_char(r.certificate_issued_at at time zone 'UTC', 'YYYY-MM-DD'),
    'valid_until', to_char(r.certificate_valid_until at time zone 'UTC', 'YYYY-MM-DD'));
end $$;
revoke all on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;

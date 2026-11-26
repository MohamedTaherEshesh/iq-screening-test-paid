-- OMS-MND-261126-14  Corporate registration form: basic company data needed before any offer.
-- NOT APPLIED. Needs the owner's words "موافق على قاعدة البيانات".
-- Adds 6 optional/required columns to corporate_accounts and replaces corporate_register so that:
--   * organisation type (company / non-profit organisation / government authority / education) is required,
--   * tax number, address, website, billing email are stored,
--   * choosing exams at registration is optional (exams are chosen later in the offer request).
-- Rollback: supabase/migrations/202611260014_rollback.sql
begin;
alter table public.corporate_accounts
  add column if not exists org_type      text check (org_type in ('company','organization','government','education')),
  add column if not exists tax_no        text check (char_length(tax_no) <= 40),
  add column if not exists address       text check (char_length(address) <= 300),
  add column if not exists website       text check (char_length(website) <= 200),
  add column if not exists billing_email text check (char_length(billing_email) <= 200 and billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

create or replace function public.corporate_register(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.corporate_accounts; e jsonb; tag text; n int; total int := 0; ref text; i int := 0; ex int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'invalid_request'; end if;
  if coalesce(p->>'consent','') <> 'yes' then raise exception 'consent_required'; end if;
  if coalesce(p->>'org_type','') not in ('company','organization','government','education') then raise exception 'invalid_fields'; end if;
  perform pg_advisory_xact_lock(hashtextextended('corporate-register', 71));
  if (select count(*) from public.corporate_accounts where created_at > now() - interval '10 minutes') >= 30 then raise exception 'busy'; end if;
  if exists (select 1 from public.corporate_accounts where lower(email) = lower(trim(p->>'email')) and status in ('pending','active')) then raise exception 'email_registered'; end if;
  ex := case when jsonb_typeof(p->'exams') = 'array' then jsonb_array_length(p->'exams') else 0 end;
  if ex > 20 then raise exception 'invalid_fields'; end if;
  loop
    ref := 'CORP-' || to_char(now() at time zone 'UTC', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 5));
    exit when not exists (select 1 from public.corporate_accounts where reference = ref);
    i := i + 1; if i > 5 then raise exception 'busy'; end if;
  end loop;
  insert into public.corporate_accounts(reference, org_type, company_name, registration_no, tax_no, country, city, address, website, sector, employees,
                                        contact_name, contact_title, email, phone, billing_email, notes, language)
  values (ref, p->>'org_type', trim(p->>'company_name'), nullif(trim(p->>'registration_no'), ''), nullif(trim(p->>'tax_no'), ''),
          upper(trim(p->>'country')), nullif(trim(p->>'city'), ''), nullif(trim(p->>'address'), ''), nullif(trim(p->>'website'), ''),
          nullif(trim(p->>'sector'), ''), nullif(trim(p->>'employees'), ''), trim(p->>'contact_name'), nullif(trim(p->>'contact_title'), ''),
          lower(trim(p->>'email')), trim(p->>'phone'), nullif(lower(trim(p->>'billing_email')), ''), nullif(trim(p->>'notes'), ''),
          case when p->>'language' = 'ar' then 'ar' else 'en' end)
  returning * into c;
  if ex > 0 then
    for e in select * from jsonb_array_elements(p->'exams') loop
      tag := e->>'exam'; n := (e->>'seats')::int;
      if not exists (select 1 from public.exam_price_history h where h.exam_tag = tag and h.valid_to is null) then raise exception 'unknown_exam'; end if;
      insert into public.corporate_exam_requests(company_id, exam_tag, seats_requested) values (c.id, tag, n);
      total := total + n;
    end loop;
  end if;
  return jsonb_build_object('reference', c.reference, 'status', c.status, 'exams', ex, 'seats', total);
exception
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_fields';
  when unique_violation then raise exception 'email_registered';
end $$;
revoke all on function public.corporate_register(jsonb) from public;
grant execute on function public.corporate_register(jsonb) to anon, authenticated;
commit;

-- OMS-MND-261126-12  Corporate accounts: company registration, requested exams, seat balance (ledger)
-- OMS-MND-261126-13  Per-company exam prices with history (same rule as Price_<ExamName>: new price opens, old price closes)
-- NOT APPLIED. Needs the owner's words "موافق على قاعدة البيانات" and the backup step at the top of the RUN file.
-- Adds 4 tables + 8 functions. Does NOT touch exam_payments, exam_results, exam_price_history, question_bank or demo tables.
-- Rollback: supabase/migrations/202611260012_rollback.sql
begin;

create table public.corporate_accounts (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique,
  company_name     text not null check (char_length(company_name) between 2 and 200),
  registration_no  text check (char_length(registration_no) <= 60),
  country          text not null check (country ~ '^[A-Z]{2}$'),
  city             text check (char_length(city) <= 100),
  sector           text check (char_length(sector) <= 100),
  employees        text check (employees in ('1-50','51-200','201-1000','1000+')),
  contact_name     text not null check (char_length(contact_name) between 2 and 120),
  contact_title    text check (char_length(contact_title) <= 120),
  email            text not null check (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone            text not null check (phone ~ '^\+?[0-9 ()-]{7,25}$'),
  notes            text check (char_length(notes) <= 1000),
  language         text not null default 'en' check (language in ('en','ar')),
  status           text not null default 'pending' check (status in ('pending','active','suspended','rejected')),
  status_changed_at timestamptz,
  status_changed_by text,
  status_note      text,
  created_at       timestamptz not null default now()
);
comment on table public.corporate_accounts is 'OMS-MND-261126-12: companies registered from omsaze.com/corporate.html. Status set by the owner in admin.';
-- One open (pending or active) registration per work email.
create unique index corporate_accounts_open_email on public.corporate_accounts (lower(email)) where status in ('pending','active');

create table public.corporate_exam_requests (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references public.corporate_accounts(id) on delete cascade,
  exam_tag        text not null,
  seats_requested int  not null check (seats_requested between 1 and 10000),
  created_at      timestamptz not null default now(),
  unique (company_id, exam_tag)
);

create table public.corporate_price_history (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.corporate_accounts(id) on delete cascade,
  exam_tag     text not null,
  currency     text not null default 'USD' check (currency = 'USD'),
  amount_cents int  not null check (amount_cents between 100 and 100000),
  valid_from   timestamptz not null,
  valid_to     timestamptz,
  changed_by   text,
  note         text,
  created_at   timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
comment on table public.corporate_price_history is 'OMS-MND-261126-13: negotiated price per company per exam. valid_to null = current. No open row = global Price_<ExamName> applies.';
create unique index corporate_price_one_open on public.corporate_price_history (company_id, exam_tag) where valid_to is null;

create table public.corporate_seat_ledger (
  id             bigint generated always as identity primary key,
  company_id     uuid not null references public.corporate_accounts(id) on delete cascade,
  exam_tag       text not null,
  seats          int  not null check (seats <> 0 and seats between -10000 and 10000),
  kind           text not null check (kind in ('grant','use','adjust')),
  unit_usd_cents int,
  price_source   text check (price_source in ('company','global')),
  price_id       bigint,
  note           text check (char_length(note) <= 300),
  created_by     text,
  created_at     timestamptz not null default now()
);
comment on table public.corporate_seat_ledger is 'OMS-MND-261126-12: seat balance per company per exam = sum(seats). grant (+), use (-), adjust (+/-). Rows are never edited.';

alter table public.corporate_accounts      enable row level security;
alter table public.corporate_exam_requests enable row level security;
alter table public.corporate_price_history enable row level security;
alter table public.corporate_seat_ledger   enable row level security;
revoke all on public.corporate_accounts, public.corporate_exam_requests, public.corporate_price_history, public.corporate_seat_ledger from anon, authenticated;

-- Exams a company can choose = exams that have a current global price.
create or replace function public.corporate_exam_catalog()
returns table(exam_tag text) language sql stable security definer set search_path = public, pg_temp as $$
  select exam_tag from public.exam_price_history where valid_to is null order by exam_tag
$$;
revoke all on function public.corporate_exam_catalog() from public;
grant execute on function public.corporate_exam_catalog() to anon, authenticated;

-- Public registration (called from corporate.html with the publishable key). Returns a reference only.
create or replace function public.corporate_register(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.corporate_accounts; e jsonb; tag text; n int; total int := 0; ref text; i int := 0;
  s text;
begin
  if p is null or jsonb_typeof(p) <> 'object' or jsonb_typeof(p->'exams') <> 'array' then raise exception 'invalid_request'; end if;
  if coalesce(p->>'consent','') <> 'yes' then raise exception 'consent_required'; end if;
  -- Flood guard: at most 30 registrations in 10 minutes for the whole site.
  perform pg_advisory_xact_lock(hashtextextended('corporate-register', 71));
  if (select count(*) from public.corporate_accounts where created_at > now() - interval '10 minutes') >= 30 then raise exception 'busy'; end if;
  if exists (select 1 from public.corporate_accounts where lower(email) = lower(trim(p->>'email')) and status in ('pending','active')) then raise exception 'email_registered'; end if;
  if jsonb_array_length(p->'exams') < 1 or jsonb_array_length(p->'exams') > 20 then raise exception 'choose_exam'; end if;
  loop
    ref := 'CORP-' || to_char(now() at time zone 'UTC', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 5));
    exit when not exists (select 1 from public.corporate_accounts where reference = ref);
    i := i + 1; if i > 5 then raise exception 'busy'; end if;
  end loop;
  s := nullif(trim(p->>'employees'), '');
  insert into public.corporate_accounts(reference, company_name, registration_no, country, city, sector, employees, contact_name, contact_title, email, phone, notes, language)
  values (ref, trim(p->>'company_name'), nullif(trim(p->>'registration_no'), ''), upper(trim(p->>'country')), nullif(trim(p->>'city'), ''),
          nullif(trim(p->>'sector'), ''), s, trim(p->>'contact_name'), nullif(trim(p->>'contact_title'), ''), lower(trim(p->>'email')),
          trim(p->>'phone'), nullif(trim(p->>'notes'), ''), case when p->>'language' = 'ar' then 'ar' else 'en' end)
  returning * into c;
  for e in select * from jsonb_array_elements(p->'exams') loop
    tag := e->>'exam'; n := (e->>'seats')::int;
    if not exists (select 1 from public.exam_price_history h where h.exam_tag = tag and h.valid_to is null) then raise exception 'unknown_exam'; end if;
    insert into public.corporate_exam_requests(company_id, exam_tag, seats_requested) values (c.id, tag, n);
    total := total + n;
  end loop;
  return jsonb_build_object('reference', c.reference, 'status', c.status, 'exams', jsonb_array_length(p->'exams'), 'seats', total);
exception
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_fields';
  when unique_violation then raise exception 'email_registered';
end $$;
revoke all on function public.corporate_register(jsonb) from public;
grant execute on function public.corporate_register(jsonb) to anon, authenticated;

-- Current price for a company and exam: company price if open, else the global Price_<ExamName>.
create or replace function public.current_corporate_price(p_company uuid, p_exam_tag text)
returns table(source text, price_id bigint, amount_cents int, valid_from timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select * from (
    select 'company'::text, id, amount_cents, valid_from from public.corporate_price_history where company_id = p_company and exam_tag = p_exam_tag and valid_to is null
    union all
    select 'global'::text, id, amount_cents, valid_from from public.exam_price_history where exam_tag = p_exam_tag and valid_to is null
  ) x(source, price_id, amount_cents, valid_from) order by x.source = 'global' limit 1
$$;
revoke all on function public.current_corporate_price(uuid, text) from public, anon, authenticated;

-- Activate a new company price from now on. The open price closes at the same moment. p_amount_cents null = go back to the global price.
create or replace function public.set_corporate_price(p_company uuid, p_exam_tag text, p_amount_cents int, p_changed_by text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t timestamptz := clock_timestamp(); old public.corporate_price_history; nw public.corporate_price_history;
begin
  if not exists (select 1 from public.corporate_accounts where id = p_company) then raise exception 'Unknown company'; end if;
  if not exists (select 1 from public.exam_price_history where exam_tag = p_exam_tag and valid_to is null) then raise exception 'Unknown exam %', p_exam_tag; end if;
  if p_amount_cents is not null and (p_amount_cents < 100 or p_amount_cents > 100000) then raise exception 'Price must be between 1 and 1000 USD'; end if;
  perform pg_advisory_xact_lock(hashtextextended('corp-price:' || p_company::text || ':' || p_exam_tag, 73));
  select * into old from public.corporate_price_history where company_id = p_company and exam_tag = p_exam_tag and valid_to is null for update;
  if found and old.amount_cents = p_amount_cents then return jsonb_build_object('changed', false, 'current', to_jsonb(old)); end if;
  if not found and p_amount_cents is null then return jsonb_build_object('changed', false); end if;
  if found then update public.corporate_price_history set valid_to = t where id = old.id; end if;
  if p_amount_cents is not null then
    insert into public.corporate_price_history(company_id, exam_tag, amount_cents, valid_from, changed_by, note)
    values (p_company, p_exam_tag, p_amount_cents, t, left(p_changed_by, 200), left(p_note, 500)) returning * into nw;
  end if;
  return jsonb_build_object('changed', true, 'closed_at', case when old.id is null then null else t end, 'current', to_jsonb(nw));
end $$;
revoke all on function public.set_corporate_price(uuid, text, int, text, text) from public, anon, authenticated;

create or replace function public.set_corporate_status(p_company uuid, p_status text, p_changed_by text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.corporate_accounts;
begin
  if p_status not in ('pending','active','suspended','rejected') then raise exception 'Unknown status'; end if;
  update public.corporate_accounts set status = p_status, status_changed_at = clock_timestamp(), status_changed_by = left(p_changed_by, 200), status_note = left(p_note, 500)
  where id = p_company returning * into c;
  if not found then raise exception 'Unknown company'; end if;
  return jsonb_build_object('id', c.id, 'status', c.status);
end $$;
revoke all on function public.set_corporate_status(uuid, text, text, text) from public, anon, authenticated;

-- Add (or correct) seats. The unit price in force at that moment is stored on the row.
create or replace function public.grant_corporate_seats(p_company uuid, p_exam_tag text, p_seats int, p_changed_by text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare pr record; bal int; r public.corporate_seat_ledger;
begin
  if not exists (select 1 from public.corporate_accounts where id = p_company and status = 'active') then raise exception 'Company is not active'; end if;
  if p_seats is null or p_seats = 0 or p_seats < -10000 or p_seats > 10000 then raise exception 'Seats must be between -10000 and 10000, not 0'; end if;
  perform pg_advisory_xact_lock(hashtextextended('corp-seats:' || p_company::text, 79));
  select * into pr from public.current_corporate_price(p_company, p_exam_tag);
  if not found then raise exception 'Unknown exam %', p_exam_tag; end if;
  select coalesce(sum(seats), 0) into bal from public.corporate_seat_ledger where company_id = p_company and exam_tag = p_exam_tag;
  if bal + p_seats < 0 then raise exception 'Balance cannot go below zero'; end if;
  insert into public.corporate_seat_ledger(company_id, exam_tag, seats, kind, unit_usd_cents, price_source, price_id, note, created_by)
  values (p_company, p_exam_tag, p_seats, case when p_seats > 0 then 'grant' else 'adjust' end, pr.amount_cents, pr.source, pr.price_id, left(p_note, 300), left(p_changed_by, 200))
  returning * into r;
  return jsonb_build_object('entry', to_jsonb(r), 'balance', bal + p_seats);
end $$;
revoke all on function public.grant_corporate_seats(uuid, text, int, text, text) from public, anon, authenticated;

create or replace function public.corporate_balances()
returns table(company_id uuid, exam_tag text, granted int, used int, balance int)
language sql stable security definer set search_path = public, pg_temp as $$
  select company_id, exam_tag,
         coalesce(sum(seats) filter (where seats > 0), 0)::int,
         coalesce(-sum(seats) filter (where seats < 0), 0)::int,
         coalesce(sum(seats), 0)::int
  from public.corporate_seat_ledger group by company_id, exam_tag
$$;
revoke all on function public.corporate_balances() from public, anon, authenticated;

commit;

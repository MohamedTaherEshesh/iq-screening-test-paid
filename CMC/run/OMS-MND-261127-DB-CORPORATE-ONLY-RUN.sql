-- OMSAZE DB batch CORPORATE ONLY: corporate part of 261126-16 (male/female columns + corporate_register), 261127-01, -04, -06, -07. No exam age rule, no gender columns.
-- Run ONCE in Supabase > omsaze-staging > SQL Editor > New query > paste all > Run. One transaction: if any step fails, nothing changes.
-- OMS-MND-261127-03 (employees total) is NOT included: the field was removed from registration (owner 2026-11-27 09:45Z).
begin;

-- ===== m16_corp.sql =====
alter table public.corporate_accounts
  add column if not exists male_count   int check (male_count between 0 and 1000000),
  add column if not exists female_count int check (female_count between 0 and 1000000);
-- Corporate registration stores expected male/female employee counts (optional).
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
                                        contact_name, contact_title, email, phone, billing_email, notes, language, male_count, female_count)
  values (ref, p->>'org_type', trim(p->>'company_name'), nullif(trim(p->>'registration_no'), ''), nullif(trim(p->>'tax_no'), ''),
          upper(trim(p->>'country')), nullif(trim(p->>'city'), ''), nullif(trim(p->>'address'), ''), nullif(trim(p->>'website'), ''),
          nullif(trim(p->>'sector'), ''), nullif(trim(p->>'employees'), ''), trim(p->>'contact_name'), nullif(trim(p->>'contact_title'), ''),
          lower(trim(p->>'email')), trim(p->>'phone'), nullif(lower(trim(p->>'billing_email')), ''), nullif(trim(p->>'notes'), ''),
          case when p->>'language' = 'ar' then 'ar' else 'en' end,
          nullif(p->>'male_count', '')::int, nullif(p->>'female_count', '')::int)
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

-- ===== 202611270001_org_types.sql =====
-- OMS-MND-261127-01: grouped organization type list on corporate registration (22 types in 6 groups).
-- The 4 old codes stay valid so existing rows and older pages keep working.
alter table public.corporate_accounts drop constraint if exists corporate_accounts_org_type_check;
alter table public.corporate_accounts add constraint corporate_accounts_org_type_check check (org_type in (
  'company','organization','government','education',
  'enterprise','holding','sme','startup','consulting','system_integrator',
  'gov_ministry','gov_authority','municipality','soe',
  'university','school','training_center','research_institute',
  'ngo','charity','association','international_org',
  'healthcare','financial',
  'individual','other'));
-- corporate_register: widen its org_type check in place (works on the -14 and the -16 version of the function).
do $$
declare src text; old_list text := $q$('company','organization','government','education')$q$;
begin
  src := pg_get_functiondef('public.corporate_register(jsonb)'::regprocedure);
  if position(old_list in src) = 0 then raise exception 'corporate_register org_type list not found'; end if;
  src := replace(src, old_list, $q$('company','organization','government','education','enterprise','holding','sme','startup','consulting','system_integrator','gov_ministry','gov_authority','municipality','soe','university','school','training_center','research_institute','ngo','charity','association','international_org','healthcare','financial','individual','other')$q$);
  execute src;
end $$;

-- ===== 202611270004_corporate_access_links.sql =====
-- OMS-MND-261127-04  Company admin sign-in by email code (owner design 2026-11-27).
-- * The company's registered work email is its first ADMIN. OMSAZE admin can add more admin emails, remove them,
--   or change the first one. Only a company's admin emails can enter that company, never another one.
-- * The company code is its registration reference (CORP-YYMMDD-XXXXX), sent in the registration emails.
-- * Sign-in (owner 2026-11-27 09:49Z): company admin email; company code optional (people forget it).
--   Without a code the company is found from the email (it must be an admin of exactly one approved company).
--   -> a 6-digit code is emailed (10 min, 5 tries) -> a 60-minute session
--   for that company only. Codes and sessions are stored as SHA-256 hashes, never in plain text.
-- * OMSAZE admin can change a company's admin email (e.g. the person left); every change is logged;
--   open sessions of the old admin are closed.
-- * Registration notice: registration_notice_at marks the "registration received" email (sent once).
-- Service role only, except corporate_verify_code (public, rate limited). Rollback: 202611270004_rollback.sql
alter table public.corporate_accounts add column if not exists registration_notice_at timestamptz;

create table if not exists public.corporate_login_codes (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.corporate_accounts(id) on delete cascade,
  email       text not null,
  code_hash   text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes',
  attempts    int not null default 0,
  used_at     timestamptz
);
create table if not exists public.corporate_sessions (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.corporate_accounts(id) on delete cascade,
  email       text not null,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '60 minutes',
  closed_at   timestamptz
);
create table if not exists public.corporate_email_changes (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.corporate_accounts(id) on delete cascade,
  old_email   text not null,
  new_email   text not null,
  changed_by  text,
  note        text,
  created_at  timestamptz not null default now()
);
create table if not exists public.corporate_admins (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.corporate_accounts(id) on delete cascade,
  email       text not null check (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at  timestamptz not null default now(),
  created_by  text,
  removed_at  timestamptz,
  removed_by  text
);
create unique index if not exists corporate_admins_open on public.corporate_admins (company_id, lower(email)) where removed_at is null;
comment on table public.corporate_admins is 'OMS-MND-261127-04: extra company admin emails added by OMSAZE admin (the registered email is always an admin).';
alter table public.corporate_admins enable row level security;
revoke all on public.corporate_admins from anon, authenticated;
comment on table public.corporate_login_codes is 'OMS-MND-261127-04: one-time sign-in codes for company admins (hash only).';
comment on table public.corporate_sessions is 'OMS-MND-261127-04: 60-minute company admin sessions (hash only), one company per session.';
comment on table public.corporate_email_changes is 'OMS-MND-261127-04: log of company admin email changes made by OMSAZE admin.';
alter table public.corporate_login_codes enable row level security;
alter table public.corporate_sessions enable row level security;
alter table public.corporate_email_changes enable row level security;
revoke all on public.corporate_login_codes, public.corporate_sessions, public.corporate_email_changes from anon, authenticated;

create or replace function public.corp_hash(p text) returns text language sql immutable set search_path = public, pg_temp as
$$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
revoke all on function public.corp_hash(text) from public, anon, authenticated;

-- Edge function asks for a code for an email. Returns null when no ACTIVE company has that admin email.
-- At most 5 codes per company per hour. The plain code is returned once (to be emailed) and never stored.
-- Is this email an admin of this company? (registered email, or an extra admin not removed)
create or replace function public.corp_is_admin(p_company uuid, p_email text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.corporate_accounts where id = p_company and lower(email) = lower(trim(p_email)))
      or exists (select 1 from public.corporate_admins where company_id = p_company and lower(email) = lower(trim(p_email)) and removed_at is null)
$$;
revoke all on function public.corp_is_admin(uuid, text) from public, anon, authenticated;

-- Which approved company does this sign-in mean? Code given: that company, if the email is its admin.
-- No code: the one approved company where the email is an admin (null if none or more than one).
create or replace function public.corp_company_for_admin(p_code text, p_email text) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cid uuid; n int; em text := lower(trim(p_email));
begin
  if nullif(trim(coalesce(p_code, '')), '') is not null then
    select id into cid from public.corporate_accounts where reference = upper(trim(p_code)) and status = 'active';
    if cid is null or not public.corp_is_admin(cid, em) then return null; end if;
    return cid;
  end if;
  select count(*), min(c.id::text)::uuid into n, cid from public.corporate_accounts c where c.status = 'active' and public.corp_is_admin(c.id, em);
  if n = 1 then return cid; end if;
  return null;
end $$;
revoke all on function public.corp_company_for_admin(text, text) from public, anon, authenticated;

-- Public: company code -> company name (approved companies only). Optional helper for the sign-in page.
create or replace function public.corporate_lookup(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.corporate_accounts;
begin
  if p_code is null or upper(trim(p_code)) !~ '^CORP-[0-9]{6}-[0-9A-F]{5}$' then raise exception 'unknown_company'; end if;
  select * into c from public.corporate_accounts where reference = upper(trim(p_code)) and status = 'active';
  if not found then raise exception 'unknown_company'; end if;
  return jsonb_build_object('company', c.company_name);
end $$;
revoke all on function public.corporate_lookup(text) from public;
grant execute on function public.corporate_lookup(text) to anon, authenticated;

-- Edge function step 2: company code + admin email -> code to email. Null when the email is not an admin of that
-- approved company. At most 5 codes per company per hour. The plain code is returned once (to be emailed), never stored.
create or replace function public.corporate_request_code(p_code text, p_email text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.corporate_accounts; code text; em text := lower(trim(p_email));
begin
  select * into c from public.corporate_accounts where id = public.corp_company_for_admin(p_code, em);
  if not found then return null; end if;
  if (select count(*) from public.corporate_login_codes where company_id = c.id and created_at > now() - interval '1 hour') >= 5 then raise exception 'busy'; end if;
  code := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint) % 1000000)::text, 6, '0');
  update public.corporate_login_codes set used_at = coalesce(used_at, now()) where company_id = c.id and email = em and used_at is null;
  insert into public.corporate_login_codes(company_id, email, code_hash) values (c.id, em, public.corp_hash(c.id::text || ':' || em || ':' || code));
  return jsonb_build_object('code', code, 'email', em, 'contact_name', c.contact_name, 'company_name', c.company_name, 'reference', c.reference, 'language', c.language);
end $$;
revoke all on function public.corporate_request_code(text, text) from public, anon, authenticated;

-- Public step 3: company code + email + code -> 60-minute session for that company. 5 wrong tries kill the code.
create or replace function public.corporate_verify_code(p_code text, p_email text, p_otp text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.corporate_accounts; lc public.corporate_login_codes; tok text; em text := lower(trim(p_email));
begin
  if p_otp is null or p_otp !~ '^[0-9]{6}$' then raise exception 'invalid_code'; end if;
  select * into c from public.corporate_accounts where id = public.corp_company_for_admin(p_code, em);
  if not found then raise exception 'invalid_code'; end if;
  select * into lc from public.corporate_login_codes where company_id = c.id and email = em and used_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if not found then raise exception 'invalid_code'; end if;
  if lc.code_hash <> public.corp_hash(c.id::text || ':' || em || ':' || p_otp) then
    update public.corporate_login_codes set attempts = attempts + 1, used_at = case when attempts + 1 >= 5 then now() else null end where id = lc.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  update public.corporate_login_codes set used_at = now() where id = lc.id;
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.corporate_sessions(company_id, email, token_hash) values (c.id, em, public.corp_hash(tok));
  return jsonb_build_object('ok', true, 'token', tok, 'expires_in', 3600);
end $$;
revoke all on function public.corporate_verify_code(text, text, text) from public;
grant execute on function public.corporate_verify_code(text, text, text) to anon, authenticated;

-- Session token -> company. The session dies if the company is no longer active or its admin email changed.
create or replace function public.corporate_company_for_token(p_token text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare cid uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'invalid_session'; end if;
  select s.company_id into cid from public.corporate_sessions s join public.corporate_accounts c on c.id = s.company_id
   where s.token_hash = public.corp_hash(p_token) and s.closed_at is null and s.expires_at > now() and c.status = 'active' and public.corp_is_admin(c.id, s.email);
  if cid is null then raise exception 'invalid_session'; end if;
  return cid;
end $$;
revoke all on function public.corporate_company_for_token(text) from public, anon, authenticated;

-- OMSAZE admin changes a company's admin email. Logged; old sessions and codes closed.
create or replace function public.corporate_change_admin_email(p_company uuid, p_new_email text, p_changed_by text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.corporate_accounts; ne text := lower(trim(p_new_email));
begin
  if ne is null or char_length(ne) > 200 or ne !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Invalid email'; end if;
  select * into c from public.corporate_accounts where id = p_company for update;
  if not found then raise exception 'Unknown company'; end if;
  if lower(c.email) = ne then raise exception 'Same email'; end if;
  if exists (select 1 from public.corporate_accounts where lower(email) = ne and status in ('pending','active') and id <> p_company) then raise exception 'Email used by another company'; end if;
  update public.corporate_accounts set email = ne where id = p_company;
  insert into public.corporate_email_changes(company_id, old_email, new_email, changed_by, note) values (p_company, c.email, ne, left(p_changed_by, 200), left(p_note, 300));
  update public.corporate_sessions set closed_at = now() where company_id = p_company and email = lower(c.email) and closed_at is null;
  update public.corporate_login_codes set used_at = now() where company_id = p_company and email = lower(c.email) and used_at is null;
  return jsonb_build_object('company', p_company, 'old_email', c.email, 'new_email', ne);
end $$;
revoke all on function public.corporate_change_admin_email(uuid, text, text, text) from public, anon, authenticated;

-- OMSAZE admin adds an extra admin email to a company (logged in corporate_email_changes with old_email '(added)').
create or replace function public.corporate_add_admin(p_company uuid, p_email text, p_changed_by text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare ne text := lower(trim(p_email));
begin
  if ne is null or char_length(ne) > 200 or ne !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Invalid email'; end if;
  if not exists (select 1 from public.corporate_accounts where id = p_company) then raise exception 'Unknown company'; end if;
  if public.corp_is_admin(p_company, ne) then raise exception 'Already an admin'; end if;
  if (select count(*) from public.corporate_admins where company_id = p_company and removed_at is null) >= 10 then raise exception 'Too many admins'; end if;
  insert into public.corporate_admins(company_id, email, created_by) values (p_company, ne, left(p_changed_by, 200));
  insert into public.corporate_email_changes(company_id, old_email, new_email, changed_by, note) values (p_company, '(added)', ne, left(p_changed_by, 200), left(p_note, 300));
  return jsonb_build_object('company', p_company, 'added', ne);
end $$;
revoke all on function public.corporate_add_admin(uuid, text, text, text) from public, anon, authenticated;

-- OMSAZE admin removes an extra admin email (the registered email can only be changed, not removed).
create or replace function public.corporate_remove_admin(p_company uuid, p_email text, p_changed_by text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare em text := lower(trim(p_email));
begin
  update public.corporate_admins set removed_at = now(), removed_by = left(p_changed_by, 200) where company_id = p_company and lower(email) = em and removed_at is null;
  if not found then raise exception 'Not an extra admin'; end if;
  insert into public.corporate_email_changes(company_id, old_email, new_email, changed_by, note) values (p_company, em, '(removed)', left(p_changed_by, 200), left(p_note, 300));
  update public.corporate_sessions set closed_at = now() where company_id = p_company and email = em and closed_at is null;
  update public.corporate_login_codes set used_at = now() where company_id = p_company and email = em and used_at is null;
  return jsonb_build_object('company', p_company, 'removed', em);
end $$;
revoke all on function public.corporate_remove_admin(uuid, text, text, text) from public, anon, authenticated;

-- "Registration received" email: edge function claims the notice once, within 30 minutes of registering.
create or replace function public.corporate_claim_registration_notice(p_reference text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.corporate_accounts;
begin
  update public.corporate_accounts set registration_notice_at = now()
   where reference = p_reference and registration_notice_at is null and created_at > now() - interval '30 minutes'
  returning * into c;
  if not found then return null; end if;
  return jsonb_build_object('email', c.email, 'contact_name', c.contact_name, 'company_name', c.company_name, 'reference', c.reference, 'language', c.language);
end $$;
revoke all on function public.corporate_claim_registration_notice(text) from public, anon, authenticated;

-- ===== 202611270006_corporate_service_requests.sql =====
-- OMS-MND-261127-06  Corporate service requests: after approval a company opens its link, chooses a service
-- and sends requests (transactions) as often as it needs. Assessment is open now (Cognitive + MindProof quotas);
-- Training, Academy, Digital Labs and AI Automation are listed as "coming soon"; other divisions are hidden until the owner opens them.
-- (owner 2026-11-27: list = Assessment, Training, Academy, Digital, AI automation)
-- The rest are listed as "coming soon" and open later by changing their status in the catalog.
-- Every request is kept with its date and year; nothing is edited by the company after sending.
-- Request states (owner 2026-11-27): new -> in_process -> approved (or rejected / cancelled). Paid + balance: OMS-MND-261127-07.
-- Needs OMS-MND-261127-04. Rollback: supabase/migrations/202611270006_rollback.sql
create table if not exists public.corporate_service_catalog (
  code     text primary key check (code ~ '^[a-z_]{3,40}$'),
  name_en  text not null,
  name_ar  text not null,
  status   text not null default 'soon' check (status in ('open','soon','hidden')),
  sort     int  not null default 100,
  items    jsonb not null default '[]'::jsonb  -- [{code, family, category, name_en, name_ar}] what a request can ask for (Assessment: 2 exams x 5 categories)
);
insert into public.corporate_service_catalog(code, name_en, name_ar, status, sort, items) values
  ('assessment', 'Assessment', 'التقييم', 'open', 10, '[{"code": "mindproof_junior", "family": "mindproof", "category": "junior", "name_en": "MindProof Reasoning Score, Junior", "name_ar": "مؤشر MindProof للاستدلال، الناشئون"}, {"code": "cognitive_junior", "family": "cognitive", "category": "junior", "name_en": "Cognitive Assessment, Junior", "name_ar": "التقييم المعرفي، الناشئون"}, {"code": "mindproof_university", "family": "mindproof", "category": "university", "name_en": "MindProof Reasoning Score, Universities", "name_ar": "مؤشر MindProof للاستدلال، الجامعات"}, {"code": "cognitive_university", "family": "cognitive", "category": "university", "name_en": "Cognitive Assessment, Universities", "name_ar": "التقييم المعرفي، الجامعات"}, {"code": "mindproof_manager", "family": "mindproof", "category": "manager", "name_en": "MindProof Reasoning Score, Manager", "name_ar": "مؤشر MindProof للاستدلال، المديرون"}, {"code": "cognitive_manager", "family": "cognitive", "category": "manager", "name_en": "Cognitive Assessment, Manager", "name_ar": "التقييم المعرفي، المديرون"}, {"code": "mindproof_senior_manager", "family": "mindproof", "category": "senior_manager", "name_en": "MindProof Reasoning Score, Senior Manager", "name_ar": "مؤشر MindProof للاستدلال، كبار المديرين"}, {"code": "cognitive_senior_manager", "family": "cognitive", "category": "senior_manager", "name_en": "Cognitive Assessment, Senior Manager", "name_ar": "التقييم المعرفي، كبار المديرين"}, {"code": "mindproof_c_level", "family": "mindproof", "category": "c_level", "name_en": "MindProof Reasoning Score, C-Level", "name_ar": "مؤشر MindProof للاستدلال، الإدارة العليا"}, {"code": "cognitive_c_level", "family": "cognitive", "category": "c_level", "name_en": "Cognitive Assessment, C-Level", "name_ar": "التقييم المعرفي، الإدارة العليا"}]'),

  ('training', 'Training', 'التدريب', 'soon', 20, '[]'),
  ('academy', 'Academy', 'الأكاديمية', 'soon', 30, '[]'),
  ('digital_labs', 'Digital Labs', 'المختبرات الرقمية', 'soon', 40, '[]'),
  ('ai_automation', 'AI Automation', 'الأتمتة بالذكاء الاصطناعي', 'soon', 50, '[]'),
  ('sap_erp', 'SAP & ERP', 'SAP وأنظمة ERP', 'hidden', 60, '[]'),
  ('managed_services', 'Managed Services', 'الخدمات المُدارة', 'hidden', 70, '[]'),
  ('advisory', 'Advisory', 'الاستشارات', 'hidden', 80, '[]'),
  ('engineering', 'Engineering Services', 'الخدمات الهندسية', 'hidden', 90, '[]')
on conflict (code) do nothing;

create table if not exists public.corporate_service_requests (
  id           bigint generated always as identity primary key,
  reference    text not null unique,
  company_id   uuid not null references public.corporate_accounts(id) on delete cascade,
  service_code text not null references public.corporate_service_catalog(code),
  request_year int  not null,
  total_qty    int  not null check (total_qty between 1 and 1000000),
  notes        text check (char_length(notes) <= 1000),
  status       text not null default 'new' check (status in ('new','in_process','approved','rejected','cancelled')),
  status_changed_at timestamptz,
  status_changed_by text,
  status_note  text,
  created_at   timestamptz not null default now()
);
create index if not exists corporate_service_requests_company on public.corporate_service_requests (company_id, created_at desc);
create table if not exists public.corporate_service_request_lines (
  request_id bigint not null references public.corporate_service_requests(id) on delete cascade,
  item_code  text not null check (item_code ~ '^[a-z_]{3,40}$'),
  quantity   int  not null check (quantity between 0 and 1000000),
  primary key (request_id, item_code)
);
comment on table public.corporate_service_requests is 'OMS-MND-261127-06: one row per service request (transaction) per company; year kept for yearly tracking.';
alter table public.corporate_service_catalog enable row level security;
alter table public.corporate_service_requests enable row level security;
alter table public.corporate_service_request_lines enable row level security;
revoke all on public.corporate_service_catalog, public.corporate_service_requests, public.corporate_service_request_lines from anon, authenticated;

-- Portal view for a link holder: company basics, catalog, and the company's own request history.
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
                                   'status', r.status, 'created_at', r.created_at, 'notes', r.notes,
                                   'lines', (select jsonb_object_agg(l.item_code, l.quantity) from public.corporate_service_request_lines l where l.request_id = r.id))
                                   order by r.created_at desc, r.id desc)
                          from public.corporate_service_requests r where r.company_id = cid), '[]'::jsonb));
end $$;
revoke all on function public.corporate_portal(text) from public;
grant execute on function public.corporate_portal(text) to anon, authenticated;

-- Send one request. p = {service, lines: {item: qty}, notes}. Max 20 requests per company per day.
create or replace function public.corporate_request_service(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare cid uuid; s public.corporate_service_catalog; k text; q int; tot int := 0; ref text; i int := 0; rid bigint; allowed text[];
begin
  cid := public.corporate_company_for_token(p_token);
  if p is null or jsonb_typeof(p) <> 'object' or jsonb_typeof(p->'lines') <> 'object' then raise exception 'invalid_fields'; end if;
  select * into s from public.corporate_service_catalog where code = p->>'service';
  if not found or s.status <> 'open' then raise exception 'service_closed'; end if;
  select array_agg(x->>'code') into allowed from jsonb_array_elements(s.items) x;
  for k in select jsonb_object_keys(p->'lines') loop
    if not (k = any(coalesce(allowed, '{}'))) then raise exception 'invalid_fields'; end if;
    if jsonb_typeof(p->'lines'->k) <> 'number' then raise exception 'invalid_fields'; end if;
    q := (p->'lines'->>k)::int;
    if q < 0 or q > 1000000 or (p->'lines'->>k)::numeric <> q then raise exception 'invalid_fields'; end if;
    tot := tot + q;
  end loop;
  if tot < 1 then raise exception 'quantity_required'; end if;
  if tot > 1000000 then raise exception 'invalid_fields'; end if;
  perform pg_advisory_xact_lock(hashtextextended('corp-service:' || cid::text, 83));
  if (select count(*) from public.corporate_service_requests where company_id = cid and created_at > now() - interval '1 day') >= 20 then raise exception 'busy'; end if;
  loop
    ref := 'SRQ-' || to_char(now() at time zone 'UTC', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 5));
    exit when not exists (select 1 from public.corporate_service_requests where reference = ref);
    i := i + 1; if i > 5 then raise exception 'busy'; end if;
  end loop;
  insert into public.corporate_service_requests(reference, company_id, service_code, request_year, total_qty, notes)
  values (ref, cid, s.code, extract(year from now() at time zone 'UTC')::int, tot, nullif(left(trim(p->>'notes'), 1000), ''))
  returning id into rid;
  insert into public.corporate_service_request_lines(request_id, item_code, quantity)
  select rid, key, (value::text)::int from jsonb_each(p->'lines');
  return jsonb_build_object('reference', ref, 'service', s.code, 'total', tot);
exception
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_fields';
end $$;
revoke all on function public.corporate_request_service(text, jsonb) from public;
grant execute on function public.corporate_request_service(text, jsonb) to anon, authenticated;

-- Admin: change a request's status (service role only, called by admin-analytics).
create or replace function public.set_service_request_status(p_reference text, p_status text, p_changed_by text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.corporate_service_requests;
begin
  if p_status not in ('new','in_process','approved','rejected','cancelled') then raise exception 'Unknown status'; end if;
  update public.corporate_service_requests set status = p_status, status_changed_at = clock_timestamp(), status_changed_by = left(p_changed_by, 200), status_note = left(p_note, 500)
   where reference = p_reference returning * into r;
  if not found then raise exception 'Unknown request'; end if;
  return jsonb_build_object('reference', r.reference, 'status', r.status);
end $$;
revoke all on function public.set_service_request_status(text, text, text, text) from public, anon, authenticated;

-- ===== 202611270007_service_request_balance.sql =====
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

select 'OMSAZE DB batch applied' as result, (select count(*) from public.corporate_service_catalog) as services;
commit;

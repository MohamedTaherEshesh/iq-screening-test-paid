-- OMS-MND-261127-04  Company admin sign-in by email code (owner design 2026-11-27).
-- * The company's registered work email is its ADMIN. Only that email can enter that company, never another one.
-- * Sign-in: admin enters the company name AND the registered admin email (both must match one approved company)
--   -> a 6-digit code is emailed (10 min, 5 tries) -> a 60-minute session
--   for that company only. Codes and sessions are stored as SHA-256 hashes, never in plain text.
-- * OMSAZE admin can change a company's admin email (e.g. the person left); every change is logged;
--   open sessions of the old admin are closed.
-- * Registration notice: registration_notice_at marks the "registration received" email (sent once).
-- Service role only, except corporate_verify_code (public, rate limited). Rollback: 202611270004_rollback.sql
begin;
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
create or replace function public.corp_name_key(p text) returns text language sql immutable set search_path = public, pg_temp as
$$ select regexp_replace(lower(trim(coalesce(p, ''))), '\s+', ' ', 'g') $$;
revoke all on function public.corp_name_key(text) from public, anon, authenticated;

create or replace function public.corporate_request_code(p_email text, p_company text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.corporate_accounts; code text;
begin
  select * into c from public.corporate_accounts where lower(email) = lower(trim(p_email)) and public.corp_name_key(company_name) = public.corp_name_key(p_company)
     and status = 'active' order by created_at desc limit 1;
  if not found then return null; end if;
  if (select count(*) from public.corporate_login_codes where company_id = c.id and created_at > now() - interval '1 hour') >= 5 then raise exception 'busy'; end if;
  code := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint) % 1000000)::text, 6, '0');
  update public.corporate_login_codes set used_at = coalesce(used_at, now()) where company_id = c.id and used_at is null;
  insert into public.corporate_login_codes(company_id, email, code_hash) values (c.id, lower(c.email), public.corp_hash(c.id::text || ':' || code));
  return jsonb_build_object('code', code, 'email', c.email, 'contact_name', c.contact_name, 'company_name', c.company_name, 'reference', c.reference, 'language', c.language);
end $$;
revoke all on function public.corporate_request_code(text, text) from public, anon, authenticated;

-- Public: email + code -> session token for that company only. 5 wrong tries kill the code.
create or replace function public.corporate_verify_code(p_email text, p_company text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.corporate_accounts; lc public.corporate_login_codes; tok text;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then raise exception 'invalid_code'; end if;
  select * into c from public.corporate_accounts where lower(email) = lower(trim(p_email)) and public.corp_name_key(company_name) = public.corp_name_key(p_company)
     and status = 'active' order by created_at desc limit 1;
  if not found then raise exception 'invalid_code'; end if;
  select * into lc from public.corporate_login_codes where company_id = c.id and lower(email) = lower(c.email) and used_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if not found then raise exception 'invalid_code'; end if;
  if lc.code_hash <> public.corp_hash(c.id::text || ':' || p_code) then
    update public.corporate_login_codes set attempts = attempts + 1, used_at = case when attempts + 1 >= 5 then now() else null end where id = lc.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  update public.corporate_login_codes set used_at = now() where id = lc.id;
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.corporate_sessions(company_id, email, token_hash) values (c.id, lower(c.email), public.corp_hash(tok));
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
   where s.token_hash = public.corp_hash(p_token) and s.closed_at is null and s.expires_at > now() and c.status = 'active' and lower(c.email) = s.email;
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
  update public.corporate_sessions set closed_at = now() where company_id = p_company and closed_at is null;
  update public.corporate_login_codes set used_at = now() where company_id = p_company and used_at is null;
  return jsonb_build_object('company', p_company, 'old_email', c.email, 'new_email', ne);
end $$;
revoke all on function public.corporate_change_admin_email(uuid, text, text, text) from public, anon, authenticated;

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
commit;

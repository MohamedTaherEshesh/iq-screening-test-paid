-- OMS-MND-261127-06  Corporate service requests: after approval a company opens its link, chooses a service
-- and sends requests (transactions) as often as it needs. Assessment is open now (Cognitive + MindProof quotas);
-- Training, Academy, Digital Labs and AI Automation are listed as "coming soon"; other divisions are hidden until the owner opens them.
-- (owner 2026-11-27: list = Assessment, Training, Academy, Digital, AI automation)
-- The rest are listed as "coming soon" and open later by changing their status in the catalog.
-- Every request is kept with its date and year; nothing is edited by the company after sending.
-- Request states (owner 2026-11-27): new -> in_process -> approved (or rejected / cancelled). Paid + balance: OMS-MND-261127-07.
-- Needs OMS-MND-261127-04. Rollback: supabase/migrations/202611270006_rollback.sql
begin;
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
commit;

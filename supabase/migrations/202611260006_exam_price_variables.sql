-- OMS-MND-261126-06: exam prices as server-side global variables (Price_<ExamName>) with full history.
-- One open row per exam = the current price. Changing a price closes the open row (valid_to = change time)
-- and opens a new row (valid_from = the same change time). The next quote/checkout uses the new price.
-- The browser never sends or decides the price: exam-payment reads it here and signs it into the quote.
-- Backward compatible: the old fixed USD 10 quote (scope omsaze-sandbox-usd-10) is still accepted until the
-- new exam-payment is deployed.
-- Rollback: re-create reserve_exam_payment from 202611260006_rollback.sql (old body below), then
--   drop function public.set_exam_price(text,int,text,text), public.current_exam_price(text), public.assert_exam_price_quote(jsonb,text);
--   alter table public.exam_payments drop column price_id; drop table public.exam_price_history;

create table if not exists public.exam_price_history (
  id            bigint generated always as identity primary key,
  variable_name text not null check (variable_name ~ '^Price_[A-Za-z0-9_]+$'),
  exam_tag      text not null,
  currency      text not null default 'USD' check (currency = 'USD'),
  amount_cents  int  not null check (amount_cents between 100 and 100000),
  valid_from    timestamptz not null,
  valid_to      timestamptz,
  changed_by    text,
  note          text,
  created_at    timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
comment on table public.exam_price_history is 'OMS-MND-261126-06: Price_<ExamName> global variables. valid_to null = current price. Old price valid_to = new price valid_from.';
create unique index if not exists exam_price_one_open on public.exam_price_history(exam_tag) where valid_to is null;
alter table public.exam_price_history enable row level security;
revoke all on public.exam_price_history from anon, authenticated;

insert into public.exam_price_history(variable_name, exam_tag, amount_cents, valid_from, changed_by, note)
select v.name, v.tag, 1000, now(), 'system', 'Starting price (was fixed USD 10 in code)'
from (values ('Price_University_IQ_Preparation', 'university-iq-preparation'),
             ('Price_University_Cognitive_Skills', 'university-cognitive-skills')) v(name, tag)
where not exists (select 1 from public.exam_price_history h where h.exam_tag = v.tag);

create or replace function public.current_exam_price(p_exam_tag text)
returns table(price_id bigint, variable_name text, amount_cents int, valid_from timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select id, variable_name, amount_cents, valid_from from public.exam_price_history where exam_tag = p_exam_tag and valid_to is null
$$;
revoke all on function public.current_exam_price(text) from public, anon, authenticated;

create or replace function public.set_exam_price(p_exam_tag text, p_amount_cents int, p_changed_by text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t timestamptz := clock_timestamp(); old public.exam_price_history; nw public.exam_price_history;
begin
  if p_amount_cents is null or p_amount_cents < 100 or p_amount_cents > 100000 then raise exception 'Price must be between 1 and 1000 USD'; end if;
  perform pg_advisory_xact_lock(hashtextextended('exam-price:' || coalesce(p_exam_tag, ''), 61));
  select * into old from public.exam_price_history where exam_tag = p_exam_tag and valid_to is null for update;
  if not found then raise exception 'Unknown exam %', p_exam_tag; end if;
  if old.amount_cents = p_amount_cents then return jsonb_build_object('changed', false, 'current', to_jsonb(old)); end if;
  update public.exam_price_history set valid_to = t where id = old.id;
  insert into public.exam_price_history(variable_name, exam_tag, amount_cents, valid_from, changed_by, note)
  values (old.variable_name, p_exam_tag, p_amount_cents, t, left(p_changed_by, 200), left(p_note, 500)) returning * into nw;
  return jsonb_build_object('changed', true, 'previous', to_jsonb(old) || jsonb_build_object('valid_to', t), 'current', to_jsonb(nw));
end $$;
revoke all on function public.set_exam_price(text, int, text, text) from public, anon, authenticated;

alter table public.exam_payments add column if not exists price_id bigint references public.exam_price_history(id);

-- New quote format (scope omsaze-exam-price-v2): the quote names the exam and the price row it was made from.
create or replace function public.assert_exam_price_quote(q jsonb, p_exam_tag text) returns bigint
language plpgsql set search_path = public, pg_temp as $$
declare cur record;
begin
  if q is null or jsonb_typeof(q) <> 'object' or not (q ?& array['scope','currency','usdCents','source','rate','amountCents','expiresAt','asOf','examTag','priceId']) then raise exception 'Incomplete quote'; end if;
  select * into cur from public.current_exam_price(p_exam_tag);
  if not found then raise exception 'No price for this exam'; end if;
  if q->>'scope' <> 'omsaze-exam-price-v2' or q->>'examTag' <> p_exam_tag or (q->>'priceId')::bigint <> cur.price_id
     or (q->>'usdCents')::int <> cur.amount_cents or q->>'currency' <> 'EGP' or q->>'source' <> 'https://www.exchangerate-api.com'
     or (q->>'rate')::numeric <= 0 or (q->>'rate')::numeric > 10000
     or (q->>'amountCents')::int <> round(cur.amount_cents * (q->>'rate')::numeric)::int
     or (q->>'expiresAt')::timestamptz <= clock_timestamp() or (q->>'expiresAt')::timestamptz > clock_timestamp() + interval '16 minutes'
     or (q->>'asOf')::timestamptz > clock_timestamp() + interval '5 minutes' or (q->>'asOf')::timestamptz < clock_timestamp() - interval '48 hours'
  then raise exception 'Price changed or quote invalid. Refresh the quote.'; end if;
  return cur.price_id;
end $$;
revoke all on function public.assert_exam_price_quote(jsonb, text) from public, anon, authenticated;

create or replace function public.reserve_exam_payment(p_test_id uuid, p_candidate uuid, p_quote jsonb)
 returns jsonb language plpgsql set search_path to 'public', 'pg_temp' as $function$
declare t public.exam_payments; s public.university_challenge_sessions; pid bigint; usd int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text,29));
  select * into s from public.university_challenge_sessions where id = p_test_id;
  if not found or s.candidate_id <> p_candidate or s.submitted is not true or s.result is null then
    return null;
  end if;
  select * into t from public.exam_payments where test_id = p_test_id;
  if found then
    if t.candidate_id <> p_candidate then return null; end if;
    return to_jsonb(t) || jsonb_build_object('existing', true);
  end if;
  if p_quote->>'scope' = 'omsaze-exam-price-v2' then
    pid := public.assert_exam_price_quote(p_quote, s.exam_tag);
    usd := (p_quote->>'usdCents')::int;
  else
    perform public.assert_sandbox_usd_quote(p_quote);  -- old fixed USD 10 quote, until the new exam-payment is deployed
    usd := 1000;
  end if;
  insert into public.exam_payments(candidate_id, test_id, amount_cents, usd_cents, fx_rate, fx_as_of, fx_source, price_id)
  values (p_candidate, p_test_id, (p_quote->>'amountCents')::int, usd, (p_quote->>'rate')::numeric, (p_quote->>'asOf')::timestamptz, p_quote->>'source', pid)
  returning * into t;
  return to_jsonb(t) || jsonb_build_object('existing', false);
end $function$;

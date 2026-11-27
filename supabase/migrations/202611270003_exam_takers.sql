-- OMS-MND-261127-03  Corporate registration: one approximate total of employees who will take exams
-- (replaces the separate male/female inputs on the form; old male_count/female_count columns are kept for old rows).
-- Needs OMS-MND-261126-16 applied first (corporate_register with male_count/female_count). Order: -16, -01, -03.
-- Rollback: supabase/migrations/202611270003_rollback.sql
begin;
alter table public.corporate_accounts
  add column if not exists exam_takers int check (exam_takers between 0 and 1000000);

do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('public.corporate_register(jsonb)'::regprocedure);
  if position('exam_takers' in d) > 0 then raise notice 'corporate_register already stores exam_takers'; return; end if;
  n := replace(d, 'language, male_count, female_count)', 'language, male_count, female_count, exam_takers)');
  n := replace(n, 'nullif(p->>''female_count'', '''')::int)', 'nullif(p->>''female_count'', '''')::int, nullif(p->>''exam_takers'', '''')::int)');
  if n = d or position('exam_takers)' in n) = 0 or position('''exam_takers''' in n) = 0 then
    raise exception 'corporate_register is not the OMS-MND-261126-16 version: apply -16 first';
  end if;
  execute n;
end $do$;
revoke all on function public.corporate_register(jsonb) from public;
grant execute on function public.corporate_register(jsonb) to anon, authenticated;
commit;

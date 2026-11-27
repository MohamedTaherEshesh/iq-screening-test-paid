-- Rollback OMS-MND-261127-03: stop storing exam_takers, drop the column.
begin;
do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('public.corporate_register(jsonb)'::regprocedure);
  n := replace(d, 'language, male_count, female_count, exam_takers)', 'language, male_count, female_count)');
  n := replace(n, ', nullif(p->>''exam_takers'', '''')::int)', ')');
  if n <> d then execute n; end if;
end $do$;
alter table public.corporate_accounts drop column if exists exam_takers;
revoke all on function public.corporate_register(jsonb) from public;
grant execute on function public.corporate_register(jsonb) to anon, authenticated;
commit;

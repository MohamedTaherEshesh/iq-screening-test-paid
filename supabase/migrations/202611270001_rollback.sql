-- Rollback OMS-MND-261127-01 (only if no rows use the new codes; otherwise map them first, e.g. enterprise/holding/sme/startup/consulting/system_integrator/financial/healthcare/individual/other -> company, gov_* /municipality/soe -> government, university/school/training_center/research_institute -> education, ngo/charity/association/international_org -> organization)
begin;
do $$
declare src text; new_list text := $q$('company','organization','government','education','enterprise','holding','sme','startup','consulting','system_integrator','gov_ministry','gov_authority','municipality','soe','university','school','training_center','research_institute','ngo','charity','association','international_org','healthcare','financial','individual','other')$q$;
begin
  src := pg_get_functiondef('public.corporate_register(jsonb)'::regprocedure);
  src := replace(src, new_list, $q$('company','organization','government','education')$q$);
  execute src;
end $$;
alter table public.corporate_accounts drop constraint if exists corporate_accounts_org_type_check;
alter table public.corporate_accounts add constraint corporate_accounts_org_type_check check (org_type in ('company','organization','government','education'));
commit;

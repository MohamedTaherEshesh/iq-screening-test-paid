-- OMS-MND-261127-01: grouped organization type list on corporate registration (22 types in 6 groups).
-- The 4 old codes stay valid so existing rows and older pages keep working.
begin;
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
commit;

-- Rollback OMS-MND-261126-14: restore corporate_register from 202611260012 (re-run that function block), then:
begin;
alter table public.corporate_accounts drop column if exists org_type, drop column if exists tax_no, drop column if exists address,
  drop column if exists website, drop column if exists billing_email;
commit;
-- then re-run the "create or replace function public.corporate_register" block from 202611260012_corporate_accounts.sql

-- Rollback OMS-MND-261127-04 (run the -06 rollback first if -06 is applied). Admin email changes already made stay.
begin;
drop function if exists public.corporate_claim_registration_notice(text);
drop function if exists public.corporate_change_admin_email(uuid, text, text, text);
drop function if exists public.corporate_company_for_token(text);
drop function if exists public.corporate_verify_code(text, text);
drop function if exists public.corporate_request_code(text);
drop function if exists public.corp_hash(text);
drop table if exists public.corporate_email_changes;
drop table if exists public.corporate_sessions;
drop table if exists public.corporate_login_codes;
alter table public.corporate_accounts drop column if exists registration_notice_at;
commit;

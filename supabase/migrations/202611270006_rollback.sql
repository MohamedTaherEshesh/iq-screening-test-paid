-- Rollback OMS-MND-261127-06. Deletes all service requests: export them first if any exist.
begin;
drop function if exists public.set_service_request_status(text, text, text, text);
drop function if exists public.corporate_request_service(text, jsonb);
drop function if exists public.corporate_portal(text);
drop table if exists public.corporate_service_request_lines;
drop table if exists public.corporate_service_requests;
drop table if exists public.corporate_service_catalog;
commit;

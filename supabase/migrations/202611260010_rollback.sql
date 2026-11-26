-- Rollback OMS-MND-261126-10 (removes the demo tables and functions only)
begin;
drop function if exists public.demo_submit(uuid, smallint[]);
drop function if exists public.demo_start(text);
drop function if exists public.demo_status(text);
drop table if exists public.demo_runs;
drop table if exists public.demo_usage;
drop table if exists public.demo_questions;
commit;

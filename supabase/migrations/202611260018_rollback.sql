-- Rollback OMS-MND-261126-18
begin;
drop view if exists public.exam_item_response_stats;
drop function if exists public.log_item_view(uuid,int,int,int);
drop function if exists public.log_item_answer(uuid,int,int);
drop table if exists public.exam_item_responses;
drop trigger if exists trg_question_bank_version on public.question_bank;
drop function if exists public.trg_question_bank_version();
commit;

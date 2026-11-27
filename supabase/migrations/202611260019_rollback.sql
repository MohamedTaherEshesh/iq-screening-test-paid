-- Rollback OMS-MND-261126-19 (export public.question_reviews first if it holds real reviews)
begin;
drop view if exists public.question_review_status;
drop table if exists public.question_reviews;
drop function if exists public.trg_question_reviews_fill();
drop function if exists public.trg_question_reviews_append_only();
commit;

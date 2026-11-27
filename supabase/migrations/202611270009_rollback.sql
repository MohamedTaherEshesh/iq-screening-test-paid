-- Rollback OMS-MND-261127-09 (run only if needed).
begin;
update public.exam_price_history set variable_name = 'Price_University_IQ_Preparation' where variable_name = 'Price_University_MindProof_Reasoning_Score';
-- First prices set for new exams stay in history; close them if needed: update public.exam_price_history set valid_to = now() where valid_to is null and exam_tag not in ('university-iq-preparation','university-cognitive-skills');
-- set_exam_price: re-create the body from 202611260006_exam_price_variables.sql.
drop function if exists public.exam_price_variable(text);
-- Service-role grants are harmless to keep; to remove: revoke execute on function <same list> from service_role;
commit;

-- OMS-MND-261126-17 rollback: remove the visual drafts and the item_meta column.
delete from public.question_bank where provenance = 'code_generated_v1' and legacy_id like 'V-%';
alter table public.question_bank drop column if exists item_meta;
-- Full restore if ever needed: compare with public.backup_question_bank_20261126_17.

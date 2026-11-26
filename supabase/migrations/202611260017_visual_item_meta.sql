-- OMS-MND-261126-17 (APPLIED 2026-11-26 after owner approval "موافق على قاعدة البيانات").
-- Backup taken first: public.backup_question_bank_20261126_17 (1,991 rows).
alter table public.question_bank add column if not exists item_meta jsonb;
comment on column public.question_bank.item_meta is 'OMS-MND-261126-17: format, format_name, level, exam_type, subdomain, difficulty_score, stem_svg(_en/_ar), rule data for code-generated items';

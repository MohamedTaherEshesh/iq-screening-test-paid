-- OMS-MND-261126-02: questions that measure English ability are never translated.
-- Paste all of this into Supabase > SQL Editor (project omsaze-staging) and press Run.
alter table public.question_bank add column if not exists english_only boolean not null default false;

insert into public.cmc_backup_oms_mnd_261126_01 (id, legacy_id, prompt_ar, options_ar, explanation_ar, backed_up_at)
select id, legacy_id, prompt_ar, options_ar, explanation_ar, now() from public.question_bank
where (domain = 'linguistic' or legacy_id = 'BACKFILL1125-CREATIVE-979168b5')
  and id not in (select id from public.cmc_backup_oms_mnd_261126_01);

create or replace function public.enforce_english_only_questions() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.domain = 'linguistic' then
    new.english_only := true;
  end if;
  if new.english_only and new.prompt_en is not null then
    new.prompt_ar := new.prompt_en;
    new.options_ar := new.options_en;
  end if;
  return new;
end $$;

drop trigger if exists trg_english_only_questions on public.question_bank;
create trigger trg_english_only_questions
  before insert or update on public.question_bank
  for each row execute function public.enforce_english_only_questions();

update public.question_bank set english_only = true where legacy_id = 'BACKFILL1125-CREATIVE-979168b5';
update public.question_bank set updated_at = updated_at where domain = 'linguistic';

create or replace view public.cmc_check_translated_english_only with (security_invoker = true) as
select id, legacy_id, domain, status from public.question_bank
where english_only and (prompt_ar is distinct from prompt_en or options_ar is distinct from options_en);

select count(*) as english_only_questions from public.question_bank where english_only;

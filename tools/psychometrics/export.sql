-- OMS-MND-261126-22: read-only export for analyze.py. Run in the Supabase SQL editor and download as CSV.
-- Needs OMS-MND-261126-18 (response log) and -16/-21 (gender). Only submitted sessions; no names or emails.
select r.session_id, r.exam_tag, r.language, coalesce(s.candidate_gender, 'undisclosed') as gender,
       r.position, r.item_code, r.item_version,
       case when r.answer is null then '' when r.is_correct then '1' else '0' end as correct,
       round(r.visible_seconds::numeric, 1) as visible_seconds,
       round(r.seconds_to_first_answer::numeric, 1) as seconds_to_first_answer,
       r.answer_changes
  from public.exam_item_response_stats r
  join public.university_challenge_sessions s on s.id = r.session_id
 where r.submitted
 order by r.exam_tag, r.session_id, r.position;

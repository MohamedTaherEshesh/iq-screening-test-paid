// OMS-MND-261126-08: display names of each exam. Exam IDs (exam_tag) stay unchanged.
export const EXAM_NAMES: Record<string, { en: string; ar: string }> = {
  'university-iq-preparation': { en: 'MindProof Reasoning Score', ar: 'مؤشر MindProof للاستدلال' },
  'university-cognitive-skills': { en: 'University Cognitive Skills', ar: 'المهارات المعرفية الجامعية' },
};
export function examName(tag: string | null | undefined, lang: 'en' | 'ar' = 'en'): string {
  const n = tag ? EXAM_NAMES[tag] : undefined;
  if (n) return lang === 'ar' ? n.ar : n.en;
  return lang === 'ar' ? 'اختبار MindProof' : 'MindProof assessment';
}

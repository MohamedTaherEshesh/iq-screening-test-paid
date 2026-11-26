// OMS-MND-261126-08/-15: display names of each exam (-15: level names "for Universities"). Exam IDs (exam_tag) stay unchanged.
export const EXAM_NAMES: Record<string, { en: string; ar: string }> = {
  'university-iq-preparation': { en: 'MindProof Reasoning Score for Universities', ar: 'مؤشر MindProof للاستدلال للجامعات' },
  'university-cognitive-skills': { en: 'Cognitive Assessment for Universities', ar: 'التقييم المعرفي للجامعات' },
};
export function examName(tag: string | null | undefined, lang: 'en' | 'ar' = 'en'): string {
  const n = tag ? EXAM_NAMES[tag] : undefined;
  if (n) return lang === 'ar' ? n.ar : n.en;
  return lang === 'ar' ? 'اختبار MindProof' : 'MindProof assessment';
}

// OMSAZE MindProof public catalog. Public metadata only; never contains questions, keys or secrets.
// OMS-MND-261126-15: 5 levels x 2 exam types = 10 exams. Exam IDs of the 2 live exams are unchanged.
//   MindProof Reasoning Score (MRS) = reasoning and problem solving: one index score, timed, used for selection.
//   Cognitive Assessment (CA)       = profile of cognitive skills: a score per skill, used for development.
// Age rule: Junior 10 to 17 (under 18). Universities, Manager, Senior Manager and C-Level: 18 and over.
(function (w) {
  "use strict";
  const LEVELS = [
    { id: "junior", en: "Junior", ar: "الناشئون", ageEn: "Age 10 to 17", ageAr: "من 10 إلى 17 سنة", minAge: 10, maxAge: 17,
      focusEn: "School-age students. Everyday and school situations, simple language, no workplace content. Never shares questions with the University level.",
      focusAr: "طلاب المدارس. مواقف يومية ومدرسية ولغة بسيطة ولا محتوى عن العمل. لا يشارك أي سؤال مع مستوى الجامعات.",
      difficultyEn: "Foundation", difficultyAr: "تأسيسي" },
    { id: "university", en: "Universities", ar: "الجامعات", ageEn: "18 and over", ageAr: "18 سنة فأكثر", minAge: 18,
      focusEn: "University students and fresh graduates. Academic examples: study material, data in reports, research reasoning.",
      focusAr: "طلاب الجامعات والخريجون الجدد. أمثلة أكاديمية: مواد دراسية وبيانات في تقارير واستدلال بحثي.",
      difficultyEn: "Intermediate", difficultyAr: "متوسط" },
    { id: "manager", en: "Manager", ar: "المديرون", ageEn: "18 and over", ageAr: "18 سنة فأكثر", minAge: 18,
      focusEn: "Team leads, managers and post-graduates. Business cases, reading numbers and reports, prioritising and deciding.",
      focusAr: "قادة الفرق والمديرون وطلاب الدراسات العليا. حالات عمل وقراءة أرقام وتقارير وترتيب أولويات واتخاذ قرار.",
      difficultyEn: "Advanced", difficultyAr: "متقدم" },
    { id: "senior-manager", en: "Senior Manager", ar: "كبار المديرين", ageEn: "18 and over", ageAr: "18 سنة فأكثر", minAge: 18,
      focusEn: "Heads of department and senior managers. Multi-step problems, incomplete or conflicting information, trade-offs across teams.",
      focusAr: "رؤساء الإدارات وكبار المديرين. مسائل متعددة الخطوات ومعلومات ناقصة أو متعارضة وموازنة بين الإدارات.",
      difficultyEn: "High", difficultyAr: "عالٍ" },
    { id: "c-level", en: "C-Level", ar: "الإدارة العليا (C-Level)", ageEn: "18 and over", ageAr: "18 سنة فأكثر", minAge: 18,
      focusEn: "CEOs, executives and board-level decision makers. Strategy, ambiguity, risk and long-range consequences under time pressure.",
      focusAr: "الرؤساء التنفيذيون وصنّاع القرار على مستوى مجلس الإدارة. استراتيجية وغموض ومخاطر وعواقب بعيدة المدى تحت ضغط الوقت.",
      difficultyEn: "Very high", difficultyAr: "عالٍ جدًا" }
  ];
  const TYPES = {
    mrs: { en: "MindProof Reasoning Score", ar: "مؤشر MindProof للاستدلال",
      sumEn: "Measures how you reason and solve new problems: logical, numerical, abstract and critical thinking. Timed. Gives one index score and a band (A to E), used to compare and select.",
      sumAr: "يقيس طريقة تفكيرك وحلك لمشكلات جديدة: تفكير منطقي وعددي ومجرد ونقدي. محدد بوقت. يعطي درجة واحدة (مؤشر) ومستوى من A إلى E، ويُستخدم للمقارنة والاختيار." },
    ca: { en: "Cognitive Assessment", ar: "التقييم المعرفي",
      sumEn: "Maps your cognitive skills one by one: language, attention and memory, processing speed, visual and creative thinking. Accuracy over speed. Gives a score per skill and development tips.",
      sumAr: "يرسم ملف مهاراتك المعرفية مهارةً مهارة: اللغة والانتباه والذاكرة وسرعة المعالجة والتفكير البصري والإبداعي. الدقة أهم من السرعة. يعطي درجة لكل مهارة ونصائح للتطوير." }
  };
  const LEVEL_NAME = { junior: ["Junior", "للناشئين"], university: ["for Universities", "للجامعات"], manager: ["for Managers", "للمديرين"], "senior-manager": ["for Senior Managers", "لكبار المديرين"], "c-level": ["for C-Level", "للإدارة العليا"] };
  // Live exams keep their original IDs (question banks, prices and certificates use them).
  const LIVE = {
    "university-mrs": { id: "university-iq-preparation", previewHref: "./iq-prep.html", questionCount: 70, durationSeconds: 6300, domains: 7 },
    "university-ca": { id: "university-cognitive-skills", previewHref: "./university.html", questionCount: 70, durationSeconds: 6300, domains: 7 }
  };
  const items = [];
  LEVELS.forEach(function (lv) {
    ["mrs", "ca"].forEach(function (t) {
      const live = LIVE[lv.id + "-" + t];
      const ty = TYPES[t], ln = LEVEL_NAME[lv.id];
      items.push(Object.assign({
        id: lv.id + "-" + (t === "mrs" ? "reasoning-score" : "cognitive-assessment"),
        level: lv.id, type: t, group: lv.id,
        en: lv.id === "junior" ? ty.en + " Junior" : ty.en + " " + ln[0],
        ar: ty.ar + " " + ln[1],
        summaryEn: ty.sumEn + " Level: " + lv.en + " (" + lv.ageEn + "). " + lv.focusEn,
        summaryAr: ty.sumAr + " المستوى: " + lv.ar + " (" + lv.ageAr + "). " + lv.focusAr,
        minAge: lv.minAge, maxAge: lv.maxAge || null,
        pilot: !!live
      }, live || {}));
    });
  });
  w.OMSAZE_T_LEVELS = Object.freeze(LEVELS.map(function (l) { return Object.freeze(l); }));
  w.OMSAZE_T_TYPES = Object.freeze(TYPES);
  w.OMSAZE_T_CATALOG = Object.freeze(items.map(function (item) {
    return Object.freeze(Object.assign({}, item, { enabled: false, status: item.pilot ? "pilot-in-development" : "planned" }));
  }));
})(window);

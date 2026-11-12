// OMSAZE T development-only catalog. Public metadata; never contains questions, keys or secrets.
// Keep aligned with the private backend assessment-catalog.ts.
// All availability flags are disabled until the corresponding backend and reviewed bank are ready.
(function (w) {
  "use strict";
  const categories = [
    { id:"university-iq-preparation", group:"university", en:"University IQ Preparation", ar:"التحضير لاختبار الذكاء الجامعي", pilot:true, questionCount:70, durationSeconds:6300, domains:7, previewHref:"./university.html" },
    { id:"university-cognitive-skills", group:"university", en:"University Cognitive Skills", ar:"المهارات المعرفية الجامعية" },
    { id:"junior-iq-preparation", group:"junior", en:"Junior IQ Preparation", ar:"التحضير لاختبارات الذكاء للناشئين" },
    { id:"junior-cognitive-skills", group:"junior", en:"Junior Cognitive Skills", ar:"المهارات المعرفية للناشئين" },
    { id:"advanced-iq-preparation", group:"advanced", en:"Advanced IQ Preparation", ar:"التحضير لاختبارات الذكاء المتقدمة" },
    { id:"advanced-cognitive-skills", group:"advanced", en:"Advanced Cognitive Skills", ar:"المهارات المعرفية المتقدمة" },
    { id:"management-iq-simulation", group:"management", en:"Management IQ Simulation", ar:"محاكاة اختبارات الذكاء للإدارة" },
    { id:"management-cognitive-skills", group:"management", en:"Management Cognitive Skills", ar:"المهارات المعرفية للإدارة" }
  ];
  w.OMSAZE_T_CATALOG = Object.freeze(categories.map(item => Object.freeze({
    ...item,
    pilot: item.pilot === true,
    enabled: false,
    status: item.pilot ? "pilot-in-development" : "planned"
  })));
})(window);

/* OMSAZE site shell for MindProof: the same header, logo and footer as the main OMSAZE website,
   so MindProof reads as part of OMSAZE Assessment. Set OMSAZE_MAIN to the environment to link to
   (preview.omsaze.com = STAGING mirror of live; change to https://omsaze.com when it is published). */
(function () {
  var MAIN = 'https://preview.omsaze.com/';
  var s = document.currentScript;
  var label = (s && s.getAttribute('data-label')) || 'Assessment catalog';
  var u = function (p) { return MAIN + p; };
  var nav = [
    ['about.html', 'About'], ['consulting.html', 'Advisory'], ['sap-erp.html', 'SAP &amp; ERP'],
    ['erp-support.html', 'Managed Services'], ['academy.html', 'Academy'], ['digital-labs.html', 'Digital Labs'],
    ['assessment.html', 'Assessment'], ['insights.html', 'Insights'], ['engineering.html', 'Engineering']
  ].map(function (n) {
    return '<a href="' + u(n[0]) + '"' + (n[0] === 'assessment.html' ? ' aria-current="page"' : '') + '>' + n[1] + '</a>';
  }).join('');

  var head = document.createElement('div');
  head.className = 'oms-header';
  head.setAttribute('role', 'banner');
  head.dir = 'ltr';
  head.innerHTML =
    '<a class="oms-skip" href="#app">Skip to content</a>' +
    '<div class="oms-wrap oms-header-inner">' +
      '<a class="oms-brand" href="' + MAIN + '"><img src="./omsaze-logo.png" alt="OMSAZE Consulting home"></a>' +
      '<button class="oms-menu" type="button" aria-expanded="false" aria-controls="oms-nav">Menu</button>' +
      '<nav id="oms-nav" class="oms-nav" aria-label="Main">' + nav +
        '<a class="oms-btn" href="' + u('contact.html') + '">Contact</a></nav>' +
    '</div>' +
    '<div class="oms-strip"><div class="oms-wrap oms-strip-inner">' +
      '<nav aria-label="Breadcrumb" class="oms-crumbs"><a href="' + u('assessment.html') + '">Assessment</a>' +
      '<span aria-hidden="true">›</span><a href="./">OMSAZE MindProof</a></nav>' +
      '<span class="oms-pill">' + label + '</span>' +
    '</div></div>';

  var foot = document.createElement('div');
  foot.className = 'oms-footer';
  foot.setAttribute('role', 'contentinfo');
  foot.dir = 'ltr';
  var li = function (p, t) { return '<li><a href="' + u(p) + '">' + t + '</a></li>'; };
  foot.innerHTML =
    '<div class="oms-wrap">' +
      '<div class="oms-footer-grid">' +
        '<div><img class="oms-footer-logo" src="./omsaze-logo.png" alt="OMSAZE Consulting">' +
          '<p>Transforming Business. Enabling Excellence.</p>' +
          '<p class="oms-muted">OMSAZE MindProof is the assessment product of OMSAZE Digital Labs.</p></div>' +
        '<div><h3>Divisions</h3><ul>' + li('consulting.html', 'Advisory') + li('sap-erp.html', 'SAP &amp; ERP') +
          li('erp-support.html', 'Managed Services') + li('engineering.html', 'Engineering Services') +
          li('academy.html', 'Academy') + li('digital-labs.html', 'Digital Labs') + '</ul></div>' +
        '<div><h3>Company</h3><ul>' + li('about.html', 'About') + li('insights.html', 'Insights') +
          li('assessment.html', 'Assessment') + li('contact.html', 'Contact') + '</ul>' +
          '<p class="oms-muted">Zaha Park Mall, 8th Floor<br>New Administrative Capital, Egypt</p></div>' +
      '</div>' +
      '<div class="oms-legal"><p>&copy; 2026 OMSAZE Consulting. All rights reserved.</p>' +
        '<nav aria-label="Legal"><a href="' + u('privacy.html') + '">Privacy and cookies</a>' +
        '<a href="' + u('terms.html') + '">Terms</a><a href="' + u('refund.html') + '">Refunds</a></nav></div>' +
    '</div>';

  function mount() {
    var main = document.querySelector('main');
    if (main && !main.id) { main.id = 'app'; main.classList.add('oms-wide'); }
    document.body.insertBefore(head, document.body.firstChild);
    document.body.appendChild(foot);
    var btn = head.querySelector('.oms-menu'), nv = head.querySelector('.oms-nav');
    btn.addEventListener('click', function () {
      var open = nv.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();

/* Reads a job posting from the current page. Runs inside the page (chrome.scripting.executeScript), so it must be
   self-contained: no imports and nothing from outside this function.
   Order of trust: 1) schema.org JobPosting data that most job sites publish (LinkedIn, Greenhouse, Lever, Ashby,
   SmartRecruiters, Workday, Indeed, StepStone, Welcome to the Jungle, many Japanese boards); 2) rules for sites that
   render the job in the page (LinkedIn's logged-in view, Handshake, Workday, Indeed, Glassdoor); 3) general
   heuristics (title patterns, headings, the largest text block). Text you select on the page wins for the description. */
export function extractJob() {
  const T = (el) => (el ? (el.innerText || el.textContent || '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '');
  const one = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const q = (sel, root = document) => { for (const s of sel.split('||')) { try { const e = root.querySelector(s.trim()); if (e && one(T(e))) return e; } catch (_) { /* bad selector */ } } return null; };
  const meta = (n) => { const e = document.querySelector(`meta[property="${n}"],meta[name="${n}"]`); return e ? one(e.content) : ''; };
  const host = location.hostname.replace(/^www\./, '');
  const out = { company: '', role: '', location: '', url: location.href, posted: '', deadline: '', pay: '', workMode: '', description: '', source: '', from: {} };
  const set = (k, v, how) => { v = typeof v === 'string' ? (k === 'description' ? v.trim() : one(v)) : v; if (v && !out[k]) { out[k] = v; out.from[k] = how; } };
  const htmlText = (h) => { const d = document.createElement('div'); d.innerHTML = String(h || '').replace(/<(br|\/p|\/li|\/h\d|\/div)>/gi, '\n$&'); return T(d) || one(d.textContent); };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const toDate = (s) => {
    s = one(s); if (!s) return '';
    let m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    const d = new Date(s.replace(/(\d)(st|nd|rd|th)\b/, '$1')); return isNaN(d) || d.getFullYear() < 2000 ? '' : iso(d);
  };
  const agoDate = (s) => {
    s = (s || '').toLowerCase(); const now = new Date();
    if (/just now|today|moments? ago|本日|今日/.test(s)) return iso(now);
    if (/yesterday|昨日/.test(s)) { now.setDate(now.getDate() - 1); return iso(now); }
    const m = s.match(/(\d+)\+?\s*(minute|hour|day|week|month|分|時間|日|週間|か月|ヶ月)/); if (!m) return '';
    const n = +m[1], u = m[2], days = /minute|hour|分|時間/.test(u) ? 0 : /day|日/.test(u) ? n : /week|週/.test(u) ? n * 7 : n * 30;
    now.setDate(now.getDate() - days); return iso(now);
  };

  /* 1) schema.org JobPosting */
  const nodes = [];
  const walk = (x) => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) return x.forEach(walk); nodes.push(x); if (x['@graph']) walk(x['@graph']); };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => { try { walk(JSON.parse(s.textContent)); } catch (_) { /* invalid JSON on the page */ } });
  const jp = nodes.find((n) => [].concat(n['@type'] || []).some((t) => /JobPosting/i.test(t)));
  if (jp) {
    set('role', htmlText(jp.title), 'page data');
    const org = [].concat(jp.hiringOrganization || [])[0]; set('company', typeof org === 'string' ? org : org && org.name, 'page data');
    const locs = [].concat(jp.jobLocation || []).map((l) => { const a = (l && l.address) || l || {}; if (typeof a === 'string') return a; const c = typeof a.addressCountry === 'object' ? a.addressCountry.name : a.addressCountry;
      return [a.addressLocality, a.addressRegion, a.addressRegion && /^(US|USA|United States)$/i.test(c || '') ? '' : c].filter(Boolean).join(', '); }).filter(Boolean);
    if (/TELECOMMUTE/i.test(jp.jobLocationType || '')) { locs.push('Remote'); set('workMode', 'Remote', 'page data'); }
    set('location', [...new Set(locs)].slice(0, 4).join('; '), 'page data');
    set('posted', toDate(jp.datePosted), 'page data');
    set('description', htmlText(jp.description), 'page data');
    const sal = jp.baseSalary && (jp.baseSalary.value || jp.baseSalary);
    if (sal && (sal.minValue || sal.value)) { const cur = jp.baseSalary.currency || sal.currency || ''; const u = (sal.unitText || '').toLowerCase(); set('pay', `${cur} ${sal.minValue || sal.value}${sal.maxValue ? '–' + sal.maxValue : ''}${u ? ' per ' + u : ''}`.trim(), 'page data'); }
    if (jp.validThrough) { const d = toDate(jp.validThrough), days = d ? (new Date(d) - new Date()) / 864e5 : -1; if (days >= 0 && days <= 120) { out.deadline = d; out.from.deadline = 'listing expiry'; } }
    if (jp.url && /^https?:/.test(jp.url)) out.canonical = jp.url;
  }

  /* 2) sites that render the job in the page */
  const SITES = [
    [/linkedin\.com$/, 'LinkedIn', {
      role: '.job-details-jobs-unified-top-card__job-title h1 || .job-details-jobs-unified-top-card__job-title || .jobs-unified-top-card__job-title || .top-card-layout__title || h1.t-24 || main h1',
      company: '.job-details-jobs-unified-top-card__company-name a || .job-details-jobs-unified-top-card__company-name || .jobs-unified-top-card__company-name || .topcard__org-name-link || .top-card-layout__second-subline a',
      location: '.job-details-jobs-unified-top-card__primary-description-container .tvm__text || .job-details-jobs-unified-top-card__bullet || .jobs-unified-top-card__bullet || .topcard__flavor--bullet',
      posted: '.job-details-jobs-unified-top-card__primary-description-container || .jobs-unified-top-card__posted-date || .posted-time-ago__text',
      description: '#job-details || .jobs-description__content || .jobs-box__html-content || .show-more-less-html__markup || .description__text' }],
    [/joinhandshake\.com$/, 'Handshake', {
      role: '[data-hook="job-title"] || h1', company: '[data-hook="employer-name"] || a[href*="/employers/"] || a[href*="/e/"]',
      location: '[data-hook="job-location"] || [class*="location"]', description: '[data-hook="job-description"] || [class*="description"] || [class*="Description"]' }],
    [/myworkdayjobs\.com$|myworkdaysite\.com$/, 'Workday', {
      role: '[data-automation-id="jobPostingHeader"]', location: '[data-automation-id="locations"] dd || [data-automation-id="locations"]',
      posted: '[data-automation-id="postedOn"] dd || [data-automation-id="postedOn"]', description: '[data-automation-id="jobPostingDescription"]' }],
    [/greenhouse\.io$/, 'Greenhouse', { role: '.app-title || .job__title h1 || h1.section-header || h1', company: '.company-name', location: '.location || .job__location', description: '#content || .job__description || #app_body' }],
    [/lever\.co$/, 'Lever', { role: '.posting-headline h2', location: '.posting-categories .location || .location', description: '[data-qa="job-description"] || .section-wrapper.page-full-width || .posting-page' }],
    [/ashbyhq\.com$/, 'Ashby', { role: 'h1', description: '[class*="_descriptionText"] || [class*="description"]' }],
    [/indeed\.[a-z.]+$/, 'Indeed', { role: '[data-testid="jobsearch-JobInfoHeader-title"] || h1.jobsearch-JobInfoHeader-title || h1', company: '[data-testid="inlineHeader-companyName"] || [data-company-name="true"]',
      location: '[data-testid="inlineHeader-companyLocation"] || [data-testid="job-location"]', description: '#jobDescriptionText' }],
    [/glassdoor\.[a-z.]+$/, 'Glassdoor', { role: '[data-test="job-title"] || h1', company: '[data-test="employer-name"]', location: '[data-test="location"]', description: '[class*="JobDetails_jobDescription"] || [class*="jobDescription"]' }],
    [/wellfound\.com$/, 'Wellfound', { role: 'h1', description: '[class*="description"]' }],
    [/smartrecruiters\.com$/, 'SmartRecruiters', { role: 'h1.job-title || h1', location: '.job-detail-location || [itemprop="jobLocation"]', description: '.job-sections || [itemprop="description"]' }],
  ];
  const site = SITES.find(([re]) => re.test(host));
  out.source = site ? site[1] : (meta('og:site_name') || host.replace(/^(jobs|careers|boards|apply|job-boards)\./, ''));
  if (site) {
    const r = site[2];
    if (r.role) set('role', T(q(r.role)), 'page');
    if (r.company) set('company', T(q(r.company)).replace(/^at\s+/i, ''), 'page');
    if (r.location) set('location', T(q(r.location)).split('\n')[0].split(' · ')[0], 'page');
    if (r.posted && !out.posted) { const t = T(q(r.posted)); set('posted', agoDate(t) || toDate((t.match(/posted\s+(?:on\s+)?(.+)/i) || [])[1]), 'page'); }
    if (r.description) set('description', T(q(r.description)), 'page');
  }
  if (/linkedin\.com$/.test(host)) { const id = new URLSearchParams(location.search).get('currentJobId') || (location.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/) || [])[1]; if (id) out.url = `https://www.linkedin.com/jobs/view/${id}/`; }
  if (/lever\.co$/.test(host) && !out.company) set('company', (location.pathname.split('/')[1] || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), 'address');
  if (/myworkdayjobs\.com$/.test(host) && !out.company) set('company', meta('og:site_name') || host.split('.')[0].replace(/\b\w/g, (c) => c.toUpperCase()), 'address');

  /* 3) general heuristics */
  const title = one(meta('og:title') || document.title);
  const pat = title.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s+[|\-–—]\s+.*)?$/i) || title.match(/^(.+?)\s+[|\-–—]\s+(.+?)(?:\s+[|\-–—]\s+.*)?$/);
  if (pat) {
    const [a, b] = [one(pat[1]), one(pat[2])], jobish = (s) => /intern|engineer|developer|analyst|scientist|research|co-?op|student|graduate|software|data|インターン|エンジニア|採用/i.test(s);
    if (jobish(a) && !jobish(b)) { set('role', a, 'title'); set('company', b.replace(/\b(careers?|jobs?)\b.*$/i, ''), 'title'); }
    else if (jobish(b) && !jobish(a)) { set('role', b, 'title'); set('company', a, 'title'); }
  }
  set('role', T(q('main h1 || article h1 || h1')), 'heading');
  set('company', meta('og:site_name').replace(/\b(careers?|jobs?)\b.*$/i, ''), 'site name');
  set('location', T(q('[class*="job-location"] || [class*="jobLocation"] || [data-testid*="location"] || [class*="location"]')).split('\n')[0], 'page');
  if (!out.description) {
    let best = null, bestLen = 0;
    document.querySelectorAll('[class*="description"],[id*="description"],[class*="Description"],article,main,[role="main"],section').forEach((e) => { const n = T(e).length; if (n > bestLen && n < 60000) { best = e; bestLen = n; } });
    if (bestLen > 300) set('description', T(best), 'largest text block');
  }
  const sel = one(String(window.getSelection ? window.getSelection() : '')).length > 200 ? String(window.getSelection()).trim() : '';
  if (sel) { out.description = sel; out.from.description = 'your selection'; }

  /* from the text itself */
  const text = out.description || '';
  if (!out.deadline || out.from.deadline === 'listing expiry') {
    const m = text.match(/(?:application\s+)?(?:deadline|apply\s+by|applications?\s+(?:close|due)|closing\s+date|応募締切|締め切り)[^0-9A-Za-z぀-鿿]{0,12}((?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2})|(?:[A-Z][a-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})|(?:\d{1,2}\/\d{1,2}\/\d{4}))/i);
    const d = m && toDate(m[1]); if (d) { out.deadline = d; out.from.deadline = 'posting text'; }
  }
  if (!out.pay) { const U = '(?:\\/|per)\\s?(?:hour|hr|month|year|week|時間|月)', A = '(?:US\\$|CA\\$|\\$|€|£|¥)\\s?\\d[\\d,.]*\\s?[kK]?';
    const m = text.match(new RegExp(`(${A}(?:\\s?${U})?(?:\\s?(?:-|–|to)\\s?${A})?\\s?${U})`, 'i')); if (m) set('pay', m[1], 'posting text'); }
  if (!out.workMode) { const h = (out.location + ' ' + text.slice(0, 1500)).toLowerCase(); set('workMode', /\bhybrid\b/.test(h) ? 'Hybrid' : /\bremote\b/.test(h) ? 'Remote' : /\bon-?site\b|in-office/.test(h) ? 'On-site' : '', 'posting text'); }
  out.role = out.role.replace(/\s*\((?:m|f|w|d|x)\/(?:m|f|w|d|x)(?:\/(?:m|f|w|d|x))?\)\s*$/i, '').slice(0, 200);
  out.company = out.company.replace(/\s*[|·•].*$/, '').slice(0, 120);
  out.description = out.description.slice(0, 60000);
  return out;
}

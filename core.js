/* Internship Tracker core: the single source of the scoring formula, track inference and
   three-way merge. Loaded by the page (window.IATCore) and by Node for tests (module.exports).
   fetcher.py mirrors score()/inferTrack() for the terminal; tests/test_parity.py keeps them identical. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IATCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WEIGHT_KEYS = ['fit', 'skills', 'sponsor', 'recency', 'degree', 'location'];

  /* Every catalog skill the fetcher can detect in posting text (keys of fetcher.SKILLS). */
  const SKILL_NAMES = [
    'Python', 'SQL', 'pandas', 'NumPy', 'scikit-learn', 'PyTorch', 'TensorFlow', 'Machine learning', 'Deep learning',
    'NLP', 'Statistics', 'A/B testing', 'Regression', 'Tableau', 'Power BI', 'Excel', 'Looker', 'Data visualization', 'ETL',
    'Data modeling', 'Spark', 'Airflow', 'dbt', 'Snowflake', 'BigQuery', 'Redshift', 'Kafka', 'Hadoop', 'AWS', 'GCP', 'Azure',
    'Docker', 'Kubernetes', 'Git', 'Linux', 'Java', 'C#', 'C/C++', 'JavaScript', 'TypeScript', 'React', 'Scala', 'Rust', 'R',
    'LLMs', 'Prompt engineering', 'Databases'];

  const DEFAULTS = {
    targets: ['SWE', 'DE', 'DA', 'DS', 'BIE'],
    weights: { fit: 30, skills: 25, sponsor: 20, recency: 15, degree: 5, location: 5 },
    places: ['TX', 'Remote'],
    /* Skills you can truthfully claim (from Experience_Details.md). Editable in Settings. */
    mySkills: ['Python', 'SQL', 'pandas', 'NumPy', 'scikit-learn', 'PyTorch', 'Machine learning', 'Deep learning', 'NLP',
      'Regression', 'Tableau', 'Data visualization', 'ETL', 'Data modeling', 'Databases', 'Git', 'Java', 'C#', 'C/C++',
      'JavaScript', 'LLMs', 'Prompt engineering'],
    noSponsorPenalty: 20,
    recencyHalfLife: 5,
    topScore: 75,
    minScore: 55,
    followUpDays: 14,
    staleDays: 45,
    savedStaleDays: 7,
    savedLimit: 15,
    dailyGoal: 3,
    weeklyGoal: 10,
    hideNoSponsor: false,
    windowDays: 10,
    fetchHours: 2,
    notify: false,
    onboarded: false,
    resumes: { DS: 'DS / ML', DA: 'DA / BI', BIE: 'DA / BI', DE: 'Data Eng', SWE: 'SWE', Quant: 'DS / ML' }
  };

  /* ---------- track inference (same rules as fetcher.infer_track) ---------- */
  const T = (re) => (s) => re.test(s);
  const isBI = T(/business intelligence|\bBI\b/i);
  const isDE = T(/data engineer|analytics engineer|data platform|\betl\b|data infrastructure/i);
  const isQuant = T(/\bquant(itative)?\b/i);
  const isNonTech = T(/product manag|program manag|project manag|product owner|\bdesign(er)?\b|marketing/i);
  const isHW = T(/hardware|electrical|electronic|mechanical|manufactur|sensor|firmware|asic|fpga|silicon|analog|\bRF\b/i);
  const isSoftData = T(/software|data|machine learning|\bML\b/i);
  const isFin = T(/financ|accounting|audit|\btax\b|investment|equity research|credit/i);
  const isDataWord = T(/data|analytics/i);
  const isDA = T(/analyst|analytics|insights/i);
  const isDS = T(/data scien|machine learning|\bML\b|\bAI\b|artificial intelligence|applied scien|research scien|deep learning|\bNLP\b|computer vision|\bLLM/i);
  const isOther = T(/hardware|electrical|electronic|mechanical|manufactur|civil|chemical|firmware|\bRF\b|asic|fpga|verification|silicon|analog|power systems|sales|trader|trading|\bUX\b|supply chain|human resources|legal|nurs|clinical|biomedical|process engineer|quality engineer|test engineer/i);
  const isSWE = T(/software|developer|\bSWE\b|back-?end|front-?end|full[- ]?stack|platform|cloud|devops|\bSRE\b|site reliability|mobile|\biOS\b|android|\bweb\b|engineer/i);

  function inferTrack(title, category) {
    const t = title || '';
    if (isBI(t)) return 'BIE';
    if (isDE(t)) return 'DE';
    if (isQuant(t) || category === 'Quant') return 'Quant';
    if (isNonTech(t)) return 'Other';
    if (isHW(t) && !isSoftData(t)) return 'Other';
    if (isFin(t) && !isDataWord(t)) return 'Other';
    if (isDA(t)) return 'DA';
    if (isDS(t)) return 'DS';
    if (isOther(t)) return 'Other';
    if (isSWE(t)) return 'SWE';
    return 'Other';
  }

  /* ---------- scoring ---------- */
  const SENIOR = /\bph\.?d\b|doctoral|\bsenior\b|\bstaff\b|\bmba\b/i;

  function daysBetween(fromIso, toIso) {
    const p = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
    const a = p(fromIso), b = p(toIso);
    return a === null || b === null ? null : Math.round((b - a) / 864e5);
  }

  /* Degrees as a list ("Bachelor's", "Master's", "PhD", "MBA"), from the feed or a free-text field like "BS/MS". */
  function degreesOf(l) {
    if (Array.isArray(l.degrees)) return l.degrees;
    const s = l.degree || '';
    const out = [];
    if (/\b(bs|ba|bachelor)/i.test(s)) out.push("Bachelor's");
    if (/\b(ms|ma|master)/i.test(s)) out.push("Master's");
    if (/\bphd\b|doctor/i.test(s)) out.push('PhD');
    if (/\bmba\b/i.test(s)) out.push('MBA');
    return out;
  }

  const sponsorOf = (l) => (l.noSponsor || l.sponsor === 'no') ? 'no' : (l.friendly || l.sponsor === 'yes') ? 'yes' : 'unknown';
  const trackOf = (l) => l.track || inferTrack(l.role, l.category);
  const locationsOf = (l) => Array.isArray(l.locations) && l.locations.length ? l.locations : (l.location ? [l.location] : []);
  const num = (x, d) => { const n = Number(x); return Number.isFinite(n) ? n : d; };

  function settingsOf(s) {
    s = s || {};
    const w = Object.assign({}, DEFAULTS.weights, s.weights || {});
    return {
      targets: Array.isArray(s.targets) ? s.targets : DEFAULTS.targets,
      weights: w,
      places: Array.isArray(s.places) ? s.places : DEFAULTS.places,
      mySkills: Array.isArray(s.mySkills) ? s.mySkills : DEFAULTS.mySkills,
      noSponsorPenalty: Math.max(0, num(s.noSponsorPenalty, DEFAULTS.noSponsorPenalty)),
      recencyHalfLife: Math.max(0.5, num(s.recencyHalfLife, DEFAULTS.recencyHalfLife))
    };
  }

  /* Component values in [0, 1] for one listing under the given settings. */
  function components(l, settings, todayIso) {
    const s = settingsOf(settings);
    const track = trackOf(l);
    let fit = track === 'Quant' ? 0.4 : track === 'Other' ? 0.1 : (s.targets.indexOf(track) >= 0 ? 1.0 : 0.4);
    if (SENIOR.test(l.role || '')) fit *= 0.5;

    const found = Array.isArray(l.skillsFound) ? l.skillsFound : [];
    const mine = new Set(s.mySkills);
    const matched = found.filter((k) => mine.has(k));
    const missing = found.filter((k) => !mine.has(k));
    const skills = found.length ? (matched.length + 1) / (found.length + 2) : 0.5;

    const sp = sponsorOf(l);
    let sponsor = (l.h1b === null || l.h1b === undefined) ? 0.3 : Math.min(1.0, Math.log10(1 + Number(l.h1b)) / 3);
    if (sp === 'yes' || l.friendly) sponsor = Math.max(sponsor, 0.9);
    const noSponsor = sp === 'no';
    if (noSponsor) sponsor = 0.0;

    const age0 = daysBetween(l.posted, todayIso);
    const age = age0 === null ? 30 : Math.max(0, age0);
    const recency = Math.pow(0.5, age / s.recencyHalfLife);

    const degs = degreesOf(l);
    const degree = (!degs.length || degs.indexOf("Master's") >= 0) ? 1.0 : degs.indexOf("Bachelor's") >= 0 ? 0.7 : 0.0;

    const places = s.places.map((p) => String(p).toLowerCase().trim()).filter(Boolean);
    const locs = locationsOf(l).map((x) => String(x).toLowerCase());
    const hit = locs.some((x) => places.some((p) => x.indexOf(p) >= 0 || (p === 'tx' && x.indexOf('texas') >= 0)));
    const location = hit ? 1.0 : 0.5;

    return {
      track, matched, missing, noSponsor, friendly: !noSponsor && (sp === 'yes' || !!l.friendly),
      penalty: noSponsor ? s.noSponsorPenalty : 0,
      v: { fit, skills, sponsor, recency, degree, location }
    };
  }

  function score(l, settings, todayIso) {
    const s = settingsOf(settings);
    const c = components(l, s, todayIso);
    let tot = 0;
    for (const k of WEIGHT_KEYS) tot += Math.max(0, num(s.weights[k], 0));
    const parts = WEIGHT_KEYS.map((k) => {
      const wk = Math.max(0, num(s.weights[k], 0));
      return { k, v: c.v[k], pts: tot ? wk * c.v[k] / tot * 100 : 0, max: tot ? wk / tot * 100 : 0 };
    });
    let sum = 0;
    for (const p of parts) sum += p.pts;
    const flags = [];
    if (c.friendly) flags.push('CPT/OPT friendly');
    if (c.noSponsor) flags.push('No sponsorship');
    if (l.source === 'simplify' && !l.textRead) flags.push('Text not read');
    return {
      total: Math.max(0, Math.round(sum - c.penalty)), parts, pen: c.penalty, track: c.track,
      matched: c.matched, missing: c.missing, sponsor: c.noSponsor ? 'no' : c.friendly ? 'yes' : 'unknown', flags
    };
  }

  /* Recommended next step: Apply now / Tailor first / Low priority. */
  function action(scored, settings) {
    const top = num((settings || {}).topScore, DEFAULTS.topScore), min = num((settings || {}).minScore, DEFAULTS.minScore);
    if (scored.sponsor === 'no' || scored.total < min) return ['low', 'Low priority'];
    if ((scored.missing || []).length >= 2 || scored.total < top) return ['tailor', 'Tailor first'];
    return ['now', 'Apply now'];
  }

  /* ---------- three-way merge of the user's data (apps, dismissed, settings, ...) ---------- */
  function stable(x) {
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
    return JSON.stringify(x === undefined ? null : x);
  }
  const same = (a, b) => stable(a) === stable(b);

  /* Merge two edits of a list of records keyed by `key`. Mine wins when both sides changed the same record. */
  function mergeById(base, mine, latest, key) {
    key = key || 'id';
    const B = new Map((base || []).map((x) => [x[key], x])), M = new Map((mine || []).map((x) => [x[key], x])), L = new Map((latest || []).map((x) => [x[key], x]));
    const out = [], seen = new Set();
    let conflicts = 0;
    const pick = (id) => {
      const b = B.get(id), m = M.get(id), l = L.get(id);
      if (same(m, b)) return l;                 // I did not touch it: take theirs (or their delete)
      if (same(l, b)) return m;                 // they did not touch it: take mine (or my delete)
      if (!same(m, l)) conflicts++;             // both changed: mine wins
      return m;
    };
    for (const id of [...L.keys(), ...M.keys(), ...B.keys()]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const r = pick(id);
      if (r !== undefined) out.push(r);
    }
    return { list: out, conflicts };
  }

  function mergeSet(base, mine, latest) {
    const b = new Set(base || []), m = new Set(mine || []);
    const out = new Set(latest || []);
    for (const x of m) if (!b.has(x)) out.add(x);
    for (const x of b) if (!m.has(x)) out.delete(x);
    return [...out];
  }

  function mergeObject(base, mine, latest) {
    const out = Object.assign({}, latest || {});
    const keys = new Set([...Object.keys(base || {}), ...Object.keys(mine || {})]);
    for (const k of keys) if (!same((mine || {})[k], (base || {})[k])) {
      if ((mine || {})[k] === undefined) delete out[k]; else out[k] = mine[k];
    }
    return out;
  }

  function merge3(base, mine, latest) {
    base = base || {}; mine = mine || {}; latest = latest || {};
    const apps = mergeById(base.apps, mine.apps, latest.apps, 'id');
    const manual = mergeById(base.manualListings, mine.manualListings, latest.manualListings, 'id');
    const log = mergeById(base.dismissLog, mine.dismissLog, latest.dismissLog, 'id');
    const merged = Object.assign({}, latest, {
      apps: apps.list,
      manualListings: manual.list,
      dismissLog: log.list,
      dismissed: mergeSet(base.dismissed, mine.dismissed, latest.dismissed),
      settings: mergeObject(base.settings, mine.settings, latest.settings),
      ui: mine.ui || latest.ui
    });
    return { merged, conflicts: apps.conflicts + manual.conflicts + log.conflicts };
  }

  return { WEIGHT_KEYS, SKILL_NAMES, DEFAULTS, inferTrack, degreesOf, sponsorOf, trackOf, daysBetween, components, score, action, merge3, mergeById, mergeSet, stable };
});

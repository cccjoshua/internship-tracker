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
    /* A posting that will not sponsor never ranks above this, so it never sits among your first-priority listings. */
    noSponsorCap: 40,
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
      total: Math.max(0, Math.min(c.noSponsor ? DEFAULTS.noSponsorCap : 100, Math.round(sum - c.penalty))), parts, pen: c.penalty, track: c.track,
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
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const idList = (xs) => Array.isArray(xs) && xs.length > 0 && xs.every((x) => isObj(x) && x.id !== undefined && x.id !== null && x.id !== '');

  /* Field-level three-way merge of one value. Changes on different fields of the same record are both kept.
     A field changed on both sides to different values is a conflict: mine wins and the path is reported.
     An edit beats a delete (nothing is lost silently); the path is reported. */
  function mergeValue(b, m, l, path, out) {
    if (same(m, b)) return l;
    if (same(l, b)) return m;
    if (same(m, l)) return m;
    if (m === undefined) { out.push(path + ' (deleted here, edited elsewhere: kept)'); return l; }
    if (l === undefined) { out.push(path + ' (deleted elsewhere, edited here: kept)'); return m; }
    if (isObj(m) && isObj(l) && (isObj(b) || b === undefined)) {
      const r = {}, bb = b || {};
      for (const k of new Set([...Object.keys(bb), ...Object.keys(m), ...Object.keys(l)])) {
        const v = mergeValue(bb[k], m[k], l[k], path ? path + '.' + k : k, out);
        if (v !== undefined) r[k] = v;
      }
      return r;
    }
    if (Array.isArray(m) && Array.isArray(l) && (b === undefined || Array.isArray(b)) && (idList(m) || idList(l))
      && (idList(m) || !m.length) && (idList(l) || !l.length)) return mergeList(b || [], m, l, 'id', path, out);
    out.push(path);
    return m;
  }
  function mergeList(base, mine, latest, key, path, out) {
    const B = new Map((base || []).map((x) => [x[key], x])), M = new Map((mine || []).map((x) => [x[key], x])), L = new Map((latest || []).map((x) => [x[key], x]));
    const res = [], seen = new Set();
    for (const id of [...M.keys(), ...L.keys(), ...B.keys()]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const v = mergeValue(B.get(id), M.get(id), L.get(id), (path ? path + '.' : '') + id, out);
      if (v !== undefined) res.push(v);
    }
    return res;
  }
  function mergeById(base, mine, latest, key) {
    const paths = [];
    const list = mergeList(base || [], mine || [], latest || [], key || 'id', '', paths);
    return { list, conflicts: paths.length, paths };
  }
  function mergeSet(base, mine, latest) {
    const b = new Set(base || []), m = new Set(mine || []);
    const out = new Set(latest || []);
    for (const x of m) if (!b.has(x)) out.add(x);
    for (const x of b) if (!m.has(x)) out.delete(x);
    return [...out];
  }
  function mergeObject(base, mine, latest) { return mergeValue(base || {}, mine || {}, latest || {}, '', []) || {}; }
  /* Whole-document merge (the Profile): { merged, conflicts, paths }. */
  function mergeDeep(base, mine, latest) {
    const paths = [];
    const merged = mergeValue(base || {}, mine || {}, latest || {}, '', paths) || {};
    return { merged, conflicts: paths.length, paths };
  }
  function merge3(base, mine, latest) {
    base = base || {}; mine = mine || {}; latest = latest || {};
    const apps = mergeById(base.apps, mine.apps, latest.apps, 'id');
    const manual = mergeById(base.manualListings, mine.manualListings, latest.manualListings, 'id');
    const log = mergeById(base.dismissLog, mine.dismissLog, latest.dismissLog, 'id');
    const setPaths = [];
    const merged = Object.assign({}, latest, {
      apps: apps.list, manualListings: manual.list, dismissLog: log.list,
      dismissed: mergeSet(base.dismissed, mine.dismissed, latest.dismissed),
      settings: mergeValue(base.settings || {}, mine.settings || {}, latest.settings || {}, 'settings', setPaths) || {},
      ui: mine.ui || latest.ui
    });
    const paths = [...apps.paths, ...manual.paths, ...log.paths, ...setPaths];
    return { merged, conflicts: paths.length, paths };
  }

  /* ---------- profile-vs-job fit and resume keyword coverage (no AI calls; inputs come from a job analysis) ----------
     Simplify does not publish its match formula, and neither does any employer's ATS. This is a transparent, explainable
     equivalent built from the same kinds of ingredients. Three rules keep it honest:
       1. Unknown is not a score. A component the posting or your Profile does not state is left out of the total
          (no free points, not counted as a gap); `coverage` is the share of weight that could be assessed. Below
          MIN_COVERAGE, or with skills unassessable, total is null ("not enough data").
       2. Eligibility is separate: each requirement is meets / fails / unknown / na. Any "fails" makes the verdict
          "blocked" and caps the total, so no other strength can hide it.
       3. A synonym is a match; a related skill is partial credit, labelled "inferred", never chained. */
  const FIT_KEYS = ['skills', 'education', 'experience', 'role', 'location', 'auth'];
  const FIT_LABEL = { skills: 'Skills', education: 'Education', experience: 'Experience level', role: 'Role fit', location: 'Location', auth: 'Work authorization' };
  const FIT_WEIGHTS = { skills: 35, education: 15, experience: 10, role: 15, location: 10, auth: 15 };
  const MIN_COVERAGE = 0.6, BLOCKED_CAP = 35, IMPLIED_CREDIT = 0.5;
  const ALIAS = {
    'database systems': 'databases', 'relational databases': 'databases', 'database': 'databases', 'dbms': 'databases',
    js: 'javascript', 'node': 'node.js', nodejs: 'node.js', ts: 'typescript', py: 'python', postgres: 'postgresql', ml: 'machine learning',
    dl: 'deep learning', sklearn: 'scikit-learn', 'scikit learn': 'scikit-learn', tf: 'tensorflow', k8s: 'kubernetes', 'google cloud platform': 'gcp',
    'google cloud': 'gcp', 'amazon web services': 'aws', 'microsoft azure': 'azure', 'ms sql server': 'sql server', 'microsoft sql server': 'sql server',
    mssql: 'sql server', 'ab testing': 'a/b testing', 'a/b tests': 'a/b testing', 'data viz': 'data visualization', 'visualization': 'data visualization',
    'natural language processing': 'nlp', 'large language models': 'llms', llm: 'llms', 'prompting': 'prompt engineering', 'cplusplus': 'c++',
    'version control': 'git', 'object oriented programming': 'oop', 'object-oriented programming': 'oop', 'object-oriented design': 'oop',
    'rest': 'rest apis', 'restful apis': 'rest apis', 'rest api': 'rest apis', 'etl/elt': 'etl', 'elt': 'etl', 'ms excel': 'excel', 'microsoft excel': 'excel',
    'golang': 'go', 'html5': 'html', 'css3': 'css', 'reactjs': 'react', 'react.js': 'react', 'powerbi': 'power bi', 'statistical analysis': 'statistics',
  };
  /* A combined claim is a direct claim of each part. */
  const EXPANDS = { 'c/c++': ['c', 'c++'], 'html/css': ['html', 'css'] };
  /* Having the left one suggests the right one: one level only, partial credit, shown as inferred. */
  const IMPLIES = { git: ['version control', 'version control systems'], tfs: ['version control', 'version control systems'], 't-sql': ['sql'], 'sql server': ['sql'], postgresql: ['sql'], mysql: ['sql'], sqlite: ['sql'],
    pandas: ['python'], numpy: ['python'], 'scikit-learn': ['machine learning'], pytorch: ['deep learning'],
    tensorflow: ['deep learning'], 'deep learning': ['machine learning'], textcnn: ['deep learning'], 'doc2vec': ['nlp'] };
  function nk(s) {
    let k = String(s || '').toLowerCase().replace(/[“”"']/g, '').replace(/\s*&\s*/g, ' and ').replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
    return ALIAS[k] || k;
  }
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = (k, flags) => new RegExp('(^|[^a-z0-9+#])' + escRe(k) + '($|[^a-z0-9+#])', flags);
  function splitTerms(s) {
    const out = [];
    for (const part of String(s || '').split(/[,;|]|\band\b/)) {
      const m = /^([^()]*)\(([^)]*)\)\s*$/.exec(part.trim());
      if (m) { out.push(m[1].trim()); out.push(...m[2].split(/[,/]/).map((x) => x.trim())); } else out.push(part.trim());
    }
    return out.filter((x) => x && x.length < 40);
  }
  /* 'Java | Python | C++' (one requirement, any option) -> ['Java', 'Python', 'C++']; a plain term -> [term]. */
  const anyOf = (t) => {
    let x = String(t || '');
    const m = /^[^(|]*\(([^()]*\|[^()]*)\)\s*$/.exec(x); if (m) x = m[1]; // "Scripting (Bash | Python)" -> the options inside
    return x.split('|').map((y) => y.trim()).filter(Boolean);
  };
  /* set: direct claims; implied: skill -> the direct claim that suggests it; no: do-not-claim. */
  function skillSet(profile, settings) {
    profile = profile || {};
    const raw = [...((settings || {}).mySkills || [])];
    for (const s of profile.skills || []) raw.push(...splitTerms(s.value));
    for (const sec of ['experience', 'projects', 'leadership', 'education']) for (const e of profile[sec] || []) if (!e.hidden) raw.push(...splitTerms(e.tech));
    const no = new Set((profile.notYet || []).flatMap(splitTerms).map(nk));
    const set = new Set(), implied = new Map();
    const add = (k) => { if (!k || no.has(k) || set.has(k)) return; set.add(k); for (const x of EXPANDS[k] || []) add(x); };
    for (const r of raw) add(nk(r));
    for (const k of set) for (const x of IMPLIES[k] || []) if (!set.has(x) && !no.has(x) && !implied.has(x)) implied.set(x, k);
    /* Evidence: where the Profile shows the skill used. 'work' (a job's tech or confirmed points) beats 'project'
       (a project or course project) beats 'listed' (only a skills line or coursework). Recruiters weigh shown use more
       than a listed skill, so the match score does too. */
    const blob = (secs) => secs.flatMap((sec) => (profile[sec] || []).filter((e) => !e.hidden).flatMap((e) => [e.tech, e.title, e.name, e.context,
      ...(e.points || []).filter((p) => !p.confirm).map((p) => p.text)])).filter(Boolean).join(' \n ').toLowerCase();
    const work = ' ' + blob(['experience']) + ' ', proj = ' ' + blob(['projects', 'leadership']) + ' ';
    const formsOf = (k) => [k, ...Object.keys(ALIAS).filter((x) => ALIAS[x] === k)];
    const depth = new Map();
    for (const k of set) {
      const f = formsOf(k), inW = f.some((x) => wordRe(x).test(work)), inP = !inW && f.some((x) => wordRe(x).test(proj));
      depth.set(k, inW ? 'work' : inP ? 'project' : 'listed');
    }
    for (const [k, v] of Object.entries(EXPANDS)) if (set.has(k)) for (const x of v) if (depth.get(x) === 'listed') depth.set(x, depth.get(k));
    return { set, implied, no, depth };
  }
  const DEPTH_CREDIT = { work: 1, project: 0.9, listed: 0.7 };
  const DEPTH_LABEL = { work: 'used at work', project: 'used in a project', listed: 'listed only' };
  /* Evidence level of a skill you have: 'work' | 'project' | 'listed' | 'implied' | null. */
  function skillDepth(term, S) {
    const h = hasSkill(term, S);
    if (h !== 'direct') return h;
    if (!S.depth) return 'work';
    const k = nk(term);
    if (S.depth.has(k)) return S.depth.get(k);
    let best = null;
    if (k.length >= 4) { const re = wordRe(k); for (const x of S.set) if (x.length >= 4 && (re.test(x) || wordRe(x).test(k))) { const d = S.depth.get(x); if (!best || DEPTH_CREDIT[d] > DEPTH_CREDIT[best]) best = d; } }
    return best || 'listed';
  }
  /* 'direct' | 'implied' | null */
  function hasSkill(term, S) {
    const k = nk(term);
    if (!k || !S) return null;
    if (S.no && S.no.has(k)) return null;
    if (S.set.has(k)) return 'direct';
    if (k.length >= 4) {
      const re = wordRe(k);
      for (const x of S.set) if (x.length >= 4 && (re.test(x) || wordRe(x).test(k))) return 'direct';
    }
    if (S.implied && S.implied.has(k)) return 'implied';
    return null;
  }
  const ym = (s) => { const m = /^(\d{4})-(\d{2})/.exec(s || ''); return m ? +m[1] * 12 + (+m[2] - 1) : null; };
  const ymText = (s) => { const v = ym(s); return v === null ? '' : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][v % 12] + ' ' + Math.floor(v / 12); };
  const NOW_FUTURE = /authorized\s+to\s+work\s+in\s+the\s+(united\s+states|u\.?s\.?a?\.?)[^.]{0,40}\bnow\s+and\s+in\s+the\s+future|(not|never)\s+(now\s+or\s+in\s+the\s+future\s+)?require\s+(employer\s+|visa\s+|immigration\s+)?sponsorship|without\s+(the\s+)?(need\s+for\s+)?(current\s+or\s+future\s+)?(employer\s+|visa\s+)?sponsorship/i;
  /* "Candidates on CPT or OPT are not eligible", "This role does not accept OPT candidates". Mirrors fetcher.OPT_EXCLUDED. */
  const OPT_EXCLUDED = /\b(CPT|OPT|F-?1)\b[^.]{0,60}\b(not|ineligible|unable)\b[^.]{0,30}\b(eligible|accept\w*|consider\w*|sponsor\w*|support\w*)|\b(not|cannot|can't|unable to|do(es)? not|will not|won't)\s+(be\s+able\s+to\s+)?(accept|consider|support|hire|employ)\w*[^.]{0,40}\b(CPT|OPT|F-?1)\b|\bineligible\b[^.]{0,40}\b(CPT|OPT|F-?1)\b|\b(CPT|OPT|F-?1)\b[^.]{0,60}\bineligible\b/i;
  /* "CPT and OPT students are welcome", "F-1 students on CPT are eligible": checked sentence by sentence, never a negated one. */
  const OPT_WELCOME = /\b(CPT|OPT|F-?1)\b[^.]{0,60}\b(welcome|eligible|encouraged|accept(ed)?|consider(ed)?)\b/i;
  const optWelcome = (t) => String(t || '').split(/(?<=[.!?;])\s+/).some((x) => OPT_WELCOME.test(x) && !OPT_EXCLUDED.test(x) && !/\b(not|no|never|ineligible|unable|cannot)\b/i.test(x));
  const elig = (key, label, status, detail, evidence) => ({ key, label, status, detail: detail || '', evidence: evidence || '' });
  const known = (x) => x !== null && x !== undefined;

  /* profile: Profile page data; a: job analysis; ctx: { settings, role, track, h1b, h1bYear, locations } */
  function fit(profile, a, ctx) {
    profile = profile || {}; a = a || {}; ctx = ctx || {};
    const s = settingsOf(ctx.settings), pref = profile.preferences || {}, notes = {}, eligibility = [], v = {};
    const w = Object.assign({}, FIT_WEIGHTS, (ctx.settings || {}).fitWeights || {});
    const S = skillSet(profile, ctx.settings);
    // skills
    let req = a.requiredSkills || [], opt = a.preferredSkills || [];
    if (!req.length && !opt.length) {
      /* Older analyses may list no skills: fall back to the concrete tools among the keywords only.
         Work habits (code review, Agile, documentation) are not something a skills list can show. */
      const kw = (a.keywords || []).filter((k) => k.kind === 'tool');
      req = kw.filter((k) => k.importance >= 2).map((k) => k.term); opt = kw.filter((k) => k.importance < 2).map((k) => k.term);
    }
    const uniq = (xs) => { const seen = new Set(); return xs.filter((x) => { const k = nk(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
    req = uniq(req); opt = uniq(opt).filter((x) => !req.some((r) => nk(r) === nk(x)));
    /* "Java | Python | C++" is one requirement met by any one option. */
    const label = new Map();
    const depthOf = new Map();
    const kind = new Map([...req, ...opt].map((x) => {
      const ops = anyOf(x);
      if (ops.length < 2) { const d = skillDepth(x, S); if (d && d !== 'implied') depthOf.set(x, d); return [x, hasSkill(x, S)]; }
      const got = ops.map((o) => [o, hasSkill(o, S)]), d = got.filter((g) => g[1] === 'direct'), im = got.filter((g) => g[1] === 'implied');
      label.set(x, d.length ? d.map((g) => g[0]).join(' / ') : im.length ? im[0][0] : ops.join(' or '));
      if (d.length) depthOf.set(x, d.map((g) => skillDepth(g[0], S)).sort((a2, b2) => DEPTH_CREDIT[b2] - DEPTH_CREDIT[a2])[0]);
      return [x, d.length ? 'direct' : im.length ? 'implied' : null];
    }));
    const show = (x) => label.get(x) || x;
    const credit = (x) => kind.get(x) === 'direct' ? DEPTH_CREDIT[depthOf.get(x) || 'work'] : kind.get(x) === 'implied' ? IMPLIED_CREDIT : 0;
    const reqHit = req.filter((x) => kind.get(x)), optHit = opt.filter((x) => kind.get(x));
    const inferred = [...reqHit, ...optHit].filter((x) => kind.get(x) === 'implied').map((x) => ({ term: show(x), from: S.implied.get(nk(show(x))) }));
    const denom = 2 * req.length + opt.length, haveSkills = S.set.size > 0;
    v.skills = denom && haveSkills ? (2 * req.reduce((t, x) => t + credit(x), 0) + opt.reduce((t, x) => t + credit(x), 0)) / denom : null;
    const flagged = [...req, ...opt].filter((x) => S.no.has(nk(x)));
    notes.skills = !denom ? 'The posting lists no concrete skills' : !haveSkills ? 'Your Profile lists no skills yet'
      : `${reqHit.length}/${req.length} required · ${optHit.length}/${opt.length} preferred${inferred.length ? ` · ${inferred.length} inferred` : ''}${(() => { const l = [...reqHit, ...optHit].filter((x) => depthOf.get(x) === 'listed').length; return l ? ` · ${l} listed only (not shown in a job or project)` : ''; })()}`;
    // education and graduation window
    const au = a.audience || {}, levels = au.degreeLevels || [];
    const pursuing = pref.degreePursuing || '', held = Array.isArray(pref.degreesHeld) ? pref.degreesHeld : [];
    if (!levels.length) { v.education = null; notes.education = 'Degree not stated'; eligibility.push(elig('degree', 'Degree level', 'na', 'The posting does not state a degree level')); }
    else if (!pursuing) { v.education = null; notes.education = `${levels.join(' / ')} · add your degree in Profile`; eligibility.push(elig('degree', 'Degree level', 'unknown', `Asks for ${levels.join(' / ')}; your Profile does not say which degree you are pursuing`, au.evidence)); }
    else if (levels.indexOf(pursuing) >= 0) { v.education = 1; notes.education = `${levels.join(' / ')} accepted`; eligibility.push(elig('degree', 'Degree level', 'meets', `${pursuing}'s is accepted`, au.evidence)); }
    else if (levels.some((l) => held.indexOf(l) >= 0)) { v.education = 0.55; notes.education = `Asks for ${levels.join(' / ')} students; you are in a ${pursuing}'s`; eligibility.push(elig('degree', 'Degree level', 'unknown', `Asks for ${levels.join(' / ')} students; you hold one and are pursuing a ${pursuing}'s. Ask the recruiter.`, au.evidence)); }
    else { v.education = 0; notes.education = `Only ${levels.join(' / ')}`; eligibility.push(elig('degree', 'Degree level', 'fails', `Only ${levels.join(' / ')} students`, au.evidence)); }
    const g = ym(pref.graduation), lo = ym(au.gradFrom), hi = ym(au.gradTo);
    const win = au.gradText || [ymText(au.gradFrom), ymText(au.gradTo)].filter(Boolean).join(' – ');
    if (lo === null && hi === null) eligibility.push(elig('graduation', 'Graduation window', 'na', 'No graduation window stated'));
    else if (g === null) eligibility.push(elig('graduation', 'Graduation window', 'unknown', `Window ${win}; add your graduation date in Profile`, au.evidence));
    else {
      const inside = (lo === null || g >= lo) && (hi === null || g <= hi);
      eligibility.push(elig('graduation', 'Graduation window', inside ? 'meets' : 'fails', `Window ${win}; you graduate ${ymText(pref.graduation)}`, au.evidence));
      if (!inside && known(v.education)) v.education = Math.min(v.education, 0.2);
      notes.education += inside ? ' · graduation date fits' : ' · graduation date outside the window';
    }
    if (au.enrollment) eligibility.push(elig('enrollment', 'Enrollment', 'unknown', au.enrollment, au.evidence));
    // experience level
    const needY = typeof au.yearsExperience === 'number' ? au.yearsExperience : null;
    const haveY = ['', null, undefined].includes(pref.yearsExperience) ? null : num(pref.yearsExperience, null);
    if (needY === null || needY <= 0) { v.experience = null; notes.experience = 'No minimum experience stated'; }
    else if (haveY === null) { v.experience = null; notes.experience = `Asks for ${needY}+ years; add yours in Profile`; }
    else { v.experience = Math.max(0, Math.min(1, haveY / needY)); notes.experience = `Asks for ${needY}+ years; you have about ${haveY}`; }
    // role: is this one of your target tracks
    const track = ctx.track || inferTrack(ctx.role || '');
    v.role = track === 'Other' ? 0.3 : track === 'Quant' ? 0.5 : s.targets.indexOf(track) >= 0 ? 1 : 0.5;
    notes.role = `${track}${s.targets.indexOf(track) >= 0 ? ' is a target track' : ' is not one of your target tracks'}`;
    // location
    const L = a.location || {}, mode = L.workMode || 'unknown';
    const places = s.places.map((p) => String(p).toLowerCase()), locs = (L.places && L.places.length ? L.places : (ctx.locations || [])).filter(Boolean).map((x) => String(x).toLowerCase());
    const regions = (Array.isArray(pref.regions) ? pref.regions : []).map((r) => String(r).toLowerCase());
    if (!locs.length && mode === 'unknown') { v.location = null; notes.location = 'Location not stated'; }
    else {
      const preferred = (mode === 'remote' && places.some((p) => p.indexOf('remote') >= 0)) || locs.some((x) => places.some((p) => x.indexOf(p) >= 0 || (p === 'tx' && x.indexOf('texas') >= 0)));
      const usLike = locs.some((x) => /,\s*[a-z]{2}\b|united states|\busa?\b/.test(x)) || (mode === 'remote' && !locs.length);
      const inRegion = regions.some((r) => (/united states|^us\b|^usa\b/.test(r) && usLike) || locs.some((x) => x.indexOf(r) >= 0));
      v.location = preferred ? 1 : inRegion ? 0.7 : regions.length ? 0.3 : null;
      notes.location = (mode !== 'unknown' ? mode[0].toUpperCase() + mode.slice(1) + ' · ' : '') + (preferred ? 'a preferred place' : inRegion ? 'inside your regions' : regions.length ? 'outside your regions' : 'add your regions in Profile');
    }
    // work authorization: separate questions, answered only from your Profile (never from name, school or nationality)
    const needs = pref.needsSponsorship === true ? true : pref.needsSponsorship === false ? false : null;
    const usCitizen = pref.usCitizen === true ? true : (pref.usCitizen === false || needs === true) ? false : null;
    const optAns = pref.needsCptOpt !== undefined ? pref.needsCptOpt : pref.cptOpt; // Profile field: "Will you work this internship on CPT or OPT?"
    const usesOpt = optAns === true ? true : optAns === false ? false : null;
    const spo = a.sponsorship || {}, said = (spo.evidence || '') + ' ' + (spo.note || '');
    const st = ['not_stated', 'cpt_opt_ok', undefined, ''].includes(spo.status) && NOW_FUTURE.test(said) ? 'no_sponsorship' : (spo.status || 'not_stated');
    const optOut = OPT_EXCLUDED.test(said) || (a.redFlags || []).some((x) => OPT_EXCLUDED.test(String(x)));
    const ev = spo.evidence || '';
    if (st === 'citizens_only' || st === 'clearance_required') {
      const what = st === 'citizens_only' ? 'U.S. citizenship required' : 'Security clearance required';
      const stc = usCitizen === false ? 'fails' : (usCitizen === true && st === 'citizens_only') ? 'meets' : 'unknown';
      eligibility.push(elig('citizenship', st === 'citizens_only' ? 'Citizenship' : 'Security clearance', stc, usCitizen === null ? `${what}; your Profile does not say` : what, ev));
    } else eligibility.push(elig('citizenship', 'Citizenship / clearance', 'na', 'Not required by the posting'));
    if (optOut) eligibility.push(elig('cptopt', 'Internship authorization (CPT/OPT)', usesOpt === true ? 'fails' : usesOpt === false ? 'meets' : 'unknown', 'The posting does not accept CPT/OPT candidates', ev));
    else if (st === 'cpt_opt_ok' || optWelcome(said)) eligibility.push(elig('cptopt', 'Internship authorization (CPT/OPT)', 'meets', 'CPT / OPT welcome', ev));
    else eligibility.push(elig('cptopt', 'Internship authorization (CPT/OPT)', usesOpt === false ? 'na' : 'unknown', usesOpt === false ? 'You do not need CPT/OPT' : 'Not stated in the posting'));
    if (st === 'no_sponsorship') eligibility.push(elig('sponsorship', 'Future sponsorship', needs === true ? 'fails' : needs === false ? 'meets' : 'unknown', 'Requires work authorization without sponsorship, now and in the future', ev));
    else if (st === 'sponsors') eligibility.push(elig('sponsorship', 'Future sponsorship', 'meets', 'Says it sponsors visas', ev));
    else eligibility.push(elig('sponsorship', 'Future sponsorship', needs === false ? 'na' : 'unknown', 'Not stated' + (ctx.h1b ? ` · reference only: ${Number(ctx.h1b).toLocaleString('en-US')} H-1B approvals${ctx.h1bYear ? ' in ' + ctx.h1bYear : ''} (employer-wide, not a commitment for this role)` : ''), st === 'cpt_opt_ok' ? '' : ev));
    const authFails = eligibility.some((e) => ['citizenship', 'cptopt', 'sponsorship'].includes(e.key) && e.status === 'fails');
    const authMeets = !authFails && (needs === false || st === 'sponsors') && !optOut;
    v.auth = authFails ? 0 : authMeets ? 1 : (st === 'cpt_opt_ok' && !optOut) ? 0.8 : null;
    notes.auth = ({ sponsors: 'Sponsors visas', cpt_opt_ok: 'CPT / OPT welcome', no_sponsorship: 'No sponsorship', citizens_only: 'Citizens only', clearance_required: 'Clearance required' })[st] || 'Not stated';
    if (optOut) notes.auth += ' · CPT/OPT not accepted';
    if (st === 'not_stated' && ctx.h1b) notes.auth += ` · ${Number(ctx.h1b).toLocaleString('en-US')} H-1B approvals on record (reference)`;
    // total over the components that could be assessed
    const wt = (k) => Math.max(0, num(w[k], 0));
    let all = 0, kn = 0, got = 0;
    for (const k of FIT_KEYS) { all += wt(k); if (known(v[k])) { kn += wt(k); got += wt(k) * v[k]; } }
    const coverage = all ? kn / all : 0;
    const parts = FIT_KEYS.map((k) => {
      const ok = known(v[k]);
      return { k, label: FIT_LABEL[k], v: ok ? v[k] : null, known: ok, pts: ok && kn ? wt(k) * v[k] / kn * 100 : 0, max: ok && kn ? wt(k) / kn * 100 : 0, weight: all ? wt(k) / all * 100 : 0, note: notes[k] };
    });
    const blockers = eligibility.filter((e) => e.status === 'fails').map((e) => `${e.label}: ${e.detail}`);
    const open = eligibility.filter((e) => e.status === 'unknown');
    let total = kn && coverage >= MIN_COVERAGE && known(v.skills) ? Math.round(got / kn * 100) : null;
    const verdict = blockers.length ? 'blocked' : total === null ? 'insufficient' : open.length ? 'check' : 'ok';
    const rawTotal = total;
    if (blockers.length && total !== null) total = Math.min(total, BLOCKED_CAP);
    return { total, rawTotal, coverage: Math.round(coverage * 100) / 100, verdict, parts, track, blockers, open: open.map((e) => e.label), eligibility, flagged,
      skills: { evidence: [...reqHit, ...optHit].map((x) => ({ term: show(x), depth: kind.get(x) === 'implied' ? 'implied' : depthOf.get(x) || 'work', required: req.indexOf(x) >= 0 })), reqHit: reqHit.map(show), reqMiss: req.filter((x) => reqHit.indexOf(x) < 0).map(show), optHit: optHit.map(show), optMiss: opt.filter((x) => optHit.indexOf(x) < 0).map(show), inferred } };
  }

  /* Literal keyword coverage of the resume text: share of the posting's keywords (weighted by importance) that appear
     in a phrase that does not negate them ("no Python experience" does not count). It measures wording, not ability:
     rephrasing can raise it without changing the candidate fit above, and it is not any employer's ATS score. */
  const NEG_BEFORE = /\b(no|not|without|never|lack(?:s|ing)?|zero|non|nor|unfamiliar with)\b[^.;:!?\n]{0,30}$/i;
  function affirmed(form, t) {
    const re = wordRe(form, 'g');
    let m, any = false;
    while ((m = re.exec(t)) !== null) {
      any = true;
      const start = m.index + m[1].length;
      if (!NEG_BEFORE.test(t.slice(Math.max(0, start - 40), start))) return 'yes';
      re.lastIndex = start + 1;
    }
    return any ? 'negated' : 'no';
  }
  function keywordScore(text, keywords) {
    const t = ' ' + String(text || '').toLowerCase().replace(/[ \t]+/g, ' ') + ' ';
    const seen = new Set(), hit = [], miss = [], negated = [];
    let got = 0, all = 0;
    for (const k of keywords || []) {
      const key = nk(k.term);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const wgt = Math.max(0, num(k.importance, 1));
      const forms = [...new Set([key, String(k.term || '').toLowerCase().trim(), ...Object.keys(ALIAS).filter((x) => ALIAS[x] === key)])].filter(Boolean);
      const res = forms.map((f) => affirmed(f, t));
      all += wgt;
      if (res.indexOf('yes') >= 0) { got += wgt; hit.push(k); } else { miss.push(k); if (res.indexOf('negated') >= 0) negated.push(k); }
    }
    return { score: all ? Math.round(got / all * 100) : 0, hit, miss, negated };
  }

  /* Token-free check of a resume bullet or letter sentence against the Profile facts it cites: numbers and years that
     are not in the facts, tools the facts do not mention (even ones from another experience), "Led"/"Managed" verbs or
     an "independently" claim the facts do not support. It cannot prove a sentence true: [] means nothing detected. */
  const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
  const numsOf = (t) => new Set((String(t || '').match(NUM_RE) || []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, '')));
  const LEAD_VERB = /^\s*(led|lead|managed|spearheaded|owned|directed|headed|architected|supervised|oversaw)\b/i;
  const LEAD_FACT = /\b(lead|led|leader|leading|manag|own(ed|er)?|direct|head|architect|supervis|oversaw|mentor|coordinat)/i;
  const SOLO = /\b(independently|single-?handedly|solely|on my own|by myself|sole (developer|engineer|author|owner))\b/i;
  const TEAM = /\b(team|we|our|together|collaborat\w*|co-?(built|developed|wrote|authored)|teammates?|classmates?|colleagues|partner)\b/i;
  function factCheck(text, sourceText, S) {
    const out = [], t = String(text || ''), src = String(sourceText || '');
    if (!src.trim()) return t.trim() ? ['No Profile fact is cited'] : [];
    const have = numsOf(src);
    const extra = [...numsOf(t)].filter((n) => !have.has(n));
    const years = extra.filter((n) => /^(19|20)\d\d$/.test(n)), nums = extra.filter((n) => !/^(19|20)\d\d$/.test(n));
    if (nums.length) out.push(`${nums.length > 1 ? 'Numbers' : 'Number'} ${nums.slice(0, 3).join(', ')} not in the cited facts`);
    if (years.length) out.push(`${years.length > 1 ? 'Years' : 'Year'} ${years.slice(0, 3).join(', ')} not in the cited facts`);
    const tl = ' ' + t.toLowerCase() + ' ', sl = ' ' + src.toLowerCase() + ' ';
    for (const name of SKILL_NAMES) {
      const k = nk(name);
      if (k.length < 3 && !/[+#]/.test(k)) continue; // "R", "Go", "C": too ambiguous in prose
      const forms = [k, name.toLowerCase(), ...Object.keys(ALIAS).filter((x) => ALIAS[x] === k)];
      if (!forms.some((f) => wordRe(f).test(tl)) || forms.some((f) => wordRe(f).test(sl))) continue;
      if (S && S.no && S.no.has(k)) out.push(`${name} is on your Do-not-claim list`);
      else if (S && !hasSkill(name, S)) out.push(`${name} is not in your Profile`);
      else out.push(`${name} is not in the cited facts (it may belong to another experience)`);
    }
    if (LEAD_VERB.test(t) && !LEAD_FACT.test(src)) out.push(`“${t.trim().split(/\s+/)[0]}” claims more than the cited facts`);
    if (SOLO.test(t) && TEAM.test(src)) out.push('Says the work was done alone; the cited facts describe team work');
    return out;
  }

  /* ---------- resume score: how ready this resume is for this posting (0-100) ----------
     Five parts, each 0-1, weighted: Match 35 (the posting's required and preferred skills that you truly have and that
     the resume shows), Impact 25 (bullets with a number; bullets that open with an action verb), Clarity 15 (length,
     vague phrases, repeated openers), Format 15 (one page at a readable size, density, 2-5 bullets per entry, LinkedIn,
     section order) and Truth 10 (bullets whose cited Profile facts do not back them). A part that cannot be assessed
     (no analysis, no layout yet) is left out and the rest is rescaled. Every lost point comes with a fix. */
  const RS_WEIGHTS = { match: 35, impact: 25, clarity: 15, format: 15, truth: 10 };
  const RS_LABEL = { match: 'Match', impact: 'Impact', clarity: 'Clarity', format: 'Format', truth: 'Truth' };
  const WEAK_START = /^(responsible|duties|tasks?|was|were|is|are|i|my|the|a|an|worked on|helped|assisted|in charge|participated)\b/i;
  const VAGUE = /\b(responsible for|helped( to)?|assisted (with|in)|worked on|various|a variety of|etc\.?|successfully|effectively|utilized|participated in|duties included)\b/i;
  function resumeScore(m, ctx) {
    ctx = ctx || {};
    const a = ctx.analysis || null, S = ctx.skills || null, L = ctx.layout || null, flagged = new Set(ctx.flagged || []);
    const secs = ((m && m.sections) || []).filter((x) => !x.hidden);
    const lines = [];
    for (const x of secs) {
      lines.push(x.text || '', ...(x.lines || []).filter((l) => !l.hidden).map((l) => `${l.label}: ${l.value}`), ...(x.items || []));
      for (const e of x.entries || []) if (!e.hidden) lines.push(e.title, e.subtitle, ...(e.lines || []), ...(e.bullets || []).filter((b) => !b.hidden).map((b) => b.text));
    }
    const t = ' ' + lines.filter(Boolean).join('\n').toLowerCase().replace(/[ \t]+/g, ' ') + ' ';
    const bullets = [];
    for (const x of secs) if (x.kind === 'entries' && x.key !== 'education') for (const e of x.entries || []) if (!e.hidden) for (const b of e.bullets || []) if (!b.hidden && String(b.text || '').trim()) bullets.push({ b, e, sec: x });
    const v = {}, notes = {}, fixes = [];
    const fix = (k, text, ref, gain) => fixes.push({ k, text, ref: ref || null, gain: gain || 1 });
    const shown = (term) => { const k = nk(term); return [...new Set([k, String(term || '').toLowerCase().trim(), ...Object.keys(ALIAS).filter((x) => ALIAS[x] === k)])].filter(Boolean).some((f) => affirmed(f, t) === 'yes'); };
    // match
    if (a && S) {
      const items = [], seen = new Set();
      const add = (term, w, req) => { const ops = anyOf(term); const key = ops.map(nk).join('|'); if (!key || seen.has(key)) return; seen.add(key); items.push({ term, ops, w, req }); };
      (a.requiredSkills || []).forEach((x) => add(x, 2, true));
      (a.preferredSkills || []).forEach((x) => add(x, 1, false));
      (a.keywords || []).filter((k) => (k.kind === 'tool' || k.kind === 'skill') && num(k.importance, 1) >= 2).forEach((k) => add(k.term, 1, false));
      let have = 0, got = 0; const miss = [];
      for (const it of items) {
        const mine = it.ops.filter((o) => hasSkill(o, S));
        if (!mine.length) continue;
        have += it.w;
        if (it.ops.some(shown)) got += it.w; else miss.push({ term: mine[0], req: it.req, w: it.w });
      }
      v.match = have ? got / have : null;
      notes.match = have ? `${Math.round(got / have * 100)}% of the posting's skills you have are on the page` : 'None of the posting\'s listed skills are in your Profile';
      miss.sort((x, y) => y.w - x.w).forEach((x) => fix('match', `Show “${x.term}”${x.req ? ' (required)' : ''}: you have it, but this resume never says so. Add it to Technical Skills, or to the bullet where you used it`, { goto: 'skills', term: x.term }, x.w * 2));
    } else notes.match = 'Analyze the posting to score the match';
    // impact
    if (bullets.length) {
      const withNum = bullets.filter((x) => /\d/.test(x.b.text)), weak = bullets.filter((x) => WEAK_START.test(x.b.text.trim()));
      const numShare = withNum.length / bullets.length;
      v.impact = 0.65 * Math.min(1, numShare / 0.5) + 0.35 * (1 - weak.length / bullets.length);
      notes.impact = `${withNum.length} of ${bullets.length} bullets have a number · ${bullets.length - weak.length} open with an action verb`;
      if (numShare < 0.5) {
        const cand = bullets.filter((x) => !/\d/.test(x.b.text)).slice(0, Math.max(1, Math.ceil(bullets.length * 0.5) - withNum.length));
        cand.forEach((x) => fix('impact', 'Add a number your Profile has (users, records, time saved, team size, accuracy) or swap in a quantified point', { bullet: x.b.id, text: x.b.text }, 1));
      }
      weak.forEach((x) => fix('impact', 'Open with an action verb (Built, Designed, Reduced…), not a duty or helper word', { bullet: x.b.id, text: x.b.text }, 1));
    } else notes.impact = 'No bullets yet';
    // clarity
    if (bullets.length) {
      let bad = 0;
      for (const x of bullets) {
        const tx = x.b.text.trim(), why = [];
        if (tx.length > 200) why.push('runs past two lines');
        if (tx.length < 45) why.push('too short to show what you did and why it mattered');
        if (VAGUE.test(tx)) why.push(`vague wording (“${(VAGUE.exec(tx) || [''])[0]}”)`);
        if (/\.$/.test(tx)) why.push('ends with a period');
        if (why.length) { bad++; fix('clarity', why.join('; '), { bullet: x.b.id, text: tx }, 0.6); }
      }
      const rep = [];
      for (const x of secs) if (x.kind === 'entries') {
        const first = {};
        for (const y of bullets.filter((z) => z.sec === x)) { const w = (y.b.text.trim().split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z-]/g, ''); if (w) (first[w] = first[w] || []).push(y); }
        for (const [w, ys] of Object.entries(first)) if (ys.length > 1) { rep.push(w); ys.slice(1).forEach((y) => fix('clarity', `“${w[0].toUpperCase() + w.slice(1)}” already opens another bullet in ${x.title}: vary the verb`, { bullet: y.b.id, text: y.b.text }, 0.5)); }
      }
      v.clarity = Math.max(0, 1 - (bad + rep.length * 0.5) / bullets.length);
      notes.clarity = bad || rep.length ? `${bad} bullet${bad === 1 ? '' : 's'} to tighten${rep.length ? ` · repeated opener: ${rep.join(', ')}` : ''}` : 'Concise, specific bullets';
    }
    // format
    const checks = [];
    if (L) {
      checks.push([3, L.pages === 1, L.pages === 1 ? 'One page' : `${L.pages} pages`, 'Fit it to one page: hide the least relevant bullets', { action: 'fit1' }]);
      const roomy = L.pages === 1 && L.size >= 10.5 && (L.tight === undefined || L.tight >= 1);
      checks.push([2, roomy, roomy ? `Readable at ${L.size} pt` : `Crowded (${L.size} pt${L.tight < 1 ? ', tight spacing' : ''})`, 'Too dense to skim: hide one or two weaker bullets so it fits at 10.5 pt with normal spacing', { action: 'fit1' }]);
      if (L.pages === 1) checks.push([1, L.fill >= 0.8, `${Math.round(L.fill * 100)}% of the page used`, 'The page has room: turn a hidden bullet back on or add a stronger point', null]);
    }
    const ents = secs.filter((x) => x.kind === 'entries' && x.key !== 'education').flatMap((x) => (x.entries || []).filter((e) => !e.hidden));
    const off = ents.filter((e) => { const n = (e.bullets || []).filter((b) => !b.hidden && String(b.text || '').trim()).length; return n && (n < 2 || n > 5); });
    checks.push([2, !off.length, off.length ? `${off.length} entr${off.length > 1 ? 'ies' : 'y'} outside 2–5 bullets` : '2–5 bullets per entry', 'Give each job or project 2–5 bullets', off.length ? { entry: off[0].id } : null]);
    const contact = String((m && m.header && m.header.contact) || '');
    checks.push([1, /linkedin/i.test(contact), 'LinkedIn in the header', 'Add your LinkedIn URL in Profile › Basics', { goto: 'basics' }]);
    const ix = (k) => secs.findIndex((x) => x.key === k || x.kind === k), ex = ix('experience'), sk = ix('skills');
    checks.push([1, ex < 0 || sk < 0 || ex === sk + 1, 'Experience right under Skills', 'Move Professional Experience directly under Technical Skills', null]);
    { let all = 0, ok = 0; for (const [w, pass, , tip, ref] of checks) { all += w; if (pass) ok += w; else fix('format', tip, ref, w * 0.8); } v.format = all ? ok / all : null; notes.format = checks.filter((c) => !c[1]).map((c) => c[2]).join(' · ') || checks.map((c) => c[2]).slice(0, 2).join(' · '); }
    // truth
    if (bullets.length) {
      const f = bullets.filter((x) => flagged.has(x.b.id));
      v.truth = Math.max(0, 1 - f.length / Math.max(3, bullets.length / 3));
      notes.truth = f.length ? `${f.length} bullet${f.length > 1 ? 's' : ''} not backed by the cited Profile facts` : 'Every bullet is backed by its Profile facts';
      f.forEach((x) => fix('truth', 'Not backed by its Profile facts: fix the bullet or add the true fact to your Profile', { bullet: x.b.id, text: x.b.text }, 3));
    }
    let all = 0, got = 0;
    const parts = Object.keys(RS_WEIGHTS).map((k) => { const ok = v[k] !== undefined && v[k] !== null; if (ok) { all += RS_WEIGHTS[k]; got += RS_WEIGHTS[k] * v[k]; } return { k, label: RS_LABEL[k], v: ok ? Math.round(v[k] * 100) / 100 : null, weight: RS_WEIGHTS[k], note: notes[k] || '' }; });
    fixes.sort((x, y) => y.gain - x.gain);
    return { total: all ? Math.round(got / all * 100) : null, parts, fixes, bullets: bullets.length };
  }

  /* What a failed save means for the page. status 0 = the request never reached the server.
     'offline' and 'server' are retried with backoff; 'rejected' and 'corrupt' are not (retrying cannot fix them). */
  function saveFailure(status) {
    if (!status) return 'offline';
    if (status === 409) return 'conflict';
    if (status === 503) return 'corrupt';
    if (status >= 400 && status < 500) return 'rejected';
    return 'server';
  }
  const RETRY_SECONDS = [5, 15, 60];
  const retryDelay = (n) => RETRY_SECONDS[Math.min(Math.max(0, n), RETRY_SECONDS.length - 1)];

  return { WEIGHT_KEYS, SKILL_NAMES, DEFAULTS, inferTrack, degreesOf, sponsorOf, trackOf, daysBetween, components, score, action, merge3, mergeById, mergeSet, mergeObject, mergeDeep, stable,
    FIT_KEYS, FIT_LABEL, FIT_WEIGHTS, MIN_COVERAGE, fit, keywordScore, skillSet, hasSkill, skillDepth, DEPTH_LABEL, nk, ALIAS,
    resumeScore, RS_WEIGHTS, WEAK_START, VAGUE, splitTerms, factCheck, OPT_EXCLUDED, saveFailure, retryDelay };
});

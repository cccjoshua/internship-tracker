/* Internship Tracker page. Pure scoring, track inference and merging live in core.js (IATCore). */
(function () {
'use strict';
const C = window.IATCore;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const KEY = 'iat-v1', SCHEMA = 3;
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 12);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (x) => JSON.parse(JSON.stringify(x));
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

/* ---------- dates ---------- */
let TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const rel = (n) => { const d = new Date(TODAY); d.setDate(d.getDate() + n); return iso(d); };
const parse = (s) => { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysFrom = (s) => { const p = parse(s); return p ? Math.round((p - TODAY) / 864e5) : null; };
const fmt = (s) => { const p = parse(s); if (!p) return '—'; const o = { month: 'short', day: 'numeric' }; if (p.getFullYear() !== TODAY.getFullYear()) o.year = 'numeric'; return p.toLocaleDateString('en-US', o); };
const maxDate = (x, y) => (!y || (x && x > y)) ? x : y;
const ago = (s) => { const n = -daysFrom(s); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; };
const dueText = (n) => n < 0 ? `${-n}d overdue` : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`;
const dueCls = (n) => n < 0 ? 'hot' : n <= 3 ? 'soon' : '';
const plural = (n, w, p) => `${n} ${n === 1 ? w : (p || w + 's')}`;

/* ---------- links ---------- */
function normUrl(u) { u = (u || '').trim(); if (!u) return ''; if (!/^[a-z][a-z0-9+.-]*:/i.test(u) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(u)) u = 'https://' + u; return u; }
const safeUrl = (u) => { u = normUrl(u); return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; };
const urlKey = (u) => safeUrl(u).toLowerCase().replace(/#.*$/, '').replace(/\/+$/, '');

/* ---------- model ---------- */
const STAGES = [['saved', 'Saved'], ['applied', 'Applied'], ['oa', 'Assessment'], ['interview', 'Interviewing'], ['offer', 'Offer'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn'], ['missed', 'Missed deadline'], ['ghosted', 'No response'], ['expired', 'Posting closed']];
const LABEL = Object.fromEntries(STAGES);
const ORDER = { saved: 0, applied: 1, oa: 2, interview: 3, offer: 4, rejected: 5, withdrawn: 6, missed: 7, ghosted: 8, expired: 9 };
const CLOSED = ['rejected', 'withdrawn', 'missed', 'ghosted', 'expired'];
const FLOW = ['saved', 'applied', 'oa', 'interview', 'offer'];
const TRACKS = ['SWE', 'DE', 'DA', 'DS', 'BIE'];
const TRACK_NAME = { SWE: 'Software Eng.', DE: 'Data Eng.', DA: 'Data Analyst', DS: 'Data Science', BIE: 'BI Engineer', Quant: 'Quant', Other: 'Other' };
const SPONSOR = { yes: 'Sponsors visa', no: 'No sponsorship', unknown: 'Sponsorship ?' };
const DEFAULTS = C.DEFAULTS;
const WEIGHT_LABEL = { fit: 'Role fit', skills: 'Skill match', sponsor: 'Sponsorship evidence', recency: 'Recency', degree: 'Degree', location: 'Preferred location' };
const WEIGHT_HINT = { fit: 'title matches a target track', skills: 'posting skills on your resume', sponsor: 'H-1B history, CPT/OPT wording', recency: 'halves every few days', degree: 'Master’s listed', location: 'one of your preferred places' };
const ROUND_KINDS = ['Recruiter call', 'Technical', 'Behavioral', 'Case / take-home', 'Hiring manager', 'Final round', 'Other'];
const DISMISS_REASONS = [['location', 'Location doesn’t work'], ['skills', 'Skills gap too big'], ['role', 'Role isn’t a fit'], ['company', 'Not interested in the company'], ['sponsor', 'Sponsorship concern'], ['timing', 'Dates or term don’t work'], ['other', 'Other']];
const DISMISS_LABEL = Object.fromEntries(DISMISS_REASONS);
const CLOSE_REASONS = [['rejected', 'Rejected', 'They said no'], ['withdrawn', 'Withdrawn', 'You stepped back'], ['ghosted', 'No response', 'Silent for weeks'], ['missed', 'Missed deadline', 'Saved but not submitted'], ['expired', 'Posting closed', 'The job was taken down']];

function hist(...p) { return p.map(([s, n]) => ({ s, d: rel(n) })); }
function blankApp(o) {
  return Object.assign({ id: uid(), company: '', role: '', track: '', status: 'saved', priority: 2, sponsor: 'unknown', location: '', url: '', posted: '', deadline: '', applied: '', resume: '', notes: '',
    nextText: '', nextDate: '', followedUp: '', snoozeUntil: '', followLog: [], rounds: [], contacts: [], history: [] }, o);
}
/* Follow-ups are logged separately from stage history so they never change the application's stage. */
function logFollowUp(a, d) { a.followLog = [...new Set([...(a.followLog || []), d])].filter((x) => parse(x)).sort(); a.followedUp = a.followLog[a.followLog.length - 1] || ''; }
function followText(a) { const n = (a.followLog || []).length; return n ? `Followed up ${fmt(a.followedUp)}${n > 1 ? ` · ${n}×` : ''}` : ''; }
function sampleApps() {
  const a = (o) => blankApp(Object.assign({ sample: true }, o));
  return [
    a({ company: 'Pelican Logistics', role: 'Business Intelligence Engineer Intern', track: 'BIE', location: 'Seattle, WA', status: 'saved', priority: 3, deadline: rel(9), resume: 'Resume_PelicanLogistics.docx', nextText: 'Submit application', nextDate: rel(1), history: hist(['saved', -1]) }),
    a({ company: 'Copperline Software', role: 'Business Data Analyst Intern, Strategy & Planning', track: 'DA', location: 'Mountain View, CA', status: 'saved', priority: 2, deadline: rel(5), nextText: 'Tailor resume', nextDate: rel(0), history: hist(['saved', -3]) }),
    a({ company: 'Brightwater Cloud', role: 'Software Engineer Intern', track: 'SWE', location: 'San Francisco, CA', status: 'saved', priority: 1, history: hist(['saved', -6]) }),
    a({ company: 'Summit Semiconductor', role: 'AI Data Science Intern (MS)', track: 'DS', location: 'Santa Clara, CA', status: 'applied', priority: 3, applied: rel(-12), resume: 'Resume_SummitSemiconductor.docx', score: 82, history: hist(['saved', -14], ['applied', -12]) }),
    a({ company: 'Mosaic Social', role: 'Data Science Intern', track: 'DS', location: 'San Francisco, CA', status: 'applied', priority: 2, applied: rel(-19), resume: 'Resume_MosaicSocial.docx', score: 64, history: hist(['saved', -22], ['applied', -19]) }),
    a({ company: 'Glacier Data', role: 'Data Engineer Intern', track: 'DE', location: 'San Mateo, CA', status: 'applied', priority: 2, applied: rel(-7), history: hist(['saved', -9], ['applied', -7]) }),
    a({ company: 'Vector AI Labs', role: 'Data Science Intern', track: 'DS', location: 'Redwood City, CA', status: 'oa', priority: 2, applied: rel(-18), resume: 'Resume_VectorAILabs.docx', nextText: 'Finish online assessment', nextDate: rel(3), score: 77, history: hist(['saved', -20], ['applied', -18], ['oa', -4]) }),
    a({ company: 'Keystone Bank', role: 'Data Analyst Intern', track: 'DA', location: 'McLean, VA', status: 'interview', priority: 3, applied: rel(-26), score: 79,
      rounds: [{ id: uid(), date: rel(-3), time: '10:00', kind: 'Recruiter call', with: 'Recruiter', notes: 'Asked about SQL projects and start date.' }, { id: uid(), date: rel(6), time: '14:00', kind: 'Final round', with: 'Analytics manager', notes: '' }],
      contacts: [{ id: uid(), name: 'Recruiter (add name)', title: 'Campus recruiting', email: '', link: '', note: '' }], history: hist(['saved', -28], ['applied', -26], ['oa', -15], ['interview', -3]) }),
    a({ company: 'Corner Market Co.', role: 'Data Science Intern', track: 'DS', location: 'Irving, TX', status: 'rejected', priority: 2, applied: rel(-30), score: 58, history: hist(['saved', -33], ['applied', -30], ['rejected', -9]) }),
  ];
}
function sampleListings() {
  const l = (o) => Object.assign({ id: 'ex-' + uid(), degree: 'BS/MS', sponsor: 'unknown', sample: true, source: 'example' }, o, { url: 'https://simplify.jobs/?example=' + encodeURIComponent(o.company) });
  return [
    l({ company: 'Bayou Grid Energy', role: 'Data Analytics Intern – Summer 2027', location: 'Houston, TX', posted: rel(-1), deadline: rel(6), skillsFound: ['SQL', 'Python', 'Tableau'] }),
    l({ company: 'Lattice Freight', role: 'Data Engineer Intern', location: 'Remote (US)', posted: rel(-2), sponsor: 'yes', skillsFound: ['Python', 'SQL', 'Airflow', 'AWS'] }),
    l({ company: 'Quarry Health', role: 'Data Science Intern, MS', location: 'Austin, TX', posted: rel(-3), degree: 'MS', sponsor: 'yes', deadline: rel(24), skillsFound: ['Python', 'Machine learning', 'Statistics'] }),
    l({ company: 'Harbor & Pine Retail', role: 'Business Intelligence Intern', location: 'Seattle, WA', posted: rel(-5), skillsFound: ['SQL', 'Power BI', 'Excel'] }),
    l({ company: 'Northwind Robotics', role: 'Software Engineer Intern', location: 'Pittsburgh, PA', posted: rel(-8), sponsor: 'yes', skillsFound: ['C/C++', 'Python', 'Linux'] }),
    l({ company: 'Meridian Quant', role: 'Quantitative Research Intern', location: 'New York, NY', posted: rel(-4), degree: 'PhD', sponsor: 'yes' }),
    l({ company: 'Cobalt Payments', role: 'Data Analyst Intern', location: 'Dallas, TX', posted: rel(-12), sponsor: 'no' }),
    l({ company: 'Fieldnote Labs', role: 'Machine Learning Intern', location: 'San Francisco, CA', posted: rel(-20), degree: 'MS' }),
    l({ company: 'Pelican Logistics', role: 'Business Intelligence Engineer Internship – 2027', location: 'Seattle, WA', posted: rel(-6) }),
  ];
}
const defaultUi = () => ({ q: '', track: '', sponsor: '', stage: 'open' });
function fresh() { return { v: SCHEMA, apps: [], manualListings: [], dismissed: [], dismissLog: [], settings: clone(DEFAULTS), ui: defaultUi() }; }

/* Older listings stored pre-computed values; keep the raw facts (same as fetcher.upgrade_listing). */
function upgradeListing(l) {
  if ('skillsFound' in l) return l;
  l = Object.assign({}, l);
  const sk = l.skills || {}; delete l.skills;
  l.skillsFound = [...(sk.matched || []), ...(sk.missing || [])];
  const flags = l.flags || []; delete l.flags;
  l.noSponsor = flags.includes('No sponsorship') || l.sponsor === 'no';
  l.friendly = (flags.includes('CPT/OPT friendly') || l.sponsor === 'yes') && !l.noSponsor;
  delete l.v; delete l.penalty;
  return l;
}
function migrate(d) {
  d = d || {};
  const ds = d.settings || {};
  const settings = Object.assign(clone(DEFAULTS), ds, {
    weights: Object.assign({}, DEFAULTS.weights, ds.weights && ds.weights.skills !== undefined ? ds.weights : {}),
    resumes: Object.assign({}, DEFAULTS.resumes, ds.resumes || {}),
  });
  if (!Array.isArray(settings.mySkills)) settings.mySkills = DEFAULTS.mySkills.slice();
  const legacy = Array.isArray(d.listings) ? d.listings : [];
  const s = {
    v: SCHEMA, apps: Array.isArray(d.apps) ? d.apps : [],
    manualListings: (Array.isArray(d.manualListings) ? d.manualListings : legacy.filter((l) => l && l.source !== 'simplify')).filter((l) => l && l.company).map(upgradeListing),
    dismissed: Array.isArray(d.dismissed) ? d.dismissed.slice(-3000) : [],
    dismissLog: Array.isArray(d.dismissLog) ? d.dismissLog.slice(-2000) : [],
    settings, ui: Object.assign(defaultUi(), d.ui),
  };
  if (!s.ui.sorts) { const o = s.ui.sort || {}; s.ui.sorts = { active: ['company', 'status', 'applied', 'action', 'resume', 'sponsor'].includes(o.key) ? o : { key: 'action', dir: 1 } }; }
  delete s.ui.sort;
  if (!STAGE_F[s.ui.stage]) s.ui.stage = s.ui.showClosed ? 'all' : 'open';
  delete s.ui.showClosed;
  s.apps = s.apps.filter((a) => a && a.company).map((a) => {
    const b = blankApp(a); b.url = safeUrl(b.url); if (!LABEL[b.status]) b.status = 'saved'; b.priority = Math.min(3, Math.max(1, +b.priority || 2));
    if (!['yes', 'no', 'unknown'].includes(b.sponsor)) b.sponsor = 'unknown';
    b.history = (Array.isArray(b.history) ? b.history : []).filter((h) => h && LABEL[h.s] && parse(h.d)); if (!b.history.length) b.history = [{ s: b.status, d: b.applied || iso(TODAY) }];
    b.followLog = (Array.isArray(b.followLog) ? b.followLog : []).filter((x) => parse(x)); if (b.followedUp && parse(b.followedUp) && !b.followLog.includes(b.followedUp)) b.followLog.push(b.followedUp); b.followLog.sort();
    b.rounds = (Array.isArray(b.rounds) ? b.rounds : []).filter((r) => r && typeof r === 'object').map((r) => Object.assign({ id: uid(), date: '', time: '', kind: 'Other', with: '', notes: '' }, r));
    b.contacts = (Array.isArray(b.contacts) ? b.contacts : []).filter((c) => c && typeof c === 'object').map((c) => Object.assign({ id: uid(), name: '', title: '', email: '', link: '', note: '' }, c));
    if (typeof b.contact === 'string' && b.contact.trim() && !b.contacts.length) b.contacts.push({ id: uid(), name: b.contact.trim(), title: '', email: '', link: '', note: 'Moved from the old Contact field' });
    delete b.contact;
    if (typeof b.score !== 'number' && typeof b.matchScore === 'number') b.score = b.matchScore;
    delete b.matchScore;
    if (typeof b.score !== 'number') { const m = /Match score (\d{1,3}) when tracked/.exec(b.notes || ''); if (m) b.score = +m[1]; }
    return b;
  });
  if (ds.onboarded === undefined && (s.apps.length || legacy.length)) s.settings.onboarded = true;
  return s;
}
function normFeed(d) { d = d || {}; return { lrev: +d.lrev || 0, listings: (Array.isArray(d.listings) ? d.listings : []).filter((l) => l && l.company).map(upgradeListing).map((l) => Object.assign({}, l, { url: safeUrl(l.url) })), fetch: d.fetch || null, closures: Array.isArray(d.closures) ? d.closures : [], savedDeadlines: d.savedDeadlines || {} }; }
const userData = () => ({ v: SCHEMA, apps: S.apps, manualListings: S.manualListings, dismissed: S.dismissed, dismissLog: S.dismissLog, settings: S.settings, ui: Object.assign({}, S.ui, { q: '' }) });
const listingKey = (l) => urlKey(l.url) || ('k:' + norm(l.company) + '|' + norm(l.role));

/* ---------- storage: data/tracker.json via server.py (revision-checked, merged on conflict), else this browser ---------- */
const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('iat-sync') : null;
const Store = {
  mode: 'local', rev: 0, base: null, t: null, busy: false, queued: null, destructive: false, tries: 0,
  async init() {
    try {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 2500);
      const [r, rl] = await Promise.all([fetch('api/state', { cache: 'no-store', signal: ctl.signal }), fetch('api/listings', { cache: 'no-store', signal: ctl.signal })]);
      if (r.ok && (r.headers.get('content-type') || '').includes('application/json')) {
        const d = await r.json();
        if (d === null || (d && Array.isArray(d.apps))) {
          this.mode = 'file';
          const feed = rl.ok ? await rl.json() : {};
          if (d) { this.rev = +d.rev || 0; this.base = d; }
          return { user: d, feed };
        }
      }
    } catch (e) { /* not served by server.py */ }
    try { const raw = localStorage.getItem(KEY); return { user: raw ? JSON.parse(raw) : null, feed: {} }; } catch (e) { return { user: null, feed: {} }; }
  },
  async latest() { try { const r = await fetch('api/state', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; } },
  async latestFeed() { try { const r = await fetch('api/listings', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; } },
  save(d, destructive) {
    if (destructive) this.destructive = true;
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* quota or private mode */ }
    if (this.mode !== 'file') { setSaved('Saved in this browser only', true); return; }
    this.queued = d; clearTimeout(this.t); setSaved('Saving…'); this.t = setTimeout(() => this.flush(), 300);
  },
  async flush() {
    if (this.busy || !this.queued) return;
    const d = this.queued; this.queued = null; this.busy = true; const backup = this.destructive; this.destructive = false;
    try {
      const headers = { 'Content-Type': 'application/json' }; if (backup) headers['X-Backup'] = '1';
      const r = await fetch('api/state', { method: 'PUT', headers, body: JSON.stringify(Object.assign({}, d, { baseRev: this.rev })) });
      if (r.status === 409) {
        const body = await r.json(), latest = body.state || {};
        if (this.tries++ > 3) throw new Error('conflict loop');
        const { merged, conflicts } = C.merge3(this.base || {}, clone(d), latest);
        this.rev = +latest.rev || 0; this.base = latest;
        adoptUser(merged, { keepUi: true }); UI.scoredRev++;
        this.queued = userData();
        if ($('#drawer').hidden) render();
        toast(conflicts ? `Merged with changes from another tab. Where both changed the same item, your version was kept (${conflicts}).` : 'Merged with changes from another tab');
      } else if (!r.ok) throw new Error(String(r.status));
      else {
        const res = await r.json(); this.tries = 0; this.rev = +res.rev || this.rev; this.base = Object.assign(clone(d), { rev: this.rev });
        setSaved('Saved to data/tracker.json'); if (bc) bc.postMessage({ rev: this.rev });
      }
    } catch (e) {
      if (!this.queued) this.queued = d;
      setSaved('Server not reachable; kept in this browser', true);
      clearTimeout(this.rt); this.rt = setTimeout(() => this.flush(), 15000);
      return;
    } finally { this.busy = false; }
    if (this.queued && this.tries < 5) this.flush();
  },
};
function setSaved(t, warn) { const el = $('#saveState'); el.textContent = t; el.classList.toggle('warn', !!warn); }
let S, F = normFeed({}), pendingExt = null;
function save(destructive) { Store.save(userData(), destructive); }
function adoptUser(d, o) { const ui = S ? S.ui : null; S = migrate(d); if (o && o.keepUi && ui) S.ui = ui; }
function applyExternal(d, msg) {
  if (!d) return;
  if (!$('#drawer').hidden) { pendingExt = { d, msg }; return; }
  adoptUser(d, { keepUi: true }); Store.rev = +d.rev || Store.rev; Store.base = d; undoStack.length = 0; pendingExt = null; render(); if (msg) toast(msg);
}
function applyFeed(d, msg) {
  if (!d) return;
  F = normFeed(d); UI.scoredRev++;
  applyClosures();
  if (!$('#drawer').hidden) return;
  render(); if (msg) toast(msg);
  notifyCheck();
}
/* The refresh reports Saved applications whose posting closed; move them to Closed here (the server never edits your data). */
function applyClosures() {
  const names = [];
  let filled = 0;
  for (const [id, d] of Object.entries(F.savedDeadlines || {})) { const a = S.apps.find((x) => x.id === id); if (a && !a.deadline && parse(d)) { a.deadline = d; filled++; } } // fill only; never overwrite a date you entered
  for (const c of F.closures) {
    const a = S.apps.find((x) => x.id === c.id);
    if (!a || a.status !== 'saved' || a.keepOpen) continue;
    setStatus(a, 'expired', parse(c.day) ? c.day : iso(TODAY));
    a.notes = ((a.notes || '') + ` Posting closed (${c.why}), detected ${c.day}.`).trim();
    names.push(a.company);
  }
  if (names.length) UI.closedNotice = names;
  if (names.length || filled) save();
}
if (bc) bc.onmessage = async (e) => {
  if (Store.mode !== 'file' || !e.data) return;
  if (e.data.rev > Store.rev && !Store.busy && !Store.queued) applyExternal(await Store.latest(), 'Updated from another tab');
  if (e.data.lrev > F.lrev) applyFeed(await Store.latestFeed());
};
window.addEventListener('storage', (e) => { if (e.key !== KEY || !e.newValue || Store.mode === 'file') return; try { applyExternal(JSON.parse(e.newValue), 'Updated from another tab'); } catch (_) { /* ignore */ } });
async function checkRemote() {
  if (Store.mode !== 'file') return;
  if (!Store.busy && !Store.queued) { const l = await Store.latest(); if (l && (+l.rev || 0) > Store.rev) applyExternal(l, 'Updated from another tab'); }
  const f = await Store.latestFeed(); if (f && (+f.lrev || 0) > F.lrev) applyFeed(f, refreshMessage(f.fetch));
}
function takeDailySnapshot() {
  try {
    const k = KEY + '-snap-' + iso(TODAY); if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(userData()));
    const keys = Object.keys(localStorage).filter((x) => x.startsWith(KEY + '-snap-')).sort(); while (keys.length > 7) localStorage.removeItem(keys.shift());
  } catch (e) { /* ignore */ }
}
function snapshots() { try { return Object.keys(localStorage).filter((x) => x.startsWith(KEY + '-snap-')).sort().reverse(); } catch (e) { return []; } }

/* ---------- undo ---------- */
const undoStack = [];
function checkpoint(withSettings) { undoStack.push(JSON.stringify({ apps: S.apps, manualListings: S.manualListings, dismissed: S.dismissed, dismissLog: S.dismissLog, settings: withSettings ? S.settings : null })); if (undoStack.length > 30) undoStack.shift(); }
function undo() {
  const j = undoStack.pop(); if (!j) return toast('Nothing to undo');
  const d = JSON.parse(j); S.apps = d.apps; S.manualListings = d.manualListings || []; S.dismissed = d.dismissed || []; S.dismissLog = d.dismissLog || []; if (d.settings) S.settings = d.settings;
  UI.scoredRev++; save(true); render(); toast(undoStack.length ? `Undone · ${plural(undoStack.length, 'more step')} available` : 'Undone');
}

/* ---------- logic ---------- */
function syncApplied(a) { const h = a.history.find((x) => x.s === 'applied'); if (h) a.applied = h.d; else if (a.status === 'saved') a.applied = ''; }
function setStatus(a, s, d) {
  if (a.status === s) return;
  if (CLOSED.includes(a.status) && !CLOSED.includes(s)) a.keepOpen = true; // reopened by you: the daily check will not close it again
  a.status = s; a.history.push({ s, d: d || iso(TODAY) }); syncApplied(a);
}
function moveTo(a, s) {
  const last = a.history[a.history.length - 1];
  const back = FLOW.includes(s) && FLOW.includes(a.status) && FLOW.indexOf(s) < FLOW.indexOf(a.status);
  if (back && last && last.s === a.status && a.history.length > 1) { a.history.pop(); a.status = s; if (a.history[a.history.length - 1].s !== s) a.history.push({ s, d: iso(TODAY) }); syncApplied(a); }
  else setStatus(a, s);
}
const reached = (a, s) => a.history.some((h) => h.s === s) || a.status === s;
const norm = (s) => (s || '').toLowerCase().replace(/\b(summer|fall|winter|spring|internship|intern|co-?op)\b|\b20\d\d\b/g, '').replace(/[^a-z0-9]/g, '');
function findDup(company, role, url, exceptId) {
  const k = norm(company) + '|' + norm(role), u = urlKey(url);
  return S.apps.find((a) => a.id !== exceptId && ((norm(a.company) + '|' + norm(a.role)) === k || (u && urlKey(a.url) === u)));
}
const inferTrack = (role) => { const t = C.inferTrack(role); return TRACKS.includes(t) ? t : ''; };
/* Every listing scored under the current settings (cached until data or settings change). */
const UI = { expanded: new Set(), limits: {}, attnAll: false, tableLimit: 25, scoredRev: 0, cache: null, select: false, selected: new Set(), closedNotice: null, editGoal: null, baseline: null };
function scored() {
  const key = UI.scoredRev + '|' + iso(TODAY) + '|' + JSON.stringify(S.settings) + '|' + S.apps.length + '|' + S.dismissed.length + '|' + S.manualListings.length;
  if (UI.cache && UI.cache.key === key) return UI.cache.list;
  const dis = new Set(S.dismissed), today = iso(TODAY);
  const list = [...S.manualListings, ...F.listings].filter((l) => !dis.has(listingKey(l)) && !dis.has('k:' + norm(l.company) + '|' + norm(l.role))).map((l) => {
    const sc = C.score(l, S.settings, today);
    return Object.assign({}, l, sc, { t: sc.track, sponsor: sc.sponsor, dup: findDup(l.company, l.role, l.url) });
  });
  UI.cache = { key, list };
  return list;
}
const visibleListings = () => scored().filter((l) => !(S.settings.hideNoSponsor && l.sponsor === 'no'));
const action = (l) => C.action(l, S.settings);
function filtered() {
  const { q, track, sponsor } = S.ui; const t = (q || '').toLowerCase().trim();
  return S.apps.filter((a) => (!t || [a.company, a.role, a.location, a.notes, ...(a.contacts || []).map((c) => c.name + ' ' + c.title), ...(a.rounds || []).map((r) => r.kind + ' ' + r.with + ' ' + r.notes)].join(' ').toLowerCase().includes(t)) && (!track || a.track === track) && (!sponsor || a.sponsor === sponsor));
}
function lastDate(a) { const l = a.history[a.history.length - 1]; return l ? l.d : a.applied; }
const quietDays = (a) => -daysFrom(maxDate(lastDate(a), a.followedUp));
const snoozed = (a) => a.snoozeUntil && daysFrom(a.snoozeUntil) > 0;
function staleApps() { const sd = +S.settings.staleDays || 45; return S.apps.filter((a) => a.status === 'applied' && !snoozed(a) && quietDays(a) >= sd); }
function followUps() { const fu = +S.settings.followUpDays || 14, sd = +S.settings.staleDays || 45; return S.apps.filter((a) => a.status === 'applied' && !snoozed(a) && quietDays(a) >= fu && quietDays(a) < sd); }
const band = (s) => s >= (+S.settings.topScore || 75) ? 'b1' : s >= (+S.settings.minScore || 55) ? 'b2' : 'b3';
const resumeFor = (l) => (S.settings.resumes || DEFAULTS.resumes)[l.t || l.track] || 'SWE';
const appliedOn = (d) => S.apps.filter((a) => a.history.some((h) => h.s === 'applied' && h.d === d)).length;
function weekStart() { const s = new Date(TODAY); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return s; }
function appliedThisWeek() { const from = iso(weekStart()); return S.apps.filter((a) => a.history.some((h) => h.s === 'applied' && h.d >= from && h.d <= iso(TODAY))).length; }
/* Saved applications: you chose to apply. They lead today's queue (Joshua's saved workflow). */
const savedOn = (a) => { const h = a.history.find((x) => x.s === 'saved'); return h ? h.d : (a.history[0] || {}).d || iso(TODAY); };
const savedDays = (a) => Math.max(0, -daysFrom(savedOn(a)));
const savedApps = () => S.apps.filter((a) => a.status === 'saved');
/* Anything with a deadline within 7 days goes first. */
function soonDl(x) { const n = daysFrom(x.deadline); return n !== null && n >= 0 && n <= 7 ? 0 : 1; }
/* Saved applications not applied to yet, most urgent first: deadline, then score, then the longest waiting. */
function savedQueue() {
  return savedApps().filter((a) => !(a.deadline && daysFrom(a.deadline) < 0))
    .sort((x, y) => soonDl(x) - soonDl(y) || (x.deadline && soonDl(x) === 0 ? x.deadline.localeCompare(y.deadline) : 0) || (y.score ?? -1) - (x.score ?? -1) || savedOn(x).localeCompare(savedOn(y)));
}
function listingPicks() { return visibleListings().filter((l) => !l.dup && action(l)[0] === 'now').sort((a, b) => soonDl(a) - soonDl(b) || b.total - a.total); }
/* Today's queue: saved applications before new picks; anything due within 7 days first of all. */
function queueList() {
  const lim = Math.max(5, (+S.settings.dailyGoal || 3) + 2);
  const sv = savedQueue().map((a) => ({ kind: 'app', id: a.id, a, soon: soonDl(a) })), ls = listingPicks().map((l) => ({ kind: 'listing', id: l.id, l, soon: soonDl(l) }));
  return [...sv.filter((x) => !x.soon), ...ls.filter((x) => !x.soon), ...sv.filter((x) => x.soon), ...ls.filter((x) => x.soon)].sort((x, y) => x.soon - y.soon).slice(0, lim);
}
const qMoreSaved = (Q) => Math.max(0, savedQueue().length - Q.filter((x) => x.kind === 'app').length);
/* Applications › List stage filter. */
const STAGE_F = { open: ['Open', (a) => !CLOSED.includes(a.status)], todo: ['To apply', (a) => a.status === 'saved'], active: ['In progress', (a) => ['applied', 'oa', 'interview', 'offer'].includes(a.status)], closed: ['Closed', (a) => CLOSED.includes(a.status)], all: ['All', () => true] };
const filtersOn = () => !!(S.ui.q || S.ui.track || S.ui.sponsor);
const upcomingRounds = (a) => (a.rounds || []).filter((r) => parse(r.date) && daysFrom(r.date) >= 0).sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));

/* ---------- small renderers ---------- */
const stChip = (s) => `<span class="chip st s-${s}">${LABEL[s]}</span>`;
const spChip = (s) => `<span class="chip v-${s}">${SPONSOR[s] || SPONSOR.unknown}</span>`;
const prio = (p) => `<span class="prio" role="img" aria-label="Priority ${p} of 3">${[1, 2, 3].map((i) => `<i class="${i <= p ? 'on' : ''}"></i>`).join('')}</span>`;
const opts = (list, val) => list.map(([v, l]) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(l)}</option>`).join('');
const link = (u, txt, cls = 'btn sm ghost') => { u = safeUrl(u); return u ? `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${txt}</a>` : ''; };
const eff = (now) => now ? '<span class="eff now" title="Takes effect as soon as you change it">Instant</span>' : '<span class="eff later" title="Takes effect from the next listings refresh">Next refresh</span>';
const ring = (n) => `<span class="ring sm ${band(n)}" style="--p:${n}" title="Match score ${n} of 100"><span>${n}</span></span>`;

/* ---------- views ---------- */
const VIEWS = {
  dashboard: ['Dashboard', () => TODAY.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })],
  board: ['Applications', () => 'Drag cards between stages, or focus one and press Shift + arrow keys'],
  table: ['Applications', () => 'Select a company to edit; select a column to sort'],
  inbox: ['New listings', () => 'Ranked by your scoring rules'],
  settings: ['Settings', () => 'Scoring, reminders, calendar and your data'],
};
const R = {};

const savedBadge = (a) => typeof a.score === 'number' ? `<span class="ring sm ${band(a.score)}" style="--p:${a.score}" title="Match score ${a.score} when saved"><span>${a.score}</span></span>` : `<span class="qbadge" title="Saved by you" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 2.5h8v11l-4-3-4 3z"/></svg></span>`;
const savedAgo = (a) => { const d = savedDays(a); return d === 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; };
const dlTag = (d) => { const n = daysFrom(d); return n === null ? '' : `<span class="dl ${n < 0 ? 'hot' : n <= 7 ? 'soon' : ''}" title="Application deadline">${n < 0 ? 'Deadline passed' : 'Deadline ' + fmt(d)}${n >= 0 && n <= 7 ? ' · ' + dueText(n).toLowerCase() : ''}</span>`; };
const appliedBtn = (a, cls = 'btn sm primary') => `<button class="${cls}" type="button" data-applied-app="${a.id}" title="Mark as applied today">Applied ✓</button>`;
const skipBtn = (a) => `<button class="btn sm ghost" type="button" data-skip-app="${a.id}" title="You decided not to apply: moves to Closed (Withdrawn); Undo is available">Not applying</button>`;
const visIcon = (s) => s === 'yes' ? '<span class="vis yes" title="Sponsors visa / CPT-OPT friendly" aria-label="Sponsors visa">✓</span>' : s === 'no' ? '<span class="vis no" title="No sponsorship" aria-label="No sponsorship">✕</span>' : '<span class="sr">Unknown</span>';

/* Weekly chart drawn at the box's real pixel width, so labels stay 11px on any screen. */
function weekSvg(width) {
  const { wk, goalW } = UI.week || { wk: [], goalW: 0 }; if (!wk.length) return '';
  const mx = Math.max(goalW, ...wk.map((w) => w.c)), top = mx <= 4 ? 4 : Math.ceil(mx / 2) * 2;
  const W = Math.max(280, Math.round(width)), H = 200, L = 28, B = 24, T = 18, Rp = 6, pw = W - L - Rp, ph = H - B - T, bw = pw / 8, y = (v) => T + ph - (v / top) * ph, narrow = bw < 62;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Applications submitted per week over the last 8 weeks: ${wk.map((w) => w.c).join(', ')}">`;
  for (const g of [0, top / 2, top]) svg += `<line class="gl" x1="${L}" x2="${W - Rp}" y1="${y(g)}" y2="${y(g)}"/><text x="${L - 8}" y="${y(g) + 4}" text-anchor="end">${g}</text>`;
  wk.forEach((w, i) => {
    const bwid = Math.min(48, bw * 0.56), x = L + bw * i + (bw - bwid) / 2, h = ph * (w.c / top);
    svg += `<rect class="bar${i === 7 ? ' now' : ''}" x="${x}" y="${T + ph - h}" width="${bwid}" height="${h}" rx="2"/>`;
    if (w.c) svg += `<text class="val" x="${x + bwid / 2}" y="${T + ph - h - 5}" text-anchor="middle">${w.c}</text>`;
    if (bw >= 44 || i % 2 === 1) svg += `<text x="${x + bwid / 2}" y="${H - 6}" text-anchor="middle">${i === 7 ? (narrow ? 'Now' : 'This week') : narrow ? `${w.d.getMonth() + 1}/${w.d.getDate()}` : w.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</text>`;
  });
  if (goalW) svg += `<line class="goal" x1="${L}" x2="${W - Rp}" y1="${y(goalW)}" y2="${y(goalW)}"/><text class="goal-l" x="${W - Rp}" y="${y(goalW) - 6}" text-anchor="end">Goal ${goalW}/week</text>`;
  return svg + '</svg>';
}
function fitChart() { const box = $('#weekChart'); if (box && box.clientWidth) box.innerHTML = weekSvg(box.clientWidth); }

R.dashboard = () => {
  const A = S.apps, appliedA = A.filter((a) => reached(a, 'applied')), applied = appliedA.length;
  const replied = appliedA.filter((a) => ['oa', 'interview', 'offer', 'rejected'].some((s) => reached(a, s))).length;
  const intv = A.filter((a) => reached(a, 'interview')).length, offers = A.filter((a) => reached(a, 'offer')).length;
  const toApply = savedApps().length;
  const SMALL = 20, small = applied > 0 && applied < SMALL;
  const pct = (n, d) => d ? Math.round(n / d * 100) + '%' : '—';
  const smallNote = small ? ` · <span class="small" title="With fewer than ${SMALL} applications one reply moves this by ${Math.round(100 / applied)} points">small sample</span>` : '';
  const items = attentionItems();
  const urg = (i) => i.missed || (i.n < 0 && !i.fu) ? 'u-hot' : (i.fu || i.saved || i.n <= 3) ? 'u-soon' : '';
  const acts = (i) => i.fu ? `<span class="mini"><button class="btn sm" type="button" data-fu="done" data-id="${i.a.id}">Followed up</button><button class="btn sm ghost" type="button" data-fu="snooze" data-id="${i.a.id}">Snooze 7d</button></span>`
    : i.missed ? `<span class="mini"><span class="due hot">${dueText(i.n)}</span><button class="btn sm" type="button" data-missed="${i.a.id}">Mark missed</button></span>`
      : i.saved ? `<span class="mini">${appliedBtn(i.a)}<button class="btn sm" type="button" data-skip-app="${i.a.id}" title="You decided not to apply: moves to Closed (Withdrawn); Undo is available">Not applying</button><button class="btn sm ghost" type="button" data-fu="snooze" data-id="${i.a.id}">Keep 7d</button></span>`
        : i.stale ? `<span class="mini"><button class="btn sm" type="button" data-ghost="${i.a.id}">Close as no response</button><button class="btn sm ghost" type="button" data-fu="snooze" data-id="${i.a.id}">Keep</button></span>`
          : `<span class="due ${dueCls(i.n)}">${dueText(i.n)}</span>`;
  const shown = UI.attnAll ? items : items.slice(0, 5);
  const todo = items.length ? `<ul class="todo">${shown.map((i) => `<li class="${urg(i)}"><span class="kind">${i.kind}</span><button class="what" type="button" data-open="${i.a.id}"><b>${esc(i.a.company)}</b><span>${esc(i.text)} · ${esc(i.a.role)}</span></button>${acts(i)}</li>`).join('')}</ul>
    ${items.length > 5 ? `<div class="panel-foot"><button class="btn sm ghost" type="button" data-action="attn-all">${UI.attnAll ? 'Show fewer' : `Show all ${items.length}`}</button></div>` : ''}` : `<p class="empty">Nothing due in the next 7 days.</p>`;
  const topS = +S.settings.topScore || 75;
  const best = visibleListings().filter((l) => !l.dup && l.total >= topS);
  const picks = queueList(), moreSaved = qMoreSaved(picks);
  const qli = (x) => x.kind === 'app'
    ? `<li class="qsaved">${savedBadge(x.a)}<button class="what" type="button" data-open="${x.a.id}"><b>${esc(x.a.company)} <span class="chip st s-saved">Saved</span></b><span>${esc(x.a.role)} · ${x.a.deadline ? `<span class="due ${dueCls(daysFrom(x.a.deadline))}">Apply by ${fmt(x.a.deadline)}</span>` : `Saved ${savedAgo(x.a)}`} · Resume: ${esc(x.a.resume || resumeFor(x.a))}</span></button><span class="mini">${appliedBtn(x.a)}${link(x.a.url, 'Posting ↗')}</span></li>`
    : `<li>${ring(x.l.total)}<a class="what" href="#inbox" data-goto="${esc(x.l.id)}"><b>${esc(x.l.company)}</b><span>${x.l.isNew ? '<span class="chip new">New</span> ' : ''}${esc(x.l.role)}${x.l.deadline ? ' · ' + dlTag(x.l.deadline) : ''} · Resume: ${esc(resumeFor(x.l))}</span></a><span class="mini"><button class="btn sm primary" type="button" data-trackl="${esc(x.l.id)}" title="Save to Applications">Save</button><button class="btn sm" type="button" data-appliedl="${esc(x.l.id)}" title="Add as applied today">Applied ✓</button></span></li>`;
  const topPanel = picks.length ? `<ul class="tmatch">${picks.slice(0, 6).map(qli).join('')}</ul>
    <div class="panel-foot">${moreSaved ? `<button class="btn sm ghost" type="button" data-action="show-saved">${moreSaved} more saved →</button>` : ''}<a class="btn sm ghost" href="#inbox">All new listings · ${best.length} top matches →</a></div>`
    : `<p class="empty">Nothing queued. Save listings you want to apply to, or check New listings after the next refresh.</p>`;
  const fst = [['applied', 'Applied'], ['oa', 'Assessment'], ['interview', 'Interview'], ['offer', 'Offer']];
  const fc = fst.map(([s]) => A.filter((a) => reached(a, s)).length), base = Math.max(fc[0], 1);
  const funnel = fst.map(([s, l], i) => `<div class="frow"><span>${l}</span><div class="fbar" aria-hidden="true"><span class="s-${s}" style="width:${Math.max(fc[i] ? 3 : 0, fc[i] / base * 100)}%"></span></div><span class="num"><b>${fc[i]}</b>${i ? ` · ${Math.round(fc[i] / base * 100)}%` : ''}</span></div>`).join('');
  const start = weekStart(); start.setDate(start.getDate() - 49);
  const wk = Array.from({ length: 8 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + 7 * i); return { d, c: 0 }; });
  for (const a of A) { const h = a.history.find((x) => x.s === 'applied'); const d = parse(h ? h.d : a.applied); if (!d) continue; const i = Math.floor((d - start) / (7 * 864e5)); if (i >= 0 && i < 8) wk[i].c++; }
  const goalW = Math.max(0, +S.settings.weeklyGoal || 0);
  UI.week = { wk, goalW };
  const segs = [['saved', 'Saved'], ['active', 'In progress'], ['closed', 'Closed']];
  const tcol = { saved: 'var(--line-strong)', active: 'var(--st-applied)', closed: 'var(--st-rejected)' };
  const tmax = Math.max(1, ...TRACKS.map((t) => A.filter((a) => a.track === t).length));
  const trows = TRACKS.map((t) => {
    const at = A.filter((a) => a.track === t); const c = { saved: at.filter((a) => a.status === 'saved').length, active: at.filter((a) => ['applied', 'oa', 'interview', 'offer'].includes(a.status)).length, closed: at.filter((a) => CLOSED.includes(a.status)).length };
    return `<div class="trow" role="img" aria-label="${t}: ${c.saved} saved, ${c.active} in progress, ${c.closed} closed"><b>${t}</b><div class="seg" style="width:${Math.max(at.length ? 8 : 0, at.length / tmax * 100)}%">${segs.map(([k]) => c[k] ? `<span style="flex:${c[k]};background:${tcol[k]}"></span>` : '').join('')}</div><span class="num">${at.length}</span></div>`;
  }).join('');
  const dG = +S.settings.dailyGoal || 3, dDone = appliedOn(iso(TODAY));
  const wDone = appliedThisWeek(), wG = goalW || 10;
  const due3 = items.filter((i) => i.n <= 3), overdue = due3.filter((i) => i.n < 0 && !i.fu).length;
  const goalForm = (k, v, max) => `<form data-goalform="${k}"><label class="sr" for="g-${k}">${k === 'daily' ? 'Daily' : 'Weekly'} goal</label><input id="g-${k}" type="number" min="1" max="${max}" value="${v}" class="mono"><button class="btn sm primary" type="submit">Save</button><button class="btn sm ghost" type="button" data-action="goal-cancel">Cancel</button></form>`;
  const pencil = (k) => `<button class="btn icon sm ghost" type="button" data-goal="${k}" aria-label="Edit ${k} goal" title="Edit goal"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2.5 13.5 5 6 12.5H3.5V10z"/></svg></button>`;
  const prog = (n, g) => `<div class="prog ${n >= g ? 'done' : ''}"><span style="width:${Math.min(100, n / g * 100)}%"></span></div>`;
  const tile = (k, body, tip) => `<div class="tile"${tip ? ` title="${esc(tip)}"` : ''}><span class="k">${k}</span>${body}</div>`;
  const Q = picks;
  const today = `<div class="today" role="group" aria-label="Today">
    ${tile(`Applied today ${pencil('daily')}`, UI.editGoal === 'daily' ? goalForm('daily', dG, 20) : `<span class="t mono">${dDone}/${dG}</span>${prog(dDone, dG)}<a class="go s" href="#inbox">${dDone >= dG ? 'Daily goal met · keep going →' : `${plural(Q.length, 'pick')} in today’s queue →`}</a>`, 'Applications you marked Applied today, against your daily goal.')}
    ${tile(`This week ${pencil('weekly')}`, UI.editGoal === 'weekly' ? goalForm('weekly', wG, 60) : `<span class="t mono">${wDone}/${wG}</span>${prog(wDone, wG)}<span class="s">${wDone >= wG ? 'Weekly goal met' : `${wG - wDone} more to reach your goal${toApply ? ` · ${toApply} saved to apply` : ''}`}</span>`, 'Applications submitted since Monday, against your weekly goal.')}
    ${tile('Needs attention', `<span class="t ${overdue ? 'hot' : due3.length ? 'soon' : ''}">${due3.length || 'None'}</span><span class="s">${overdue ? `<span class="due hot">${overdue} overdue</span>` : due3.length ? 'Follow-ups and items due within 3 days' : 'Nothing due within 3 days'}</span>`, 'Follow-ups that are due, plus deadlines, next steps and interviews in the next 3 days.')}
    ${tile('Response rate', `<span class="t mono${small ? ' dim' : ''}">${pct(replied, applied)}</span><span class="s">${replied} of ${applied} replied${smallNote}</span>`, 'Share of applications that got any reply: an assessment, interview, offer or rejection.')}
    ${tile('Interview rate', `<span class="t mono${small ? ' dim' : ''}">${pct(intv, applied)}</span><span class="s">${plural(intv, 'interview')} · ${plural(offers, 'offer')}${smallNote}</span>`, 'Share of applications that reached an interview.')}
  </div>${(() => { const n = toApply, lim = +S.settings.savedLimit || 15; return n > lim ? `<div class="notice warn"><span><b>${n} saved applications</b>, more than your limit of ${lim}. Apply to or drop a few before saving more.</span><button class="btn sm" type="button" data-action="show-saved">Review saved →</button></div>` : ''; })()}${UI.closedNotice ? `<div class="notice"><span class="grow">Closed since the last refresh: <b>${UI.closedNotice.map(esc).join(', ')}</b> moved from Saved to Closed.</span><button class="btn sm ghost" type="button" data-action="notice-ok">OK</button></div>` : ''}`;
  const showTrack = replied >= 5;
  const sampleHint = small ? `<p class="empty">Rates are based on ${plural(applied, 'application')}; treat them as a rough signal until you have ${SMALL} or more.</p>` : '';
  return `<div style="display:flex;flex-direction:column;gap:16px">
  ${today}
  <div class="dash">
    <section class="panel a-att"><h2>Needs attention <small>next 7 days · follow up after ${S.settings.followUpDays} quiet days</small></h2>${todo}</section>
    <section class="panel a-top"><h2>Today’s queue <small>your saved applications first, then “Apply now” picks</small></h2>${topPanel}</section>
    <section class="panel a-pipe" ${showTrack ? '' : 'style="grid-column:1/-1"'}><h2>Pipeline <small>applications that reached each stage · n = ${applied}</small></h2><div class="funnel">${funnel}</div>${sampleHint}${showTrack ? '' : `<p class="empty">A breakdown by track appears once you have 5 or more replies (now ${replied}).</p>`}</section>
    ${showTrack ? `<section class="panel a-track"><h2>By track</h2><div class="tracks">${trows}</div><div class="legend">${segs.map(([k, l]) => `<span><i style="background:${tcol[k]}"></i>${l}</span>`).join('')}</div></section>` : ''}
    <section class="panel chart a-week"><h2>Applications per week <small>last 8 weeks · dashed line is your weekly goal</small></h2><div id="weekChart" class="chartbox">${weekSvg(880)}</div></section>
  </div></div>`;
};
function attentionItems() {
  const items = [];
  for (const a of S.apps) {
    if (CLOSED.includes(a.status)) continue;
    if (a.status === 'saved' && a.deadline) { const n = daysFrom(a.deadline); if (n !== null && n <= 7) items.push({ a, kind: n < 0 ? 'Missed?' : 'Deadline', n, text: (n < 0 ? 'Deadline passed ' : 'Apply by ') + fmt(a.deadline), missed: n < 0 }); }
    if (a.nextText && a.nextDate) { const n = daysFrom(a.nextDate); if (n !== null && n <= 7) items.push({ a, kind: 'Next step', n, text: a.nextText }); }
    for (const r of upcomingRounds(a)) { const n = daysFrom(r.date); if (n <= 7) items.push({ a, kind: 'Interview', n, text: `${r.kind}${r.time ? ' at ' + r.time : ''}${r.with ? ' with ' + r.with : ''}` }); }
  }
  const ssd = +S.settings.savedStaleDays || 7;
  for (const a of savedApps()) {
    if (snoozed(a)) continue; const d = savedDays(a);
    if (d >= ssd && !items.some((i) => i.a === a)) items.push({ a, kind: 'Saved', n: 0.6, text: `Saved ${d} days ago, not applied yet`, saved: true });
  }
  for (const a of followUps()) items.push({ a, kind: 'Follow up', n: -0.5, text: `No reply for ${quietDays(a)} days`, fu: true });
  for (const a of staleApps()) items.push({ a, kind: 'No reply', n: 0.5, text: `Silent for ${quietDays(a)} days`, stale: true });
  return items.sort((x, y) => x.n - y.n);
}

function urgency(a) {
  if (CLOSED.includes(a.status)) return '';
  let n = null;
  if (a.status === 'saved' && a.deadline) n = daysFrom(a.deadline);
  for (const d of [a.nextText ? a.nextDate : '', ...upcomingRounds(a).map((r) => r.date)]) { const m = daysFrom(d); if (m !== null && (n === null || m < n)) n = m; }
  if (n !== null && n < 0) return 'u-hot';
  if (n !== null && n <= 3) return 'u-soon';
  if (followUps().includes(a) || staleApps().includes(a)) return 'u-soon';
  return '';
}
function card(a) {
  let meta = '';
  if (a.status === 'saved') { const old = savedDays(a) >= (+S.settings.savedStaleDays || 7); meta = (a.deadline ? `<span class="due ${dueCls(daysFrom(a.deadline))}">Deadline ${fmt(a.deadline)}</span>` : '<span>No deadline</span>') + `<span class="${old ? 'due soon' : ''}">Saved ${savedAgo(a)}</span>`; }
  else if (a.applied) meta = `<span>Applied ${ago(a.applied)}</span>`;
  if (a.status === 'applied' && quietDays(a) >= (+S.settings.followUpDays || 14)) meta += `<span class="due soon">No reply for ${quietDays(a)} days</span>`;
  if (followText(a) && !CLOSED.includes(a.status)) meta += `<span class="fu-done">✓ ${followText(a)}</span>`;
  const r = !CLOSED.includes(a.status) && upcomingRounds(a)[0];
  if (r) meta += `<span class="rd">◆ ${esc(r.kind)} · ${fmt(r.date)}${r.time ? ' ' + esc(r.time) : ''}</span>`;
  if (a.nextText) meta += `<span class="next">→ ${esc(a.nextText)}${a.nextDate ? ' · ' + fmt(a.nextDate) : ''}</span>`;
  return `<li class="card ${urgency(a)}" draggable="true" data-id="${a.id}" data-open="${a.id}" tabindex="0" aria-label="${esc(a.company + ', ' + a.role + ', ' + LABEL[a.status])}">
    <div class="card-top"><strong>${esc(a.company)}</strong>${prio(a.priority)}</div>
    <div class="role">${esc(a.role)}</div>
    <div class="chips">${a.track ? `<span class="chip tag">${a.track}</span>` : ''}${a.sponsor !== 'unknown' ? spChip(a.sponsor) : ''}${CLOSED.includes(a.status) ? stChip(a.status) : ''}</div>
    <div class="meta">${meta}</div>
    ${a.status === 'saved' ? `<div class="qacts">${appliedBtn(a, 'btn sm')}${link(a.url, 'Posting ↗')}</div>` : ''}
    <select class="move" data-status-for="${a.id}" aria-label="Move ${esc(a.company)} to stage">${opts(STAGES, a.status)}</select></li>`;
}
const COL_LIMIT = 6;
function colSort(s) {
  if (s === 'saved') return (x, y) => (x.deadline || '9').localeCompare(y.deadline || '9') || y.priority - x.priority;
  if (s === 'applied') return (x, y) => quietDays(y) - quietDays(x) || y.priority - x.priority; // longest silence first
  if (s === 'closed') return (x, y) => (lastDate(y) || '').localeCompare(lastDate(x) || '');
  const nxt = (a) => [a.nextDate, ...upcomingRounds(a).map((r) => r.date)].filter(Boolean).sort()[0] || '9';
  return (x, y) => nxt(x).localeCompare(nxt(y)) || y.priority - x.priority;
}
const layoutCtl = (v) => `<div class="segctl" role="group" aria-label="Layout"><a href="#board" ${v === 'board' ? 'aria-current="true"' : ''}>Board</a><a href="#table" ${v === 'table' ? 'aria-current="true"' : ''}>List</a></div>`;
R.board = () => {
  const A = filtered(); const cols = ['saved', 'applied', 'oa', 'interview', 'offer', 'closed'];
  if (!S.apps.length) return emptyState();
  const nA = A.filter((a) => !CLOSED.includes(a.status)).length;
  return `<div class="toolbar" style="margin-bottom:10px"><span class="grow">${plural(nA, 'active application')}</span>${layoutCtl('board')}</div><div class="board">${cols.map((s) => {
    const items = A.filter((a) => s === 'closed' ? CLOSED.includes(a.status) : a.status === s).sort(colSort(s));
    const name = s === 'closed' ? 'Closed' : LABEL[s];
    if (s === 'closed' && !S.ui.closedOpen) return `<section class="col collapsed s-closed" data-drop="closed" aria-label="Closed, ${items.length} applications, collapsed"><h2><span class="dot"></span>Closed<span class="count">${items.length}</span></h2><button class="colbtn" type="button" data-action="closed-toggle">Show</button></section>`;
    const lim = UI.limits['col-' + s] || COL_LIMIT, vis = items.slice(0, lim);
    return `<section class="col s-${s}" data-drop="${s}" aria-label="${name}, ${items.length} applications"><h2><span class="dot"></span>${name}<span class="count">${items.length}</span></h2>${items.length ? `<ul class="cards">${vis.map(card).join('')}</ul>` : '<p class="empty">Drop a card here</p>'}${items.length > lim ? `<button class="colbtn" type="button" data-more="col-${s}">Show ${items.length - lim} more</button>` : ''}${s === 'closed' ? '<button class="colbtn" type="button" data-action="closed-toggle">Hide closed</button>' : ''}</section>`;
  }).join('')}</div>`;
};
function emptyState() {
  return `<div class="panel" style="align-items:flex-start"><h2>No applications yet</h2><p class="empty">Add one with <span class="kbd">N</span>, save a listing from New listings, or import a file in Settings.</p>
    <div class="row"><button class="btn primary" type="button" data-action="add">+ Add application</button><a class="btn" href="#inbox">Browse new listings</a><a class="btn ghost" href="#settings/data">Import</a></div></div>`;
}

/* One computed "what happens next" per application. rank: lower = sooner. */
function nextAction(a) {
  const fu = +S.settings.followUpDays || 14, sd = +S.settings.staleDays || 45;
  if (CLOSED.includes(a.status)) return { t: LABEL[a.status], s: fmt(lastDate(a)), c: 'mut', r: 1e5 };
  const r = upcomingRounds(a)[0], rn = r ? daysFrom(r.date) : null;
  const step = a.nextText && a.nextDate ? daysFrom(a.nextDate) : null;
  if (r && (step === null || rn <= step)) return { t: `Interview: ${r.kind}`, s: `${fmt(r.date)}${r.time ? ' ' + r.time : ''} · ${dueText(rn)}`, c: rn <= 3 ? 'soon' : '', r: rn };
  if (step !== null) return { t: a.nextText, s: `${fmt(a.nextDate)} · ${dueText(step)}`, c: step < 0 ? 'hot' : step <= 3 ? 'soon' : '', r: step };
  if (a.status === 'saved') {
    if (a.deadline) { const n = daysFrom(a.deadline); return n < 0 ? { t: 'Deadline passed', s: `${fmt(a.deadline)} · mark missed?`, c: 'hot', r: n } : { t: 'Apply by ' + fmt(a.deadline), s: dueText(n), c: n <= 3 ? 'hot' : n <= 7 ? 'soon' : '', r: n }; }
    return { t: 'Apply', s: 'no deadline listed', c: '', r: 30 };
  }
  if (a.status === 'applied') {
    const q = quietDays(a), snz = snoozed(a);
    if (!snz && q >= sd) return { t: 'No reply · close?', s: `silent ${q} days`, c: 'soon', r: 0.5 };
    if (!snz && q >= fu) return { t: 'Follow up', s: `quiet ${q} days`, c: 'soon', r: -0.5 };
    const base = snz ? a.snoozeUntil : (() => { const d = parse(maxDate(lastDate(a), a.followedUp)) || new Date(TODAY); d.setDate(d.getDate() + fu); return iso(d); })();
    return { t: a.followedUp ? `Followed up ${fmt(a.followedUp)}` : 'Waiting for reply', s: `follow up ${fmt(base)}`, c: '', r: 60 + (daysFrom(base) || 0) };
  }
  if (a.status === 'offer') return { t: 'Respond to offer', s: 'add the reply deadline as next step', c: 'soon', r: 2 };
  return { t: 'Add the next step', s: `${LABEL[a.status]} · ${ago(lastDate(a))}`, c: 'soon', r: 5 };
}
/* Applications › List: separate sections, because Saved and Applied rows need different columns. */
const TSEC = {
  todo: { title: 'To apply', hint: 'saved, not submitted yet', filter: (a) => a.status === 'saved', def: { key: 'deadline', dir: 1 },
    cols: [['company', 'Company · Role'], ['score', 'Score'], ['deadline', 'Deadline'], ['saved', 'Saved'], ['resume', 'Resume'], ['', ' ']],
    empty: 'Nothing saved. Press Save on a listing in New listings or the dashboard queue.' },
  active: { title: 'In progress', hint: 'applied, waiting or interviewing', filter: (a) => ['applied', 'oa', 'interview', 'offer'].includes(a.status), def: { key: 'action', dir: 1 },
    cols: [['company', 'Company · Role'], ['status', 'Status'], ['applied', 'Applied'], ['action', 'Next action'], ['resume', 'Resume'], ['sponsor', 'Visa']],
    empty: 'No applications in progress yet.' },
  closed: { title: 'Closed', hint: 'rejected, withdrawn, no response, posting closed', filter: (a) => CLOSED.includes(a.status), def: { key: 'closed', dir: -1 },
    cols: [['company', 'Company · Role'], ['status', 'Status'], ['applied', 'Applied'], ['closed', 'Closed on'], ['resume', 'Resume']],
    empty: 'Nothing closed.' } };
const STAGE_SECS = { open: ['todo', 'active'], todo: ['todo'], active: ['active'], closed: ['closed'], all: ['todo', 'active', 'closed'] };
function sortVal(a, key) {
  switch (key) {
    case 'status': return ORDER[a.status]; case 'action': return nextAction(a).r * 10 - a.priority; case 'sponsor': return ({ yes: 0, no: 1, unknown: 2 })[a.sponsor];
    case 'score': return typeof a.score === 'number' ? -a.score : ''; case 'deadline': return a.deadline || ''; case 'saved': return savedOn(a);
    case 'closed': return lastDate(a) || ''; case 'resume': return (a.resume || resumeFor(a)).toLowerCase(); default: return String(a[key] || '').toLowerCase();
  }
}
function sortRows(rows, { key, dir }) {
  return rows.sort((x, y) => {
    const a = sortVal(x, key), b = sortVal(y, key); if (a === '' && b !== '') return 1; if (b === '' && a !== '') return -1;
    const c = (a > b ? 1 : a < b ? -1 : 0) * dir; return c || ((typeof y.score === 'number' ? y.score : -1) - (typeof x.score === 'number' ? x.score : -1)) || savedOn(x).localeCompare(savedOn(y));
  });
}
const appliedCell = (a) => { if (!a.applied) return '—'; const n = -daysFrom(a.applied); return `${fmt(a.applied)}<span class="na-s">${n <= 0 ? 'today' : n + 'd ago'}</span>`; };
const resumeCell = (a) => `<td class="rs" title="${esc(a.resume || resumeFor(a))}">${a.resume ? esc(a.resume) : `<span style="color:var(--faint)">${esc(resumeFor(a))} (base)</span>`}</td>`;
const coCell = (a) => `<td class="co ${urgency(a)}"><button type="button" data-open="${a.id}">${esc(a.company)}</button><span class="sub2">${a.track ? `<span class="chip tag">${a.track}</span>` : ''}${esc(a.role)}</span></td>`;
const stCell = (a) => `<td><select class="stsel s-${a.status}" data-status-for="${a.id}" aria-label="Status for ${esc(a.company)}">${opts(STAGES, a.status)}</select></td>`;
function rowFor(k, a) {
  if (k === 'todo') {
    const n = daysFrom(a.deadline), d = savedDays(a), old = d >= (+S.settings.savedStaleDays || 7);
    return `<tr data-open="${a.id}">${coCell(a)}
      <td class="sc-c">${typeof a.score === 'number' ? ring(a.score) : '<span class="na-s">—</span>'}</td>
      <td class="dt">${n === null ? '<span class="na-s">not listed</span>' : `<span class="${n <= 3 ? 'due hot' : n <= 7 ? 'due soon' : ''}">${fmt(a.deadline)}</span><span class="na-s">${n < 0 ? 'passed' : dueText(n).toLowerCase()}</span>`}</td>
      <td class="dt">${fmt(savedOn(a))}<span class="na-s ${old ? 'due soon' : ''}">${d === 0 ? 'today' : d + 'd ago'}</span></td>
      ${resumeCell(a)}
      <td class="acts-c"><div class="mini">${appliedBtn(a)}${link(a.url, 'Posting ↗')}${skipBtn(a)}</div></td></tr>`;
  }
  if (k === 'active') {
    const na = nextAction(a);
    return `<tr data-open="${a.id}">${coCell(a)}${stCell(a)}<td class="dt">${appliedCell(a)}</td>
      <td class="na"><span class="na-t ${na.c}">${esc(na.t)}</span><span class="na-s">${esc(na.s)}</span></td>${resumeCell(a)}<td class="vi">${visIcon(a.sponsor)}</td></tr>`;
  }
  return `<tr data-open="${a.id}" class="closed">${coCell(a)}${stCell(a)}<td class="dt">${appliedCell(a)}</td><td class="dt">${fmt(lastDate(a))}</td>${resumeCell(a)}</tr>`;
}
R.table = () => {
  if (!S.apps.length) return emptyState();
  const all = filtered(), stage = STAGE_F[S.ui.stage] ? S.ui.stage : 'open';
  const bar = `<div class="toolbar" style="margin-bottom:12px"><div class="stagef" role="group" aria-label="Show stage">${Object.entries(STAGE_F).map(([k, [l, f]]) => `<button type="button" data-stage="${k}" aria-pressed="${k === stage}">${l}<span class="c">${all.filter(f).length}</span></button>`).join('')}</div>
    <span class="grow"></span><button class="btn sm ghost" type="button" data-action="export-csv">Export CSV</button>${layoutCtl('table')}</div>`;
  const secs = STAGE_SECS[stage], single = secs.length === 1;
  return bar + `<div class="tsecs">${secs.map((k) => {
    const T = TSEC[k], sort = (S.ui.sorts || {})[k] || T.def, rows = sortRows(all.filter(T.filter), sort);
    const open = single || ((S.ui.tsec || {})[k] !== undefined ? S.ui.tsec[k] : k !== 'closed'), lim = UI.limits['tsec-' + k] || 25, shown = rows.slice(0, lim);
    const head = `<button class="tsec-h" type="button" data-tsec="${k}" aria-expanded="${open}" ${single ? 'disabled' : ''}><span class="tsec-t">${T.title}</span><span class="cnt">${rows.length}</span><span class="hint">${T.hint}</span>${single ? '' : '<span class="car" aria-hidden="true">›</span>'}</button>`;
    if (!open) return `<section class="tsec s-${k}" aria-label="${T.title}">${head}</section>`;
    const table = rows.length ? `<div class="tablewrap"><table class="t-${k}"><thead><tr>${T.cols.map(([c, l]) => c ? `<th scope="col" aria-sort="${sort.key === c ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${k}:${c}">${l} ${sort.key === c ? `<span class="arr" aria-hidden="true">${sort.dir > 0 ? '↑' : '↓'}</span>` : ''}</button></th>` : `<th scope="col"><span class="sr">Actions</span></th>`).join('')}</tr></thead>
      <tbody>${shown.map((a) => rowFor(k, a)).join('')}</tbody></table>${rows.length > lim ? `<button class="more" type="button" data-more="tsec-${k}" style="display:block;width:100%;box-sizing:border-box">Show ${Math.min(25, rows.length - lim)} more of ${rows.length - lim}</button>` : ''}</div>`
      : `<p class="empty tsec-empty">${filtersOn() ? 'Nothing here with these filters.' : T.empty}</p>`;
    return `<section class="tsec s-${k}" aria-label="${T.title}">${head}${table}</section>`;
  }).join('')}</div>`;
};

function evidence(l) {
  const h = l.h1b === null || l.h1b === undefined ? (l.source === 'simplify' ? 'No H-1B record found for this employer' : '') : `${Number(l.h1b).toLocaleString('en-US')} H-1B approvals (USCIS FY2023)`;
  const fl = (l.flags || []).map((f) => `<span class="chip ${f === 'CPT/OPT friendly' ? 'v-yes' : f === 'No sponsorship' ? 'v-no' : 'tag'}">${esc(f)}${f === 'No sponsorship' && l.pen ? ` −${l.pen}` : ''}</span>`).join('');
  return h || fl ? `<div class="ev"><span>${esc(h)}</span>${fl}</div>` : '';
}
function skillLine(l) {
  const m = l.matched || [], x = l.missing || [];
  if (!m.length && !x.length) return l.source === 'simplify' ? `<div class="sk empty">${l.textRead ? 'No specific tools named in the posting' : 'Posting text could not be read; skill match counted as neutral'}</div>` : '';
  return `<div class="sk"><span class="sk-l">Skills ${m.length}/${m.length + x.length}</span>${m.map((s) => `<span class="chip v-yes">${esc(s)}</span>`).join('')}${x.map((s) => `<span class="chip miss" title="Not in your skills (Settings)">${esc(s)}</span>`).join('')}</div>`;
}
function refreshMessage(f) {
  if (!f) return '';
  if (f.error) return 'Refresh failed: ' + f.error;
  return `Refreshed: ${f.matched} listings, ${f.new || 0} new${f.removed ? `, ${f.removed} closed removed` : ''}`;
}
function fetchSummary() {
  const f = F.fetch; if (!f) return Store.mode === 'file' ? 'Not refreshed yet' : 'Example listings only (the local server refreshes from SimplifyJobs)';
  const at = new Date(f.at), hrs = +S.settings.fetchHours || 2, next = new Date(at.getTime() + hrs * 3600e3);
  const t = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Refreshed ${t(at)}${at.toDateString() !== new Date().toDateString() ? ' ' + fmt(iso(at)) : ''}${f.new ? ` · ${f.new} new` : ''}${f.removed ? ` · ${f.removed} closed or expired removed` : ''} · next about ${t(next)}${f.error ? ` · <span class="due hot">last refresh failed: ${esc(f.error)}</span>` : ''}`;
}
let refreshing = false;
R.inbox = () => {
  const t = (S.ui.q || '').toLowerCase().trim();
  let L = scored();
  const hidden = S.settings.hideNoSponsor ? L.filter((l) => l.sponsor === 'no').length : 0;
  if (S.settings.hideNoSponsor) L = L.filter((l) => l.sponsor !== 'no');
  if (S.ui.sponsor) L = L.filter((l) => l.sponsor === S.ui.sponsor);
  if (S.ui.track) L = L.filter((l) => l.t === S.ui.track);
  if (t) L = L.filter((l) => (l.company + ' ' + l.role + ' ' + l.location).toLowerCase().includes(t));
  L = L.slice().sort((a, b) => (!!a.dup - !!b.dup) || b.total - a.total);
  if (S.ui.lsort === 'newest') L.sort((a, b) => (!!a.dup - !!b.dup) || (b.posted || '').localeCompare(a.posted || '') || b.total - a.total);
  const ex = F.fetch && F.fetch.excluded ? Object.entries(F.fetch.excluded).sort((a, b) => b[1] - a[1]) : [];
  const head = `<div class="inbox-head"><p><b>${L.length}</b> listing${L.length === 1 ? '' : 's'} ranked by fit${hidden ? ` · ${hidden} hidden without sponsorship` : ''}<br><span class="sub">${fetchSummary()}</span></p>
    <select id="lsort" aria-label="Sort listings"><option value="score"${S.ui.lsort !== 'newest' ? ' selected' : ''}>Best match first</option><option value="newest"${S.ui.lsort === 'newest' ? ' selected' : ''}>Newest first</option></select>
    <label class="switch"><input type="checkbox" id="hideNo" ${S.settings.hideNoSponsor ? 'checked' : ''}> Hide no-sponsorship</label>
    <button class="btn sm${UI.select ? ' primary' : ''}" type="button" data-action="select-mode" aria-pressed="${UI.select}">${UI.select ? 'Done selecting' : 'Select'}</button>
    <button class="btn sm" type="button" data-action="refresh" ${refreshing ? 'disabled' : ''}>${refreshing ? 'Refreshing…' : 'Refresh now'}</button></div>
    <div class="toolbar" style="margin-top:6px;align-items:flex-start">${ex.length ? `<details class="why exl"><summary>Not shown this refresh: ${ex.reduce((s, e) => s + e[1], 0).toLocaleString('en-US')}</summary><div class="parts">${ex.map(([k, n]) => `<span>${esc(k)} <b>${n.toLocaleString('en-US')}</b></span>`).join('')}</div></details>` : ''}<span class="grow"></span>LEGEND_SLOT</div>`;
  if (!L.length) return head.replace('LEGEND_SLOT', '') + `<div class="panel" style="margin-top:12px"><p class="empty">No listings match. Refresh now, clear the filters, or widen the window in Settings.</p></div>`;
  const topS = +S.settings.topScore || 75, minS = +S.settings.minScore || 55, open = S.ui.sec || {};
  const Q = filtersOn() ? [] : queueList(), qids = new Set(Q.filter((x) => x.kind === 'listing').map((x) => x.id)), rest = L.filter((l) => !qids.has(l.id)), moreSaved = qMoreSaved(Q);
  const Lq = new Map(L.map((l) => [l.id, l]));
  const goal = +S.settings.dailyGoal || 3, done = appliedOn(iso(TODAY));
  const queue = Q.length ? `<section class="lsec queue" aria-label="Today's queue"><div class="lsec-h"><span>Today’s queue</span><span class="hint">your saved applications first, then “Apply now” picks · open the posting, apply, then press Applied ✓</span>
      <span style="margin-left:auto;display:flex;align-items:center;gap:8px;font-weight:500"><span class="hint">Applied today</span> <b class="mono">${done}/${goal}</b><span class="prog ${done >= goal ? 'done' : ''}" style="width:90px"><span style="width:${Math.min(100, done / goal * 100)}%"></span></span></span></div>
      ${Q.map((x) => x.kind === 'app' ? srow(x.a) : lrow(Lq.get(x.id) || x.l)).join('')}${moreSaved ? `<button class="more" type="button" data-action="show-saved">${plural(moreSaved, 'more saved application')} →</button>` : ''}</section>` : '';
  const groups = [
    ['new', 'New since the last refresh', '', rest.filter((l) => !l.dup && l.isNew && l.total >= minS), true],
    ['top', 'Top matches', `score ${topS}+`, rest.filter((l) => !l.dup && !l.isNew && l.total >= topS), true],
    ['more', 'More matches', `score ${minS}–${topS - 1}`, rest.filter((l) => !l.dup && !l.isNew && l.total >= minS && l.total < topS), false],
    ['low', 'Lower matches', `below ${minS}`, rest.filter((l) => !l.dup && l.total < minS), false],
    ['dup', 'Already tracking', '', rest.filter((l) => l.dup), false]].filter((g) => g[3].length);
  const w = S.settings.weights;
  const legend = `<details class="info"><summary><span aria-hidden="true">ⓘ</span> What the labels mean</summary><div class="info-pop"><p><span class="act now">Apply now</span> score ${topS}+ and at most 1 missing skill</p><p><span class="act tailor">Tailor first</span> add the missing skills you truly have, then apply</p><p><span class="act low">Low priority</span> below ${minS} or no sponsorship</p><p class="sub">Score weights: role fit ${w.fit}, skills ${w.skills}, sponsorship ${w.sponsor}, recency ${w.recency}, degree ${w.degree}, location ${w.location} (change them in Settings). Expand a listing to see its breakdown.</p></div></details>`;
  const vis = [];
  const body = `<div style="margin-top:12px">${queue}${Q.length ? '<div style="height:12px"></div>' : ''}${groups.map(([k, title, hint, items, def]) => {
    const isOpen = open[k] !== undefined ? open[k] : def, lim = UI.limits['sec-' + k] || 25;
    if (isOpen) vis.push(...items.slice(0, lim).filter((l) => !l.dup));
    return `<section class="lsec" aria-label="${esc(title)}"><button class="lsec-h" type="button" data-sec="${k}" aria-expanded="${isOpen}">${k === 'new' ? '<span class="chip new">New</span>' : ''}${esc(title)} <span class="cnt">${items.length}</span>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}<span class="car" aria-hidden="true">›</span></button>
      ${isOpen ? items.slice(0, lim).map(lrow).join('') + (items.length > lim ? `<button class="more" type="button" data-more="sec-${k}">Show ${Math.min(25, items.length - lim)} more of ${items.length - lim}</button>` : '') : ''}</section>`;
  }).join('')}</div>`;
  UI.visibleIds = [...Q.filter((x) => x.kind === 'listing'), ...vis].map((l) => l.id);
  const n = UI.selected.size;
  const selbar = UI.select ? `<div class="selbar" role="region" aria-label="Selected listings"><span class="grow">${n ? plural(n, 'listing') + ' selected' : 'Select listings with the checkboxes'}</span>
    <button class="btn sm ghost" type="button" data-action="sel-all">Select all shown</button><button class="btn sm ghost" type="button" data-action="sel-none" ${n ? '' : 'disabled'}>Clear</button>
    <button class="btn sm primary" type="button" data-action="sel-track" ${n ? '' : 'disabled'}>Save</button><button class="btn sm" type="button" data-action="sel-dismiss" ${n ? '' : 'disabled'}>Dismiss…</button></div>` : '';
  return head.replace('LEGEND_SLOT', legend) + body + selbar;
};
/* A saved application inside today's queue. */
function srow(a) {
  return `<article class="lrow qsaved${UI.select ? ' sel' : ''}" aria-label="${esc(a.company + ', ' + a.role + ', saved')}">
    ${UI.select ? '<span></span>' : ''}${savedBadge(a)}
    <button class="lmain" type="button" data-open="${a.id}" title="Open to edit">
      <span class="l1"><b>${esc(a.company)}</b><span class="role">${esc(a.role)}</span><span class="chip st s-saved">Saved</span></span>
      <span class="l2">${a.track ? `<span>${esc(a.track)}</span>` : ''}${a.location ? `<span>${esc(a.location.split('; ')[0])}</span>` : ''}<span>Saved ${savedAgo(a)}</span>${a.deadline ? dlTag(a.deadline) : ''}<span>Resume: <span class="rv">${esc(a.resume || resumeFor(a))}</span></span>${a.sponsor === 'yes' ? '<span class="pos">Sponsors visa</span>' : a.sponsor === 'no' ? '<span class="neg">No sponsorship</span>' : ''}</span>
    </button>
    <span class="lacts">${appliedBtn(a)}${link(a.url, 'Posting ↗')}${skipBtn(a)}</span>
  </article>`;
}
function lrow(l) {
  const m = (l.matched || []).length, n = m + (l.missing || []).length, ex = UI.expanded.has(l.id);
  const locs = (l.location || '').split('; '), loc = locs.length > 2 ? locs.slice(0, 2).join('; ') + ` +${locs.length - 2}` : l.location;
  const h = l.h1b === null || l.h1b === undefined ? (l.source === 'simplify' ? 'No H-1B record' : '') : `${Number(l.h1b).toLocaleString('en-US')} H-1B`;
  const flags = (l.flags || []).filter((f) => f !== 'Text not read').map((f) => `<span class="${f === 'No sponsorship' ? 'neg' : 'pos'}">${esc(f)}</span>`).join('');
  const [ak, al] = action(l), miss = (l.missing || []).slice(0, 3);
  const todo = l.dup ? '' : `<span class="l2"><span class="act ${ak}">${al}</span><span>Resume: <span class="rv">${esc(resumeFor(l))}</span></span>${miss.length ? `<span class="add">Add if true: ${miss.map(esc).join(', ')}${(l.missing || []).length > 3 ? ' …' : ''}</span>` : ''}</span>`;
  const sel = UI.select && !l.dup, picked = sel && UI.selected.has(l.id);
  return `<article class="lrow${UI.select ? ' sel' : ''}${picked ? ' picked' : ''}" aria-label="${esc(l.company + ', ' + l.role + ', score ' + l.total)}">
    ${UI.select ? (sel ? `<input type="checkbox" data-pick="${esc(l.id)}" ${picked ? 'checked' : ''} aria-label="Select ${esc(l.company)}">` : '<span></span>') : ''}
    ${ring(l.total)}
    <button class="lmain" type="button" data-expand="${esc(l.id)}" aria-expanded="${ex}">
      <span class="l1"><b>${esc(l.company)}</b><span class="role">${esc(l.role)}</span><span class="xcar" aria-hidden="true">›</span><span class="sr">${ex ? 'Hide' : 'Show'} score details</span></span>
      ${todo}<span class="l2">${l.t ? `<span>${esc(l.t)}</span>` : ''}<span>${esc(loc || '')}</span>${l.posted ? `<span>${ago(l.posted)}</span>` : ''}${l.deadline ? dlTag(l.deadline) : ''}${h ? `<span>${h}</span>` : ''}${n ? `<span>Skills ${m}/${n}</span>` : ''}${flags}${l.dup ? `<span class="pos">Tracking · ${LABEL[l.dup.status]}</span>` : ''}</span>
    </button>
    <span class="lacts">${l.dup ? `<button class="btn sm" type="button" data-open="${l.dup.id}">Open</button>` : `<button class="btn sm primary" type="button" data-trackl="${esc(l.id)}" title="Save to Applications (Saved)">Save</button><button class="btn sm" type="button" data-appliedl="${esc(l.id)}" title="Add to Applications as applied today">Applied ✓</button>`}${link(l.url, 'Posting ↗')}${l.dup ? '' : `<button class="btn sm ghost" type="button" data-dismiss="${esc(l.id)}" aria-label="Dismiss ${esc(l.company)}" title="Dismiss">✕</button>`}</span>
    ${ex ? `<div class="ldetail">${evidence(l)}${skillLine(l)}<div class="why"><div class="parts">${l.parts.map((p) => `<span>${WEIGHT_LABEL[p.k]} <b>${Math.round(p.pts)}/${Math.round(p.max)}</b></span>`).join('')}${l.pen ? `<span>No-sponsorship penalty <b>−${l.pen}</b></span>` : ''}<span>Degree ${esc(l.degree || '—')}</span><span>Posted ${fmt(l.posted)}</span>${l.deadline ? `<span>Deadline <b>${fmt(l.deadline)}</b></span>` : '<span>No deadline stated</span>'}</div></div></div>` : ''}
  </article>`;
}

/* ---------- settings ---------- */
const SECTIONS = [['search', 'Job search'], ['skills', 'Your skills'], ['scoring', 'Scoring'], ['outcomes', 'Score vs. outcomes'], ['goals', 'Goals and reminders'], ['resumes', 'Resume versions'], ['calendar', 'Calendar'], ['data', 'Your data'], ['appearance', 'Appearance']];
const numField = (id, label, key, min, max, hint, step) => `<label class="field"><span>${label}</span><input id="${id}" type="number" min="${min}" max="${max}" step="${step || 1}" data-setting="${key}" data-min="${min}" data-max="${max}" value="${esc(S.settings[key])}">${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
R.settings = () => {
  const st = S.settings;
  let tot = 0; for (const k of C.WEIGHT_KEYS) tot += Math.max(0, +st.weights[k] || 0);
  const mine = new Set(st.mySkills);
  const where = Store.mode === 'file' ? 'Saved to <b>data/tracker.json</b> on your computer. A backup is made at most every 30 minutes and before every delete, import or restore.' : 'Saved in <b>this browser only</b>. Clearing site data erases it, so export a backup regularly, or run the local server to save to a file.';
  const calUrl = location.origin + '/calendar.ics';
  const notifState = !('Notification' in window) ? 'This browser does not support notifications.' : Notification.permission === 'denied' ? 'Blocked in the browser’s site settings. Allow notifications for this page there, then switch this on.' : st.notify && Notification.permission === 'granted' ? 'On. Reminders appear while a tracker tab is open (it can be in the background).' : 'Off.';
  return `<div class="settings">
  <nav class="stoc" aria-label="Settings sections">${SECTIONS.map(([k, l]) => `<a href="#settings/${k}" data-stoc="${k}">${l}</a>`).join('')}</nav>
  <div class="sbody">
  <section class="panel" id="s-search"><h2>Job search</h2>
    <div class="field"><span>Target tracks ${eff(true)}</span><div class="checks">${TRACKS.map((t) => `<label><input type="checkbox" data-target="${t}" ${st.targets.includes(t) ? 'checked' : ''}> ${t} <span class="sub">${TRACK_NAME[t]}</span></label>`).join('')}</div><span class="hint">Listings in these tracks get full role-fit points.</span></div>
    <label class="field"><span>Preferred locations ${eff(true)}</span><input id="p-places" type="text" value="${esc(st.places.join(', '))}"><span class="hint">Comma separated, e.g. TX, Remote, Seattle. “TX” also matches “Texas”.</span></label>
    <label class="switch"><input type="checkbox" id="p-hide" ${st.hideNoSponsor ? 'checked' : ''}> Hide listings that say they do not sponsor visas ${eff(true)}</label>
    <div class="grid2">${numField('p-window', `Show listings posted in the last (days) ${eff(false)}`, 'windowDays', 1, 60)}
      ${numField('p-hours', 'Refresh listings every (hours) <span class="eff later">Within 5 min</span>', 'fetchHours', 1, 24)}</div>
    <div class="row"><span class="empty">${fetchSummary()}</span><button class="btn sm" type="button" data-action="refresh" ${refreshing ? 'disabled' : ''}>${refreshing ? 'Refreshing…' : 'Refresh now'}</button></div>
    <p class="empty">The refresh runs on your Mac with no AI calls. The Mac must be awake; a missed run happens within 5 minutes of waking.</p></section>

  <section class="panel" id="s-skills"><h2>Your skills <small>${mine.size} of ${C.SKILL_NAMES.length} selected</small>${eff(true)}</h2>
    <p class="empty">The skill match compares these with the tools each posting names. Only tick skills you can explain in an interview; the “Add if true” hints on listings come from the ones left unticked.</p>
    <div class="checks sm">${C.SKILL_NAMES.map((k) => `<label><input type="checkbox" data-skill="${esc(k)}" ${mine.has(k) ? 'checked' : ''}> ${esc(k)}</label>`).join('')}</div>
    <div class="row"><button class="btn sm ghost" type="button" data-action="skills-reset">Reset to the starting list</button></div></section>

  <section class="panel" id="s-scoring"><h2>Scoring ${eff(true)}</h2>
    <div class="field"><span>Weights <span class="hint">relative, any scale; the share column shows each one’s part of 100 points</span></span>
    <div class="weights">${C.WEIGHT_KEYS.map((k) => { const sh = tot ? (Math.max(0, +st.weights[k] || 0) / tot * 100) : 0; return `<label for="w-${k}">${WEIGHT_LABEL[k]} <span class="hint">· ${WEIGHT_HINT[k]}</span></label><input id="w-${k}" type="number" min="0" max="100" step="5" data-weight="${k}" value="${st.weights[k]}"><span class="share" aria-label="${Math.round(sh)} percent"><span class="prog"><span style="width:${sh}%"></span></span>${Math.round(sh)}%</span>`; }).join('')}</div></div>
    <div class="grid2">
      ${numField('p-top', 'Apply-now threshold', 'topScore', 1, 100, '“Apply now” and Top matches start here.')}
      ${numField('p-min', 'Lower-match cutoff', 'minScore', 0, 99, 'Listings below this go to the collapsed “Lower matches” group and are labelled Low priority. Nothing is hidden.')}
      ${numField('p-pen', 'No-sponsorship penalty (points)', 'noSponsorPenalty', 0, 100, 'Subtracted when a posting says it will not sponsor.')}
      ${numField('p-hl', 'Recency half-life (days)', 'recencyHalfLife', 1, 30, 'The recency points halve every this many days.')}
    </div>
    <div class="row"><button class="btn sm ghost" type="button" data-action="scoring-reset">Reset scoring to defaults</button></div>
    <div class="field"><span>Preview: top listings now <span class="hint">· arrows show the change since you opened this page</span></span>${previewList()}</div></section>

  <section class="panel" id="s-outcomes"><h2>Score vs. outcomes <small>use this to calibrate the weights</small></h2>${calibration()}</section>

  <section class="panel" id="s-goals"><h2>Goals and reminders ${eff(true)}</h2>
    <div class="grid2">${numField('p-dgoal', 'Daily goal (applications)', 'dailyGoal', 1, 20)}${numField('p-wgoal', 'Weekly goal (applications)', 'weeklyGoal', 1, 60)}
      ${numField('p-fu', 'Suggest a follow-up after (quiet days)', 'followUpDays', 3, 60)}${numField('p-stale', 'Offer to close as “No response” after (days)', 'staleDays', 15, 120)}
      ${numField('p-sstale', 'Remind me about a saved application after (days)', 'savedStaleDays', 2, 30)}${numField('p-slimit', 'Saved list limit', 'savedLimit', 3, 60, 'Saved applications lead today’s queue. Past the limit, the dashboard asks you to apply or drop a few first.')}</div>
    <div class="field"><span>Desktop notifications</span><label class="switch"><input type="checkbox" id="p-notify" ${st.notify && 'Notification' in window && Notification.permission === 'granted' ? 'checked' : ''} ${'Notification' in window ? '' : 'disabled'}> Remind me about deadlines, interviews, follow-ups and new “Apply now” matches</label>
      <span class="hint">${notifState}</span>${st.notify && 'Notification' in window && Notification.permission === 'granted' ? '<div class="row"><button class="btn sm" type="button" data-action="notify-test">Send a test notification</button></div>' : ''}</div></section>

  <section class="panel" id="s-resumes"><h2>Resume versions <small>shown on each listing as “Resume: …”</small>${eff(true)}</h2>
    <div class="weights" style="grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)">${['DS', 'DA', 'BIE', 'DE', 'SWE'].map((k) => `<label for="rv-${k}">${k} · ${TRACK_NAME[k]}</label><input id="rv-${k}" type="text" data-resume="${k}" value="${esc((st.resumes || DEFAULTS.resumes)[k] || '')}">`).join('')}</div>
    <p class="empty">Name the base resume you use for each track. Keep one base resume per track and tailor it per posting.</p></section>

  <section class="panel" id="s-calendar"><h2>Calendar</h2>
    ${Store.mode === 'file' ? `<p class="empty">Deadlines of saved applications, next steps and interview rounds, as a calendar your calendar app can subscribe to. It updates on its own while the tracker is running.</p>
    <div class="field"><span>Subscription address</span><div class="copy"><input id="calUrl" type="text" readonly value="${esc(calUrl)}" aria-label="Calendar subscription address"><button class="btn" type="button" data-action="copy-cal">Copy</button></div>
    <span class="hint">Apple Calendar: File → New Calendar Subscription, paste the address. Google Calendar cannot reach your Mac, so download the file and import it instead.</span></div>
    <div class="row"><a class="btn" href="calendar.ics?download=1" download="internship-tracker.ics">Download .ics file</a></div>`
      : '<p class="empty">The calendar is served by the local server. Start it with <span class="kbd">python3 server.py</span> to subscribe or download.</p>'}</section>

  <section class="panel" id="s-data"><h2>Your data <small>${plural(S.apps.length, 'application')} · ${plural(F.listings.length + S.manualListings.length, 'listing')}</small></h2>
    <p class="empty">${where}</p>
    <div class="row"><button class="btn" type="button" data-action="export">Download backup</button><button class="btn" type="button" data-action="pick-import">Import file…</button><button class="btn" type="button" data-action="pick-restore">Restore from file…</button><button class="btn ghost" type="button" data-action="export-csv">Export CSV</button></div>
    <p class="empty">Download saves everything as a .json file. Import adds rows from a .json backup or a .csv (columns like Company, Role, Status, Location, Link, Deadline) and skips duplicates. Restore replaces everything with a .json backup; you can undo it.</p>
    <input type="file" id="fileImport" accept=".json,.csv,application/json,text/csv" hidden><input type="file" id="fileRestore" accept=".json,application/json" hidden>
    <details class="why"><summary>Paste text instead</summary><div class="field" style="margin-top:8px"><textarea id="io" rows="5" aria-label="Paste JSON or CSV" placeholder="Paste a JSON backup, or CSV with a header row"></textarea>
      <div class="row"><button class="btn sm" type="button" data-action="import">Import pasted</button><button class="btn sm" type="button" data-action="restore">Restore pasted</button><button class="btn sm ghost" type="button" data-action="copy-data">Copy current data</button></div></div></details>
    <div class="row" style="border-top:1px solid var(--line);padding-top:12px">${S.apps.some((a) => !a.sample) ? '' : '<button class="btn ghost" type="button" data-action="load-samples">Load example data</button>'}<span style="margin-left:auto"></span><button class="btn ghost danger" type="button" data-action="clear-all">Clear all data</button></div>
    ${S.dismissed.length ? `<div class="row"><span class="empty">${plural(S.dismissed.length, 'dismissed listing')} stay hidden.</span><button class="btn sm ghost" type="button" data-action="undismiss">Show them again</button></div>` : ''}
    ${Store.mode === 'file' ? `<div class="field"><span>Backups on your computer</span><ul class="snaps" id="bkList"><li class="empty">Loading…</li></ul></div>`
      : snapshots().length ? `<div class="field"><span>Daily snapshots in this browser</span><ul class="snaps">${snapshots().map((k) => `<li><span class="mono">${k.slice(-10)}</span><button class="btn sm ghost" type="button" data-snap="${esc(k)}">Restore</button></li>`).join('')}</ul></div>` : ''}
  </section>

  <section class="panel" id="s-appearance"><h2>Appearance</h2>
    <label class="field" style="max-width:240px"><span>Theme</span><select id="p-theme">${opts([['system', 'Match the system'], ['light', 'Light'], ['dark', 'Dark']], themeNow())}</select></label>
    <div class="row"><button class="btn sm ghost" type="button" data-action="onboarding">Run the setup guide again</button></div></section>
  </div></div>`;
};
function rankMap() { const m = new Map(); visibleListings().filter((l) => !l.dup).sort((a, b) => b.total - a.total).forEach((l, i) => m.set(l.id, i)); return m; }
function previewList() {
  const L = visibleListings().filter((l) => !l.dup).sort((a, b) => b.total - a.total).slice(0, 8);
  if (!L.length) return '<p class="empty">No listings yet.</p>';
  if (!UI.baseline) UI.baseline = rankMap();
  return `<ol class="prev">${L.map((l, i) => {
    const was = UI.baseline.get(l.id); const d = was === undefined ? null : was - i;
    const mv = d === null ? '<span class="mv up">new</span>' : d > 0 ? `<span class="mv up">↑${d}</span>` : d < 0 ? `<span class="mv down">↓${-d}</span>` : '<span class="mv same">–</span>';
    return `<li><span class="rk">${i + 1}</span>${ring(l.total)}<span><b>${esc(l.company)}</b> <span class="sub" style="display:inline">${esc(l.role)}</span></span>${mv}</li>`;
  }).join('')}</ol>`;
}
function calibration() {
  const top = +S.settings.topScore || 75, min = +S.settings.minScore || 55;
  const bands = [[`${top}+`, (s) => s >= top], [`${min}–${top - 1}`, (s) => s >= min && s < top], [`below ${min}`, (s) => s < min], ['added by hand', null]];
  const rows = bands.map(([label, test]) => {
    const A = S.apps.filter((a) => reached(a, 'applied') && (test ? (typeof a.score === 'number' && test(a.score)) : typeof a.score !== 'number'));
    const rep = A.filter((a) => ['oa', 'interview', 'offer', 'rejected'].some((s) => reached(a, s))).length, iv = A.filter((a) => reached(a, 'interview')).length;
    const rate = (n) => A.length >= 5 ? Math.round(n / A.length * 100) + '%' : '—';
    return `<tr><td>${label}</td><td class="n">${A.length}</td><td class="n">${rate(rep)}</td><td class="n">${rate(iv)}</td></tr>`;
  }).join('');
  const reasons = {}; for (const d of S.dismissLog) { const r = d.reason || 'none'; (reasons[r] = reasons[r] || []).push(d.score); }
  const rlist = Object.entries(reasons).sort((a, b) => b[1].length - a[1].length);
  return `<p class="empty">Applications are grouped by the match score they had when you tracked them. Rates show once a group has 5 or more applications; calibrate when each group has about 10.</p>
    <table class="calib"><thead><tr><th scope="col">Score when tracked</th><th scope="col">Applied</th><th scope="col">Reply rate</th><th scope="col">Interview rate</th></tr></thead><tbody>${rows}</tbody></table>
    ${rlist.length ? `<div class="field"><span>Why you dismissed listings</span><div class="ev">${rlist.map(([r, sc]) => { const nums = sc.filter((x) => typeof x === 'number'); return `<span class="chip tag">${esc(DISMISS_LABEL[r] || 'No reason given')} · ${sc.length}${nums.length ? ` · avg score ${Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)}` : ''}</span>`; }).join('')}</div>
    <span class="hint">Many high-scoring dismissals for one reason suggest a weight to lower or a preference to change (for example locations).</span></div>` : '<p class="empty">Dismiss reasons will appear here once you dismiss listings.</p>'}`;
}
async function loadBackups() {
  const el = $('#bkList'); if (!el) return;
  try {
    const r = await fetch('api/backups', { cache: 'no-store' }); const list = await r.json();
    el.innerHTML = list.length ? list.slice(0, 12).map((b) => `<li><span class="mono">${esc(b.label)}</span><button class="btn sm ghost" type="button" data-bk="${esc(b.name)}">Restore</button></li>`).join('') + (list.length > 12 ? `<li class="empty">${list.length - 12} older backups in data/backups</li>` : '') : '<li class="empty">No backups yet. One is made after your first change.</li>';
  } catch (e) { el.innerHTML = '<li class="empty">Could not list backups.</li>'; }
}

/* ---------- render ---------- */
function route() { const h = location.hash.slice(1).split('/')[0]; return h === 'prefs' ? 'settings' : VIEWS[h] ? h : 'dashboard'; }
let lastView = null;
function render() {
  const v = route();
  const navKey = (v === 'board' || v === 'table') ? 'apps' : v;
  if (navKey === 'apps' && S.ui.layout !== v) { S.ui.layout = v; save(); }
  $$('[data-nav]').forEach((a) => a.dataset.nav === navKey ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  $('#navApps').setAttribute('href', '#' + (S.ui.layout === 'table' ? 'table' : 'board'));
  if (v === 'settings') $('#gearBtn').setAttribute('aria-current', 'page'); else $('#gearBtn').removeAttribute('aria-current');
  $('#viewTitle').textContent = VIEWS[v][0];
  document.title = VIEWS[v][0] + ' · Internship Tracker';
  $('#viewSub').textContent = (filtersOn() && (v === 'board' || v === 'table')) ? `Showing ${filtered().length} of ${S.apps.length} applications · filters on` : VIEWS[v][1]();
  $('#tools').hidden = !['board', 'table', 'inbox'].includes(v);
  $('#clearF').hidden = !filtersOn();
  /* Badges count only what needs you: items due soon, active applications, and "Apply now" picks. */
  const nAtt = attentionItems().filter((i) => i.n <= 3).length, nAct = S.apps.filter((a) => !CLOSED.includes(a.status)).length, nNow = listingPicks().length;
  const badge = (id, n, tip) => { const el = $(id); el.textContent = n || ''; el.title = n ? tip : ''; el.classList.toggle('hot', id === '#nDash' && n > 0); };
  badge('#nDash', nAtt, `${plural(nAtt, 'item')} due within 3 days or waiting for a follow-up`); badge('#nApps', nAct, plural(nAct, 'active application')); badge('#nInbox', nNow, `${nNow} “Apply now” pick${nNow === 1 ? '' : 's'}`);
  $('#banner').hidden = !(S.apps.some((a) => a.sample) || S.manualListings.some((l) => l.sample));
  const y = window.scrollY;
  $('#view').innerHTML = R[v]();
  if (v === lastView) window.scrollTo(0, y);
  if (v === 'settings' && Store.mode === 'file') loadBackups();
  if (v === 'dashboard') fitChart();
  if (v !== 'settings') UI.baseline = null;
  if (v !== lastView && lastView !== null) { const sub = location.hash.split('/')[1]; const el = sub && document.getElementById('s-' + sub); if (el) el.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0); }
  lastView = v;
}
function focusCard(id) { const el = $(`.card[data-id="${CSS.escape(id)}"]`); if (el) el.focus(); }
function toast(msg, undoable) {
  const t = $('#toast'); t.innerHTML = `<span>${esc(msg)}</span>${undoable ? '<button type="button" class="tbtn" data-action="undo">Undo</button>' : ''}`;
  t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), undoable ? 7000 : 3200);
}

/* ---------- menus and dialogs ---------- */
let menuPick = null;
function showMenu(x, y, title, items, onPick) {
  const m = $('#menu');
  m.innerHTML = `${title ? `<div class="mt">${esc(title)}</div>` : ''}${items.map((it, i) => `<button type="button" data-mi="${i}" class="${it.sep ? 'sep' : ''}">${esc(it.label)}${it.hint ? `<span class="sub" style="margin-left:auto;font-size:12px">${esc(it.hint)}</span>` : ''}</button>`).join('')}`;
  menuPick = (i) => { m.close(); onPick(items[i].value); };
  m.style.left = '0px'; m.style.top = '0px';
  m.showModal();
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  const first = m.querySelector('button'); if (first) first.focus();
}
function menuAt(el, title, items, onPick) { const r = el.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, title, items, onPick); }
$('#menu').addEventListener('click', (e) => { const b = e.target.closest('[data-mi]'); if (b) return menuPick(+b.dataset.mi); if (e.target === e.currentTarget) e.currentTarget.close(); });
$('#menu').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
  e.preventDefault(); const bs = $$('#menu button'); const i = bs.indexOf(document.activeElement);
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length; bs[n].focus();
});
const dlg = $('#dlg');
let dlgClose = null;
function openDialog(html, cls, onClose) {
  dlgClose = null; if (dlg.open) dlg.close();
  dlg.className = 'modal ' + (cls || ''); dlg.innerHTML = html; dlgClose = onClose || null; dlg.showModal();
}
/* "close" fires asynchronously; ignore it when another dialog has already opened in its place. */
dlg.addEventListener('close', () => { if (dlg.open) return; const f = dlgClose; dlgClose = null; if (f) f(); });
dlg.addEventListener('click', (e) => { if (e.target === dlg && !dlg.classList.contains('locked')) dlg.close(); });

function showHelp() {
  const k = (...ks) => ks.map((x) => `<span class="kbd">${esc(x)}</span>`).join('');
  openDialog(`<div class="mbody"><h2 id="dlgTitle">Keyboard shortcuts</h2><dl class="keys">
    <dt>${k(MOD, 'K')}</dt><dd>Search applications, listings and commands</dd>
    <dt>${k('N')}</dt><dd>New application</dd><dt>${k('/')}</dt><dd>Filter the current list</dd>
    <dt>${k('G', 'D')}</dt><dd>Go to Dashboard (also G A applications, G B board, G T list, G L listings, G S settings)</dd>
    <dt>${k('Shift', '←', '→')}</dt><dd>Move the focused card to the previous or next stage</dd>
    <dt>${k('Enter')}</dt><dd>Open the focused card</dd><dt>${k(MOD, 'Z')}</dt><dd>Undo (up to 30 steps)</dd>
    <dt>${k('Esc')}</dt><dd>Close a dialog or the edit panel</dd><dt>${k('?')}</dt><dd>Show this list</dd></dl>
    <div class="mfoot"><button class="btn primary" type="button" data-close>Done</button></div></div>`);
  $('[data-close]', dlg).focus();
}

/* Command palette (Ctrl/⌘ + K) */
function paletteItems(q) {
  const t = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const hit = (s) => t.every((w) => s.toLowerCase().includes(w));
  const cmds = [
    ['Add application', () => openDrawer(null)], ['Go to Dashboard', () => go('dashboard')], ['Go to Applications · Board', () => go('board')], ['Go to Applications · List', () => go('table')], ['Review saved applications', () => { S.ui.stage = 'todo'; go('table'); }],
    ['Go to New listings', () => go('inbox')], ['Go to Settings', () => go('settings')], ['Refresh listings now', () => startRefresh()], ['Export JSON backup', () => doExport()],
    ['Download calendar (.ics)', () => { location.href = 'calendar.ics?download=1'; }], ['Keyboard shortcuts', () => showHelp()], ['Toggle dark mode', () => cycleTheme()], ['Undo', () => undo()],
  ].map(([label, run]) => ({ k: 'Command', label, run }));
  const out = cmds.filter((c) => !t.length || hit(c.label));
  if (t.length) {
    out.push(...S.apps.filter((a) => hit([a.company, a.role, LABEL[a.status], a.location, a.notes].join(' '))).slice(0, 12).map((a) => ({ k: LABEL[a.status], label: a.company, sub: a.role, run: () => openDrawer(a.id) })));
    out.push(...visibleListings().filter((l) => !l.dup && hit(l.company + ' ' + l.role + ' ' + (l.location || ''))).sort((a, b) => b.total - a.total).slice(0, 10).map((l) => ({ k: 'Listing ' + l.total, label: l.company, sub: l.role, run: () => { UI.expanded.add(l.id); go('inbox'); } })));
  }
  return out.slice(0, 40);
}
function go(v) { if (route() === v) render(); else location.hash = v; }
function showPalette() {
  openDialog(`<label class="sr" for="palIn" id="dlgTitle">Search</label><input id="palIn" type="text" role="combobox" aria-expanded="true" aria-controls="palList" aria-autocomplete="list" placeholder="Search applications, listings or commands…" autocomplete="off"><ul id="palList" role="listbox"></ul><div class="pf"><span><span class="kbd">↑</span><span class="kbd">↓</span> move</span><span><span class="kbd">Enter</span> open</span><span><span class="kbd">Esc</span> close</span></div>`, 'pal');
  const inp = $('#palIn'), ul = $('#palList'); let items = [], idx = 0;
  const draw = () => {
    items = paletteItems(inp.value); idx = Math.min(idx, Math.max(0, items.length - 1));
    ul.innerHTML = items.length ? items.map((it, i) => `<li role="option" id="po-${i}" data-pi="${i}" aria-selected="${i === idx}"><span class="k">${esc(it.k)}</span><span class="t">${esc(it.label)}${it.sub ? ` <span>· ${esc(it.sub)}</span>` : ''}</span></li>`).join('') : '<li class="empty">No matches</li>';
    inp.setAttribute('aria-activedescendant', items.length ? 'po-' + idx : '');
    const sel = $('#po-' + idx); if (sel) sel.scrollIntoView({ block: 'nearest' });
  };
  const runIt = (i) => { const it = items[i]; if (!it) return; dlg.close(); setTimeout(it.run, 0); };
  inp.addEventListener('input', () => { idx = 0; draw(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); runIt(idx); }
  });
  ul.addEventListener('click', (e) => { const li = e.target.closest('[data-pi]'); if (li) runIt(+li.dataset.pi); });
  draw(); inp.focus();
}

/* First-run setup */
function showOnboarding(step) {
  step = step || 1; const st = S.settings;
  const steps = `<div class="steps" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>`;
  let body = '';
  if (step === 1) body = `<h2 id="dlgTitle">Welcome to your internship tracker</h2><p class="empty">Three quick choices so new listings are ranked for you. You can change all of them later in Settings.</p>
    <div class="field"><span>Which roles are you targeting?</span><div class="checks">${TRACKS.map((t) => `<label><input type="checkbox" data-ob-target="${t}" ${st.targets.includes(t) ? 'checked' : ''}> ${t} <span class="sub">${TRACK_NAME[t]}</span></label>`).join('')}</div></div>
    <label class="field"><span>Preferred locations</span><input id="ob-places" type="text" value="${esc(st.places.join(', '))}"><span class="hint">Comma separated, e.g. TX, Remote</span></label>`;
  if (step === 2) body = `<h2 id="dlgTitle">Which of these can you truly claim?</h2><p class="empty">Listings that ask for these skills rank higher. Only tick what you could explain in an interview.</p>
    <div class="checks sm">${C.SKILL_NAMES.map((k) => `<label><input type="checkbox" data-ob-skill="${esc(k)}" ${st.mySkills.includes(k) ? 'checked' : ''}> ${esc(k)}</label>`).join('')}</div>`;
  if (step === 3) body = `<h2 id="dlgTitle">Set a pace you can keep</h2><div class="grid2">
    <label class="field"><span>Applications per day</span><input id="ob-d" type="number" min="1" max="20" value="${st.dailyGoal}"></label>
    <label class="field"><span>Applications per week</span><input id="ob-w" type="number" min="1" max="60" value="${st.weeklyGoal}"></label></div>
    <p class="empty">Start empty, or look around with fictional example data first (you can remove it with one click).</p>`;
  openDialog(`<form class="mbody" id="obForm" method="dialog">${steps}${body}<div class="mfoot">${step > 1 ? '<button class="btn ghost" type="button" data-ob="back">Back</button>' : '<button class="btn ghost" type="button" data-ob="skip">Skip</button>'}<span class="spacer"></span>
    ${step < 3 ? '<button class="btn primary" type="button" data-ob="next">Next</button>' : '<button class="btn" type="button" data-ob="examples">Explore with examples</button><button class="btn primary" type="button" data-ob="finish">Start tracking</button>'}</div></form>`, 'locked', () => { if (!S.settings.onboarded) { S.settings.onboarded = true; save(); render(); } });
  const keep = () => {
    if (step === 1) { S.settings.targets = $$('[data-ob-target]', dlg).filter((x) => x.checked).map((x) => x.dataset.obTarget); S.settings.places = $('#ob-places').value.split(',').map((x) => x.trim()).filter(Boolean); }
    if (step === 2) S.settings.mySkills = $$('[data-ob-skill]', dlg).filter((x) => x.checked).map((x) => x.dataset.obSkill);
    if (step === 3) { S.settings.dailyGoal = clampInt($('#ob-d').value, 1, 20, 3); S.settings.weeklyGoal = clampInt($('#ob-w').value, 1, 60, 10); }
  };
  dlg.querySelector('#obForm').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ob]'); if (!b) return; const k = b.dataset.ob;
    if (k !== 'skip') keep();
    if (k === 'next') return showOnboarding(step + 1);
    if (k === 'back') return showOnboarding(step - 1);
    S.settings.onboarded = true;
    if (k === 'examples') addSamples();
    save(); dlg.close(); render(); toast(k === 'skip' ? 'You can change these choices any time in Settings' : 'All set. New listings are now ranked for you.');
  });
  const f = dlg.querySelector('input,button.primary'); if (f) f.focus();
}
const clampInt = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(+v || d)));

/* ---------- application panel ---------- */
let editing = null, confirmDel = false, force = false, forceDates = false, returnTo = null, origStatus = 'saved', origApplied = '';
function roundRow(r) {
  return `<li data-round="${esc(r.id)}"><label class="field"><span>Date</span><input type="date" data-k="date" value="${esc(r.date)}"></label><label class="field"><span>Time</span><input type="time" data-k="time" value="${esc(r.time)}"></label>
    <label class="field"><span>Type</span><select data-k="kind">${opts(ROUND_KINDS.map((x) => [x, x]), ROUND_KINDS.includes(r.kind) ? r.kind : 'Other')}</select></label><label class="field"><span>With</span><input type="text" data-k="with" value="${esc(r.with)}" placeholder="Interviewer or team"></label>
    <label class="field full"><span>Notes</span><textarea data-k="notes" rows="2" placeholder="Questions asked, how it went, what to prepare">${esc(r.notes)}</textarea></label><button class="btn sm ghost danger rm" type="button" data-rm>Remove round</button></li>`;
}
function contactRow(c) {
  return `<li data-contact="${esc(c.id)}"><label class="field"><span>Name</span><input type="text" data-k="name" value="${esc(c.name)}"></label><label class="field"><span>Role</span><input type="text" data-k="title" value="${esc(c.title)}" placeholder="Recruiter, referral, alum…"></label>
    <label class="field"><span>Email</span><input type="email" data-k="email" value="${esc(c.email)}"></label><label class="field"><span>Profile link</span><input type="url" data-k="link" value="${esc(c.link)}" placeholder="https://"></label>
    <label class="field full"><span>Note</span><input type="text" data-k="note" value="${esc(c.note)}"></label><button class="btn sm ghost danger rm" type="button" data-rm>Remove contact</button></li>`;
}
function openDrawer(id, prefill) {
  const a = id ? S.apps.find((x) => x.id === id) : blankApp(prefill || {}); if (!a) return;
  if (dlg.open) dlg.close();
  if ($('#drawer').hidden) { const ae = document.activeElement; const host = ae && ae.closest ? ae.closest('[data-open]') : null; returnTo = host ? host.dataset.open : (ae && ae.id) || null; }
  editing = id || null; confirmDel = false; force = false; forceDates = false; origStatus = a.status; origApplied = a.applied || '';
  const f = (k, l, type = 'text', cls = '', extra = '') => `<label class="field ${cls}"><span>${l}</span><input id="f-${k}" type="${type}" value="${esc(a[k])}" ${extra}></label>`;
  const nR = (a.rounds || []).length, nC = (a.contacts || []).length, fuOn = !!(a.followedUp || a.snoozeUntil);
  $('#drawer').innerHTML = `<form id="appForm" style="display:contents" novalidate>
    <div class="dhead"><div><h2 id="dTitle">${id ? esc(a.company) : 'New application'}</h2>${id ? `<div class="sub">${esc(a.role)}</div>` : ''}</div><button class="btn ghost sm" type="button" data-action="close">Close</button></div>
    <div id="formErr" class="err" hidden role="alert"></div>
    <div class="dgrid">
      ${f('company', 'Company *', 'text', '', 'required autocomplete="off"')}${f('role', 'Role *', 'text', '', 'required autocomplete="off"')}
      <label class="field"><span>Status</span><select id="f-status">${opts(STAGES, a.status)}</select></label>
      <label class="field" id="stdateWrap" hidden><span>Date of this change</span><input id="f-stdate" type="date" value="${iso(TODAY)}"></label>
      <label class="field"><span>Track</span><select id="f-track">${opts([['', '—'], ...TRACKS.map((t) => [t, t + ' · ' + TRACK_NAME[t]])], a.track)}</select></label>
      <label class="field"><span>Priority</span><select id="f-priority">${opts([['3', 'High'], ['2', 'Medium'], ['1', 'Low']], String(a.priority))}</select></label>
      <label class="field"><span>Visa sponsorship</span><select id="f-sponsor">${opts([['unknown', 'Unknown'], ['yes', 'Sponsors'], ['no', 'Does not sponsor']], a.sponsor)}</select></label>
      ${f('location', 'Location')}
      ${f('url', 'Posting link', 'url', 'full', 'placeholder="https://"')}
      ${f('resume', 'Resume version', 'text', 'full', `placeholder="${esc(resumeFor(a))} (base)"`)}
    </div>
    <div class="sechead">Dates and next step</div>
    <div class="dgrid">${f('deadline', 'Application deadline', 'date')}${f('applied', 'Date applied', 'date')}${f('nextText', 'Next step', 'text', '', 'placeholder="e.g. Send thank-you note"')}${f('nextDate', 'Next step date', 'date')}</div>
    <details class="dsec" ${nR ? 'open' : ''}><summary>Interview rounds <span class="cnt">${nR || ''}</span></summary><div class="inner"><ul class="sublist" id="rounds">${(a.rounds || []).map(roundRow).join('')}</ul><button class="btn sm" type="button" data-add="round">+ Add round</button></div></details>
    <details class="dsec" ${nC ? 'open' : ''}><summary>Contacts <span class="cnt">${nC || ''}</span></summary><div class="inner"><ul class="sublist" id="contacts">${(a.contacts || []).map(contactRow).join('')}</ul><button class="btn sm" type="button" data-add="contact">+ Add contact</button></div></details>
    <details class="dsec" ${fuOn ? 'open' : ''}><summary>Follow-up</summary><div class="inner"><div class="dgrid">${f('followedUp', 'Last followed up', 'date')}${f('snoozeUntil', 'Snooze reminders until', 'date')}</div></div></details>
    <label class="field"><span>Notes</span><textarea id="f-notes" rows="3">${esc(a.notes)}</textarea></label>
    ${id ? `<details class="dsec"><summary>History <span class="cnt">${a.history.length + (a.followLog || []).length}</span></summary><div class="inner"><span class="hint" style="font-size:12px;color:var(--faint)">Edit a date to backfill when something happened.</span><ul class="timeline" id="hist">${[...a.history.map((h, i) => ({ k: 's', v: h.s, d: h.d, i })), ...(a.followLog || []).map((d, i) => ({ k: 'f', d, i: 100 + i }))].sort((x, y) => x.d.localeCompare(y.d) || x.i - y.i).map((e) => e.k === 's'
      ? `<li data-s="${e.v}"><input type="date" value="${e.d}" aria-label="Date for ${LABEL[e.v]}">${stChip(e.v)}<button class="btn ghost sm" type="button" data-hdel aria-label="Remove ${LABEL[e.v]} entry">Remove</button></li>`
      : `<li data-flog><input type="date" value="${e.d}" aria-label="Follow-up date"><span class="chip fu">✓ Followed up</span><button class="btn ghost sm" type="button" data-hdel aria-label="Remove follow-up entry">Remove</button></li>`).join('')}</ul></div></details>` : ''}
    <div class="dfoot">${id ? `<button class="btn ghost danger" type="button" data-action="delete">Delete</button>` : ''}${link(a.url, 'Open posting ↗', 'btn ghost')}<span class="spacer"></span>
      <button class="btn" type="button" data-action="close">Cancel</button><button class="btn primary" type="submit">${id ? 'Save changes' : 'Add application'}</button></div>
  </form>`;
  $('#drawer').hidden = false; $('#scrim').hidden = false; $('#app').inert = true;
  setTimeout(() => (prefill && prefill.company ? $('#f-role') : $('#f-company')).focus(), 0);
}
function closeDrawer() {
  if ($('#drawer').hidden) return; $('#drawer').hidden = true; $('#scrim').hidden = true; $('#app').inert = false; editing = null;
  if (pendingExt) { const p = pendingExt; pendingExt = null; applyExternal(p.d, p.msg); } else render();
  const id = returnTo; returnTo = null; if (!id) return;
  const el = $(`.card[data-open="${CSS.escape(id)}"],td button[data-open="${CSS.escape(id)}"],[data-open="${CSS.escape(id)}"]`) || document.getElementById(id); if (el) el.focus();
}
function dateIssues(hist) {
  const first = {}, out = []; for (const h of hist) if (!first[h.s] || h.d < first[h.s]) first[h.s] = h.d;
  const seq = ['applied', 'oa', 'interview', 'offer'];
  for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < seq.length; j++) { const x = seq[i], y = seq[j]; if (first[x] && first[y] && first[y] < first[x]) out.push(`${LABEL[y]} (${fmt(first[y])}) is earlier than ${LABEL[x]} (${fmt(first[x])}).`); }
  for (const c of CLOSED) if (first[c] && first.applied && first[c] < first.applied) out.push(`${LABEL[c]} (${fmt(first[c])}) is earlier than Applied (${fmt(first.applied)}).`);
  if (hist.some((h) => daysFrom(h.d) > 0)) out.push('A status date is in the future.');
  return out;
}
function formError(html) { const e = $('#formErr'); e.innerHTML = html; e.hidden = false; e.scrollIntoView({ block: 'nearest' }); }
const subRows = (sel, keys) => $$(sel).map((li) => { const o = { id: li.dataset.round || li.dataset.contact }; for (const k of keys) { const el = li.querySelector(`[data-k="${k}"]`); o[k] = (el.value || '').trim(); } return o; });
function submitForm(e) {
  e.preventDefault();
  const g = (k) => ($('#f-' + k).value || '').trim();
  if (!g('company') || !g('role')) return formError('Add a company and a role to save.');
  const rawUrl = g('url'), url = safeUrl(rawUrl);
  if (rawUrl && !url) return formError('The posting link must start with http:// or https://.');
  for (const k of ['deadline', 'applied', 'nextDate', 'followedUp', 'snoozeUntil']) if (g(k) && !parse(g(k))) return formError('Use a valid date.');
  const rounds = subRows('#rounds li', ['date', 'time', 'kind', 'with', 'notes']).filter((r) => r.date || r.with || r.notes);
  const contacts = subRows('#contacts li', ['name', 'title', 'email', 'link', 'note']).filter((c) => c.name || c.email || c.link || c.note).map((c) => Object.assign(c, { link: safeUrl(c.link) }));
  if (rounds.some((r) => r.date && !parse(r.date))) return formError('Use a valid date for each interview round.');
  const dup = findDup(g('company'), g('role'), url, editing);
  if (dup && !force) return formError(`You already track <b>${esc(dup.company)}</b> · ${esc(dup.role)} (${LABEL[dup.status]}). <button class="btn sm" type="button" data-open="${dup.id}">Open it</button><button class="btn sm ghost" type="button" data-action="force-save">Save anyway</button>`);
  if (pendingExt) { const p = pendingExt; pendingExt = null; adoptUser(p.d, { keepUi: true }); Store.rev = +p.d.rev || Store.rev; Store.base = p.d; undoStack.length = 0; }
  const st = g('status'), sd = parse(g('stdate')) ? g('stdate') : iso(TODAY), appliedIn = g('applied');
  let hist;
  if (!editing) { const t = iso(TODAY); hist = [{ s: 'saved', d: st === 'saved' ? sd : (sd < t ? sd : t) }]; if (st !== 'saved') hist.push({ s: st, d: sd }); }
  else {
    hist = $$('#hist li[data-s]').filter((li) => !li.hidden).map((li) => { const v = li.querySelector('input').value; return { s: li.dataset.s, d: parse(v) ? v : iso(TODAY) }; });
    if (st !== origStatus || !hist.length) hist.push({ s: st, d: sd });
  }
  if (appliedIn && appliedIn !== origApplied) { const ha = hist.find((h) => h.s === 'applied'); if (ha) ha.d = appliedIn; }
  hist = hist.map((h, i) => Object.assign({ i }, h)).sort((x, y) => x.d.localeCompare(y.d) || x.i - y.i).map(({ s, d }) => ({ s, d }));
  if (!forceDates) { const issues = dateIssues(hist); if (issues.length) return formError(`<span>${issues.map(esc).join('<br>')}</span><button class="btn sm" type="button" data-action="force-dates">Save anyway</button>`); }
  checkpoint();
  let a = editing ? S.apps.find((x) => x.id === editing) : null; const isNew = !a;
  if (isNew) { a = blankApp(Object.assign({}, UI.prefill || {})); S.apps.push(a); }
  UI.prefill = null;
  if (CLOSED.includes(origStatus) && !CLOSED.includes(st)) a.keepOpen = true;
  for (const k of ['company', 'role', 'track', 'sponsor', 'location', 'deadline', 'applied', 'nextText', 'nextDate', 'followedUp', 'snoozeUntil', 'resume', 'notes']) a[k] = g(k);
  a.rounds = rounds.map((r) => Object.assign(r, { id: r.id || uid() })); a.contacts = contacts.map((c) => Object.assign(c, { id: c.id || uid() }));
  if (editing) a.followLog = $$('#hist li[data-flog]').filter((li) => !li.hidden).map((li) => li.querySelector('input').value).filter((x) => parse(x));
  const fuField = g('followedUp'); if (fuField && fuField !== (a.followLog || []).slice(-1)[0]) logFollowUp(a, fuField); else { a.followLog = [...new Set(a.followLog || [])].sort(); a.followedUp = a.followLog[a.followLog.length - 1] || ''; }
  a.url = url; a.priority = +g('priority') || 2; a.history = hist; a.status = st;
  if (!hist.some((h) => h.s === 'applied') && appliedIn && st !== 'saved') a.applied = appliedIn; else syncApplied(a);
  save(); returnTo = a.id; closeDrawer();
  const back = $(`.card[data-open="${CSS.escape(a.id)}"],td button[data-open="${CSS.escape(a.id)}"]`); if (back) back.focus();
  toast(isNew ? `${a.company} added` : 'Changes saved', true);
}

/* ---------- import / export ---------- */
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); } return rows.filter((r) => r.some((x) => x.trim()));
}
function normStatus(s) { s = (s || '').toLowerCase(); if (/offer/.test(s)) return 'offer'; if (/reject|declin/.test(s)) return 'rejected'; if (/ghost|no response/.test(s)) return 'ghosted'; if (/withdr/.test(s)) return 'withdrawn'; if (/interview/.test(s)) return 'interview'; if (/assess|\boa\b|test/.test(s)) return 'oa'; if (/appl|submit/.test(s)) return 'applied'; return 'saved'; }
function normDate(s) { if (!s) return ''; if (parse(s)) return s; const d = new Date(s); return isNaN(d) ? '' : iso(d); }
function addIfNew(a) { if (S.apps.some((x) => x.id === a.id) || findDup(a.company, a.role, a.url)) return false; S.apps.push(a); return true; }
function importText(txt) {
  txt = txt.trim(); if (!txt) return toast('Paste JSON or CSV first.');
  let added = 0, skipped = 0;
  if (/^[[{]/.test(txt)) {
    const raw = JSON.parse(txt); checkpoint(); const d = migrate(Array.isArray(raw) ? { apps: raw } : raw);
    for (const a of d.apps) { a.sample = false; addIfNew(a) ? added++ : skipped++; }
    for (const l of d.manualListings) if (!S.dismissed.includes(listingKey(l)) && !S.manualListings.some((x) => x.id === l.id || listingKey(x) === listingKey(l))) S.manualListings.push(l);
  } else {
    const rows = parseCSV(txt); if (rows.length < 2) return toast('The CSV needs a header row and at least one row.');
    const h = rows.shift().map((x) => x.trim().toLowerCase().replace(/^﻿/, '')); const col = (...n) => h.findIndex((x) => n.includes(x));
    const ix = { company: col('company', 'company name', 'name', 'organization'), role: col('role', 'position', 'title', 'job title', 'job'), status: col('status', 'stage'), location: col('location', 'city'), url: col('url', 'link', 'apply link', 'job link', 'posting'), deadline: col('deadline', 'due', 'due date'), applied: col('applied', 'date applied', 'applied date', 'applied on'), notes: col('notes', 'note'), track: col('track', 'category', 'type'), sponsor: col('sponsor', 'sponsorship', 'visa', 'visa sponsorship'), nextText: col('next step'), nextDate: col('next step date'), resume: col('resume', 'resume version') };
    if (ix.company < 0) return toast('The CSV needs a Company column.');
    checkpoint();
    for (const r of rows) {
      const v = (k) => ix[k] >= 0 ? (r[ix[k]] || '').trim() : ''; if (!v('company')) continue;
      const st = normStatus(v('status')), role = v('role'), sp = v('sponsor').toLowerCase(), applied = normDate(v('applied'));
      const a = blankApp({ company: v('company'), role, location: v('location'), url: safeUrl(v('url')), deadline: normDate(v('deadline')), applied, notes: v('notes'), nextText: v('nextText'), nextDate: normDate(v('nextDate')), resume: v('resume'),
        track: TRACKS.includes(v('track').toUpperCase()) ? v('track').toUpperCase() : inferTrack(role), sponsor: /^(y|yes|true|sponsors)/.test(sp) ? 'yes' : /^(n|no|false|does not)/.test(sp) ? 'no' : 'unknown',
        status: st, history: [{ s: 'saved', d: applied || iso(TODAY) }] });
      if (st !== 'saved') a.history.push({ s: st, d: applied || iso(TODAY) });
      addIfNew(a) ? added++ : skipped++;
    }
  }
  UI.scoredRev++; save(true); render(); toast(`Imported ${added}${skipped ? ` · skipped ${plural(skipped, 'duplicate')}` : ''}`, true);
}
function restoreFrom(d, label) {
  checkpoint(true); const m = migrate(d); S.apps = m.apps; S.manualListings = m.manualListings; S.dismissed = m.dismissed; S.dismissLog = m.dismissLog; S.settings = m.settings; S.settings.onboarded = true;
  UI.scoredRev++; save(true); render(); toast(label, true);
}
function download(name, text, type) {
  const b = new Blob([text], { type }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function doExport() {
  const j = JSON.stringify(Object.assign(userData(), { exportedAt: new Date().toISOString() }), null, 2);
  download(`internship-tracker-${iso(TODAY)}.json`, j, 'application/json');
  const io = $('#io'); if (io) io.value = j;
  toast('Exported. The file is in your Downloads folder.');
}
function csvExport() {
  const cols = [['Company', 'company'], ['Role', 'role'], ['Track', 'track'], ['Status', (a) => LABEL[a.status]], ['Priority', (a) => ['', 'Low', 'Medium', 'High'][a.priority]], ['Location', 'location'], ['Link', 'url'], ['Deadline', 'deadline'], ['Applied', 'applied'], ['Next step', 'nextText'], ['Next step date', 'nextDate'], ['Followed up', 'followedUp'], ['Visa', (a) => SPONSOR[a.sponsor]], ['Resume', 'resume'], ['Match score', (a) => a.score ?? ''], ['Interview rounds', (a) => (a.rounds || []).length], ['Notes', 'notes']];
  const cell = (v) => { v = String(v ?? ''); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [cols.map((c) => c[0]).join(','), ...S.apps.map((a) => cols.map(([, k]) => cell(typeof k === 'function' ? k(a) : a[k])).join(','))];
  download(`internship-applications-${iso(TODAY)}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
  toast(`Exported ${plural(S.apps.length, 'application')} as CSV`);
}
function addSamples() {
  let n = 0; for (const a of sampleApps()) if (addIfNew(a)) n++;
  for (const l of sampleListings()) if (!S.manualListings.some((x) => listingKey(x) === listingKey(l))) { S.manualListings.push(l); n++; }
  UI.scoredRev++; return n;
}

/* ---------- listings actions ---------- */
function trackListings(ids, status) {
  const L = scored(); const added = [];
  checkpoint();
  for (const id of ids) {
    const l = L.find((x) => x.id === id); if (!l || l.dup) continue;
    const tr = TRACKS.includes(l.t) ? l.t : inferTrack(l.role);
    const note = [`Match score ${l.total} when tracked.`, l.h1b !== undefined && l.h1b !== null ? `${l.h1b} H-1B approvals (USCIS FY2023).` : '', (l.flags || []).length ? `Flags: ${l.flags.join(', ')}.` : '',
      l.matched.length ? `Skills to highlight: ${l.matched.join(', ')}.` : '', l.missing.length ? `Not on resume: ${l.missing.join(', ')}.` : ''].filter(Boolean).join(' ');
    const a = blankApp({ company: l.company, role: l.role, track: tr, location: l.location, url: safeUrl(l.url), posted: l.posted, deadline: l.deadline || '', sponsor: l.sponsor, sample: l.sample, priority: l.total >= 80 ? 3 : l.total >= 65 ? 2 : 1, notes: note, score: l.total, listingId: l.id, history: [{ s: 'saved', d: iso(TODAY) }] });
    if (status === 'applied') setStatus(a, 'applied');
    S.apps.push(a); added.push(l.company); UI.expanded.delete(id); UI.selected.delete(id);
  }
  if (!added.length) { undoStack.pop(); return; }
  UI.scoredRev++; save(); render();
  const nS = savedApps().length, lim = +S.settings.savedLimit || 15, over = nS > lim ? ` · ${nS} saved, over your limit of ${lim}` : '';
  toast(added.length > 1 ? `${added.length} listings saved${over}` : status === 'applied' ? `${added[0]} added as Applied today · ${appliedOn(iso(TODAY))}/${+S.settings.dailyGoal || 3} today` : `${added[0]} saved · added to today’s queue${over}`, true);
  notifyCheck();
}
function dismissListings(ids, reason) {
  const L = scored(); let n = 0, name = '';
  checkpoint();
  for (const id of ids) {
    const l = L.find((x) => x.id === id); if (!l) continue; const k = listingKey(l);
    if (!S.dismissed.includes(k)) S.dismissed.push(k);
    S.dismissLog.push({ id: uid(), key: k, company: l.company, role: l.role, track: l.t, score: l.total, reason: reason || '', d: iso(TODAY) });
    UI.selected.delete(id); UI.expanded.delete(id); n++; name = l.company;
  }
  if (!n) { undoStack.pop(); return; }
  UI.scoredRev++; save(); render(); toast(n > 1 ? `${n} listings dismissed` : `${name} dismissed`, true);
}
const dismissItems = () => [...DISMISS_REASONS.map(([value, label]) => ({ value, label })), { value: '', label: 'Dismiss without a reason', sep: true }];
function startRefresh() {
  if (Store.mode !== 'file') return toast('The local server refreshes from SimplifyJobs. This page is using example listings.');
  if (refreshing) return; const before = F.fetch && F.fetch.at; refreshing = true; render();
  fetch('api/fetch', { method: 'POST' }).then((r) => { if (!r.ok && r.status !== 202) throw new Error(r.status); }).catch(() => { refreshing = false; render(); toast('Could not start a refresh. Is the local server running?'); });
  let n = 0; const poll = setInterval(async () => {
    n++; const l = await Store.latestFeed();
    if (l && l.fetch && l.fetch.at !== before) { clearInterval(poll); refreshing = false; if (bc) bc.postMessage({ lrev: +l.lrev || 0 }); applyFeed(l, refreshMessage(l.fetch) + ((l.fetch.savedClosed || []).length ? `; posting closed: ${l.fetch.savedClosed.join(', ')}` : '')); }
    else if (n > 80) { clearInterval(poll); refreshing = false; render(); toast('The refresh is taking longer than usual. It will appear when it finishes.'); }
  }, 3000);
}

/* ---------- notifications ---------- */
function notifyCheck() {
  if (!S || !S.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  let sent; try { sent = JSON.parse(localStorage.getItem('iat-notified') || '{}'); } catch (e) { sent = {}; }
  const today = iso(TODAY), out = [];
  const once = (key, title, body, hash, id) => { if (sent[key]) return; sent[key] = today; out.push({ title, body, hash, id }); };
  for (const a of S.apps) {
    if (CLOSED.includes(a.status)) continue;
    if (a.status === 'saved' && a.deadline) { const n = daysFrom(a.deadline); if (n === 0 || n === 1) once(`dl:${a.id}:${a.deadline}:${n}`, `Deadline ${n ? 'tomorrow' : 'today'}: ${a.company}`, a.role, 'board', a.id); }
    if (a.nextText && a.nextDate && daysFrom(a.nextDate) === 0) once(`ns:${a.id}:${a.nextDate}`, `Today: ${a.company}`, a.nextText, 'board', a.id);
    for (const r of upcomingRounds(a)) { const n = daysFrom(r.date); if (n === 0 || n === 1) once(`rd:${a.id}:${r.id}:${n}`, `Interview ${n ? 'tomorrow' : 'today'}${r.time ? ' at ' + r.time : ''}: ${a.company}`, `${r.kind}${r.with ? ' with ' + r.with : ''}`, 'board', a.id); }
  }
  const fu = followUps(); if (fu.length) once(`fu:${today}`, `${plural(fu.length, 'application')} to follow up`, fu.slice(0, 3).map((a) => a.company).join(', '), 'dashboard');
  const fresh = visibleListings().filter((l) => l.isNew && !l.dup && action(l)[0] === 'now' && !sent['nl:' + l.id]);
  if (fresh.length) { for (const l of fresh) sent['nl:' + l.id] = today; out.push({ title: `${plural(fresh.length, 'new “Apply now” match', 'new “Apply now” matches')}`, body: fresh.slice(0, 3).map((l) => `${l.company} (${l.total})`).join(', '), hash: 'inbox' }); }
  for (const k in sent) if (C.daysBetween(sent[k], today) > 21) delete sent[k];
  try { localStorage.setItem('iat-notified', JSON.stringify(sent)); } catch (e) { /* ignore */ }
  for (const m of out.slice(0, 4)) {
    try { const n = new Notification(m.title, { body: m.body, tag: m.title, icon: $('link[rel=icon]').href }); n.onclick = () => { window.focus(); location.hash = m.hash; if (m.id) setTimeout(() => openDrawer(m.id), 50); n.close(); }; } catch (e) { /* ignore */ }
  }
}

/* ---------- theme ---------- */
function themeNow() { try { return localStorage.getItem('iat-theme') || 'system'; } catch (_) { return 'system'; } }
function applyTheme(m) {
  const r = document.documentElement; if (m === 'light' || m === 'dark') r.setAttribute('data-theme', m); else r.removeAttribute('data-theme');
  const b = $('#themeBtn'); if (b) b.textContent = 'Theme: ' + (m === 'light' ? 'Light' : m === 'dark' ? 'Dark' : 'System');
}
function setTheme(m) { try { localStorage.setItem('iat-theme', m); } catch (_) { /* ignore */ } applyTheme(m); }
function cycleTheme() { const order = ['system', 'light', 'dark']; const next = order[(order.indexOf(themeNow()) + 1) % 3]; setTheme(next); toast('Theme: ' + next); }

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const t = e.target;
  $$('details.info[open]').forEach((d) => { if (!d.contains(t)) d.open = false; }); // close the labels popover on an outside click
  if (t.closest('#dlg') && t.closest('[data-close]')) return dlg.close();
  const go1 = t.closest('[data-goto]'); if (go1) { UI.expanded.add(go1.dataset.goto); return; }
  const stoc = t.closest('[data-stoc]'); if (stoc && route() === 'settings') { e.preventDefault(); history.replaceState(null, '', '#settings/' + stoc.dataset.stoc); const el = document.getElementById('s-' + stoc.dataset.stoc); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const add = t.closest('[data-add]');
  if (add) { const ul = add.dataset.add === 'round' ? $('#rounds') : $('#contacts'); ul.insertAdjacentHTML('beforeend', add.dataset.add === 'round' ? roundRow({ id: uid(), date: '', time: '', kind: 'Technical', with: '', notes: '' }) : contactRow({ id: uid(), name: '', title: '', email: '', link: '', note: '' })); ul.lastElementChild.querySelector('input').focus(); return; }
  const rm = t.closest('[data-rm]'); if (rm) { const li = rm.closest('li'); const ul = li.parentElement; li.remove(); const nb = ul.parentElement.querySelector('[data-add]'); if (nb) nb.focus(); return; }
  if (t.closest('select,input,textarea,summary,a[href]') && !t.closest('[data-action]')) return;
  const ex = t.closest('[data-expand]');
  if (ex) { const id = ex.dataset.expand; UI.expanded.has(id) ? UI.expanded.delete(id) : UI.expanded.add(id); render(); const b = $(`[data-expand="${CSS.escape(id)}"]`); if (b) b.focus(); return; }
  const sec = t.closest('[data-sec]');
  if (sec) { const k = sec.dataset.sec; S.ui.sec = Object.assign({}, S.ui.sec, { [k]: sec.getAttribute('aria-expanded') !== 'true' }); save(); render(); const b = $(`[data-sec="${k}"]`); if (b) b.focus(); return; }
  const mo = t.closest('[data-more]');
  if (mo) { const k = mo.dataset.more; UI.limits[k] = k.startsWith('col-') ? 1e9 : (UI.limits[k] || 25) + 25; render(); return; }
  const gh = t.closest('[data-ghost]');
  if (gh) { const a = S.apps.find((x) => x.id === gh.dataset.ghost); if (!a) return; checkpoint(); setStatus(a, 'ghosted'); save(); render(); return toast(`${a.company} closed as no response`, true); }
  const ap = t.closest('[data-appliedl]'); if (ap) return trackListings([ap.dataset.appliedl], 'applied');
  const aa = t.closest('[data-applied-app]');
  if (aa) {
    const a = S.apps.find((x) => x.id === aa.dataset.appliedApp); if (!a) return; checkpoint(); setStatus(a, 'applied'); a.snoozeUntil = ''; save(); render();
    const n = appliedOn(iso(TODAY)), g = +S.settings.dailyGoal || 3; return toast(`${a.company} marked Applied · ${n}/${g} today${n === g ? ' · daily goal met' : ''}`, true);
  }
  const sk = t.closest('[data-skip-app]');
  if (sk) { const a = S.apps.find((x) => x.id === sk.dataset.skipApp); if (!a) return; checkpoint(); setStatus(a, 'withdrawn'); a.notes = ((a.notes || '') + ` Decided not to apply on ${fmt(iso(TODAY))}.`).trim(); save(); render(); return toast(`${a.company}: not applying · moved to Closed`, true); }
  const sf = t.closest('[data-stage]'); if (sf) { S.ui.stage = sf.dataset.stage; save(); render(); const b = $(`[data-stage="${sf.dataset.stage}"]`); if (b) b.focus(); return; }
  const ts = t.closest('[data-tsec]'); if (ts) { const k = ts.dataset.tsec; S.ui.tsec = Object.assign({}, S.ui.tsec, { [k]: ts.getAttribute('aria-expanded') !== 'true' }); save(); render(); const b = $(`[data-tsec="${k}"]`); if (b) b.focus(); return; }
  const tr = t.closest('[data-trackl]'); if (tr) return trackListings([tr.dataset.trackl], 'saved');
  const dm = t.closest('[data-dismiss]'); if (dm) { const id = dm.dataset.dismiss; return menuAt(dm, 'Why dismiss it?', dismissItems(), (r) => dismissListings([id], r)); }
  const gl = t.closest('[data-goal]'); if (gl) { UI.editGoal = gl.dataset.goal; render(); const i = $('#g-' + gl.dataset.goal); if (i) { i.focus(); i.select(); } return; }
  const act = t.closest('[data-action]');
  if (act) {
    const k = act.dataset.action;
    if (k === 'close') return closeDrawer();
    if (k === 'show-saved') { S.ui.stage = 'todo'; S.ui.q = ''; S.ui.track = ''; S.ui.sponsor = ''; $('#q').value = ''; $('#fTrack').value = ''; $('#fSponsor').value = ''; save(); return go('table'); }
    if (k === 'pick-import') { $('#fileImport').value = ''; return $('#fileImport').click(); }
    if (k === 'pick-restore') { $('#fileRestore').value = ''; return $('#fileRestore').click(); }
    if (k === 'copy-data') { const j = JSON.stringify(userData(), null, 2); const io = $('#io'); io.value = j; io.select(); try { navigator.clipboard.writeText(j).then(() => toast('Copied to clipboard'), () => toast('The data is in the box. Copy it and keep it somewhere safe.')); } catch (_) { toast('The data is in the box. Copy it and keep it somewhere safe.'); } return; }
    if (k === 'add') return openDrawer(null);
    if (k === 'palette') return showPalette();
    if (k === 'help') return showHelp();
    if (k === 'onboarding') return showOnboarding(1);
    if (k === 'goal-cancel') { UI.editGoal = null; return render(); }
    if (k === 'notice-ok') { UI.closedNotice = null; return render(); }
    if (k === 'attn-all') { UI.attnAll = !UI.attnAll; return render(); }
    if (k === 'closed-toggle') { S.ui.closedOpen = !S.ui.closedOpen; save(); return render(); }
    if (k === 'table-more') { UI.tableLimit += 25; return render(); }
    if (k === 'undo') return undo();
    if (k === 'force-save') { force = true; return $('#appForm').requestSubmit(); }
    if (k === 'force-dates') { forceDates = true; return $('#appForm').requestSubmit(); }
    if (k === 'clear-filters') { S.ui.q = ''; S.ui.track = ''; S.ui.sponsor = ''; $('#q').value = ''; $('#fTrack').value = ''; $('#fSponsor').value = ''; save(); render(); return; }
    if (k === 'theme') return cycleTheme();
    if (k === 'select-mode') { UI.select = !UI.select; if (!UI.select) UI.selected.clear(); return render(); }
    if (k === 'sel-all') { for (const id of UI.visibleIds || []) UI.selected.add(id); return render(); }
    if (k === 'sel-none') { UI.selected.clear(); return render(); }
    if (k === 'sel-track') return trackListings([...UI.selected], 'saved');
    if (k === 'sel-dismiss') { const ids = [...UI.selected]; return menuAt(act, `Dismiss ${plural(ids.length, 'listing')} because…`, dismissItems(), (r) => dismissListings(ids, r)); }
    if (k === 'clear-samples') { checkpoint(); S.apps = S.apps.filter((a) => !a.sample); S.manualListings = S.manualListings.filter((l) => !l.sample); UI.scoredRev++; save(true); render(); return toast('Examples removed', true); }
    if (k === 'load-samples') { checkpoint(); const n = addSamples(); save(); render(); return toast(n ? `Added ${n} example items` : 'Example data is already loaded', !!n); }
    if (k === 'undismiss') { checkpoint(); S.dismissed = []; UI.scoredRev++; save(); render(); return toast('Dismissed listings are shown again', true); }
    if (k === 'skills-reset') { checkpoint(true); S.settings.mySkills = DEFAULTS.mySkills.slice(); save(); render(); return toast('Skills reset to the starting list', true); }
    if (k === 'scoring-reset') { checkpoint(true); Object.assign(S.settings, { weights: clone(DEFAULTS.weights), topScore: DEFAULTS.topScore, minScore: DEFAULTS.minScore, noSponsorPenalty: DEFAULTS.noSponsorPenalty, recencyHalfLife: DEFAULTS.recencyHalfLife }); save(); render(); return toast('Scoring reset to defaults', true); }
    if (k === 'clear-all') {
      if (act.dataset.armed) { checkpoint(true); S.apps = []; S.manualListings = []; S.dismissed = []; S.dismissLog = []; UI.scoredRev++; save(true); render(); return toast('All applications cleared. A backup was saved first.', true); }
      act.dataset.armed = '1'; act.textContent = 'Click again to clear all'; setTimeout(() => { if (act.isConnected) { delete act.dataset.armed; act.textContent = 'Clear all data'; } }, 3000); return;
    }
    if (k === 'refresh') return startRefresh();
    if (k === 'export') return doExport();
    if (k === 'export-csv') return csvExport();
    if (k === 'copy-cal') { const i = $('#calUrl'); i.select(); try { navigator.clipboard.writeText(i.value).then(() => toast('Address copied'), () => toast('Select the address and copy it')); } catch (_) { toast('Select the address and copy it'); } return; }
    if (k === 'notify-test') { try { new Notification('Internship Tracker', { body: 'Notifications are working.', icon: $('link[rel=icon]').href }); } catch (_) { toast('The browser did not show the notification.'); } return; }
    if (k === 'import') { try { importText($('#io').value); } catch (err) { toast('Could not read that. Check it is valid JSON or CSV.'); } return; }
    if (k === 'restore') { try { const d = JSON.parse($('#io').value); if (!d || !Array.isArray(d.apps)) throw new Error('no apps'); restoreFrom(d, 'Restored from export'); } catch (err) { toast('Restore needs a JSON export from this tracker.'); } return; }
    if (k === 'delete') {
      if (!confirmDel) { confirmDel = true; act.textContent = 'Click again to delete'; return; }
      checkpoint(); const a = S.apps.find((x) => x.id === editing); S.apps = S.apps.filter((x) => x.id !== editing); returnTo = null; UI.scoredRev++; save(true); closeDrawer(); return toast(`${a ? a.company : 'Application'} deleted`, true);
    }
  }
  const fu = t.closest('[data-fu]');
  if (fu) {
    const a = S.apps.find((x) => x.id === fu.dataset.id); if (!a) return; checkpoint();
    if (fu.dataset.fu === 'done') { logFollowUp(a, iso(TODAY)); a.snoozeUntil = ''; } else a.snoozeUntil = rel(7);
    save(); render(); return toast(fu.dataset.fu === 'done' ? `${a.company}: follow-up logged` : `${a.company}: snoozed until ${fmt(a.snoozeUntil)}`, true);
  }
  const ms = t.closest('[data-missed]');
  if (ms) { const a = S.apps.find((x) => x.id === ms.dataset.missed); if (!a) return; checkpoint(); setStatus(a, 'missed'); save(); render(); return toast(`${a.company} moved to Closed (missed deadline)`, true); }
  const bk = t.closest('[data-bk]');
  if (bk) {
    fetch('api/backups/' + encodeURIComponent(bk.dataset.bk), { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((d) => restoreFrom(d, 'Restored backup ' + bk.closest('li').querySelector('.mono').textContent)).catch(() => toast('That backup could not be read.')); return;
  }
  const hd = t.closest('[data-hdel]');
  if (hd) {
    const li = hd.closest('li'); if (li.hasAttribute('data-s')) { const rest = $$('#hist li[data-s]').filter((x) => !x.hidden); if (rest.length <= 1) return toast('Keep at least one stage in the history.'); }
    li.hidden = true; if (li.hasAttribute('data-flog')) { const left = $$('#hist li[data-flog]').filter((x) => !x.hidden).map((x) => x.querySelector('input').value).sort(); $('#f-followedUp').value = left[left.length - 1] || ''; } return;
  }
  const sn = t.closest('[data-snap]'); if (sn) { try { restoreFrom(JSON.parse(localStorage.getItem(sn.dataset.snap)), 'Restored snapshot ' + sn.dataset.snap.slice(-10)); } catch (_) { toast('That snapshot could not be read.'); } return; }
  const th = t.closest('[data-sort]');
  if (th) {
    const [sec, k] = th.dataset.sort.split(':'), cur = (S.ui.sorts || {})[sec] || TSEC[sec].def;
    S.ui.sorts = Object.assign({}, S.ui.sorts, { [sec]: cur.key === k ? { key: k, dir: -cur.dir } : { key: k, dir: k === 'closed' ? -1 : 1 } }); save(); render();
    const b = $(`[data-sort="${th.dataset.sort}"]`); if (b) b.focus(); return;
  }
  const op = t.closest('[data-open]'); if (op && !t.closest('.lrow input')) return openDrawer(op.dataset.open);
  if (t.id === 'scrim') return closeDrawer();
});
document.addEventListener('submit', (e) => {
  if (e.target.id === 'appForm') return submitForm(e);
  const gf = e.target.closest('[data-goalform]');
  if (gf) { e.preventDefault(); const k = gf.dataset.goalform, v = $('#g-' + k).value; if (k === 'daily') S.settings.dailyGoal = clampInt(v, 1, 20, 3); else S.settings.weeklyGoal = clampInt(v, 1, 60, 10); UI.editGoal = null; save(); render(); toast(`${k === 'daily' ? 'Daily' : 'Weekly'} goal: ${k === 'daily' ? S.settings.dailyGoal : S.settings.weeklyGoal} applications`); }
});
function settingChanged(msg, rerender) { save(); if (rerender !== false && route() === 'settings') render(); if (msg) toast(msg); }
document.addEventListener('change', (e) => {
  const t = e.target;
  if ((t.id === 'fileImport' || t.id === 'fileRestore') && t.files && t.files[0]) {
    const f = t.files[0];
    if (f.size > 20 * 1024 * 1024) return toast('That file is larger than 20 MB.');
    f.text().then((txt) => {
      if (t.id === 'fileImport') { try { importText(txt); } catch (_) { toast('Could not read that file. Use a .json backup or a .csv with a header row.'); } }
      else { try { const d = JSON.parse(txt); if (!d || !Array.isArray(d.apps)) throw new Error('no apps'); restoreFrom(d, `Restored from ${f.name}`); } catch (_) { toast('Restore needs a .json backup from this tracker.'); } }
    }).catch(() => toast('Could not open that file.'));
    return;
  }
  if (t.closest('#drawer') && t.id !== 'f-status') return;
  if (t.id === 'f-status') { $('#stdateWrap').hidden = t.value === origStatus; return; }
  if (t.dataset.pick) { t.checked ? UI.selected.add(t.dataset.pick) : UI.selected.delete(t.dataset.pick); render(); const b = $(`[data-pick="${CSS.escape(t.dataset.pick)}"]`); if (b) b.focus(); return; }
  if (t.dataset.statusFor) {
    const a = S.apps.find((x) => x.id === t.dataset.statusFor); if (!a) return; checkpoint(); moveTo(a, t.value); save(); render();
    if (t.classList.contains('move')) focusCard(a.id); return toast(`${a.company} → ${LABEL[a.status]}`, true);
  }
  if (t.id === 'hideNo' || t.id === 'p-hide') { S.settings.hideNoSponsor = t.checked; save(); render(); return toast(t.checked ? 'Listings without sponsorship are hidden' : 'Showing all listings'); }
  if (t.id === 'lsort') { S.ui.lsort = t.value; save(); return render(); }
  if (t.id === 'showClosed') { S.ui.showClosed = t.checked; UI.tableLimit = 25; save(); return render(); }
  if (t.dataset.setting) {
    const k = t.dataset.setting, lo = +t.dataset.min, hi = +t.dataset.max;
    const v = k === 'recencyHalfLife' ? Math.min(hi, Math.max(lo, +t.value || DEFAULTS[k])) : clampInt(t.value, lo, hi, DEFAULTS[k]);
    S.settings[k] = v;
    if (k === 'topScore' && S.settings.minScore >= v) S.settings.minScore = v - 1;
    if (k === 'minScore' && v >= S.settings.topScore) S.settings.minScore = S.settings.topScore - 1;
    return settingChanged(k === 'windowDays' ? 'Saved. Applies from the next refresh.' : k === 'fetchHours' ? `Listings will refresh every ${plural(v, 'hour')}` : 'Saved');
  }
  if (t.dataset.resume) { S.settings.resumes = Object.assign({}, DEFAULTS.resumes, S.settings.resumes, { [t.dataset.resume]: t.value.trim() || DEFAULTS.resumes[t.dataset.resume] }); return settingChanged('Resume version saved', false); }
  if (t.dataset.target) { const s = new Set(S.settings.targets); t.checked ? s.add(t.dataset.target) : s.delete(t.dataset.target); S.settings.targets = TRACKS.filter((x) => s.has(x)); return settingChanged('Target tracks saved · listings re-ranked'); }
  if (t.dataset.skill) { const s = new Set(S.settings.mySkills); t.checked ? s.add(t.dataset.skill) : s.delete(t.dataset.skill); S.settings.mySkills = C.SKILL_NAMES.filter((x) => s.has(x)); return settingChanged('Skills saved · listings re-ranked'); }
  if (t.dataset.weight) { S.settings.weights = Object.assign({}, S.settings.weights, { [t.dataset.weight]: Math.max(0, Math.min(100, +t.value || 0)) }); return settingChanged('Weights saved · listings re-ranked'); }
  if (t.id === 'p-places') { S.settings.places = t.value.split(',').map((x) => x.trim()).filter(Boolean); return settingChanged('Locations saved · listings re-ranked'); }
  if (t.id === 'p-theme') return setTheme(t.value);
  if (t.id === 'p-notify') {
    if (!t.checked) { S.settings.notify = false; return settingChanged('Notifications off'); }
    Notification.requestPermission().then((p) => { S.settings.notify = p === 'granted'; settingChanged(p === 'granted' ? 'Notifications on' : 'The browser did not allow notifications'); notifyCheck(); });
    return;
  }
  if (t.id === 'fTrack') { S.ui.track = t.value; save(); return render(); }
  if (t.id === 'fSponsor') { S.ui.sponsor = t.value; save(); return render(); }
});
let qT; $('#q').addEventListener('input', (e) => { clearTimeout(qT); qT = setTimeout(() => { S.ui.q = e.target.value; save(); render(); }, 150); });
let gPrefix = 0;
document.addEventListener('keydown', (e) => {
  if (dlg.open || $('#menu').open) return; // native dialogs handle Esc and focus
  const open = !$('#drawer').hidden;
  if (open) {
    if (e.key === 'Escape') { e.preventDefault(); return closeDrawer(); }
    if (e.key === 'Tab') {
      const f = $$('#drawer button, #drawer input, #drawer select, #drawer textarea, #drawer a[href], #drawer summary').filter((x) => !x.disabled && x.offsetParent !== null); if (!f.length) return;
      const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#appForm').requestSubmit(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return showPalette(); }
  if (e.target.closest('input,textarea,select')) return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const c = e.target.closest('.card');
  if (c && e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault(); const a = S.apps.find((x) => x.id === c.dataset.id); const i = FLOW.indexOf(a.status);
    if (i < 0) return toast('Open the card to reopen a closed application.');
    const ni = i + (e.key === 'ArrowRight' ? 1 : -1); if (ni < 0 || ni >= FLOW.length) return;
    checkpoint(); moveTo(a, FLOW[ni]); save(); render(); focusCard(a.id); return toast(`${a.company} → ${LABEL[a.status]}`, true);
  }
  if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button,a,select,input')) { const o = e.target.closest('li[data-open]'); if (o) { e.preventDefault(); return openDrawer(o.dataset.open); } }
  if (gPrefix && Date.now() - gPrefix < 1200) {
    const dest = { d: 'dashboard', a: S.ui.layout === 'table' ? 'table' : 'board', b: 'board', t: 'table', l: 'inbox', s: 'settings' }[e.key.toLowerCase()]; gPrefix = 0;
    if (dest) { e.preventDefault(); return go(dest); }
  }
  if (e.key === 'g' || e.key === 'G') { gPrefix = Date.now(); return; }
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); return openDrawer(null); }
  if (e.key === '?') { e.preventDefault(); return showHelp(); }
  if (e.key === '/' && !$('#tools').hidden) { e.preventDefault(); $('#q').focus(); }
});
/* drag and drop (pointer); keyboard and touch use Shift+arrows or the stage menu */
document.addEventListener('dragstart', (e) => { const c = e.target.closest && e.target.closest('.card'); if (!c) return; e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
document.addEventListener('dragend', (e) => { const c = e.target.closest && e.target.closest('.card'); if (c) c.classList.remove('dragging'); $$('.col.over').forEach((x) => x.classList.remove('over')); });
document.addEventListener('dragover', (e) => { const col = e.target.closest && e.target.closest('[data-drop]'); if (!col) return; e.preventDefault(); $$('.col.over').forEach((x) => x !== col && x.classList.remove('over')); col.classList.add('over'); });
document.addEventListener('drop', (e) => {
  const col = e.target.closest && e.target.closest('[data-drop]'); if (!col) return; e.preventDefault();
  const a = S.apps.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (!a) return;
  const move = (st) => { if (st === a.status) return render(); checkpoint(); moveTo(a, st); save(); render(); toast(`${a.company} → ${LABEL[a.status]}`, true); };
  if (col.dataset.drop !== 'closed') return move(col.dataset.drop);
  if (CLOSED.includes(a.status)) return render();
  render();
  showMenu(e.clientX, e.clientY, `Close ${a.company} as…`, CLOSE_REASONS.map(([value, label, hint]) => ({ value, label, hint })), move);
});
window.addEventListener('hashchange', () => { closeDrawer(); render(); });
let rzT; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (route() === 'dashboard') fitChart(); }, 120); });
function tick() { const n = new Date(); n.setHours(0, 0, 0, 0); if (+n !== +TODAY) { TODAY = n; takeDailySnapshot(); UI.cache = null; if ($('#drawer').hidden) render(); } notifyCheck(); }
setInterval(tick, 60000);
setInterval(() => { if (!document.hidden) checkRemote(); }, 90000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); checkRemote(); } });
window.addEventListener('beforeunload', (e) => { if (Store.queued || Store.busy) { Store.flush(); e.preventDefault(); e.returnValue = ''; } });

/* ---------- boot ---------- */
(async () => {
  $('#kHint').textContent = MOD === '⌘' ? '⌘K' : 'Ctrl K';
  applyTheme(themeNow());
  const { user, feed } = await Store.init();
  S = user ? migrate(user) : fresh();
  F = normFeed(feed);
  applyClosures();
  takeDailySnapshot();
  $('#fTrack').insertAdjacentHTML('beforeend', TRACKS.map((t) => `<option value="${t}">${t} · ${TRACK_NAME[t]}</option>`).join(''));
  S.ui.q = ''; $('#fTrack').value = S.ui.track || ''; $('#fSponsor').value = S.ui.sponsor || ''; $('#q').value = '';
  render();
  setSaved(Store.mode === 'file' ? 'Saved to data/tracker.json' : 'Saved in this browser only', Store.mode !== 'file');
  if (Store.mode === 'file' && (!user || user.v !== SCHEMA)) save();
  if (!S.settings.onboarded && !S.apps.length) showOnboarding(1);
  notifyCheck();
  window.__iat = { get S() { return S; }, get F() { return F; }, Store }; // for debugging in the console
})();
})();

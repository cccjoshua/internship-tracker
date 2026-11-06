/* Studio: Profile page, Job details (Claude analysis + match), Resume editor with export, and the Claude API settings.
   Loaded after app.js; uses its internals through window.IAT. Every Claude call is a button press, shows its estimated cost
   first, and its result is cached on the server, so viewing a job again costs nothing. */
(function () {
'use strict';
const I = window.IAT, C = window.IATCore;
const { $, $$, esc } = I;
const money = (c) => c === null || c === undefined ? '—' : c < 0.01 ? '$' + c.toFixed(4) : '$' + c.toFixed(2);
const sid = () => Math.random().toString(36).slice(2, 8);
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const TRACKS = ['SWE', 'DE', 'DA', 'DS', 'BIE'];

/* Drawn icons (16px grid, 1.5 stroke, currentColor): one family for every small control. */
const svgI = (d, label) => `<svg class="ic" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  up: svgI('<path d="M4 10l4-4 4 4"/>'), down: svgI('<path d="M4 6l4 4 4-4"/>'), x: svgI('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
  eye: svgI('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
  eyeOff: svgI('<path d="M2 2l12 12M6.6 3.7A6.9 6.9 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.9 2.4M10.1 10.6A2 2 0 0 1 6.9 7.4M4.2 5.1A11 11 0 0 0 1.5 8s2.4 4.5 6.5 4.5c.9 0 1.8-.2 2.5-.6"/>'),
  dl: svgI('<path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10"/>'),
};
/* ---------- server calls ---------- */
/* The page talks only to the local server; when it is down every call fails the same way, so say so plainly. */
const OFFLINE_MSG = 'Can’t reach the tracker server on your Mac. It restarts by itself within a minute; if it doesn’t, run python3 server.py in the internship-tracker folder.';
async function api(method, path, body) {
  try { return await api0(method, path, body); }
  catch (e) { if (e instanceof TypeError && !e.status) { const x = new Error(OFFLINE_MSG); x.offline = true; throw x; } throw e; }
}
async function api0(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let d = null; try { d = await r.json(); } catch (_) { /* empty */ }
  if (!r.ok) { const e = new Error((d && d.error) || `Request failed (${r.status})`); e.status = r.status; e.data = d; throw e; }
  return d;
}
const AI = { status: null };
async function refreshStatus() { try { AI.status = await api('GET', 'api/ai/status'); } catch (_) { AI.status = null; } }
const aiReady = () => !!(AI.status && AI.status.configured);
const prov = (task) => (AI.status && AI.status.config.providers && AI.status.config.providers[task]) || 'api';
const ccOK = () => { const c = AI.status && AI.status.claudeCode; return !!(c && c.found && c.loggedIn && c.subscription); };
/* Can this task run? Claude Pro needs Claude Code signed in (or the API as fallback); the API needs a key. */
const ready = (task) => !!(AI.status && AI.status.stub) || (prov(task) === 'pro' ? (ccOK() || (AI.status.config.fallback && aiReady())) : aiReady());
const usesPro = (task) => prov(task) === 'pro' && ccOK();
function costLabel(task, e) { return usesPro(task) ? `${esc(modelName(task))} · Claude Pro · no API cost` : `${esc(modelName(task))} · ≈ ${money(e)}`; }
const notReadyTip = (task) => prov(task) === 'pro' ? 'Claude Code is not signed in with your Claude plan (Settings → Claude API)' : 'Add an API key in Settings → Claude API';
/* Toast text for a finished call: what it cost, or that Claude Pro did it. */
function usedText(u) {
  if (!u) return '';
  if (u.provider === 'stub') return 'stub answer · no Claude call';
  if (u.provider === 'pro') return `via Claude Pro · no API cost (≈ ${money(u.apiEquivalent)} on the API)`;
  return `${money(u.cost)}${u.fellBack ? ' on the API (Claude Pro was unavailable)' : ''}`;
}
function est(task, inTok, outTok) {
  const st = AI.status; if (!st) return null;
  const p = st.prices[st.config.models[task]]; if (!p) return null;
  return (inTok * p[0] + outTok * p[1]) / 1e6;
}
const modelName = (task) => { const st = AI.status; if (!st) return ''; const m = st.config.models[task]; return st.modelLabels[m] || m; };

/* ---------- profile ---------- */
const P = { data: null, rev: 0, t: null, saving: false, server: true };
function blankProfile() {
  return {
    v: 1, basics: { name: '', email: '', phone: '', location: '', linkedin: '', github: '', website: '' },
    preferences: { headline: '', jobTypes: ['Internship'], terms: 'Summer 2027', regions: ['United States'], workMode: 'any', industries: '', companySize: '', compensation: '',
      /* Facts about you start unknown (null / ''), never pre-filled: the fit score treats unknown as "to confirm". */
      availability: '', graduation: '', degreePursuing: '', degreesHeld: [], yearsExperience: '', needsSponsorship: null, cptOpt: null, usCitizen: null, authStatement: '' },
    education: [], experience: [], projects: [], leadership: [], skills: [], notYet: [], certifications: [], languages: '', additional: [],
    resumeRules: [], tracks: Object.fromEntries(TRACKS.map((t) => [t, { leadWith: '' }])), openQuestions: [], resumeFileName: 'Resume_[Company]', resumeActivities: 'auto', resumeGpa: 'show',
    coverLetter: { samples: [], availability: '', signoff: 'Sincerely,', signature: '', rules: [] }, coverLetterFileName: '',
  };
}
const triText = (v) => v === true ? 'yes' : v === false ? 'no' : 'not set';
/* Yes / No / Not set, so an unanswered question stays unknown instead of defaulting to "no". */
function tri(path, label, v) {
  const val = v === true ? 'yes' : v === false ? 'no' : '';
  return `<label class="tri"><span>${esc(label)}</span><select data-pf="${path}" data-pft="tri">${[['', 'Not set'], ['yes', 'Yes'], ['no', 'No']].map(([k, t]) => `<option value="${k}" ${val === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
}
function normProfile(p) {
  const b = blankProfile(); p = p || {};
  const out = Object.assign(b, p, { basics: Object.assign(b.basics, p.basics || {}), preferences: Object.assign(b.preferences, p.preferences || {}), tracks: Object.assign(b.tracks, p.tracks || {}),
    coverLetter: Object.assign(b.coverLetter, p.coverLetter || {}) });
  if (!out.coverLetterFileName) out.coverLetterFileName = (out.resumeFileName || 'Resume_[Company]').replace(/Resume/, 'Cover_Letter');
  for (const k of ['education', 'experience', 'projects', 'leadership']) out[k] = (out[k] || []).map((e) => Object.assign({ id: k[0] + sid(), points: [] }, e, { points: (e.points || []).map((x) => Object.assign({ id: (e.id || k) + '.' + sid(), text: '', kind: 'fact', confirm: false }, x)) }));
  out.skills = (out.skills || []).map((s) => Object.assign({ id: 's' + sid(), label: '', value: '' }, s));
  return out;
}
async function loadProfile() {
  try { const d = await api('GET', 'api/profile'); P.server = true; P.data = normProfile(d); P.rev = d ? +d.rev || 0 : 0; P.base = I.clone(P.data); }
  catch (_) { P.server = false; try { P.data = normProfile(JSON.parse(localStorage.getItem('iat-profile') || 'null')); } catch (e) { P.data = normProfile(null); } }
}
function saveProfile(now) {
  clearTimeout(P.t); setPfState('Saving…');
  P.t = setTimeout(async () => {
    if (!P.server) { try { localStorage.setItem('iat-profile', JSON.stringify(P.data)); setPfState('Saved in this browser'); } catch (_) { setPfState('Could not save', true); } return; }
    try {
      let r, sent = I.clone(P.data);
      try { r = await api('PUT', 'api/profile', { profile: sent, baseRev: P.rev }); }
      catch (e) {
        if (e.status !== 409) throw e;
        /* Another tab saved first: merge field by field (both sides' changes kept; where both changed the same field, yours wins). */
        const theirs = normProfile((e.data && e.data.profile) || {}), m = C.mergeDeep(P.base || {}, sent, theirs);
        P.data = normProfile(m.merged); P.rev = +((e.data && e.data.profile) || {}).rev || 0; sent = I.clone(P.data);
        r = await api('PUT', 'api/profile', { profile: sent, baseRev: P.rev });
        I.toast(m.conflicts ? `Profile merged with another tab · ${m.conflicts} field${m.conflicts > 1 ? 's' : ''} changed in both: yours kept` : 'Profile merged with changes from another tab');
        if (I.route() === 'profile') rerenderKeepFocus();
      }
      P.rev = r.rev; P.data.updatedAt = r.updatedAt; P.base = sent; setPfState('Saved to data/profile.json');
    } catch (e) { setPfState('Not saved: ' + e.message, true); }
  }, now ? 0 : 700);
}
function setPfState(t, warn) { const el = $('#pfState'); if (el) { el.textContent = t; el.classList.toggle('warn', !!warn); } }

/* Text boxes that grow with their content. */
function autosize(el) { if (!el || !el.offsetParent) return; el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; }
const autosizeAll = (root) => $$('textarea.auto', root || document).forEach(autosize);
document.addEventListener('toggle', (e) => { if (e.target.tagName === 'DETAILS' && e.target.open) autosizeAll(e.target); }, true);

/* Path helpers: "experience.2.points.1.text" */
function getPath(o, path) { return path.split('.').reduce((x, k) => (x == null ? x : x[k]), o); }
function setPath(o, path, v) { const ks = path.split('.'); const last = ks.pop(); const t = ks.reduce((x, k) => x[k], o); t[last] = v; }

const ENTRY = {
  education: { title: 'Education', add: 'Add school', fields: [['org', 'School'], ['location', 'Location'], ['degree', 'Degree'], ['start', 'Start'], ['end', 'End or expected'], ['gpa', 'GPA / rank'], ['coursework', 'Coursework', 'full']], pointName: 'Detail line' },
  experience: { title: 'Experience', add: 'Add job', fields: [['org', 'Company'], ['title', 'Job title'], ['location', 'Location'], ['team', 'Team / department'], ['start', 'Start'], ['end', 'End'], ['tech', 'Tech used', 'full']], pointName: 'Point' },
  projects: { title: 'Projects', add: 'Add project', fields: [['name', 'Project name'], ['context', 'Role / context'], ['start', 'Start'], ['end', 'End'], ['tech', 'Tech used', 'full'], ['link', 'Link', 'full']], pointName: 'Point' },
  leadership: { title: 'Leadership & activities', add: 'Add activity', fields: [['org', 'Organization'], ['title', 'Role'], ['location', 'Location'], ['start', 'Start'], ['end', 'End']], pointName: 'Point' },
};
const entryName = (k, e) => (k === 'projects' ? e.name : k === 'education' ? e.org : [e.title, e.org].filter(Boolean).join(' · ')) || 'Untitled';
function completeness(p) {
  const b = p.basics, pr = p.preferences, S = I.S.settings;
  const checks = [['Name', b.name], ['Email', b.email], ['Phone', b.phone], ['LinkedIn', b.linkedin], ['Graduation date', pr.graduation], ['Target tracks', S.targets.length],
    ['Preferred places', S.places.length], ['Education', p.education.length], ['Experience or projects', p.experience.length + p.projects.length], ['Skills (3+ lines)', p.skills.filter((s) => s.value).length >= 3],
    ['Resume bullets', [...p.experience, ...p.projects].some((e) => e.points.some((x) => x.kind === 'bullet'))], ['Track playbook', TRACKS.some((t) => (p.tracks[t] || {}).leadWith)]];
  const missing = checks.filter(([, ok]) => !ok).map(([l]) => l);
  const confirm = ['education', 'experience', 'projects', 'leadership'].reduce((n, k) => n + p[k].reduce((m, e) => m + e.points.filter((x) => x.confirm).length, 0), 0);
  return { pct: Math.round((checks.length - missing.length) / checks.length * 100), total: checks.length, missing, confirm };
}
const PF_SECTIONS = [['basics', 'Basics'], ['prefs', 'What I am looking for'], ['education', 'Education'], ['experience', 'Experience'], ['projects', 'Projects'], ['leadership', 'Leadership'], ['skills', 'Skills'], ['rules', 'Resume rules'], ['cover', 'Cover letters'], ['tools', 'Import / export']];
const fld = (path, label, o = {}) => {
  const v = getPath(P.data, path); const id = 'pf-' + path.replace(/\./g, '-');
  const input = o.area ? `<textarea id="${id}" rows="${o.rows || 2}" data-pf="${path}"${o.type ? ` data-pft="${o.type}"` : ''} placeholder="${esc(o.ph || '')}">${esc(o.type === 'lines' ? (v || []).join('\n') : v)}</textarea>`
    : `<input id="${id}" type="${o.input || 'text'}" data-pf="${path}"${o.type ? ` data-pft="${o.type}"` : ''} value="${esc(v)}" placeholder="${esc(o.ph || '')}"${o.step ? ` step="${o.step}"` : ''}>`;
  return `<label class="field ${o.cls || ''}"><span>${label}${o.hint ? ` <span class="hint">${o.hint}</span>` : ''}</span>${input}</label>`;
};
const checks = (path, options) => { const cur = getPath(P.data, path) || []; return `<div class="checks">${options.map((o) => `<label><input type="checkbox" data-pf-in="${path}" value="${esc(o)}" ${cur.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div>`; };

function pointRow(k, i, j, x, n) {
  const base = `${k}.${i}.points.${j}`, b = x.kind === 'bullet';
  return `<li class="pt ${x.confirm ? 'pt-c' : ''}" data-pt="${esc(x.id)}">
    <button type="button" class="pt-k ${b ? 'bullet' : 'fact'}" data-pfa="kind:${base}:${b ? 'fact' : 'bullet'}" title="${b ? 'Resume-ready bullet: goes on resumes as written' : 'Background fact: Claude may use it to write bullets'} · click to switch" aria-label="${b ? 'Bullet' : 'Fact'}; switch to ${b ? 'fact' : 'bullet'}">${b ? 'Bullet' : 'Fact'}</button>
    <textarea class="auto" rows="1" data-pf="${base}.text" aria-label="${b ? 'Bullet' : 'Fact'} text">${esc(x.text)}</textarea>
    <div class="pt-acts"><label class="pt-cf${x.confirm ? ' on' : ''}" title="Untick when this still needs checking: unconfirmed points are never sent to Claude or put on a resume"><input type="checkbox" data-pf="${base}.confirm" data-pft="inv" ${x.confirm ? '' : 'checked'}>${x.confirm ? 'Unconfirmed' : 'Confirmed'}</label>
      <span class="pt-id" title="Source id Claude cites">${esc(x.id)}</span>
      <button class="btn icon sm ghost" type="button" data-pfa="mvp:${k}:${i}:${j}:-1" aria-label="Move up" ${j ? '' : 'disabled'}>${IC.up}</button><button class="btn icon sm ghost" type="button" data-pfa="mvp:${k}:${i}:${j}:1" aria-label="Move down" ${j < n - 1 ? '' : 'disabled'}>${IC.down}</button>
      <button class="btn icon sm ghost danger" type="button" data-pfa="delp:${k}:${i}:${j}" aria-label="Delete point">${IC.x}</button></div></li>`;
}
function entryCard(k, e, i, n) {
  const d = ENTRY[k], open = !!(P.open && P.open[e.id]);
  const nb = e.points.filter((x) => x.kind === 'bullet').length, nc = e.points.filter((x) => x.confirm).length;
  return `<details class="pf-entry${e.hidden ? ' off' : ''}" data-eid="${esc(e.id)}" ${open ? 'open' : ''}><summary><b>${esc(entryName(k, e))}</b><span class="sub">${esc([e.start, e.end].filter(Boolean).join(' – '))}</span>
      <span class="cnt">${plural(nb, 'bullet')}${e.points.length - nb ? ` · ${plural(e.points.length - nb, 'fact')}` : ''}${nc ? ` · <span class="warn-t">${nc} to confirm</span>` : ''}</span>${e.hidden ? '<span class="chip tag">Hidden from Claude</span>' : e.master === false ? '<span class="chip tag">Not on master</span>' : ''}</summary>
    <div class="pf-ebody"><div class="dgrid">${d.fields.map(([f, l, cls]) => fld(`${k}.${i}.${f}`, l, { cls })).join('')}
      ${k === 'education' ? `<label class="field"><span>Level</span><select data-pf="${k}.${i}.level">${['Bachelor', 'Master', 'PhD', 'Associate', 'Other'].map((x) => `<option ${e.level === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>` : ''}</div>
      ${k !== 'education' ? `<div class="field"><span>Best for tracks <span class="hint">used to order entries on a base resume</span></span>${(() => { const cur = e.bestFor || []; return `<div class="checks sm">${TRACKS.map((t) => `<label><input type="checkbox" data-pf-in="${k}.${i}.bestFor" value="${t}" ${cur.includes(t) ? 'checked' : ''}> ${t}</label>`).join('')}</div>`; })()}</div>` : ''}
      <div class="field"><span>${d.pointName}s <span class="hint">Bullets go on resumes as written; facts are details Claude may use to write new bullets.</span></span>
        <ul class="pts">${e.points.map((x, j) => pointRow(k, i, j, x, e.points.length)).join('')}</ul>
        <div class="row"><button class="btn sm" type="button" data-pfa="addp:${k}:${i}:bullet">+ Bullet</button><button class="btn sm ghost" type="button" data-pfa="addp:${k}:${i}:fact">+ Fact</button></div></div>
      <div class="row pf-eacts"><span class="mono pt-id">id ${esc(e.id)}</span><span class="grow"></span>
        <label class="switch" title="Include on the free master resume"><input type="checkbox" data-pf="${k}.${i}.master" data-pft="bool" ${e.master !== false ? 'checked' : ''}> On master resume</label>
        <button class="btn sm ghost" type="button" data-pfa="hide:${k}:${i}" title="Hidden entries are left off every resume and never sent to Claude">${e.hidden ? 'Show to Claude' : 'Hide from Claude'}</button>
        <button class="btn sm ghost" type="button" data-pfa="mve:${k}:${i}:-1" ${i ? '' : 'disabled'}>Move up</button><button class="btn sm ghost" type="button" data-pfa="mve:${k}:${i}:1" ${i < n - 1 ? '' : 'disabled'}>Move down</button>
        <button class="btn sm ghost danger" type="button" data-pfa="dele:${k}:${i}">Delete</button></div></div></details>`;
}
const plural = I.plural;

/* ---------- jump links: every "check this" or "confirm this" note links to the exact place to fix it ----------
   data-goto="pt:<point id>"    the Profile point (entry opened, text focused)
   data-goto="ent:<entry id>"   a Profile entry
   data-goto="fact:<entry id>"  a new, empty fact in that Profile entry, ready to type
   data-goto="fld:<path>"       a Profile field;  data-goto="sec:<section>"  a Profile section
   data-goto="bul:<bullet id>"  a bullet in this job's resume editor;  data-goto="ck"  the resume checklist */
const PT_SECS = ['education', 'experience', 'projects', 'leadership'];
const GOTO = { pending: null };
function findPoint(id) {
  for (const k of PT_SECS) for (let i = 0; i < ((P.data && P.data[k]) || []).length; i++) { const e = P.data[k][i], j = e.points.findIndex((x) => x.id === id); if (j >= 0) return { k, i, j, e, x: e.points[j] }; }
  return null;
}
function findEntry(id) {
  for (const k of PT_SECS) { const i = ((P.data && P.data[k]) || []).findIndex((e) => e.id === id); if (i >= 0) return { k, i, e: P.data[k][i] }; }
  return null;
}
/* The Profile entry a resume entry was written from: the entry of any of its bullets' cited points, else by name. */
function profileEntryOf(resEntry) {
  for (const b of (resEntry && resEntry.bullets) || []) for (const id of String(b.src || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const pt = findPoint(id); if (pt) return pt.e;
    const en = findEntry(id.split('.')[0]); if (en) return en.e;
  }
  const t = String((resEntry && resEntry.title) || '').toLowerCase();
  for (const k of PT_SECS) for (const e of (P.data && P.data[k]) || []) { const n = String(e.org || e.name || '').toLowerCase(); if (n && t.startsWith(n.split(',')[0])) return e; }
  return null;
}
const secOfEntry = (e) => PT_SECS.find((k) => ((P.data && P.data[k]) || []).includes(e)) || 'experience';
/* A Claude question starts with "[entry id]" (newer answers); older ones are matched by the entry's name. */
function questionTarget(q) {
  const m = /^\s*\[([\w.-]+)\]\s*/.exec(q || ''), text = m ? q.slice(m[0].length) : q;
  let en = m && m[1] !== 'new' ? findEntry(m[1]) : null;
  if (!en) for (const k of PT_SECS) ((P.data && P.data[k]) || []).forEach((e, i) => { const n = String(e.org || e.name || '').split(/[,(–]/)[0].trim(); if (!en && n.length > 3 && text.toLowerCase().includes(n.toLowerCase())) en = { k, i, e }; });
  /* Not about one entry: point at the Profile field or section where the answer belongs. */
  const t = text.toLowerCase();
  const alt = /linkedin/.test(t) ? ['fld:basics.linkedin', 'Profile › Basics'] : /github/.test(t) ? ['fld:basics.github', 'Profile › Basics'] : /phone|email|website|portfolio/.test(t) ? ['sec:basics', 'Profile › Basics']
    : /course|class|coursework|gpa|degree/.test(t) ? ['sec:education', 'Profile › Education'] : /sponsor|visa|authori[sz]|citizen|cpt|opt\b/.test(t) ? ['sec:prefs', 'Profile › Work authorization']
      : /\b(used|tools?|skills?|languages?|frameworks?|library|platforms?|know|statistics?|statistical|experience with)\b/.test(t) ? ['sec:skills', 'Profile › Skills'] : ['sec:projects', 'Profile › Projects'];
  return { text, en, alt };
}
function questionList(qs, closeDialog) {
  return `<div class="notice fix"><div class="fix-b"><b>Claude needs ${qs.length > 1 ? 'these facts' : 'this fact'} from you</b><span class="sub">Write the answer in your Profile so the next update can use it. Each button opens the right entry with a new fact ready to type.</span>
    <ul class="fixlist">${qs.map((q) => { const { text, en, alt } = questionTarget(q); return `<li><span class="fix-w"><span class="fix-t">${esc(text)}</span></span><span class="fix-a">${en ? `<button class="btn sm" type="button" data-goto="fact:${esc(en.e.id)}" ${closeDialog ? 'data-close' : ''}>Answer in ${esc(entryName(en.k, en.e))} →</button>` : `<button class="btn sm ghost" type="button" data-goto="${alt[0]}" ${closeDialog ? 'data-close' : ''}>Answer in ${esc(alt[1])} →</button>`}</span></li>`; }).join('')}</ul></div></div>`;
}
const cssq = (x) => (window.CSS && CSS.escape ? CSS.escape(x) : String(x).replace(/["\\]/g, '\\$&'));
function goTo(target) {
  const i = target.indexOf(':'), kind = i < 0 ? target : target.slice(0, i), arg = i < 0 ? '' : target.slice(i + 1);
  const go = (hash) => { if (location.hash === hash) I.render(); else location.hash = hash; };
  if (kind === 'pt' || kind === 'ent' || kind === 'fact') {
    const hit = kind === 'pt' ? findPoint(arg) : findEntry(arg);
    if (!hit) { I.toast(kind === 'pt' ? 'That fact is no longer in your Profile.' : 'That entry is no longer in your Profile.'); return go('#profile'); }
    P.open = Object.assign({}, P.open, { [hit.e.id]: true });
    if (kind === 'fact') {
      hit.e.points.push({ id: `${hit.e.id}.${sid().slice(0, 3)}`, text: '', kind: 'fact', confirm: false });
      saveProfile(); GOTO.pending = { sel: `[data-pf="${hit.k}.${hit.i}.points.${hit.e.points.length - 1}.text"]`, focus: true };
    } else GOTO.pending = kind === 'pt' ? { sel: `[data-pt="${cssq(arg)}"]`, focus: 'textarea' } : { sel: `.pf-entry[data-eid="${cssq(arg)}"]` };
    rProfile.scrolled = true; return go('#profile/' + hit.k);
  }
  if (kind === 'fld') { GOTO.pending = { sel: '#pf-' + arg.replace(/\./g, '-'), focus: true }; rProfile.scrolled = true; return go('#profile/' + (arg.startsWith('basics') ? 'basics' : 'prefs')); }
  if (kind === 'el') { GOTO.pending = { sel: arg, focus: true }; rProfile.scrolled = true; return go('#profile/prefs'); }
  if (kind === 'sec') { GOTO.pending = { sel: '#s-' + arg }; rProfile.scrolled = true; return go('#profile/' + arg); }
  if (kind === 'rskills' && JOB && ST.model) {
    const sk = ST.model.sections.find((x) => x.kind === 'skills'); if (sk) ST.sec[sk.id] = true;
    ST.pane = 'edit';
    GOTO.pending = { sel: sk ? `.rs-sec[data-sid="${cssq(sk.id)}"]` : '#studio', focus: 'input[data-rs$=".value"]' };
    return go(`#job/${encodeURIComponent(JOB.id)}/resume`);
  }
  if ((kind === 'bul' || kind === 'ck') && JOB) {
    ST.pane = kind === 'bul' ? 'edit' : 'review';
    if (kind === 'bul' && ST.model) for (const sct of ST.model.sections) if ((sct.entries || []).some((e) => (e.bullets || []).some((b) => b.id === arg))) ST.sec[sct.id] = true;
    GOTO.pending = kind === 'bul' ? { sel: `[data-bid="${cssq(arg)}"]`, focus: 'textarea' } : { sel: '#rsTodo', open: true };
    return go(`#job/${encodeURIComponent(JOB.id)}/resume`);
  }
}
/* Switch the resume page's left side without re-rendering (the editor keeps its scroll and focus). */
function setPane(k) {
  const sp = $('.rs-split'); if (!sp || !$('#rsp-' + k) && k !== 'page') return;
  ST.pane = k; sp.dataset.pane = k;
  $$('.rs-tabs [data-rspane]').forEach((b) => { const on = b.dataset.rspane === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  $$('.rs-pane').forEach((p) => { p.hidden = p.id !== 'rsp-' + k; });
  if (k === 'page') fitPaper();
  const left = $('.rs-left'); if (left && left.getBoundingClientRect().top < 0) left.scrollIntoView({ block: 'start' });
}
document.addEventListener('keydown', (e) => {
  const t = e.target.closest && e.target.closest('.rs-tabs [data-rspane]'); if (!t || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const all = $$('.rs-tabs [data-rspane]').filter((b) => b.offsetParent !== null), i = all.indexOf(t);
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
  e.preventDefault(); all[n].focus(); setPane(all[n].dataset.rspane);
});
/* Editor ↔ page: focusing a bullet marks its lines on the page and brings them into view. */
document.addEventListener('focusin', (e) => {
  const li = e.target.closest && e.target.closest('#rsEditW [data-bid]');
  $$('#rsPaper .pv-hit.cur').forEach((r) => r.classList.remove('cur'));
  if (!li) return;
  const r = $(`#rsPaper .pv-hit[data-goto="bul:${cssq(li.dataset.bid)}"]`), box = $('.rs-right .rs-sticky'); if (!r || !box) return;
  r.classList.add('cur');
  const a = r.getBoundingClientRect(), b = box.getBoundingClientRect();
  if (a.top < b.top + 40 || a.bottom > b.bottom - 20) box.scrollBy({ top: a.top - b.top - b.height / 3, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});
function applyGoto() {
  const g = GOTO.pending; if (!g) return;
  const el = $(g.sel); if (!el) return;
  GOTO.pending = null;
  if (g.open) el.querySelectorAll('details').forEach((d) => { d.open = true; });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  const box = el.closest('li, .pf-entry, .field, section') || el;
  box.classList.remove('goto-flash'); void box.offsetWidth; box.classList.add('goto-flash');
  const f = g.focus === true ? el : g.focus ? el.querySelector(g.focus) : null;
  if (f) setTimeout(() => { f.focus({ preventScroll: true }); if (f.setSelectionRange && typeof f.value === 'string') f.setSelectionRange(f.value.length, f.value.length); }, reduce ? 0 : 350);
}
/* Everything in the Profile that still needs you: unconfirmed points (never sent to Claude until confirmed). */
function toConfirm(p) {
  const out = [];
  for (const k of PT_SECS) (p[k] || []).forEach((e, i) => e.points.forEach((x, j) => { if (x.confirm) out.push({ k, i, j, e, x }); }));
  return out;
}
const MISSING_GOTO = { 'Name': 'fld:basics.name', 'Email': 'fld:basics.email', 'Phone': 'fld:basics.phone', 'LinkedIn': 'fld:basics.linkedin', 'Graduation date': 'fld:preferences.graduation',
  'Target tracks': 'sec:prefs', 'Preferred places': 'el:#p-places', 'Education': 'sec:education', 'Experience or projects': 'sec:experience', 'Skills (3+ lines)': 'sec:skills', 'Resume bullets': 'sec:experience', 'Track playbook': 'sec:rules' };

function rProfile() {
  if (!P.data) return '<p class="empty">Loading your profile…</p>';
  const p = P.data, pr = p.preferences, S = I.S.settings, cm = completeness(p);
  /* One section at a time (like Settings): the page stays short, and every "fix this" link opens the right one. */
  const want = location.hash.split('/')[1], active = PF_SECTIONS.some(([k]) => k === want) ? want : 'basics';
  const sec = (id, title, sub, body) => `<section class="panel" id="s-${id}" ${id === active ? '' : 'hidden'}><h2>${title}${sub ? ` <small>${sub}</small>` : ''}</h2>${body}</section>`;
  const mine = new Set(S.mySkills);
  return `<div class="settings pf">
  <nav class="stoc" aria-label="Profile sections">${PF_SECTIONS.map(([k, l]) => { const n = PT_SECS.includes(k) ? (p[k] || []).reduce((m, e) => m + e.points.filter((x) => x.confirm).length, 0) : 0; return `<a href="#profile/${k}" data-pftoc="${k}"${k === active ? ' aria-current="page"' : ''}>${l}${n ? ` <span class="toc-n" title="${n} to confirm">${n}</span>` : ''}</a>`; }).join('')}</nav>
  <div class="sbody">
  <div class="pf-top panel"><div class="pf-status">
    <div><b>${cm.missing.length ? `${cm.total - cm.missing.length} of ${cm.total} essentials filled` : 'All essentials filled'}</b>${cm.confirm ? ` <span class="warn-t">· ${plural(cm.confirm, 'point', 'points')} to confirm</span>` : ''}
      <div class="sub">${cm.missing.length ? 'Missing: ' + cm.missing.map((x) => `<button type="button" class="linkbtn" data-goto="${MISSING_GOTO[x] || 'sec:basics'}">${esc(x)}</button>`).join(', ') + '. ' : ''}This page is the only source of facts for tailored resumes, fit and eligibility checks. Unconfirmed points and hidden entries are never sent to Claude.</div></div>
    <span class="savestate" id="pfState">${P.server ? (p.updatedAt ? 'Saved ' + new Date(p.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not saved yet') : 'Saved in this browser only'}</span></div>
    ${cm.confirm ? (() => { const L = toConfirm(p); return `<details class="pf-todo" ${L.length <= 8 ? 'open' : ''}><summary><b>To confirm (${L.length})</b> <span class="sub">Read each point. If it is true as written, press Confirm. If not, press Edit, fix the wording, then confirm it.</span></summary>
      ${[...new Set(L.map((y) => y.e))].map((e) => { const G = L.filter((y) => y.e === e), k = G[0].k, i = G[0].i;
        return `<div class="pf-tgroup"><div class="pf-tg-h"><b>${esc(ENTRY[k].title)} › ${esc(entryName(k, e))}</b>${e.hidden ? `<span class="chip tag">hidden from Claude</span><button type="button" class="linkbtn" data-pfa="hide:${k}:${i}">Show to Claude</button>` : ''}<span class="grow"></span>${G.length > 1 ? `<button class="btn xs ghost" type="button" data-pfa="cfmall:${k}:${i}">Confirm all ${G.length}</button>` : ''}</div>
        <ul class="fixlist">${G.map(({ j, x }) => `<li><span class="fix-w"><span class="fix-t">${esc(x.text || '(empty)')}</span></span>
          <span class="fix-a"><button class="btn sm ghost" type="button" data-goto="pt:${esc(x.id)}">Edit</button><button class="btn sm" type="button" data-pfa="cfm:${k}:${i}:${j}">Confirm</button></span></li>`).join('')}</ul></div>`; }).join('')}</details>`; })() : ''}</div>

  ${sec('basics', 'Basics', 'resume header', `<div class="dgrid">${fld('basics.name', 'Name as on resume')}${fld('basics.location', 'Location', { hint: 'city and state only' })}${fld('basics.email', 'Email', { input: 'email' })}${fld('basics.phone', 'Phone')}${fld('basics.linkedin', 'LinkedIn')}${fld('basics.github', 'GitHub')}${fld('basics.website', 'Website / portfolio')}${fld('resumeFileName', 'Resume file name', { hint: '[Company] is replaced' })}</div>
    ${fld('preferences.headline', 'One-line headline', { cls: 'full', ph: 'e.g. MS Computer Science student building data pipelines and dashboards' })}`)}

  ${sec('prefs', 'What I am looking for', 'used by listing priority, fit, eligibility checks and Claude', `
    <div class="field"><span>Target tracks ${I.eff(true)}</span><div class="checks">${TRACKS.map((t) => `<label><input type="checkbox" data-target="${t}" ${S.targets.includes(t) ? 'checked' : ''}> ${t} <span class="sub">${I.TRACK_NAME[t]}</span></label>`).join('')}</div></div>
    <div class="field"><span>Job types</span>${checks('preferences.jobTypes', ['Internship', 'Co-op', 'Part-time', 'New grad (full-time)'])}</div>
    <div class="field"><span>Regions</span>${checks('preferences.regions', ['United States', 'Canada', 'Europe', 'Japan', 'Taiwan', 'Remote only'])}</div>
    <div class="dgrid">
      <label class="field"><span>Preferred places ${I.eff(true)}</span><input id="p-places" type="text" value="${esc(S.places.join(', '))}"><span class="hint">Comma separated, e.g. TX, Remote. Also in Settings.</span></label>
      <label class="field"><span>Work mode</span><select data-pf="preferences.workMode">${[['any', 'Any'], ['remote', 'Prefer remote'], ['hybrid', 'Prefer hybrid'], ['onsite', 'Prefer on-site']].map(([v, l]) => `<option value="${v}" ${pr.workMode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${fld('preferences.terms', 'Terms', { ph: 'Summer 2027' })}${fld('preferences.availability', 'Availability', { ph: 'e.g. May 18 – Aug 14, 2027' })}
      ${fld('preferences.industries', 'Industries')}${fld('preferences.companySize', 'Company size')}${fld('preferences.compensation', 'Pay expectations')}
      ${fld('preferences.graduation', 'Graduation', { input: 'month', hint: 'checked against posting windows' })}
      <label class="field"><span>Degree in progress</span><select data-pf="preferences.degreePursuing"><option value="" ${pr.degreePursuing ? '' : 'selected'}>Not set</option>${['Bachelor', 'Master', 'PhD', 'MBA'].map((x) => `<option ${pr.degreePursuing === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      ${fld('preferences.yearsExperience', 'Years of work experience', { input: 'number', type: 'num', step: '0.25' })}</div>
    <div class="field"><span>Degrees completed</span>${checks('preferences.degreesHeld', ['Associate', 'Bachelor', 'Master'])}</div>
    <fieldset class="field tri-set"><legend>Work authorization <span class="hint">used only for eligibility checks, never guessed from your name, school or nationality</span></legend>
      ${tri('preferences.needsSponsorship', 'Will you need visa sponsorship now or in the future?', pr.needsSponsorship)}
      ${tri('preferences.cptOpt', 'Will you work this internship on CPT or OPT?', pr.cptOpt)}
      ${tri('preferences.usCitizen', 'Are you a U.S. citizen?', pr.usCitizen)}</fieldset>
    ${fld('preferences.authStatement', 'How I answer authorization questions', { area: true, cls: 'full', ph: 'For application forms; never printed on the resume' })}`)}

  ${['education', 'experience', 'projects', 'leadership'].map((k) => sec(k, ENTRY[k].title, plural(p[k].length, 'entry', 'entries'), `<div class="pf-entries">${p[k].map((e, i) => entryCard(k, e, i, p[k].length)).join('') || '<p class="empty">Nothing yet.</p>'}</div>
    <div class="row"><button class="btn sm" type="button" data-pfa="adde:${k}">+ ${ENTRY[k].add}</button><span class="grow"></span>${p[k].length > 1 ? `<button class="btn sm ghost" type="button" data-pfa="openall:${k}">Expand all</button><button class="btn sm ghost" type="button" data-pfa="closeall:${k}">Collapse all</button>` : ''}</div>`)).join('')}

  ${sec('skills', 'Skills', 'resume skill lines and what you can claim', `
    <div class="field"><span>Skill lines on the resume</span><div class="pf-skills">${p.skills.map((s, i) => `<div class="pf-sk"><input type="text" data-pf="skills.${i}.label" value="${esc(s.label)}" placeholder="Label" aria-label="Skill line label"><input type="text" data-pf="skills.${i}.value" value="${esc(s.value)}" placeholder="Comma-separated skills" aria-label="Skills">
      <button class="btn icon sm ghost" type="button" data-pfa="mvs:${i}:-1" aria-label="Move up" ${i ? '' : 'disabled'}>${IC.up}</button><button class="btn icon sm ghost danger" type="button" data-pfa="dels:${i}" aria-label="Remove line">${IC.x}</button></div>`).join('')}</div>
      <div class="row"><button class="btn sm" type="button" data-pfa="adds">+ Skill line</button></div></div>
    <div class="field"><span>Skills the listing scorer looks for ${I.eff(true)} <span class="hint">${mine.size} of ${C.SKILL_NAMES.length} · same list as Settings</span></span><div class="checks sm">${C.SKILL_NAMES.map((k) => `<label><input type="checkbox" data-skill="${esc(k)}" ${mine.has(k) ? 'checked' : ''}> ${esc(k)}</label>`).join('')}</div></div>
    ${fld('notYet', 'Do not claim', { area: true, type: 'lines', rows: 4, hint: 'one per line · never counted as a match and Claude is told not to use them', cls: 'full' })}
    <div class="dgrid">${fld('certifications', 'Certifications', { area: true, type: 'lines', hint: 'one per line' })}${fld('languages', 'Spoken languages')}</div>
    ${fld('additional', 'Additional lines', { area: true, type: 'lines', hint: 'one per line, e.g. military service', cls: 'full' })}`)}

  ${sec('rules', 'Resume rules and track playbook', 'sent to Claude with every tailoring', `
    ${fld('resumeRules', 'Standing rules', { area: true, type: 'lines', rows: 5, hint: 'one per line', cls: 'full' })}
    <label class="field"><span>Leadership &amp; Activities on the resume</span><select data-pf="resumeActivities">${[['auto', 'Only when it fits and helps (recommended)'], ['always', 'Always include (1–2 entries)'], ['never', 'Never include']].map(([v, l]) => `<option value="${v}" ${(p.resumeActivities || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="hint">For SWE and data internships, recruiters weigh experience, projects and skills far more. With “only when it fits”, this section is the first thing dropped to keep one page.</span></label>
    <label class="field"><span>GPA on resumes</span><select data-pf="resumeGpa">${[['show', 'Show when 3.0 or higher (Rice CCD guide)'], ['hide', 'Hide on every resume']].map(([v, l]) => `<option value="${v}" ${(p.resumeGpa || 'show') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="hint">Hide keeps GPA and class rank off new and tailored resumes and out of what Claude sees. Your GPA stays in Profile › Education for application forms.</span></label>
    <div class="field"><span>Lead with, per track</span><div class="pf-tracks">${TRACKS.map((t) => `<label class="field"><span>${t} · ${I.TRACK_NAME[t]}</span><textarea rows="2" data-pf="tracks.${t}.leadWith">${esc((p.tracks[t] || {}).leadWith)}</textarea></label>`).join('')}</div></div>
    ${fld('openQuestions', 'Open questions to resolve', { area: true, type: 'lines', rows: 3, hint: 'notes for yourself; not sent to Claude', cls: 'full' })}`)}

  ${sec('cover', 'Cover letters', 'style and defaults for generated letters', `
    <div class="field"><span>Past letters <span class="hint">up to 3 · Claude copies their tone and shape only, never their facts or sentences</span></span>
      <div class="pf-samples">${(p.coverLetter.samples || []).map((x, i) => `<div class="pf-sample"><textarea class="auto" rows="4" data-pf="coverLetter.samples.${i}" aria-label="Past letter ${i + 1}">${esc(x)}</textarea><button class="btn sm ghost danger" type="button" data-pfa="dels2:${i}">Remove</button></div>`).join('') || '<p class="empty">No past letters yet.</p>'}</div>
      ${(p.coverLetter.samples || []).length < 3 ? '<div class="row"><button class="btn sm" type="button" data-pfa="adds2">+ Paste a past letter</button></div>' : ''}</div>
    <div class="dgrid">${fld('coverLetter.availability', 'Availability', { ph: 'e.g. May – August 2027; open to relocation' })}${fld('coverLetter.signoff', 'Sign-off', { ph: 'Sincerely,' })}
      ${fld('coverLetter.signature', 'Name under the letter', { ph: p.basics.name })}${fld('coverLetterFileName', 'Letter file name', { hint: '[Company] is replaced' })}</div>
    ${fld('coverLetter.rules', 'Standing letter rules', { area: true, type: 'lines', rows: 3, hint: 'one per line, e.g. keep it under 350 words', cls: 'full' })}`)}

  ${sec('tools', 'Import / export', '', `<div class="row"><button class="btn" type="button" data-pfa="md">Copy as Markdown</button><button class="btn" type="button" data-pfa="json">Download JSON</button><button class="btn" type="button" data-pfa="pick">Import JSON…</button><input type="file" id="pfFile" accept=".json,application/json" hidden></div>
    <p class="empty">Markdown is in the same shape as Experience_Details.md, so you can paste it into your Claude project. Earlier versions are kept in data/backups/profile.</p>`)}
  </div></div>`;
}

function profileMarkdown(p) {
  const out = [`# Experience Details — ${p.basics.name}`, '', `Updated ${new Date().toISOString().slice(0, 10)} from the Internship Tracker profile. Points marked [CONFIRM] must be verified before use.`, ''];
  const pr = p.preferences;
  out.push('## Basics', ...['location', 'email', 'phone', 'linkedin', 'github', 'website'].filter((k) => p.basics[k]).map((k) => `- ${k}: ${p.basics[k]}`),
    `- Looking for: ${pr.jobTypes.join(', ')} · ${pr.terms} · ${I.S.settings.targets.join(', ')} · ${pr.regions.join(', ')} · preferred ${I.S.settings.places.join(', ')}`,
    `- Graduation: ${pr.graduation || 'not set'} · needs sponsorship: ${triText(pr.needsSponsorship)} · CPT/OPT: ${triText(pr.cptOpt)}`, '');
  for (const k of ['education', 'experience', 'projects', 'leadership']) {
    if (!p[k].length) continue;
    out.push(`## ${ENTRY[k].title}`);
    for (const e of p[k]) {
      out.push('', `### ${entryName(k, e)}${e.location ? ' — ' + e.location : ''}`, `${[e.start, e.end].filter(Boolean).join(' – ')}${e.tech ? ' · Tech: ' + e.tech : ''}${e.degree ? ' · ' + e.degree : ''}${e.gpa ? ' · GPA ' + e.gpa : ''}`);
      for (const x of e.points) out.push(`- ${x.kind === 'bullet' ? '' : '(fact) '}${x.text}${x.confirm ? ' [CONFIRM]' : ''}`);
      if (e.bestFor && e.bestFor.length) out.push(`**Best for:** ${e.bestFor.join(' · ')}`);
    }
    out.push('');
  }
  out.push('## Skills', ...p.skills.map((s) => `- ${s.label}: ${s.value}`), ...(p.notYet.length ? ['', '## Do not claim', ...p.notYet.map((x) => '- ' + x)] : []));
  return out.join('\n');
}

function profileAction(a, el) {
  const [k, ...r] = a.split(':'), p = P.data;
  const mv = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
  if (k === 'kind') { const [path, kind] = [r.slice(0, -1).join(':'), r[r.length - 1]]; getPath(p, path).kind = kind; }
  else if (k === 'addp') { const e = p[r[0]][+r[1]]; e.points.push({ id: `${e.id}.${sid().slice(0, 3)}`, text: '', kind: r[2], confirm: false }); P.focus = `[data-pf="${r[0]}.${r[1]}.points.${e.points.length - 1}.text"]`; }
  else if (k === 'delp') p[r[0]][+r[1]].points.splice(+r[2], 1);
  else if (k === 'cfmall') { p[r[0]][+r[1]].points.forEach((x) => { x.confirm = false; }); I.toast('All confirmed · Claude can use these points now'); }
  else if (k === 'cfm') { p[r[0]][+r[1]].points[+r[2]].confirm = false; I.toast('Confirmed · Claude can use this point now'); }
  else if (k === 'mvp') mv(p[r[0]][+r[1]].points, +r[2], +r[3]);
  else if (k === 'adde') { const e = { id: r[0].slice(0, 2) + sid().slice(0, 3), points: [], bestFor: [] }; p[r[0]].push(e); P.open = Object.assign({}, P.open, { [e.id]: true }); P.focus = `[data-pf="${r[0]}.${p[r[0]].length - 1}.${ENTRY[r[0]].fields[0][0]}"]`; }
  else if (k === 'dele') { if (!el.dataset.armed) { el.dataset.armed = '1'; el.textContent = 'Click again to delete'; return; } p[r[0]].splice(+r[1], 1); }
  else if (k === 'mve') mv(p[r[0]], +r[1], +r[2]);
  else if (k === 'hide') p[r[0]][+r[1]].hidden = !p[r[0]][+r[1]].hidden;
  else if (k === 'openall' || k === 'closeall') { P.open = Object.assign({}, P.open, Object.fromEntries(p[r[0]].map((e) => [e.id, k === 'openall']))); I.render(); return; }
  else if (k === 'adds') { p.skills.push({ id: 's' + sid(), label: '', value: '' }); P.focus = `[data-pf="skills.${p.skills.length - 1}.label"]`; }
  else if (k === 'dels') p.skills.splice(+r[0], 1);
  else if (k === 'adds2') { p.coverLetter.samples.push(''); P.focus = `[data-pf="coverLetter.samples.${p.coverLetter.samples.length - 1}"]`; }
  else if (k === 'dels2') { if (!el.dataset.armed) { el.dataset.armed = '1'; el.textContent = 'Click again to remove'; return; } p.coverLetter.samples.splice(+r[0], 1); }
  else if (k === 'mvs') mv(p.skills, +r[0], +r[1]);
  else if (k === 'md') { const t = profileMarkdown(p); navigator.clipboard.writeText(t).then(() => I.toast('Profile copied as Markdown'), () => I.toast('Copy failed')); return; }
  else if (k === 'json') { download('profile.json', JSON.stringify(p, null, 2), 'application/json'); return; }
  else if (k === 'pick') { $('#pfFile').value = ''; $('#pfFile').click(); return; }
  else return;
  saveProfile(); I.render();
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

/* ---------- jobs ---------- */
const JOBS = new Map(); // key -> { loading, job, resume, error }
const ST = { key: null, model: null, notes: null, fit: null, fitT: null, saveT: null, busy: '', rw: null, paste: false, sec: {}, err: null };
function resolveJob(id) {
  const S = I.S, L = I.scored();
  let app = S.apps.find((a) => a.id === id) || null;
  let l = L.find((x) => x.id === id) || null;
  if (app && !l) l = L.find((x) => (app.listingId && x.id === app.listingId) || (I.urlKey(x.url) && I.urlKey(x.url) === I.urlKey(app.url))) || null;
  if (!app && l && l.dup) app = l.dup;
  if (!app && !l) return null;
  const b = app || l, url = (app && app.url) || (l && l.url) || '';
  return { id, app, l, company: b.company, role: b.role, url, location: (app && app.location) || (l && l.location) || '',
    locations: l ? (l.locations && l.locations.length ? l.locations : [l.location]) : [app.location].filter(Boolean),
    track: (app && app.track) || (l && TRACKS.includes(l.t) && l.t) || I.inferTrack(b.role) || 'SWE', h1b: l ? l.h1b : null, lca: l ? l.lca : null, l0: l,
    deadline: (app && app.deadline) || (l && l.deadline) || '', posted: (l && l.posted) || (app && app.posted) || '', key: I.listingKey({ url, company: b.company, role: b.role }) };
}
const curId = () => decodeURIComponent((location.hash.split('/')[1] || ''));
let JOB = null;
async function loadJob(J) {
  const st = { loading: true }; JOBS.set(J.key, st);
  try { const d = await api('GET', 'api/job?key=' + encodeURIComponent(J.key)); Object.assign(st, d, { loading: false }); }
  catch (e) { Object.assign(st, { loading: false, error: e.message }); }
  if (I.route() === 'job' && JOB && JOB.key === J.key) I.render();
}
const meta = (J) => ({ key: J.key, company: J.company, role: J.role, url: J.url, location: J.location });

/* resume model */
const SEC_TITLE = { summary: 'Summary', education: 'Education', skills: 'Technical Skills', experience: 'Professional Experience', projects: 'Projects', leadership: 'Leadership & Activities' };
/* Standing resume rules applied to every resume, new or saved: the Profile's name in the header, no "Additional"
   section, and Professional Experience directly under Technical Skills. Returns true when it changed something. */
const isAdditional = (s) => s.kind === 'list' && /^additional\b/i.test(String(s.title || '').trim());
/* Resume model v2 (Nov 2026): entries carry "loc" (city, right of the organization); education details are one line
   each; bullets carry "gen" (their text when Claude wrote them, so an edit clears Claude's "unverified" mark).
   normResume() upgrades any older model on load; there is no separate migration step. */
const RESUME_V = 3;
function normResume(m) {
  if (!m || !Array.isArray(m.sections)) return false;
  const sig = () => JSON.stringify([m.v, m.header && m.header.name, m.sections.map((s) => [s.id || s.title, (s.entries || []).map((e) => e.title + '|' + (e.loc || '') + '|' + (e.lines || []).join('|'))])]), before = sig();
  if ((m.v || 1) < 2) {
    for (const s of m.sections) if (s.key === 'education') for (const e of s.entries || []) e.lines = (e.lines || []).flatMap((l) => String(l).split(/\s+\|\s+/)).map((l) => l.trim().replace(/^(Relevant )?Coursework:/, 'Relevant Coursework:')).filter(Boolean);
    m.v = 2;
  }
  if (m.v < 3) {
    /* Bullets written before v2 kept Claude's "unverified" mark forever. Re-check them now: when every cited fact
       exists and the fact check finds nothing, the mark goes. A real problem still shows through factIssues. */
    if (P.data) for (const s of m.sections) for (const e of s.entries || []) for (const b of e.bullets || []) {
      if (!b.unverified || b.gen !== undefined) continue;
      const ids = String(b.src || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (ids.length && ids.every((x) => pointText(x) !== null) && !factIssues(b).length) b.unverified = false;
    }
    m.v = RESUME_V;
  }
  if (P.data && P.data.basics && P.data.basics.name) m.header = Object.assign({}, m.header, { name: P.data.basics.name });
  m.sections = m.sections.filter((s) => !isAdditional(s));
  for (const s of m.sections) for (const e of s.entries || []) {
    if (e.loc || s.key === 'projects' || !e.title) continue;
    const pe = profileEntryOf(e), L = pe && pe.location;
    if (L && e.title.endsWith(', ' + L)) { e.title = e.title.slice(0, -(L.length + 2)); e.loc = L; if (!e.date && e.subdate) { e.date = e.subdate; e.subdate = ''; } }
  }
  const ex = m.sections.findIndex((s) => s.key === 'experience'), sk = m.sections.findIndex((s) => s.kind === 'skills');
  if (ex >= 0 && sk >= 0 && ex !== sk + 1) { const [e] = m.sections.splice(ex, 1); m.sections.splice(m.sections.findIndex((s) => s.kind === 'skills') + 1, 0, e); }
  return sig() !== before;
}
/* Posting keywords this resume really contains (the same matching as the keyword panel, aliases included). The
   preview and the .docx/.pdf exports set them in bold in bullets and the summary. Soft skills are never bolded. */
/* Bold only what a recruiter scans for: the posting's important tools and skills (importance 2-3, required skills
   first), never soft skills or generic words. Returned in priority order; the renderer bolds at most two per bullet. */
function boldTerms(m, keywords, extra, required) {
  const softs = new Set((keywords || []).filter((k) => k.kind === 'soft' || k.kind === 'credential' || k.kind === 'domain').map((k) => C.nk(k.term)));
  const req = new Set((required || []).flatMap((x) => String(x).split('|')).map((x) => C.nk(x.trim())));
  const tech = (keywords || []).filter((k) => (k.kind === 'tool' || k.kind === 'skill' || !k.kind) && (+k.importance || 1) >= 2);
  const more = (extra || []).filter((x) => typeof x === 'string' && !softs.has(C.nk(x)) && !tech.some((k) => C.nk(k.term) === C.nk(x))).map((t) => ({ term: t, importance: 1 }));
  const hit = C.keywordScore(resumeText(m), [...tech, ...more]).hit;
  const rank = (k) => (req.has(C.nk(k.term)) ? 10 : 0) + (+k.importance || 1);
  const forms = [];
  for (const k of hit.slice().sort((x, y) => rank(y) - rank(x))) {
    const key = C.nk(k.term), fs = [String(k.term).trim(), ...Object.entries(C.ALIAS || {}).filter(([, v]) => v === key).map(([a]) => a)];
    for (const f of fs) if (f && f.length >= 2 && !forms.some((x) => x.toLowerCase() === f.toLowerCase()) && !/^(database|data|ml|ai|js|py)$/i.test(f)) forms.push(f);
  }
  return forms;
}
/* Recompute the bold terms of job J's resume from its analysis and Claude's notes; true when they changed. */
function applyBold(m, J) {
  if (!m || !J) return false;
  const st = JOBS.get(J.key), a = st && st.job && st.job.analysis, n = JOB && JOB.key === J.key ? ST.notes : st && st.resume && st.resume.notes;
  if (!a && !(n && (n.keywordsUsed || []).length)) return false;
  const terms = boldTerms(m, a ? a.keywords : [], n && n.keywordsUsed, a ? a.requiredSkills : []);
  if (JSON.stringify(terms) === JSON.stringify(m.bold || [])) return false;
  m.bold = terms; return true;
}
/* Same rule as resume_export.bold_segments: the first two terms (in priority order) found in the text, first occurrence. */
function boldHtml(text, m, limit = 2) {
  const terms = m && m.boldKeywords !== false ? (m.bold || []) : [], t = String(text || ''), spans = [];
  for (const term of terms) {
    if (spans.length >= limit) break;
    const r = new RegExp('(?<![A-Za-z0-9])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9+#])', 'i').exec(t);
    if (r && !spans.some(([a, b]) => r.index < b && a < r.index + r[0].length)) spans.push([r.index, r.index + r[0].length]);
  }
  if (!spans.length) return esc(t);
  let out = '', i = 0;
  for (const [a, b] of spans.sort((x, y) => x[0] - y[0])) { out += esc(t.slice(i, a)) + `<b>${esc(t.slice(a, b))}</b>`; i = b; }
  return out + esc(t.slice(i));
}
const dates = (e) => [e.start, e.end].filter(Boolean).join(' – ');
function contactLine(b) { return [b.location, b.phone, b.email, b.linkedin, b.github, b.website].filter(Boolean).join(' | '); }
function baseResume(p, track) {
  /* Everything goes in, but extras start hidden (toggle them on in the editor) so the base resume starts close to one page. */
  const LIMIT = { experience: [6, 2], projects: [4, 3], leadership: [1, 1] }, SHOWN = { experience: 3, projects: 3, leadership: 2 };
  const bullets = (e, k, rank) => e.points.filter((x) => x.kind === 'bullet' && !x.confirm && x.text).map((x, i) => ({ id: sid(), text: x.text, src: x.id, hidden: i >= (rank ? LIMIT[k][1] : LIMIT[k][0]) }));
  const order = (arr) => arr.filter((e) => !e.hidden && e.master !== false).map((e, i) => ({ e, i, s: track && (e.bestFor || []).includes(track) ? 0 : 1 })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.e);
  const ent = (k, e, rank) => k === 'education' ? { id: sid(), title: e.org || '', loc: e.location || '', date: e.end || dates(e), subtitle: e.degree || '', lines: [e.gpa ? 'GPA: ' + e.gpa : '', e.coursework ? 'Relevant Coursework: ' + e.coursework : '', ...e.points.filter((x) => x.kind === 'bullet' && !x.confirm).map((x) => x.text)].filter(Boolean), bullets: [] }
    : k === 'experience' ? { id: sid(), title: e.org || '', loc: e.location || '', date: dates(e), subtitle: [e.title, e.team].filter(Boolean).join(', '), subdate: '', lines: [], bullets: bullets(e, k, rank) }
      : k === 'projects' ? { id: sid(), title: e.name || '', date: dates(e), subtitle: e.context || '', lines: [], bullets: bullets(e, k, rank) }
        : { id: sid(), title: e.org || '', loc: e.location || '', date: dates(e), subtitle: e.title || '', lines: [], bullets: bullets(e, k, rank) };
  const sections = [];
  if (p.preferences.headline) sections.push({ id: sid(), kind: 'summary', title: SEC_TITLE.summary, text: p.preferences.headline, hidden: true });
  const E = (k) => { const list = (k === 'education' ? p[k].filter((e) => !e.hidden && e.master !== false) : order(p[k])).map((e, i) => Object.assign(ent(k, e, i), { hidden: k !== 'education' && i >= SHOWN[k] })); if (list.length) sections.push({ id: sid(), kind: 'entries', key: k, title: SEC_TITLE[k], entries: list }); };
  E('education');
  if (p.skills.length) sections.push({ id: sid(), kind: 'skills', title: SEC_TITLE.skills, lines: p.skills.filter((s) => s.value).map((s) => ({ label: s.label, value: s.value })) });
  E('experience'); E('projects'); E('leadership');
  if ((p.resumeActivities || 'auto') === 'never') sections.forEach((x) => { if (x.key === 'leadership') x.hidden = true; });
  return { v: 1, font: 'serif', size: 10.5, header: { name: p.basics.name, contact: contactLine(p.basics) }, sections };
}
function fromAI(r, p) {
  const sections = [];
  const tidy = (t) => String(t || '').trim().replace(/\s*\.$/, '');
  const ent = (e) => ({ id: sid(), title: e.title, loc: e.location || '', date: e.date, subtitle: e.subtitle, subdate: '', lines: e.lines || [], bullets: (e.bullets || []).map((b) => ({ id: sid(), text: tidy(b.text), gen: tidy(b.text), src: b.source, unverified: !!b.unverified, issues: b.issues || [] })) });
  for (const k of (r.sectionOrder && r.sectionOrder.length ? r.sectionOrder : ['education', 'skills', 'experience', 'projects', 'leadership'])) {
    if (k === 'summary' && r.summary) sections.push({ id: sid(), kind: 'summary', title: SEC_TITLE.summary, text: r.summary });
    else if (k === 'skills' && (r.skills || []).length) sections.push({ id: sid(), kind: 'skills', title: SEC_TITLE.skills, lines: r.skills });
    else if (['education', 'experience', 'projects', 'leadership'].includes(k) && (r[k] || []).length) sections.push({ id: sid(), kind: 'entries', key: k, title: SEC_TITLE[k], entries: r[k].map(ent) });
  }
  const m = { v: RESUME_V, font: (ST.model && ST.model.font) || 'serif', size: (ST.model && ST.model.size) || 10.5, header: { name: p.basics.name, contact: contactLine(p.basics) }, sections };
  if (ST.model && ST.model.boldKeywords === false) m.boldKeywords = false;
  /* A GPA of 3.0 or higher is shown as its own line (Rice CCD guide), unless Profile › Resume rules › GPA is set to
     Hide: then no GPA or rank line is written on any resume. */
  const hideGpa = p.resumeGpa === 'hide';
  const edu = sections.find((x) => x.key === 'education');
  for (const e of (edu && edu.entries) || []) {
    const pe = (p.education || []).find((x) => x.org && String(e.title || '').toLowerCase().startsWith(String(x.org).toLowerCase())), g = pe && String(pe.gpa || '').trim();
    const val = g && parseFloat(g), scale = g && parseFloat((/\/\s*([\d.]+)/.exec(g) || [])[1] || '4');
    e.lines = (e.lines || []).flatMap((l) => String(l).split(/\s+\|\s+/)).map((l) => l.trim()).filter(Boolean);
    if (hideGpa) e.lines = e.lines.filter((l) => !/\bGPA\b|\bRank \d+\s*\/\s*\d+/i.test(l));
    else if (val && val / scale >= 0.75 && !e.lines.some((l) => /^GPA\b/i.test(l))) e.lines.unshift('GPA: ' + g);
  }
  normResume(m); return m;
}
/* The current page as text for Claude: its sections and entries in order, and each bullet with its Profile source ids,
   so an update edits this page instead of writing a new one. Hidden items are left out. */
function draftText(m) {
  const out = [];
  for (const s of m.sections) {
    if (s.hidden) continue;
    out.push('## ' + s.title);
    if (s.kind === 'summary' && s.text) out.push(s.text);
    for (const l of s.lines || []) if (!l.hidden && l.value) out.push(`- ${l.label}: ${l.value}`);
    for (const x of s.items || []) out.push('- ' + x);
    for (const e of s.entries || []) {
      if (e.hidden) continue;
      out.push('### ' + [e.title, e.loc, e.date].filter(Boolean).join(' | '));
      if (e.subtitle || e.subdate) out.push('_' + [e.subtitle, e.subdate].filter(Boolean).join(' | ') + '_');
      for (const l of e.lines || []) out.push(l);
      for (const b of e.bullets || []) if (!b.hidden && b.text) out.push(`- ${b.src ? '(' + b.src + ') ' : ''}${b.text}`);
    }
  }
  return out.join('\n');
}
function resumeText(m) {
  const out = [m.header.name, m.header.contact];
  for (const s of m.sections) {
    if (s.hidden) continue;
    out.push(s.title, s.text || '', ...(s.lines || []).filter((l) => !l.hidden).map((l) => `${l.label}: ${l.value}`), ...(s.items || []));
    for (const e of s.entries || []) if (!e.hidden) out.push(e.title, e.subtitle, ...(e.lines || []), ...(e.bullets || []).filter((b) => !b.hidden).map((b) => b.text));
  }
  return out.filter(Boolean).join('\n');
}
function pointText(id) {
  for (const k of ['education', 'experience', 'projects', 'leadership']) for (const e of P.data[k]) for (const x of e.points) if (x.id === id) return x.confirm ? null : x.text;
  return null;
}
/* The cited points plus their entry's own facts (tech, team, context), for the truth check. */
function sourceText(src) {
  const ids = String(src || '').split(',').map((x) => x.trim()).filter(Boolean), out = [];
  for (const k of ['education', 'experience', 'projects', 'leadership']) for (const e of P.data[k] || []) for (const x of e.points || []) {
    if (ids.indexOf(x.id) < 0 || x.confirm) continue;
    out.push(x.text, e.tech || '', e.team || '', e.context || '');
  }
  return out.filter(Boolean).join('\n');
}
/* Issues the token-free check finds in a bullet whose sources exist: numbers, tools or "Led" verbs that the cited facts do not support. */
function factIssues(b) {
  if (!P.data || !b || !b.text) return [];
  return C.factCheck(b.text, sourceText(b.src), C.skillSet(P.data, I.S.settings));
}
/* Claude's own "unverified" mark applies to the wording it wrote; once you edit the bullet only the token-free fact
   check decides (it re-runs on every change, so a fixed bullet clears itself). */
const needsCheck = (b) => (!!b.unverified && (b.gen === undefined || b.gen === b.text)) || factIssues(b).length > 0;
/* Letter paragraphs are checked sentence by sentence. A sentence with no number or tool (thanks, availability) needs no
   source; one that states a checkable fact must be backed by the paragraph's cited Profile facts. */
const SENT = (t) => String(t || '').split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((x) => x.trim()).filter(Boolean);
function paraIssues(p) {
  if (!P.data || !p || !p.text) return [];
  const src = sourceText(p.src), S = C.skillSet(P.data, I.S.settings), out = [];
  for (const sent of SENT(p.text)) {
    const iss = src ? C.factCheck(sent, src, S) : (/\d/.test(sent) || C.SKILL_NAMES.some((n) => n.length > 2 && new RegExp('(^|[^a-z0-9+#])' + n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9+#])').test(sent.toLowerCase())) ? ['States a fact with no Profile source'] : []);
    for (const x of iss) if (!out.includes(x)) out.push(x);
  }
  return out;
}

/* preview: the server's exact layout as SVG pages (same line breaks as the .docx and .pdf); HTML only until the first layout arrives */
const SVG_FONT = { serif: "'Times New Roman',Times,'Liberation Serif',Tinos,serif", sans: "Arial,Helvetica,'Liberation Sans',Arimo,sans-serif" };
function svgPages(f) {
  return f.render.map((items, i) => `<svg class="pg${i ? ' extra' : ''}" viewBox="0 0 612 792" role="img" aria-label="Resume page ${i + 1}" style="font-family:${SVG_FONT[f.font] || SVG_FONT.serif}"><rect width="612" height="792" fill="#fff"/>${items.map((o) => o[0] === 't'
    ? `<text x="${o[1]}" y="${o[2]}" font-size="${o[5]}"${o[4] === 'b' ? ' font-weight="700"' : o[4] === 'i' ? ' font-style="italic"' : ''}>${esc(o[3])}</text>`
    : `<line x1="${o[1]}" y1="${o[2]}" x2="${o[3]}" y2="${o[2]}" stroke="#000" stroke-width=".6"/>`).join('')}${((f.marks || [])[i] || []).map(([t, b2, id]) => `<rect class="pv-hit" x="36" y="${t}" width="540" height="${Math.max(6, b2 - t)}" data-goto="bul:${esc(id)}"><title>Edit this bullet</title></rect>`).join('')}</svg>`).join('');
}
function paper(m, size) {
  if (ST.fit && ST.fit.render) return svgPages(ST.fit);
  const sz = size || m.size || 10.5;
  const ent = (e) => { const r1 = e.loc || e.date, r2 = e.loc ? [e.date, e.subdate].filter(Boolean).join(' – ') : e.subdate;
    return `<div class="rp-e"><div class="rp-r"><b>${esc(e.title)}</b><i>${esc(r1)}</i></div>${e.subtitle || r2 ? `<div class="rp-r"><i>${esc(e.subtitle)}</i><i>${esc(r2)}</i></div>` : ''}${(e.lines || []).length ? `<ul>${e.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${(e.bullets || []).filter((b) => !b.hidden && b.text).length ? `<ul>${e.bullets.filter((b) => !b.hidden && b.text).map((b) => `<li>${boldHtml(b.text, m)}</li>`).join('')}</ul>` : ''}</div>`; };
  const body = m.sections.filter((s) => !s.hidden).map((s) => {
    const inner = s.kind === 'summary' ? `<div>${boldHtml(s.text, m)}</div>` : s.kind === 'skills' ? (s.lines || []).filter((l) => !l.hidden && l.value).map((l) => `<div><b>${esc(l.label)}:</b> ${esc(l.value)}</div>`).join('')
      : s.kind === 'list' ? (s.items || []).map((x) => `<div>${esc(x)}</div>`).join('') : (s.entries || []).filter((e) => !e.hidden).map(ent).join('');
    return inner ? `<div class="rp-h">${esc(s.title)}</div>${inner}` : '';
  }).join('');
  return `<div class="paper ${m.font === 'sans' ? 'sans' : ''}" style="--fs:${sz}pt"><div class="rp-name">${esc(m.header.name)}</div><div class="rp-contact">${esc(m.header.contact)}</div>${body}</div>`;
}
function fitPaper() {
  const box = $('#rsPaper'); if (!box) return;
  const pg = box.querySelector('.paper'); if (!pg) { box.style.height = ''; return; }
  const sc = ST.zoom === 'actual' ? 1 : Math.min(1, box.clientWidth / 816);
  pg.style.transform = `scale(${sc})`; box.style.height = (Math.max(1056, pg.scrollHeight) * sc) + 'px';
  box.classList.toggle('over', pg.scrollHeight > 1056 + 2);
}
function scheduleFit() {
  clearTimeout(ST.fitT);
  const seq = (ST.fitSeq = (ST.fitSeq || 0) + 1), key = ST.key;
  ST.fitT = setTimeout(async () => {
    if (!ST.model) return;
    if (JOB && JOB.key === key && applyBold(ST.model, JOB)) scheduleSave();
    let fit = null;
    try { fit = await api('POST', 'api/resume/fit', { resume: ST.model }); } catch (_) { fit = null; }
    if (ST.fitSeq !== seq || ST.key !== key) return; // a newer edit or another job: this layout is stale
    ST.fit = fit; updateLive();
  }, 350);
}
/* ---------- saving resumes and letters ----------
   Every save is bound to the job it was made for: the model is copied when the save is queued, so switching jobs (or a
   late Claude answer) can never write one job's document into another. Each save sends the revision it was based on;
   if another tab saved first, your edits are kept as a named version and the newer document is shown. */
const PEND = new Map(); // 'resume|<key>' or 'letter|<key>' -> { kind, J, model, notes, t }
const DOC_STATE = { resume: '#rsState', letter: '#ltState' };
function setDocState(kind, J, t, warn) {
  if (!JOB || !J || JOB.key !== J.key) return;
  const el = $(DOC_STATE[kind]); if (el) { el.textContent = t; el.classList.toggle('warn', !!warn); }
}
function adopt(kind, J, doc) {
  const st = JOBS.get(J.key); if (st) st[kind] = doc;
  if (!JOB || JOB.key !== J.key) return;
  if (kind === 'resume') { ST.model = I.clone(doc.current); ST.notes = doc.notes || null; scheduleFit(); }
  else { LT.model = I.clone(doc.current); LT.notes = doc.notes || null; letterFit(); }
}
/* One PUT with the revision check. Returns the saved document. */
async function putDoc(kind, J, model, extra) {
  const st = JOBS.get(J.key) || {}, base = st[kind] && st[kind].updatedAt;
  const body = Object.assign(meta(J), { resume: model, baseUpdatedAt: base || undefined }, extra || {});
  try {
    const r = await api('PUT', 'api/' + kind, body);
    if (JOBS.get(J.key)) JOBS.get(J.key)[kind] = r.resume;
    return r.resume;
  } catch (e) {
    if (e.status !== 409 || !e.data || !e.data.resume) throw e;
    /* Someone else saved first: keep my edits as a version, show theirs. Nothing is overwritten. */
    const r = await api('PUT', 'api/' + kind, Object.assign(meta(J), { resume: model, label: 'Your edits (saved while another tab changed it)', by: 'you', keepCurrent: true, notes: (extra && extra.notes) || {} }));
    adopt(kind, J, r.resume);
    I.toast(`This ${kind === 'letter' ? 'cover letter' : 'resume'} was changed in another tab. Its version is shown; yours is kept under Versions.`);
    if (JOB && JOB.key === J.key) I.render();
    return r.resume;
  }
}
function queueSave(kind, J, model) {
  if (!J || !model) return;
  const id = kind + '|' + J.key, old = PEND.get(id);
  if (old) clearTimeout(old.t);
  const p = { kind, J, model: I.clone(model) };
  p.t = setTimeout(() => flushDoc(id), 900);
  PEND.set(id, p);
  setDocState(kind, J, 'Saving…');
}
async function flushDoc(id) {
  const p = PEND.get(id); if (!p) return;
  PEND.delete(id); clearTimeout(p.t);
  try {
    const doc = await putDoc(p.kind, p.J, p.model); setDocState(p.kind, p.J, 'Saved');
    const lc = JOB && JOB.key === p.J.key && $(p.kind === 'letter' ? '#ltState' : '#rsState');
    const strip = lc && lc.closest('.rs-origin') && lc.closest('.rs-origin').querySelector('.lc');
    if (strip) strip.outerHTML = lifecycle(doc, p.kind, p.J);
  }
  catch (e) {
    setDocState(p.kind, p.J, 'Not saved: ' + e.message + ' · retrying', true);
    if (!PEND.has(id)) { p.t = setTimeout(() => flushDoc(id), 5000); PEND.set(id, p); }
  }
}
/* Save everything queued for one job (or all jobs) now, e.g. before an export or a version. */
const flushJob = (J, kind) => Promise.all([...PEND.keys()].filter((id) => (!J || id.endsWith('|' + J.key)) && (!kind || id.startsWith(kind + '|'))).map(flushDoc));
window.addEventListener('beforeunload', (e) => { if (PEND.size) { flushJob(); e.preventDefault(); e.returnValue = ''; } });
function scheduleSave() { queueSave('resume', JOB, ST.model); }
function setRsState(t, warn) { const el = $('#rsState'); if (el) { el.textContent = t; el.classList.toggle('warn', !!warn); } }
/* A named version of the resume. Bound to J and the model given (default: the open job and its editor). */
async function saveVersion(label, by, J, model, notes) {
  J = J || JOB; model = model || ST.model; notes = notes !== undefined ? notes : ST.notes;
  await flushJob(J, 'resume');
  const doc = await putDoc('resume', J, model, { label, by, notes: notes || {} });
  I.loadKit(); return doc;
}
/* One-page status above the editor: a warning with a fix when it runs over, or what was hidden to make it fit. */
function pageNote() {
  if (ST.fit && ST.fit.pages > 1) return `<div class="notice warn"><span><b>${ST.fit.pages} pages.</b> Recruiters expect one page for an internship. Fit it automatically (hides the least relevant items first; you can turn any back on), or shorten bullets yourself.</span><button class="btn sm primary" type="button" data-jb="fit1">Fit to one page</button></div>`;
  if (ST.fit && ST.fit.pages === 1 && (ST.fit.size < COMFORT_PT || ST.fit.tight < 1)) return `<div class="notice"><span><b>Crowded:</b> it only fits at ${ST.fit.size} pt${ST.fit.tight < 1 ? ' with tightened spacing' : ''}. Recruiters skim a page with some air faster. Hide one or two weaker bullets, or let the tracker pick them.</span><button class="btn sm" type="button" data-jb="fit1">Make it roomier</button></div>`;
  if (ST.fit && ST.fit.pages === 1 && ST.fit.fill < 0.8 && !(ST.trimmed && ST.trimmed.length)) return `<div class="notice"><span><b>The page is ${Math.round(ST.fit.fill * 100)}% full.</b> There is room for about ${ST.fit.fill < 0.75 ? 'one more project or 3–4 bullets' : '1–2 more bullets'}: turn a hidden item back on with its eye button, or add your strongest missing project.</span></div>`;
  if (ST.trimmed && ST.trimmed.length) return `<div class="notice"><span><b>Hidden to keep one page:</b> ${esc(trimText(ST.trimmed).replace(/\.$/, ''))}. Turn any back on with its eye button, then hide something else.</span><button class="btn sm ghost" type="button" data-jb="trim-ok">OK</button></div>`;
  return '';
}
function updateLive() {
  if (!ST.model) return;
  const pn = $('#rsPageNote'); if (pn) pn.innerHTML = pageNote();
  const pv = $('#rsPaper'); if (pv) { pv.innerHTML = paper(ST.model, ST.fit && ST.fit.size); pv.classList.toggle('over', !!(ST.fit && ST.fit.pages > 1)); fitPaper(); }
  const kw = $('#rsKw'); if (kw) kw.innerHTML = kwPanel();
  const sc = $('#rsScore'); if (sc) { const was = {}; sc.querySelectorAll('details[class]').forEach((d) => { was[d.className] = d.open; }); sc.innerHTML = scorePanel(); sc.querySelectorAll('details[class]').forEach((d) => { if (d.className in was) d.open = was[d.className]; }); }
  /* The Review tab's badge follows the page as you edit. */
  const rb = $('#rst-review .rs-badge'), r2 = rsScore(ST.model, JOB); if (rb && r2 && r2.total !== null && !rb.classList.contains('issue')) { rb.textContent = r2.total; rb.className = 'rs-badge ' + (r2.total >= 80 ? 'good' : 'warn'); }
  const ft = $('#rsFit'); if (ft) ft.innerHTML = fitText();
  const ck = $('#rsChecks'); if (ck) { const open = ck.querySelector('details') && ck.querySelector('details').open; ck.innerHTML = checksBox(resumeChecks(ST.model, ST.fit), 'Resume checklist'); if (open !== undefined && ck.querySelector('details')) ck.querySelector('details').open = open || ck.querySelector('details').open; }
}
function fitText() {
  const f = ST.fit; if (!f) return '<span class="sub">Checking page fit…</span>';
  return f.pages === 1 ? `<span class="pos">Fits one page</span> <span class="sub">at ${f.size} pt${f.tight < 1 ? ', tighter spacing' : ''} · ${Math.round(f.fill * 100)}% full</span>` : `<span class="neg">${f.pages} pages at 10 pt</span> <span class="sub">hide or shorten a few bullets (Rice guide: no smaller than 10 pt)</span>`;
}
function kwPanel(compact) {
  const st = JOBS.get(JOB && JOB.key), a = st && st.job && st.job.analysis;
  if (!a) return compact ? '' : '<p class="empty">Analyze the job to see which of its keywords this resume covers.</p>';
  /* Soft skills and credentials are shown by what the bullets and education say, not by a matching word, so they are
     listed apart and left out of the percentage. */
  const SOFT = (k) => k.kind === 'soft' || k.kind === 'credential';
  const txt = resumeText(ST.model), all = a.keywords || [];
  const ks = C.keywordScore(txt, all.filter((k) => !SOFT(k))), soft = C.keywordScore(txt, all.filter(SOFT)), Sk = C.skillSet(P.data, I.S.settings);
  const can = ks.miss.filter((k) => C.hasSkill(k.term, Sk)), cannot = ks.miss.filter((k) => !C.hasSkill(k.term, Sk));
  const softChips = [...soft.hit.map((k) => `<span class="chip v-yes">${esc(k.term)}</span>`), ...soft.miss.map((k) => `<span class="chip">${esc(k.term)}</span>`)].join('');
  return `${compact ? '' : `<div class="kw-head"><span class="ring sm ${I.band(ks.score)}" style="--p:${ks.score}"><span>${ks.score}</span></span><div><b>Keyword coverage ${ks.score}%</b><div class="sub">${ks.hit.length} of ${ks.hit.length + ks.miss.length} technical keywords from the posting appear in this resume, weighted by importance. Wording only: it does not change your fit, and it is not any employer’s ATS score</div></div></div>`}
    ${can.length ? `<div class="kw-l"><span class="sk-l">In your profile, not on this resume</span>${can.map((k) => `<span class="chip kw-can" title="Importance ${k.importance}">${esc(k.term)}</span>`).join('')}</div>` : ''}
    ${ks.negated.length ? `<p class="sub">Not counted because the resume negates them (“no …”, “without …”): ${ks.negated.map((k) => esc(k.term)).join(', ')}</p>` : ''}
    ${ks.hit.length ? `<div class="kw-l"><span class="sk-l">Covered</span>${ks.hit.map((k) => `<span class="chip v-yes">${esc(k.term)}</span>`).join('')}</div>` : ''}
    ${cannot.length ? `<div class="kw-l"><span class="sk-l">Not in your Profile</span>${cannot.map((k) => `<span class="chip miss">${esc(k.term)}</span>`).join('')}</div>` : ''}
    ${softChips ? `<div class="kw-l"><span class="sk-l" title="Shown by what your bullets describe; not counted in the percentage">Soft skills · not scored</span>${softChips}</div>` : ''}
    ${cannot.length ? `<p class="sub">Have one of these? Add it to Profile › Skills first; tailoring only uses what your Profile says.</p>` : ''}`;
}

/* ---------- job page ---------- */
const STATUS_TXT = { sponsors: ['Sponsors visas', 'v-yes'], cpt_opt_ok: ['CPT / OPT welcome', 'v-yes'], not_stated: ['Not stated', 'v-unknown'], no_sponsorship: ['No sponsorship', 'v-no'], citizens_only: ['U.S. citizens only', 'v-no'], clearance_required: ['Clearance required', 'v-no'] };
const quote = (q) => q ? `<q class="ev-q">${esc(q)}</q>` : '';
function factsPanel(J, a, job) {
  if (!a) {
    const l = J.l;
    const known = l ? [['Degree (Simplify)', [...new Set((l.degrees || [l.degree]).filter(Boolean))].join(', ') || '—'], ['Employer H-1B record', I.sponsorRecords(l).join(' · ') || 'No record'],
      ['Sponsorship wording', l.sponsor === 'no' ? 'Says no sponsorship' : l.sponsor === 'yes' ? 'CPT/OPT friendly' : 'Not found'], ['Skills found', (l.skillsFound || []).join(', ') || '—'], ['Deadline', l.deadline ? I.fmt(l.deadline) : 'Not stated']] : [];
    return `<section class="panel jb-facts"><h2>Job facts <small>${known.length ? 'from the free refresh' : ''}</small></h2>
      ${known.length ? `<dl class="facts">${known.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
        : job && job.textSource === 'extension' ? `<p class="empty">Added with the Chrome extension${J.app && J.app.source ? ' from ' + esc(J.app.source) : ''}. The job description is saved (${Number((job.text || '').length).toLocaleString('en-US')} characters), so analysis reads it without opening the page.</p>`
          : J.app && typeof J.app.score === 'number' ? `<p class="empty">Saved from New listings. The listing's free facts were kept in its notes${job && job.text ? `, and the posting text is saved (${Number(job.text.length).toLocaleString('en-US')} characters)` : ''}.</p>`
          : '<p class="empty">This application was added by hand, so no posting facts are stored yet.</p>'}
      <p class="empty">Analyze the posting to see who it is for, dates, sponsorship evidence, keywords and responsibilities.</p></section>`;
  }
  const au = a.audience || {}, tm = a.timing || {}, lc = a.location || {}, sp = a.sponsorship || {}, [stx, scls] = STATUS_TXT[sp.status] || STATUS_TXT.not_stated;
  const Sk = C.skillSet(P.data, I.S.settings);
  const row = (k, v, ev) => v ? `<dt>${k}</dt><dd>${v}${quote(ev)}</dd>` : '';
  const grad = au.gradText || [au.gradFrom, au.gradTo].filter(Boolean).join(' – ');
  return `<section class="panel jb-facts"><h2>Job facts <small>from Claude’s reading of the posting</small></h2>
    <p class="jb-sum">${esc(a.summary)}</p>
    <dl class="facts">
      ${row('Who it is for', (au.degreeLevels || []).length ? `<span class="chips">${au.degreeLevels.map((d) => `<span class="chip tag">${esc(d)}</span>`).join('')}</span>` : 'Degree not stated', au.evidence)}
      ${row('Enrollment', esc(au.enrollment))}${row('Graduation', esc(grad))}${row('Majors', esc((au.majors || []).join(', ')))}
      ${row('Experience', typeof au.yearsExperience === 'number' ? esc(au.yearsExperience + '+ years') : '')}
      ${row('Dates', esc([tm.term, [tm.start, tm.end].filter(Boolean).join(' – '), tm.duration].filter(Boolean).join(' · ')), tm.evidence)}
      ${row('Deadline', tm.deadline ? esc(I.fmt(tm.deadline)) : '')}
      ${row('Location', esc([lc.workMode !== 'unknown' ? lc.workMode : '', (lc.places || []).join('; '), lc.relocation].filter(Boolean).join(' · ')))}
      ${row('Pay', esc(a.pay))}
      <dt>Sponsorship</dt><dd><span class="chip ${scls}">${stx}</span>${J.l0 && I.sponsorRecords(J.l0).length ? ` <span class="sub">${esc(I.sponsorRecords(J.l0).join(' · '))}</span>` : ''}${sp.note ? ` <span class="sub">${esc(sp.note)}</span>` : ''}${quote(sp.evidence)}</dd>
    </dl>
    ${(a.redFlags || []).length ? `<div class="notice warn"><span><b>Watch out:</b> ${a.redFlags.map(esc).join(' · ')}</span></div>` : ''}
    <details class="why" open><summary>Responsibilities</summary><ul class="jb-ul">${(a.responsibilities || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
    <div class="kw-l"><span class="sk-l">Keywords</span>${(a.keywords || []).map((k) => `<span class="chip ${C.hasSkill(k.term, Sk) ? 'v-yes' : 'miss'} imp${k.importance}" title="${k.importance === 3 ? 'Required or repeated' : k.importance === 2 ? 'Preferred' : 'Mentioned'} · ${k.kind}${C.hasSkill(k.term, Sk) ? ' · in your profile' : ''}">${esc(k.term)}</span>`).join('')}</div>
    <p class="sub jb-meta">Analyzed ${I.fmt((job.analyzedAt || '').slice(0, 10))} with ${esc((AI.status && AI.status.modelLabels[job.analysisModel]) || job.analysisModel || '')} · ${money(job.analysisCost)} · ${job.textSource === 'pasted' ? 'from pasted text' : 'from the posting page'} (${((job.text || '').length / 1000).toFixed(1)}K characters after trimming boilerplate) · cached, viewing again is free${job.checkedAt ? ` · posting re-checked ${esc(I.fmt(job.checkedAt))}, unchanged` : ''}
      <button class="btn sm ghost" type="button" data-jb="reanalyze">Re-analyze</button><button class="btn sm ghost" type="button" data-jb="paste">Paste text</button></p></section>`;
}
function matchPanel(J, a) {
  if (!a) {
    const l = J.l;
    if (!l) {
      /* Saved listings leave the feed at the next refresh (they live in Applications), so fall back to the score kept when saved. */
      const sc = J.app && typeof J.app.score === 'number' ? J.app.score : null;
      return sc !== null
        ? `<section class="panel jb-match"><h2>Listing priority <small>when you saved it · not your fit</small></h2><div class="kw-head">${I.ring(sc)}<div><b>${sc} of 100</b><div class="sub">Saved from New listings on ${I.fmt(((J.app.history || []).find((h) => h.s === 'saved') || {}).d || '')}. Analyze the posting to get a fit score against your Profile.</div></div></div></section>`
        : `<section class="panel jb-match"><h2>Match</h2><p class="empty">Added by hand, so there is no listing score. Analyze the posting to get a fit score.</p></section>`;
    }
    return `<section class="panel jb-match"><h2>Listing priority <small>what to look at first · not your fit · before analysis</small></h2><div class="kw-head">${I.ring(l.total)}<div><b>${l.total} of 100</b><div class="sub">From the title, skills named in the posting, H-1B history, recency, degree and location.</div></div></div>
      <div class="fps">${l.parts.map((p) => { const v = p.max ? p.pts / p.max : 0; return `<div class="fp"><span class="fp-l">${({ fit: 'Role fit', skills: 'Skill match', sponsor: 'Sponsorship', recency: 'Recency', degree: 'Degree', location: 'Location' })[p.k]}</span><span class="fbar"><span style="width:${Math.round(v * 100)}%;background:${v >= 0.8 ? 'var(--score-hi)' : v >= 0.5 ? 'var(--score-mid)' : 'var(--bad)'}"></span></span><span class="num fp-n">${Math.round(p.pts)}/${Math.round(p.max)}</span></div>`; }).join('')}</div></section>`;
  }
  const f = fitOf(J, a);
  const bar = (p) => p.known
    ? `<div class="fp"><span class="fp-l">${esc(p.label)}</span><span class="fbar" role="img" aria-label="${Math.round(p.v * 100)}%"><span style="width:${Math.round(p.v * 100)}%;background:${p.v >= 0.8 ? 'var(--score-hi)' : p.v >= 0.5 ? 'var(--score-mid)' : 'var(--bad)'}"></span></span><span class="num fp-n">${Math.round(p.v * 100)}%</span><span class="fp-note">${esc(p.note)}</span></div>`
    : `<div class="fp unknown"><span class="fp-l">${esc(p.label)}</span><span class="fbar"></span><span class="num fp-n">n/a</span><span class="fp-note">${esc(p.note)} · not counted</span></div>`;
  const inferred = new Set((f.skills.inferred || []).map((x) => x.term));
  const depth = new Map((f.skills.evidence || []).map((x) => [x.term, x.depth]));
  const DT = { work: 'Shown in a job: full credit', project: 'Shown in a project: 90% credit', listed: 'Only listed in Skills or coursework: 70% credit. Add a confirmed point that shows you using it to raise this.' };
  const chips = (xs, cls) => xs.map((x) => { const d = depth.get(x); return `<span class="chip ${cls}${inferred.has(x) ? ' inferred' : ''}${d === 'listed' ? ' listed' : ''}" title="${inferred.has(x) ? `Inferred from ${esc((f.skills.inferred.find((y) => y.term === x) || {}).from || '')} · half credit` : esc(DT[d] || '')}">${esc(x)}${inferred.has(x) ? ' ~' : d === 'listed' ? ' ◦' : d === 'project' ? ' ▪' : ''}</span>`; }).join('');
  return `<section class="panel jb-match"><h2>Candidate fit <small>your Profile vs. this posting · computed here, no tokens</small></h2>
    <div class="kw-head">${fitRing(f)}<div><b>${f.verdict === 'blocked' ? `Not eligible${f.rawTotal !== null ? ` · background fit ${f.rawTotal} (not counted)` : ''}` : f.total === null ? 'Not enough information to score' : `Fit ${f.total} of 100`}</b><div class="sub">Assessed ${Math.round(f.coverage * 100)}% of the weight; components marked n/a are left out, not counted as gaps. This is not an employer’s ATS score or a chance of an offer.</div></div></div>
    ${eligibilityList(f)}
    <div class="fps">${f.parts.map(bar).join('')}</div>
    <div class="kw-l"><span class="sk-l">Required</span>${chips(f.skills.reqHit, 'v-yes')}${chips(f.skills.reqMiss, 'miss')}${!f.skills.reqHit.length && !f.skills.reqMiss.length ? '<span class="sub">none listed</span>' : ''}</div>
    <div class="kw-l"><span class="sk-l">Preferred</span>${chips(f.skills.optHit, 'v-yes')}${chips(f.skills.optMiss, 'miss')}${!f.skills.optHit.length && !f.skills.optMiss.length ? '<span class="sub">none listed</span>' : ''}</div>
    <p class="sub">Credit follows the evidence in your Profile: shown in a job 100% · ▪ shown in a project 90% · ◦ only listed 70%${inferred.size ? ' · ~ inferred from a related skill 50% (confirm before you claim it)' : ''}. ${[...depth.values()].includes('listed') ? '<button type="button" class="linkbtn" data-goto="sec:projects">Show a listed skill in a project →</button>' : ''}</p>
    ${f.flagged.length ? `<p class="sub">On your “do not claim” list: ${f.flagged.map(esc).join(', ')}</p>` : ''}</section>`;
}
/* Where this draft stands: written by Claude or you, reviewed by you, exported (this exact content), applied. */
/* Where this resume stands, in one line: Draft → Ready to send → Submitted (the version the employer has). */
function submittedOf(doc) { const s = doc && doc.submitted; return s ? (doc.versions || []).find((v) => v.id === s.id) || null : null; }
function readiness(doc, J) {
  const st = (doc && doc.state) || {}, sv = submittedOf(doc);
  if (sv) {
    const changed = ST.model && JSON.stringify(sv.resume) !== JSON.stringify(ST.model);
    return `<div class="ready${changed ? ' warn' : ''}"><span class="chip v-yes">Submitted ${esc(when(sv.at))}</span><span class="sub">${changed ? '<b class="warn-t">Edited since.</b> The employer has the submitted version; use it to prepare for interviews.' : 'This is exactly the page the employer has.'}</span>
      <span class="ready-a">${changed ? '<button class="btn xs ghost" type="button" data-subcmp>Compare</button>' : ''}<span class="dlpair sm" role="group" aria-label="Download the submitted version"><span class="dlp-l" aria-hidden="true">${IC.dl} sent</span><button type="button" data-subdl="docx">.docx</button><button type="button" data-subdl="pdf">.pdf</button></span></span></div>`;
  }
  const r = rsScore(ST.model, J), flagged = r ? r.parts.find((x) => x.k === 'truth') : null, bad = flagged && flagged.v !== null && flagged.v < 1;
  const ok = st.reviewed && r && r.total !== null && r.total >= 80 && !bad;
  const why = !st.reviewed ? 'Read every line, then mark it reviewed' : bad ? 'Some bullets are not backed by your Profile' : r && r.total < 80 ? `Resume score ${r.total}: work through the biggest gains` : '';
  return `<div class="ready"><span class="chip ${ok ? 'v-yes' : 'tag'}">${ok ? 'Ready to send' : 'Draft'}</span><span class="sub">${ok ? 'Reviewed, backed by your Profile, score ' + r.total + '. Marking the job applied freezes this version.' : esc(why)}</span>${st.reviewed ? '' : '<button class="btn xs" type="button" data-jb="review">Mark reviewed</button>'}</div>`;
}
async function subDownload(fmt) {
  const st = JOBS.get(JOB.key) || {}, v = submittedOf(st.resume); if (!v) return;
  const name = fileBase(P.data.resumeFileName, JOB) + '_submitted';
  try {
    const res = await fetch('api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume: v.resume, format: fmt, filename: name }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `${name}.${fmt}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    I.toast(`Downloaded ${name}.${fmt}`);
  } catch (e) { I.toast(e.message); }
}
function lifecycle(doc, kind, J) {
  const st = (doc && doc.state) || {}, app = J.app, applied = app && (app.history || []).some((h) => h.s === 'applied');
  const step = (on, label, hint) => `<li class="${on ? 'on' : ''}" title="${esc(hint)}"><span aria-hidden="true">${on ? '●' : '○'}</span>${label}<span class="sr">${on ? ', done' : ', not yet'}</span></li>`;
  const rev = st.reviewed ? '' : `<button class="btn xs" type="button" data-${kind === 'letter' ? 'lt' : 'jb'}="review" ${doc ? '' : 'disabled'}>Mark reviewed</button>`;
  return `<div class="lc"><ol class="lc-steps" aria-label="Document status">
    ${step(st.reviewed, 'Reviewed', st.reviewed ? 'You reviewed this exact content' : 'Read every line, then mark it reviewed')}
    ${step(st.exported, st.exported ? `Exported ${(st.exportedFormats || []).map((x) => '.' + x).join(' ')}` : st.exportedBefore ? 'Edited since export' : 'Exported', st.exported ? 'This content was exported' : st.exportedBefore ? 'An earlier draft was exported; export again before you send it' : 'Not exported yet')}
    ${step(applied, 'Applied', applied ? 'Marked applied' : 'Not marked applied')}</ol>${rev}</div>`;
}
async function markReviewed(kind) {
  const J = JOB, model = kind === 'letter' ? LT.model : ST.model; if (!J || !model) return;
  await flushJob(J, kind);
  try { await putDoc(kind, J, model, { reviewed: true }); I.toast('Marked reviewed · editing it again clears this'); I.render(); } catch (e) { I.toast(e.message); }
}
/* ---------- fit helpers (shared by the job page panels) ---------- */
function fitOf(J, a) { return C.fit(P.data, a, { settings: I.S.settings, role: J.role, track: J.track, h1b: J.h1b, h1bYear: (AI.status && AI.status.h1b && AI.status.h1b.label) || '', lca: J.lca, lcaPeriod: (AI.status && AI.status.lca && AI.status.lca.label) || '', locations: J.locations }); }
function fitRing(f) {
  if (f.verdict === 'blocked') return `<span class="ring blocked" style="--p:100" title="Not eligible: ${esc(f.blockers.join('; '))}"><span aria-hidden="true">✕</span><span class="sr">Not eligible</span></span>`;
  if (f.total === null) return `<span class="ring none" title="Not enough information"><span>—</span></span>`;
  return `<span class="ring ${I.band(f.total)}" style="--p:${f.total}" title="Fit ${f.total} of 100"><span>${f.total}</span></span>`;
}
const ELIG_ICON = { meets: ['ok', '✓', 'Meets'], fails: ['bad', '✕', 'Does not meet'], unknown: ['warn', '?', 'To confirm'], na: ['na', '–', 'Not required'] };
function eligibilityList(f) {
  const rows = f.eligibility.filter((e) => e.status !== 'na' || ['citizenship', 'sponsorship'].includes(e.key));
  return `<div class="elig" role="list" aria-label="Eligibility">${rows.map((e) => { const [c, i, t] = ELIG_ICON[e.status]; return `<div class="el ${c}" role="listitem"><span class="el-i" aria-hidden="true">${i}</span><span class="el-l"><b>${esc(e.label)}</b><span class="sr"> · ${t}</span><span class="sub">${esc(e.detail)}</span>${e.evidence ? `<q>${esc(e.evidence)}</q>` : ''}</span><span class="el-s">${t}</span></div>`; }).join('')}</div>`;
}
function staleBanner(job) {
  if (!job || job.analysisState !== 'stale') return '';
  return `<div class="notice warn" role="status"><span><b>The posting text changed after it was analyzed.</b> Fit, keywords and eligibility below describe the old text. Tailoring and letters are paused until you re-analyze.</span><button class="btn sm primary" type="button" data-jb="analyze">Re-analyze</button></div>`;
}
function stepHero(J) {
  const st = JOBS.get(J.key) || {}, tl = st.job && st.job.text ? st.job.text.length : 9000, e = est('analyze', tl / 3.6 + 1100, 2400);
  const gets = [['Eligibility', 'degree, graduation window and sponsorship, with quotes from the posting'], ['Fit score', 'your Profile against its requirements'], ['Keywords', 'what your resume should cover'], ['Responsibilities', 'for your cover letter and interviews']];
  const act = ready('analyze')
    ? `<button class="btn primary lg" type="button" data-jb="analyze" ${ST.busy ? 'disabled' : ''}>${ST.busy === 'analyze' ? 'Reading the posting…' : 'Analyze with Claude'}</button>
      ${ST.busy === 'analyze' ? '<span class="sub busy-t" role="status">Claude is reading the posting. This usually takes 10–30 seconds; you can keep working.</span>' : `<span class="sub">${costLabel('analyze', e)} · about 10 seconds · saved, so it runs once per job</span>`}
      ${ST.err && ST.err.task === 'analyze' && ST.err.key === J.key && !ST.busy ? `<div class="job-err" role="alert"><b>The analysis did not finish.</b> <span>${esc(ST.err.msg)}</span></div>` : ''}
      <button class="linkbtn" type="button" data-jb="paste">Posting won’t load? Paste the description</button>`
    : `<a class="btn primary lg" href="#settings/claude">Connect Claude</a><span class="sub">${esc(notReadyTip('analyze'))}</span>`;
  return `<section class="panel step-hero"><div class="sh-main"><h2>Analyze the posting</h2>
      <p class="sub">Claude reads the posting once. Everything after this step uses the result, and fit and eligibility are computed here for free.</p>
      <ul class="gets">${gets.map(([b, t]) => `<li><b>${b}</b><span>${t}</span></li>`).join('')}</ul></div>
    <div class="sh-act">${act}<a class="linkbtn" href="#job/${esc(encodeURIComponent(J.id))}/resume">Skip to the resume →</a></div></section>`;
}
const isTailored = () => !!(ST.notes && ST.notes.model);
/* After analysis: the decision in one place, and the next step. */
function verdict(J, a, f) {
  const dl = (a.timing && /^\d{4}-\d{2}-\d{2}$/.test(a.timing.deadline || '') && a.timing.deadline) || J.deadline;
  const days = dl ? I.daysFrom(dl) : null;
  const part = (k) => f.parts.find((p) => p.k === k) || { v: null, note: '' };
  const ELIG_GOTO = { degree: ['fld:preferences.degreePursuing', 'Set your degree'], graduation: ['fld:preferences.graduation', 'Set graduation'], citizenship: ['sec:prefs', 'Work authorization'], cptopt: ['sec:prefs', 'Work authorization'], sponsorship: ['sec:prefs', 'Work authorization'] };
  const items = f.eligibility.filter((e) => e.status === 'fails' || e.status === 'unknown').map((e) => [e.status === 'fails' ? 'bad' : 'warn', `${e.label}: ${e.detail}`, ELIG_GOTO[e.key]]);
  const sk = part('skills'); items.push([sk.v === null ? 'warn' : sk.v >= 0.8 ? 'ok' : 'warn', `Skills: ${sk.note}`, sk.v !== null && sk.v < 0.8 ? ['sec:skills', 'Profile › Skills'] : null]);
  if (days !== null) items.push([days < 0 ? 'bad' : days <= 7 ? 'warn' : 'ok', days < 0 ? `Deadline passed (${I.fmt(dl)})` : `Deadline ${I.fmt(dl)}${days <= 14 ? ` · ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days'}` : ''}`]);
  const bad = f.verdict === 'blocked' || items.some((x) => x[0] === 'bad');
  const head = f.verdict === 'blocked' ? 'Not eligible as your Profile stands' : f.total === null ? 'Not enough information to judge the fit'
    : f.verdict === 'check' && f.total >= 55 ? `Fit ${f.total} · confirm ${f.open.length > 1 ? f.open.length + ' eligibility questions' : f.open[0].toLowerCase()} first`
      : f.total >= 75 ? 'Strong fit · worth applying' : f.total >= 55 ? 'Reasonable fit · tailor the resume to close gaps' : 'Weak fit · apply only if the role really interests you';
  const id = esc(encodeURIComponent(J.id));
  const next = !ST.model ? ['resume', 'Next: build the resume', usesPro('tailor') ? 'tailor with Claude Pro · no API cost' : 'tailor with Claude, or start free from your master resume']
    : !isTailored() ? ['resume', 'Next: tailor the resume', 'your draft is the master resume, not tailored to this posting']
      : !LT.model ? ['letter', 'Next: cover letter', 'optional · or go straight to Apply'] : ['apply', 'Next: apply', 'download your kit and submit'];
  const blocked = f.verdict === 'blocked';
  return `<section class="panel verdict ${bad ? 'v-bad' : f.verdict === 'ok' && f.total >= 75 ? 'v-good' : 'v-warn'}">
    ${fitRing(f)}
    <div class="vd-body"><b>${head}</b>${blocked && f.rawTotal !== null ? `<p class="sub">Skills and background alone would score ${f.rawTotal}, but a requirement is not met. Change your Profile only if it is wrong.</p>` : ''}
      <ul class="vd-checks">${items.map(([c, t, g]) => `<li class="${c}"><span class="sr">${c === 'bad' ? 'Does not meet: ' : c === 'warn' ? 'To confirm: ' : 'OK: '}</span>${esc(t)}${g && c !== 'ok' ? ` <button type="button" class="linkbtn" data-goto="${g[0]}">${esc(g[1])} →</button>` : ''}</li>`).join('')}</ul></div>
    <div class="vd-next">${blocked
      ? `${J.app ? `<button class="btn" type="button" data-skip-app="${esc(J.app.id)}">Not applying</button>` : J.l ? `<button class="btn" type="button" data-dismissl="${esc(J.l.id)}">Not interested</button>` : ''}<a class="linkbtn" href="#job/${id}/${next[0]}">Build a resume anyway →</a>`
      : `<a class="btn primary" href="#job/${id}/${next[0]}">${next[1]} →</a><span class="sub">${next[2]}</span>`}</div></section>`;
}
function pasteBox() {
  return ST.paste ? `<section class="panel"><h2>Paste the job description <small>use this when the posting page cannot be read, or to analyze a newer version</small></h2>
    <textarea id="jbPaste" rows="8" placeholder="Paste the full posting text here">${esc(ST.pasteText || '')}</textarea><div class="row"><button class="btn primary" type="button" data-jb="analyze-paste" ${ready('analyze') ? '' : 'disabled'}>Analyze pasted text</button><button class="btn ghost" type="button" data-jb="paste-cancel">Cancel</button>
    <span class="sub">Boilerplate (EEO, benefits) is trimmed before sending.</span></div></section>` : '';
}

function rsEditor(m) {
  const t = (path, val, cls = '', ph = '') => `<input type="text" class="${cls}" data-rs="${path}" value="${esc(val)}" placeholder="${esc(ph)}" aria-label="${esc(ph)}">`;
  const st = JOBS.get(JOB.key) || {}, a = st.job && st.job.analysis, kws = a ? (a.keywords || []).map((k) => k.term) : [];
  const bulletRow = (si, ei, bi, b, n) => {
    const p = `sections.${si}.entries.${ei}.bullets.${bi}`, srcs = (b.src || '').split(',').map((x) => x.trim()).filter(Boolean);
    const ok = srcs.length && srcs.every((x) => pointText(x) !== null);
    const issues = factIssues(b).filter((x) => ok || x !== 'No Profile fact is cited');
    const open = ST.rw && ST.rw.id === b.id;
    return `<li class="rb${b.hidden ? ' off' : ''}" data-bid="${b.id}"><textarea class="auto" rows="1" data-rs="${p}.text" aria-label="Bullet">${esc(b.text)}</textarea>
      <div class="rb-acts">${ok ? `<button type="button" class="src ok" data-goto="pt:${esc(srcs[0])}" title="${esc(srcs.map((x) => x + ': ' + pointText(x)).join('\n'))}&#10;Click to open it in your Profile">✓ ${esc(srcs.join(', '))}</button>` : `<span class="src no" title="No profile source: check this bullet is true">⚠ no source</span>`}${issues.length ? `<span class="src no fc" title="${esc(issues.join('\n'))}">⚠ ${esc(issues[0])}${issues.length > 1 ? ` +${issues.length - 1}` : ''}</span>` : ''}<span class="grow"></span>
        <button class="btn sm ghost${open ? ' on' : ''}" type="button" data-rsa="rw:${b.id}" title="Rewrite this bullet with Claude">Rewrite</button>
        <button class="btn icon sm ghost" type="button" data-rsa="mvb:${si}:${ei}:${bi}:-1" aria-label="Move up" ${bi ? '' : 'disabled'}>${IC.up}</button><button class="btn icon sm ghost" type="button" data-rsa="mvb:${si}:${ei}:${bi}:1" aria-label="Move down" ${bi < n - 1 ? '' : 'disabled'}>${IC.down}</button>
        <button class="btn icon sm ghost" type="button" data-rsa="hideb:${si}:${ei}:${bi}" aria-label="${b.hidden ? 'Show' : 'Hide'}" title="${b.hidden ? 'Show' : 'Hide'} on the resume">${b.hidden ? IC.eyeOff : IC.eye}</button>
        <button class="btn icon sm ghost danger" type="button" data-rsa="delb:${si}:${ei}:${bi}" aria-label="Delete bullet">${IC.x}</button></div>
      ${open ? rwPanel(b, kws) : ''}</li>`;
  };
  const secBody = (s, si) => {
    if (s.kind === 'summary') return `<textarea class="auto" rows="2" data-rs="sections.${si}.text" aria-label="Summary">${esc(s.text)}</textarea>`;
    if (s.kind === 'list') return `<textarea class="auto" rows="2" data-rs="sections.${si}.items" data-rst="lines" aria-label="${esc(s.title)} lines">${esc((s.items || []).join('\n'))}</textarea>`;
    if (s.kind === 'skills') return `<div class="rs-sk">${(s.lines || []).map((l, li) => `<div class="pf-sk">${t(`sections.${si}.lines.${li}.label`, l.label, '', 'Label')}${t(`sections.${si}.lines.${li}.value`, l.value, '', 'Skills')}<button class="btn icon sm ghost" type="button" data-rsa="mvl:${si}:${li}:-1" aria-label="Move up" ${li ? '' : 'disabled'}>${IC.up}</button><button class="btn icon sm ghost danger" type="button" data-rsa="dell:${si}:${li}" aria-label="Remove">${IC.x}</button></div>`).join('')}</div><button class="btn sm ghost" type="button" data-rsa="addl:${si}">+ Line</button>`;
    return (s.entries || []).map((e, ei) => `<div class="rs-ent${e.hidden ? ' off' : ''}"><div class="rs-eh">${t(`sections.${si}.entries.${ei}.title`, e.title, 'b', s.key === 'projects' ? 'Project' : 'Organization')}${s.key === 'projects' ? t(`sections.${si}.entries.${ei}.date`, e.date, 'r i', 'Dates') : t(`sections.${si}.entries.${ei}.loc`, e.loc || '', 'r i', 'City, State')}${t(`sections.${si}.entries.${ei}.subtitle`, e.subtitle, 'i', s.key === 'education' ? 'Degree' : s.key === 'projects' ? 'Role / context' : 'Job title')}${s.key === 'projects' ? t(`sections.${si}.entries.${ei}.subdate`, e.subdate, 'r i', 'Right side of line 2') : t(`sections.${si}.entries.${ei}.date`, e.date, 'r i', 'Dates')}</div>
      ${(e.lines || []).length || s.key === 'education' ? `<textarea class="auto" rows="1" data-rs="sections.${si}.entries.${ei}.lines" data-rst="lines" aria-label="Detail lines" placeholder="Detail lines (no bullet), one per line">${esc((e.lines || []).join('\n'))}</textarea>` : ''}
      <ul class="rbs">${(e.bullets || []).map((b, bi) => bulletRow(si, ei, bi, b, e.bullets.length)).join('')}</ul>
      <div class="row"><button class="btn sm ghost" type="button" data-rsa="addb:${si}:${ei}">+ Bullet</button>${(() => { const h = (e.bullets || []).filter((b) => b.hidden).length; return h ? `<span class="sub">${h} hidden: not on the page</span>` : ''; })()}<span class="grow"></span><button class="btn sm ghost" type="button" data-rsa="hidee:${si}:${ei}">${e.hidden ? 'Show entry' : 'Hide entry'}</button><button class="btn sm ghost" type="button" aria-label="Move up" data-rsa="mve:${si}:${ei}:-1" ${ei ? '' : 'disabled'}>${IC.up}</button><button class="btn sm ghost" type="button" aria-label="Move down" data-rsa="mve:${si}:${ei}:1" ${ei < s.entries.length - 1 ? '' : 'disabled'}>${IC.down}</button><button class="btn sm ghost danger" type="button" data-rsa="dele:${si}:${ei}">Delete</button></div></div>`).join('');
  };
  return `<div class="rs-ed">
    <div class="rs-hd">${t('header.name', m.header.name, 'b', 'Name')}${t('header.contact', m.header.contact, '', 'Contact line')}
      <div class="row"><label class="field inline"><span>Font</span><select data-rs="font"><option value="serif" ${m.font !== 'sans' ? 'selected' : ''}>Times New Roman</option><option value="sans" ${m.font === 'sans' ? 'selected' : ''}>Arial</option></select></label>
        <label class="field inline"><span>Size</span><select data-rs="size" data-rst="num">${[11, 10.5, 10, 9.5].map((x) => `<option value="${x}" ${+m.size === x ? 'selected' : ''}>${x} pt</option>`).join('')}</select></label><label class="switch" title="Posting keywords that appear in your bullets are set in bold"><input type="checkbox" data-rs="boldKeywords" data-rst="bool" ${m.boldKeywords !== false ? 'checked' : ''}> Bold posting keywords</label><span class="sub">Export shrinks to fit one page, never below 10 pt.</span></div></div>
    ${m.sections.map((s, si) => { const open = ST.sec[s.id] !== false; return `<details class="rs-sec${s.hidden ? ' off' : ''}" data-sid="${s.id}" ${open ? 'open' : ''}><summary><b>${esc(s.title)}</b><span class="cnt">${s.kind === 'entries' ? plural((s.entries || []).length, 'entry', 'entries') : ''}${(() => { const h = (s.entries || []).reduce((n2, e) => n2 + (e.hidden ? 1 : 0) + (e.bullets || []).filter((b) => b.hidden).length, 0); return h ? ` · <span class="warn-t">${h} hidden</span>` : ''; })()}</span></summary>
      <div class="rs-sbody"><div class="row rs-shead">${t(`sections.${si}.title`, s.title, 'b', 'Section title')}<span class="grow"></span><button class="btn sm ghost" type="button" data-rsa="hides:${si}">${s.hidden ? 'Show section' : 'Hide section'}</button><button class="btn sm ghost" type="button" aria-label="Move up" data-rsa="mvs:${si}:-1" ${si ? '' : 'disabled'}>${IC.up}</button><button class="btn sm ghost" type="button" aria-label="Move down" data-rsa="mvs:${si}:1" ${si < m.sections.length - 1 ? '' : 'disabled'}>${IC.down}</button></div>${secBody(s, si)}</div></details>`; }).join('')}</div>`;
}
function rwPanel(b, kws) {
  const r = ST.rw, e = est('rewrite', 700, 260);
  const presets = [['stronger', 'Stronger verb and impact'], ['shorter', 'Shorter (one line)'], ['specific', 'More specific'], ['keyword', 'Work in a keyword']];
  return `<div class="rw"><div class="row">${presets.map(([k, l]) => `<button class="btn sm${r.mode === k ? ' primary' : ''}" type="button" data-rsa="rwm:${k}">${l}</button>`).join('')}</div>
    ${r.mode === 'keyword' ? `<label class="field"><span>Keyword</span><select id="rwKw">${kws.map((k) => `<option ${r.kw === k ? 'selected' : ''}>${esc(k)}</option>`).join('') || '<option value="">Analyze the job first</option>'}</select></label>` : ''}
    <input type="text" id="rwCustom" placeholder="Or your own instruction, e.g. mention the 7-person team" value="${esc(r.custom || '')}">
    <div class="row"><button class="btn sm primary" type="button" data-rsa="rwgo:${b.id}" ${ready('rewrite') && !r.busy ? '' : 'disabled'}>${r.busy ? 'Writing…' : 'Get 3 options'}</button><span class="sub">${costLabel('rewrite', e)}</span><button class="btn sm ghost" type="button" data-rsa="rw:${b.id}">Close</button></div>
    ${r.options ? `<ol class="rw-opts">${r.options.map((o, i) => { const iss = factIssues({ text: o.text, src: b.src }); return `<li><span>${esc(o.text)}${iss.length ? `<small class="src no fc" title="${esc(iss.join('\n'))}">⚠ ${esc(iss.join(' · '))}</small>` : ''}</span><button class="btn sm" type="button" data-rsa="rwuse:${b.id}:${i}">Use</button></li>`; }).join('')}</ol>` : ''}</div>`;
}
/* Compare the current page with a saved version, bullet by bullet: what was added, removed or reworded. */
function bulletMap(m) {
  const out = [];
  for (const s of (m && m.sections) || []) for (const e of s.entries || []) for (const b of e.bullets || []) if (!b.hidden && b.text) out.push({ sec: s.title, ent: (e.title || '').split(',')[0], text: b.text.trim() });
  for (const s of (m && m.sections) || []) for (const l of s.lines || []) if (!l.hidden && l.value) out.push({ sec: s.title, ent: l.label, text: l.value.trim() });
  return out;
}
function diffDialog(v) {
  const a = bulletMap(v.resume), b = bulletMap(ST.model), words = (t) => new Set(t.toLowerCase().match(/[a-z0-9+#.%]+/g) || []);
  const sim = (x, y) => { const A = words(x), B = words(y); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.max(A.size, B.size)); };
  const usedB = new Set(), rows = [];
  for (const x of a) {
    const same = b.findIndex((y, i) => !usedB.has(i) && y.text === x.text);
    if (same >= 0) { usedB.add(same); continue; }
    let best = -1, bs = 0.5; b.forEach((y, i) => { if (!usedB.has(i) && y.ent === x.ent) { const s2 = sim(x.text, y.text); if (s2 > bs) { bs = s2; best = i; } } });
    if (best >= 0) { usedB.add(best); rows.push(['chg', x, b[best]]); } else rows.push(['del', x]);
  }
  b.forEach((y, i) => { if (!usedB.has(i)) rows.push(['add', null, y]); });
  const lab = { chg: 'Reworded', del: 'Only in the version', add: 'Only on the current page' };
  return `<div class="mbody vdiff"><h2 id="dlgTitle">Compare with “${esc(v.label)}”</h2><p class="sub">${esc(new Date(v.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} · ${rows.length ? plural(rows.length, 'difference') : 'No differences in bullets or skills'}</p>
    ${rows.length ? `<ul class="vd-list">${rows.map(([k, x, y]) => `<li class="vd-${k}"><span class="chip tag">${lab[k]}</span> <b>${esc((x || y).ent)}</b>${k === 'chg' ? `<del>${esc(x.text)}</del><ins>${esc(y.text)}</ins>` : k === 'del' ? `<del>${esc(x.text)}</del>` : `<ins>${esc(y.text)}</ins>`}</li>`).join('')}</ul>` : ''}
    <div class="mfoot"><span class="spacer"></span><button class="btn ghost" type="button" data-close>Close</button><button class="btn primary" type="button" data-vrestore="${esc(v.id)}">Restore this version</button></div></div>`;
}
function versionsSel(doc) {
  const vs = (doc && doc.versions) || [];
  if (!vs.length) return '';
  return `<button class="btn sm ghost" type="button" data-jb="compare">Compare…</button><select id="rsVer" aria-label="Versions"><option value="">Versions (${vs.length})…</option>${vs.slice().reverse().map((v) => `<option value="${v.id}">${esc(new Date(v.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} · ${esc(v.label)}</option>`).join('')}</select>`;
}
function stepNav(J, prev, next) {
  const id = esc(encodeURIComponent(J.id)), L = { overview: 'Analyze', resume: 'Resume', letter: 'Cover letter', apply: 'Apply' };
  return `<nav class="stepnav" aria-label="Previous and next step">${prev ? `<a class="btn ghost" href="#job/${id}/${prev}">← ${L[prev]}</a>` : ''}<span class="grow"></span>${next.map(([k, primary, label]) => `<a class="btn${primary ? ' primary' : ''}" href="#job/${id}/${k}">${label || 'Next: ' + L[k]} →</a>`).join('')}</nav>`;
}
/* ---------- resume score (core.resumeScore) and its panel ---------- */
function rsScore(m, J) {
  if (!m) return null;
  const st = JOBS.get((J || JOB || {}).key) || {}, a = st.job && st.job.analysis;
  const flagged = []; for (const s of m.sections) for (const e of s.entries || []) for (const b of e.bullets || []) if (!b.hidden && needsCheck(b)) flagged.push(b.id);
  return C.resumeScore(m, { analysis: a || null, skills: P.data ? C.skillSet(P.data, I.S.settings) : null, layout: m === ST.model && ST.fit ? ST.fit : null, flagged });
}
const RS_BAND = (t) => t === null ? '' : t >= 85 ? 'Strong' : t >= 70 ? 'Good, a few fixes' : t >= 55 ? 'Needs work' : 'Weak';
function fixRef(f) {
  const r = f.ref || {};
  if (r.bullet) return `<button type="button" class="linkbtn" data-goto="bul:${esc(r.bullet)}">Go to the bullet →</button>`;
  if (r.action === 'fit1') return `<button type="button" class="linkbtn" data-jb="fit1">Fix it for me →</button>`;
  if (r.goto === 'skills') return `<button type="button" class="linkbtn" data-goto="rskills">Open Technical Skills →</button>`;
  if (r.entry && ST.model) { for (const sc of ST.model.sections) for (const e of sc.entries || []) if (e.id === r.entry && (e.bullets || [])[0]) return `<button type="button" class="linkbtn" data-goto="bul:${esc(e.bullets[0].id)}">Go to the entry →</button>`; }
  if (r.goto === 'basics') return `<button type="button" class="linkbtn" data-goto="fld:basics.linkedin">Profile › Basics →</button>`;
  return '';
}
function scorePanel() {
  const r = rsScore(ST.model, JOB); if (!r) return '';
  const top = r.fixes.slice(0, 6);
  return `<div class="rscore"><div class="kw-head"><span class="ring sm ${r.total === null ? '' : I.band(r.total)}" style="--p:${r.total || 0}"><span>${r.total === null ? '–' : r.total}</span></span>
      <div><b>Resume score ${r.total === null ? '' : r.total} <small>${esc(RS_BAND(r.total))}</small></b><div class="sub">How ready this page is for this posting: wording and evidence only. Your fit for the job is on the Analyze step.</div></div></div>
    <details class="rs-break" ${r.total !== null && r.total >= 90 ? '' : 'open'}><summary><b>Breakdown</b> <span class="sub">${r.parts.filter((x) => x.v !== null).map((x) => `${esc(x.label)} ${Math.round(x.v * 100)}`).join(' · ')}</span></summary>
    <ul class="rs-parts">${r.parts.filter((x) => x.v !== null).map((x) => `<li><span class="rs-pl">${esc(x.label)} <small>${x.weight}</small></span><span class="bar"><span style="width:${Math.round(x.v * 100)}%"></span></span><span class="rs-pv">${Math.round(x.v * 100)}</span><span class="sub rs-pn">${esc(x.note)}</span></li>`).join('')}</ul></details>
    ${(() => { const k = kwPanel(true); return k ? `<details class="rs-kwd"><summary><b>Posting keywords</b> <span class="sub">what the Match part counts, and what you could add to your Profile</span></summary>${k}</details>` : ''; })()}
    ${top.length ? `<details class="rs-fixes" open><summary><b>Biggest gains</b> <span class="sub">${r.fixes.length} fix${r.fixes.length > 1 ? 'es' : ''} in all</span></summary><ol>${top.map((f) => `<li><span class="chip tag">${esc(f.k)}</span> ${esc(f.text)}${f.ref && f.ref.text ? `<span class="sub fix-q">“${esc(f.ref.text.length > 90 ? f.ref.text.slice(0, 88) + '…' : f.ref.text)}”</span>` : ''} ${fixRef(f)}</li>`).join('')}</ol></details>` : '<p class="sub pos">Nothing left to fix.</p>'}</div>`;
}

/* Bullets to check, each with what is wrong and buttons to the bullet and to the Profile fact behind it. */
function checkList() {
  const items = [];
  for (const s of ST.model.sections) for (const e of s.entries || []) for (const b of e.bullets || []) if (!b.hidden && needsCheck(b)) items.push({ b, e, s });
  if (!items.length) return '';
  return `<div class="notice warn fix"><div class="fix-b"><b>${plural(items.length, 'bullet needs', 'bullets need')} checking before you send this</b><span class="sub">Each states something (a number, a tool, a “led”) that its Profile facts don’t show. If the bullet is wrong, edit it. If it is true, add the missing fact to your Profile so it is backed up.</span>
    <ul class="fixlist">${items.map(({ b, e }) => { const iss = factIssues(b), src = String(b.src || '').split(',').map((x) => x.trim()).find((x) => findPoint(x)), pe = profileEntryOf(e);
      return `<li><span class="fix-w"><b>${esc((e.title || '').split(',')[0])}</b><span class="fix-t">${esc(b.text)}</span><span class="sub warn-t">${esc(iss.length ? iss.join(' · ') : !b.src ? 'No Profile fact is cited' : src ? 'Claude could not fully match this to its source when writing it. Compare it with the source fact; if it is true, press “It’s true”' : 'Its cited fact is unconfirmed or no longer in your Profile')}</span></span>
        <span class="fix-a">${!iss.length && src && b.unverified ? `<button class="btn sm" type="button" data-rsa="okb:${esc(b.id)}">It’s true</button>` : ''}<button class="btn sm${!iss.length && src ? ' ghost' : ''}" type="button" data-goto="bul:${esc(b.id)}">Edit bullet</button>${src ? `<button class="btn sm ghost" type="button" data-goto="pt:${esc(src)}">Source fact</button>` : ''}${pe ? `<button class="btn sm ghost" type="button" data-goto="fact:${esc(pe.id)}">+ Fact in ${esc(entryName(secOfEntry(pe), pe))}</button>` : ''}</span></li>`; }).join('')}</ul></div></div>`;
}
function studioPanel(J, st) {
  const doc = st.resume, a = st.job && st.job.analysis;
  const profChars = P.data ? JSON.stringify(P.data).length * 0.55 : 12000;
  const eT = est('tailor', profChars / 3.6 + 2200 + (AI.status && AI.status.config.includePosting ? 1600 : 0), 2600);
  const busy = ST.busy === 'tailor', canTailor = ready('tailor') && a && !ST.busy;
  const why = !ready('tailor') ? notReadyTip('tailor') : !a ? 'Analyze the posting first (step 1)' : '';
  if (!ST.model) {
    return `<section class="panel rs-start" id="studio"><h2>Build the resume for this job</h2>
      ${!P.data || !P.data.basics.name ? '<div class="notice warn"><span>Your Profile is empty, and it is the only source of facts. <a href="#profile">Fill it in first →</a></span></div>' : ''}
      <div class="choices">
        <div class="choice rec"><div class="ch-h"><b>Tailor with Claude</b><span class="chip v-yes">Recommended</span></div>
          <p>Writes from your Profile’s confirmed facts only, covers this posting’s keywords where they are true, and follows your ${esc(J.track)} playbook. Every bullet shows its source.</p>
          <div class="ch-act"><button class="btn primary" type="button" data-jb="tailor" ${canTailor ? '' : 'disabled'}>${busy ? `Tailoring… about ${usesPro('tailor') ? '1–2 min' : '30–60 s'}` : 'Tailor with Claude'}</button><span class="sub">${why ? esc(why) : costLabel('tailor', eT)}</span></div>
          ${!a ? `<a class="linkbtn" href="#job/${esc(encodeURIComponent(J.id))}">Go to step 1 →</a>` : ''}</div>
        <div class="choice"><div class="ch-h"><b>Start from your master resume</b><span class="chip tag">Free</span></div>
          <p>Your Profile’s resume bullets, ordered for ${esc(J.track)} and fitted to one page. Instant; you edit it yourself. You can still tailor it with Claude later.</p>
          <div class="ch-act"><button class="btn" type="button" data-jb="base" ${ST.busy ? 'disabled' : ''}>Use master resume</button><span class="sub">no Claude call</span></div></div>
      </div></section>${stepNav(J, 'overview', [])}`;
  }
  const n = ST.notes, unv = ST.model.sections.reduce((c, s) => c + (s.entries || []).reduce((m, e) => m + (e.bullets || []).filter((b) => needsCheck(b) && !b.hidden).length, 0), 0);
  const origin = isTailored() ? `<span class="chip v-yes">Tailored</span><span class="sub">${esc(n.model)}${n.cost ? ' · ' + money(n.cost) : ''}</span>` : `<span class="chip tag">Master resume</span><span class="sub">${a ? 'not tailored to this posting yet' : 'from your Profile'}</span>`;
  /* Edit on the left, the page on the right (always in view). The left side does one thing at a time:
     Edit the page, Review it (score, checks, Claude's notes), or Ask Claude. Narrow screens add a Page tab. */
  const nq = (n && n.questions || []).length, rs = rsScore(ST.model, J);
  const pane = ST.pane === 'page' && !matchMedia('(max-width: 1080px)').matches ? 'edit' : (ST.pane === 'ask' && !a ? 'edit' : ST.pane || 'edit');
  const tab = (k, label, badge, tone) => `<button type="button" role="tab" id="rst-${k}" aria-controls="rsp-${k}" aria-selected="${pane === k}" tabindex="${pane === k ? 0 : -1}" data-rspane="${k}" class="${k === 'page' ? 'rs-tab-page' : ''}">${label}${badge !== '' && badge !== undefined ? ` <span class="rs-badge ${tone || ''}">${badge}</span>` : ''}</button>`;
  const reviewBadge = unv + nq ? [unv + nq, 'warn issue'] : rs && rs.total !== null ? [rs.total, rs.total >= 80 ? 'good' : 'warn'] : ['', ''];
  return `<section class="panel rs v3" id="studio">
    <header class="rs-head">
      <div class="rs-status"><div class="row">${origin}<span id="rsState" class="savestate">${doc && doc.updatedAt ? 'Saved' : ''}</span></div>${readiness(doc, J)}</div>
      <div class="rs-actions">${versionsSel(doc)}<button class="btn sm ghost" type="button" data-jb="version">Save version</button><button class="btn sm ghost" type="button" data-jb="base" title="Replace this draft with your master resume (this draft is kept as a version)">Reset to master</button>
        ${isTailored() || !a ? `<button class="btn sm${isTailored() ? '' : ' primary'}" type="button" data-jb="tailor" ${canTailor ? '' : 'disabled'} title="${esc(why || costLabel('tailor', eT).replace(/<[^>]+>/g, ''))}">${busy ? `Tailoring… ${usesPro('tailor') ? '1–2 min' : '30–60 s'}` : isTailored() ? 'Update for this posting' : 'Tailor with Claude'}</button>` : ''}</div>
    </header>
    ${a && !isTailored() ? `<div class="tailor-nudge"><div><b>This is your master resume, not tailored to this posting yet.</b><span class="sub">Tailoring edits this page for this ${esc(J.track || '')} role: it keeps your layout and wording and adds the posting’s keywords only where they are true. Your current draft is kept as a version.</span></div>
      <div class="tn-act"><button class="btn primary" type="button" data-jb="tailor" ${canTailor ? '' : 'disabled'}>${busy ? `Tailoring… about ${usesPro('tailor') ? '1–2 min' : '30–60 s'}` : 'Tailor with Claude'}</button><span class="sub">${why ? esc(why) : costLabel('tailor', eT)}</span></div></div>` : ''}
    <div class="rs-split" data-pane="${pane}">
      <div class="rs-left">
        <div class="rs-tabbar"><div class="rs-seg rs-tabs" role="tablist" aria-label="Resume tools">${tab('edit', 'Edit')}${tab('review', 'Review', reviewBadge[0], reviewBadge[1])}${a ? tab('ask', 'Ask Claude') : ''}${tab('page', 'Page')}</div></div>
        <div class="rs-pane" id="rsp-edit" role="tabpanel" aria-labelledby="rst-edit" ${pane === 'edit' ? '' : 'hidden'}>
          ${unv || nq ? `<button type="button" class="rs-flag" data-rspane="review"><span class="rs-badge warn issue">${unv + nq}</span> ${[unv ? plural(unv, 'bullet') + ' not backed by your Profile' : '', nq ? plural(nq, 'question') + ' from Claude' : ''].filter(Boolean).join(' · ')}<span class="grow"></span>Review →</button>` : ''}
          <div class="rs-editw" id="rsEditW">${rsEditor(ST.model)}</div>
        </div>
        <div class="rs-pane" id="rsp-review" role="tabpanel" aria-labelledby="rst-review" ${pane === 'review' ? '' : 'hidden'}>
          <div id="rsScore">${scorePanel()}</div>
          <div id="rsTodo">${unv ? checkList() : ''}${nq ? questionList(n.questions) : ''}</div>
          ${n && (n.changes || []).length ? `<details class="why rs-notes"><summary>What Claude changed (${n.changes.length})</summary><ul class="jb-ul">${n.changes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
            ${(n.keywordsSkipped || []).length ? `<p class="sub">Left out (not supported by your Profile): ${n.keywordsSkipped.map(esc).join(', ')}. Have one of them? Add it in <button type="button" class="linkbtn" data-goto="sec:skills">Profile › Skills</button>, then update.</p>` : ''}</details>` : ''}
        </div>
        ${a ? `<div class="rs-pane" id="rsp-ask" role="tabpanel" aria-labelledby="rst-ask" ${pane === 'ask' ? '' : 'hidden'}>${revisePanel(J, a, canTailor, why)}</div>` : ''}
      </div>
      <aside class="rs-right" aria-label="The page"><div class="rs-sticky">
        <div class="rs-ptool"><span id="rsFit">${fitText()}</span><span class="grow"></span>
          <div class="rs-seg sm rs-zoom" role="group" aria-label="Zoom"><button type="button" data-rszoom="fit" aria-pressed="${ST.zoom !== 'actual'}">Fit</button><button type="button" data-rszoom="actual" aria-pressed="${ST.zoom === 'actual'}">100%</button></div>
          <div class="dlpair" role="group" aria-label="Download"><span class="dlp-l" aria-hidden="true">${IC.dl}</span><button type="button" data-jb="docx">.docx</button><button type="button" data-jb="pdf">.pdf</button></div><button class="btn sm ghost" type="button" data-jb="copy">Copy text</button></div>
        <div id="rsPageNote">${pageNote()}</div>
        <div class="rs-canvas${ST.zoom === 'actual' ? ' actual' : ''}"><div id="rsPaper" class="rs-paper">${paper(ST.model, ST.fit && ST.fit.size)}</div></div>
        <p class="sub pv-tip">Click a line on the page to edit it.</p></div></aside>
    </div></section>
    ${stepNav(J, 'overview', [['apply', false, 'Skip to Apply'], ['letter', true]])}`;
}
function rJob() {
  const id = curId(); const J = resolveJob(id); JOB = J;
  if (!J) return `<div class="panel"><p class="empty">This job is no longer in your listings or applications. <a href="#inbox">Back to New listings</a></p></div>`;
  let st = JOBS.get(J.key);
  if (!st) { loadJob(J); st = JOBS.get(J.key); }
  if (ST.key !== J.key) { ST.key = J.key; ST.model = null; ST.notes = null; ST.fit = null; ST.rw = null; ST.paste = false; ST.pasteText = ""; ST.sec = {}; ST.trimmed = null; }
  if (!ST.model && st.resume && st.resume.current) { ST.model = I.clone(st.resume.current); ST.notes = st.resume.notes || null; if (normResume(ST.model)) scheduleSave(); scheduleFit(); }
  const a = st.job && st.job.analysis, app = J.app;
  const appliedOn = app ? ((app.history || []).find((h) => h.s === 'applied') || {}).d || '' : '';
  const head = `<div class="jb-head"><div class="jb-info">${J.track ? `<span class="chip tag">${esc(J.track)}</span>` : ''}${J.location ? `<span>${esc(J.location.split('; ').slice(0, 3).join('; '))}</span>` : ''}${J.posted ? `<span>Posted ${I.ago(J.posted)}</span>` : ''}${J.deadline ? `<span>Deadline ${I.fmt(J.deadline)}</span>` : ''}${app ? I.stChip(app.status) : ''}</div>
    <div class="row">${I.link(J.url, 'Posting ↗', 'btn sm ghost')}${app ? `<button class="btn sm" type="button" data-open="${app.id}">Edit application</button>` : `<button class="btn sm" type="button" data-trackl="${esc(J.l.id)}" title="Save to Applications">Save</button><button class="btn sm" type="button" data-appliedl="${esc(J.l.id)}" title="Add to Applications as applied today">Applied ✓</button>`}</div></div>`;
  if (st.loading) return `<div class="jb">${head}<div class="panel"><p class="empty">Loading…</p></div></div>`;
  if (LT.key !== J.key) { LT.key = J.key; LT.model = null; LT.notes = null; LT.fit = null; LT.rw = null; LT.showForm = false; }
  if (!LT.model && st.letter && st.letter.current) { LT.model = I.clone(st.letter.current); LT.notes = st.letter.notes || null; letterFit(); }
  const tab = jobTab();
  const f = a ? fitOf(J, a) : null;
  const ks = a && ST.model ? C.keywordScore(resumeText(ST.model), a.keywords || []).score : null;
  /* Each step is done, started (a draft that still needs work) or not started. A master-resume draft counts as
     started, not done: the step is done once it is tailored to this posting or you have exported it. */
  /* Exported means this exact content was exported (an older export of an earlier draft does not count). */
  const exported = (d) => !!(d && d.state && d.state.exported);
  const rState = !ST.model ? '' : isTailored() || exported(st.resume) ? 'done' : 'part';
  const lState = !LT.model ? '' : (LT.notes && LT.notes.model) || exported(st.letter) ? 'done' : 'part';
  const steps = [
    ['overview', 'Analyze', a ? (st.job.analysisState === 'stale' ? 'part' : 'done') : '', a ? (st.job.analysisState === 'stale' ? 'Posting changed · re-analyze' : f.verdict === 'blocked' ? 'Not eligible' : f.total === null ? 'Fit: not enough info' : `Fit ${f.total}`) : J.l ? `Priority ${J.l.total}` : 'Not analyzed'],
    ['resume', 'Resume', rState, ST.model ? `${isTailored() ? 'Tailored' : exported(st.resume) ? 'Master · exported' : 'Master draft · not tailored'}${(() => { const r = rsScore(ST.model, J); return r && r.total !== null ? ` · score ${r.total}` : ks !== null ? ` · ${ks}% keywords` : ''; })()}` : 'Not started'],
    ['letter', 'Cover letter', lState, LT.model ? (LT.notes && LT.notes.model ? 'Written with Claude' : 'Draft') : 'Optional'],
    ['apply', 'Apply', appliedOn ? 'done' : '', appliedOn ? `Applied ${I.fmt(appliedOn)}` : ST.model ? 'Ready when you are' : 'After the resume']];
  const SR = { done: ', done', part: ', in progress', '': '' };
  const nav = `<nav class="jsteps" aria-label="Application steps"><ol>${steps.map(([k, l, s, sub], i) => `<li><a href="#job/${esc(encodeURIComponent(J.id))}${k === 'overview' ? '' : '/' + k}" class="${s}" ${tab === k ? 'aria-current="step"' : ''}><span class="sn" aria-hidden="true">${s === 'done' ? '✓' : i + 1}</span><span class="stx"><b>${l}</b><small>${esc(sub)}</small></span><span class="sr">${SR[s]}</span></a></li>`).join('')}</ol></nav>`;
  const body = tab === 'resume' ? studioPanel(J, st) : tab === 'letter' ? letterPanel(J, st) : tab === 'apply' ? applyPanel(J, st, appliedOn)
    : `${changeBanner(st.job)}${staleBanner(st.job)}${pasteBox()}${a ? verdict(J, a, f) : stepHero(J)}<div class="jb-grid">${matchPanel(J, a)}${factsPanel(J, a, st.job || {})}</div>`;
  return `<div class="jb">${head}${nav}${st.error ? `<div class="err">${esc(st.error)}</div>` : ''}${body}</div>`;
}
/* Step 4: everything needed to submit, in one place. */
const fileBase = (tpl, J) => (tpl || 'Resume_[Company]').replace('[Company]', J.company.replace(/[^A-Za-z0-9]+/g, ''));
const ymLong = (ym) => { const m = /^(\d{4})-(\d{2})/.exec(ym || ''); return m ? new Date(+m[1], +m[2] - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : ym || ''; };
function applyPanel(J, st, appliedOn) {
  const p = P.data || normProfile(null), pr = p.preferences, b = p.basics, a = st.job && st.job.analysis, id = esc(encodeURIComponent(J.id));
  const rs = ST.model ? rsScore(ST.model, J) : null, rIssues = rs && rs.total !== null && rs.total < 80 ? rs.fixes.length : 0;
  const unv = ST.model ? ST.model.sections.reduce((c, s) => c + (s.entries || []).reduce((m, e) => m + (e.bullets || []).filter((x) => needsCheck(x) && !x.hidden).length, 0), 0) : 0;
  const ks = a && ST.model ? C.keywordScore(resumeText(ST.model), a.keywords || []).score : null;
  const pages = (f) => !f ? '' : f.pages === 1 ? `<span class="pos">One page</span>` : `<span class="neg">${f.pages} pages</span>`;
  const doc = (label, file, model, state, warn, act, edit, make) => `<div class="kit-row${model ? (warn ? ' part' : '') : ' empty'}"><span class="kit-ic" aria-hidden="true">${model ? (warn ? '!' : '✓') : '○'}</span>
    <div class="kit-b"><b>${label}</b><span class="sub">${model ? `${esc(file)} · ${state}` : state}</span>${warn && warn.length ? `<ul class="kit-warn">${warn.map((w) => `<li>${w}</li>`).join('')}</ul>` : ''}</div>
    <div class="row">${model ? `<div class="dlpair" role="group" aria-label="Download"><span class="dlp-l" aria-hidden="true">${IC.dl}</span><button type="button" data-${act}="docx">.docx</button><button type="button" data-${act}="pdf">.pdf</button></div><a class="btn sm ghost" href="#job/${id}/${edit}">Edit</a>` : `<a class="btn sm" href="#job/${id}/${edit}">${make} →</a>`}</div></div>`;
  const firstUnv = unv ? (() => { for (const s of ST.model.sections) for (const e of s.entries || []) for (const x of e.bullets || []) if (!x.hidden && needsCheck(x)) return x.id; return ''; })() : '';
  const rWarn = [unv ? `${plural(unv, 'bullet needs', 'bullets need')} checking <button type="button" class="linkbtn" data-goto="bul:${esc(firstUnv)}">Show me →</button>` : '',
    rIssues ? `Resume score ${rs.total}: ${plural(rIssues, 'fix', 'fixes')} would raise it <a class="linkbtn" href="#job/${id}/resume">See them →</a>` : '',
    a && !isTailored() ? `Not tailored to this posting yet: tailoring usually raises the keyword match <a class="linkbtn" href="#job/${id}/resume">Tailor it →</a>` : ''].filter(Boolean);
  const answers = [['Work authorization', pr.authStatement], ['Will you need sponsorship?', pr.needsSponsorship === null || pr.needsSponsorship === undefined ? '' : pr.needsSponsorship ? 'Yes' : 'No'], ['Graduation', ymLong(pr.graduation)], ['Availability', (p.coverLetter || {}).availability || pr.availability],
    ['Email', b.email], ['Phone', b.phone], ['LinkedIn', b.linkedin], ['GitHub', b.github], ['Website', b.website]].filter(([, v]) => v);
  const sv = submittedOf(st.resume);
  const kit = `<section class="panel"><h2>Your application kit</h2>
    ${sv ? `<div class="kit-row"><span class="kit-ic" aria-hidden="true">✓</span><div class="kit-b"><b>Resume you submitted</b><span class="sub">frozen ${esc(when(sv.at))} when you marked this job applied · keep it for interviews</span></div><div class="row"><span class="dlpair" role="group" aria-label="Download the submitted resume"><span class="dlp-l" aria-hidden="true">${IC.dl}</span><button type="button" data-subdl="docx">.docx</button><button type="button" data-subdl="pdf">.pdf</button></span></div></div>` : ''}
    ${doc('Resume', fileBase(p.resumeFileName, J) + '.docx', ST.model, `${isTailored() ? 'tailored for ' + esc(J.company) : 'master resume'} · ${pages(ST.fit)}${(() => { const r = rsScore(ST.model, J); return r && r.total !== null ? ` · resume score ${r.total}` : ''; })()}${ks !== null ? ` · ${ks}% keywords` : ''}`, rWarn, 'jb', 'resume', 'Build the resume')}
    ${doc('Cover letter', fileBase(p.coverLetterFileName || 'Cover_Letter_[Company]', J) + '.docx', LT.model, LT.model ? `${LT.notes && LT.notes.model ? 'written with Claude' : 'draft'} · ${pages(LT.fit)}` : 'Optional. Send one when the posting asks for it, or to explain a specific interest.', [], 'lt', 'letter', 'Write one')}</section>`;
  const copyRow = (k, v, multi) => `<dt>${esc(k)}</dt><dd${multi ? ' class="multi"' : ''}><span>${esc(v)}</span><button class="btn sm ghost" type="button" data-jcopy="${esc(v)}" aria-label="Copy ${esc(k)}">Copy</button></dd>`;
  const exp = experienceAnswers(J);
  const qa = `<section class="panel"><h2>Answers for the application form <small>from your Profile · copy and paste</small></h2>
    ${answers.length ? `<dl class="qa">${answers.map(([k, v]) => copyRow(k, v)).join('')}</dl>` : '<p class="empty">Add your contact details and work authorization answer in your Profile.</p>'}
    ${pr.authStatement ? '' : '<p class="sub">Tip: write how you answer work-authorization questions in <button type="button" class="linkbtn" data-goto="fld:preferences.authStatement">Profile › What I am looking for</button> so it is here every time.</p>'}
    <h3 class="qa-h">Professional experience <small>${esc(exp.from)}</small></h3>
    ${exp.items.length ? exp.items.map((x) => `<div class="qa-exp"><div class="qa-exp-h"><b>${esc(x.head)}</b><button class="btn sm" type="button" data-jcopy="${esc(x.all)}" aria-label="Copy the whole entry">Copy all</button></div>
      <dl class="qa">${[['Company', x.company], ['Job title', x.title], ['Location', x.location], ['Start', x.start], ['End', x.end]].filter(([, v]) => v).map(([k, v]) => copyRow(k, v)).join('')}${x.desc ? copyRow('Description', x.desc, true) : ''}</dl></div>`).join('')
      : `<p class="empty">${ST.model ? 'This resume has no Professional Experience entries.' : 'Build the resume first: this section copies its latest Professional Experience.'}</p>`}</section>`;
  const submit = appliedOn
    ? `<section class="panel submit done"><span class="kit-ic" aria-hidden="true">✓</span><div><b>Applied ${esc(I.fmt(appliedOn))}</b><span class="sub">The tracker reminds you to follow up after ${+I.S.settings.followUpDays || 14} days of silence.</span></div><span class="grow"></span><button class="btn sm" type="button" data-open="${J.app.id}">Edit application</button></section>`
    : `<section class="panel submit"><div><b>Submit</b><span class="sub">Open the posting, apply with the files above, then mark it here so reminders and your daily goal count it.</span></div><span class="grow"></span>
      ${I.link(J.url, 'Open the posting ↗', 'btn')}${J.app ? `<button class="btn primary" type="button" data-applied-app="${J.app.id}">I applied ✓</button>` : `<button class="btn primary" type="button" data-appliedl="${esc(J.l.id)}">I applied ✓</button>`}</section>`;
  return `<div class="apply"><div class="apply-main">${kit}${submit}</div>${qa}</div>${stepNav(J, 'letter', [])}`;
}
/* The latest resume's Professional Experience, ready for application forms: structured fields from the Profile
   entry it was written from, and the bullets exactly as they are on the current page. */
function experienceAnswers(J) {
  const m = ST.model, out = { items: [], from: '' };
  if (!m) return out;
  const doc = (JOBS.get(J.key) || {}).resume;
  out.from = `from the latest resume${doc && doc.updatedAt ? ' (' + new Date(doc.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ')' : ''} · copy each field, or the whole entry`;
  const sec = m.sections.find((s) => s.key === 'experience' && !s.hidden);
  for (const e of (sec && sec.entries) || []) {
    if (e.hidden) continue;
    const pe = profileEntryOf(e) || {}, bl = (e.bullets || []).filter((b) => !b.hidden && b.text).map((b) => b.text.trim());
    const company = pe.org || (e.title || '').split(',')[0], location = pe.location || e.loc || '';
    const dates = e.subdate || e.date || [pe.start, pe.end].filter(Boolean).join(' – '), parts = dates.split(/\s+[–-]\s+/);
    const start = pe.start || parts[0] || '', end = pe.start ? (pe.end || 'Present') : parts[1] || '';
    const title = [pe.title, pe.team].filter(Boolean).join(', ') || e.subtitle || '';
    const desc = bl.map((x) => '• ' + x).join('\n');
    out.items.push({ head: [pe.title || e.subtitle, company].filter(Boolean).join(' · '), company, title, location, start, end, desc,
      all: [[title, company].filter(Boolean).join(', '), [location, dates].filter(Boolean).join(' | '), desc].filter(Boolean).join('\n') });
  }
  return out;
}
function changeBanner(job) {
  if (!job) return '';
  if (job.closedAt) return `<div class="notice warn"><span><b>This posting looks closed</b> (checked ${esc(I.fmt(job.closedAt))}: ${esc(job.closedWhy || 'page gone')}). Check the company’s site before spending time on it.</span></div>`;
  if (job.changedAt && job.analysis) return `<div class="notice warn"><span><b>The posting changed</b> on ${esc(I.fmt(job.changedAt))} since you analyzed it${job.changeSummary ? ` (${esc(job.changeSummary)})` : ''}. Re-analyze so the facts, match and keywords are current.</span><button class="btn sm primary" type="button" data-jb="reanalyze">Re-analyze · ${usesPro('analyze') ? 'no API cost' : '≈ $0.001'}</button></div>`;
  return '';
}
const jobTab = () => { const t = location.hash.split('/')[2]; return ['resume', 'letter', 'apply'].includes(t) ? t : 'overview'; };

/* ---------- free checklists from the Rice CCD guides ---------- */
const WEAK_START = /^(responsible|duties|tasks?|was|were|i|my|the|a|an|worked on|helped with|in charge)\b/i;
function resumeChecks(m, f) {
  const out = [], bullets = [], entries = [];
  for (const sec of m.sections) {
    if (sec.hidden || sec.kind !== 'entries') continue;
    const firsts = {};
    for (const e of sec.entries || []) {
      if (e.hidden) continue;
      const bs = (e.bullets || []).filter((b) => !b.hidden && (b.text || '').trim());
      if (sec.key !== 'education') entries.push({ e, n: bs.length, sec });
      for (const b of bs) {
        const w = (b.text.trim().split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z-]/g, '');
        bullets.push({ b, e, w, present: /present/i.test((e.date || '') + (e.subdate || '')) });
        (firsts[w] = firsts[w] || []).push(b);
      }
    }
    for (const [w, bs] of Object.entries(firsts)) if (bs.length > 1 && w) out.push({ ok: false, k: 'verbs', t: `“${w[0].toUpperCase() + w.slice(1)}” starts ${bs.length} bullets in ${sec.title}`, tip: 'Vary your action verbs within a section.' });
  }
  const pages = f ? f.pages : null;
  out.unshift({ ok: pages === 1, k: 'page', t: pages === null ? 'Checking page length…' : pages === 1 ? `One page at ${f.size} pt` : `${pages} pages at 10 pt`, tip: 'One page preferred; body text at least 10 pt.' });
  const off = entries.filter((x) => x.n && (x.n > 5 || (x.n < 2 && x.sec.key !== 'leadership')));
  out.push({ ok: !off.length, k: 'count', t: off.length ? `${off.map((x) => `${(x.e.title || '').split(',')[0]} (${x.n})`).join(', ')}` : 'Every entry has 2–4 bullets', tip: 'Aim for about 2–4 statements per position.' });
  const weak = bullets.filter((x) => WEAK_START.test(x.b.text.trim()));
  out.push({ ok: !weak.length, k: 'verb', t: weak.length ? `${plural(weak.length, 'bullet')} don’t start with an action verb` : 'Bullets start with action verbs', tip: 'Action verb + core content + result, purpose or impact.' });
  const nums = bullets.filter((x) => /\d/.test(x.b.text)).length;
  out.push({ ok: !bullets.length || nums / bullets.length >= 0.4, k: 'nums', t: `${nums} of ${bullets.length} bullets have a number`, tip: 'Quantify results where your profile has the numbers (never estimate).' });
  const tense = bullets.filter((x) => x.present && /ed$/.test(x.w));
  out.push({ ok: !tense.length, k: 'tense', t: tense.length ? `${plural(tense.length, 'bullet')} in current roles use past tense` : 'Tense matches each role’s dates', tip: 'Present tense for current roles, past tense for finished ones.' });
  const long = bullets.filter((x) => x.b.text.length > 220);
  out.push({ ok: !long.length, k: 'long', t: long.length ? `${plural(long.length, 'bullet')} longer than two lines` : 'Bullets are concise', tip: 'Short, concise phrases; at most two lines.' });
  out.push({ ok: /linkedin/i.test(m.header.contact || ''), k: 'li', t: /linkedin/i.test(m.header.contact || '') ? 'LinkedIn in the header' : 'No LinkedIn in the header', tip: 'Name, city/state, phone, email and LinkedIn on one line.' });
  return out;
}
function checksBox(items, title) {
  const bad = items.filter((x) => !x.ok).length;
  return `<details class="checks-box" ${bad ? 'open' : ''}><summary><b>${title}</b> <span class="${bad ? 'warn-t' : 'pos'}">${bad ? plural(bad, 'item') + ' to look at' : 'All checks pass'}</span> <span class="sub">Rice CCD guide · free</span></summary>
    <ul class="ck">${items.map((x) => `<li class="${x.ok ? 'ok' : 'no'}"><span class="ck-i" aria-hidden="true">${x.ok ? '✓' : '!'}</span><span>${esc(x.t)}${x.ok ? '' : `<span class="sub">${esc(x.tip)}</span>`}</span></li>`).join('')}</ul></details>`;
}
const CLICHE = /i am writing to (express|apply)|passionate|perfect fit|esteemed|to whom it may concern|dream (company|job)/i;
function letterChecks(m, f, company) {
  const paras = (m.paragraphs || []).filter((x) => !x.hidden).map((x) => (typeof x === 'string' ? x : x.text) || '').filter((x) => x.trim()), all = paras.join(' ');
  const words = all.split(/\s+/).filter(Boolean).length;
  const sents = all.split(/(?<=[.!?])\s+/).filter((x) => x.trim());
  const iStart = sents.filter((x) => /^I\b/.test(x.trim())).length;
  const last = paras.slice(-2).join(' ');
  return [
    { ok: f ? f.pages === 1 : false, t: f ? (f.pages === 1 ? `One page at ${f.size} pt` : `${f.pages} pages: shorten a paragraph`) : 'Checking page length…', tip: 'No more than one page.' },
    { ok: true, t: 'Same header and font as your resume', tip: '' },
    { ok: !!(m.salutation || '').trim() && !/whom it may concern/i.test(m.salutation), t: (m.salutation || '').trim() ? `Addressed: “${m.salutation.trim()}”` : 'No salutation', tip: 'Address the hiring manager or recruiter by name when you can; never “To whom it may concern”.' },
    { ok: !!(m.re || '').trim(), t: (m.re || '').trim() ? 'Names the position (Re: line)' : 'No Re: line naming the position', tip: 'Reference the position you are applying for.' },
    { ok: !!company && new RegExp(company.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(all), t: `Mentions ${company}${new RegExp((company || '-').split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(all) ? '' : ': not yet'}`, tip: 'Say specifically why this organization and role, not just that it is “excellent”.' },
    { ok: /\d/.test(all), t: /\d/.test(all) ? 'Gives specific, quantified examples' : 'No numbers in the examples', tip: 'Give specific examples of past accomplishments.' },
    { ok: !sents.length || iStart / sents.length <= 0.4, t: `${iStart} of ${sents.length} sentences start with “I”`, tip: 'Vary sentence structure instead of starting each sentence with “I”.' },
    { ok: /interview|discuss|conversation|speak with|talk with|meet/i.test(last), t: /interview|discuss|conversation|speak with|talk with|meet/i.test(last) ? 'Asks for a conversation or interview' : 'Closing doesn’t mention an interview', tip: 'Indicate your desire and availability for an interview.' },
    { ok: words >= 200 && words <= 420, t: `${words} words`, tip: 'About 250–380 words fits one page comfortably.' },
    { ok: !CLICHE.test(all + ' ' + (m.salutation || '')), t: CLICHE.test(all) ? 'Contains a stock phrase' : 'No stock phrases', tip: 'Replace phrases like “passionate” or “perfect fit” with specifics.' },
  ];
}

/* ---------- cover letter ---------- */
const LT = { key: null, model: null, notes: null, fit: null, fitT: null, saveT: null, rw: null, form: {} };
const today = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
function letterHeader() { const b = P.data.basics; return { name: b.name, contact: contactLine(b) }; }
/* "Master of Computer Science, Example University, expected May 2028" from your Profile (placeholders when not set). */
function whoLine() {
  const p = P.data || {}, e = (p.education || [])[0] || {}, g = (p.preferences || {}).graduation;
  return [e.degree || 'your degree', e.org || 'your school', g ? 'expected ' + ymLong(g) : 'graduation date'].join(', ');
}
function blankLetter(J) {
  const cl = P.data.coverLetter || {};
  return { v: 1, kind: 'letter', font: (ST.model && ST.model.font) || 'serif', size: 11, header: letterHeader(), date: today(), recipient: ['Hiring Manager', J.company], re: `Re: ${J.role}`,
    salutation: `Dear ${J.company} Hiring Team,`, paragraphs: [
      `[Introduction: the position, who you are (${esc(whoLine())}), and the two or three qualifications that fit.]`,
      `[Body: one experience with its numbers, tied to a requirement in the posting.]`,
      `[Body: a second experience, and why ${J.company} and this team.]`,
      `[Closing: interest, availability${cl.availability ? ' (' + cl.availability + ')' : ''}, and a request for an interview. Thank them.]`].map((t) => ({ id: sid(), text: t, src: '' })),
    closing: cl.signoff || 'Sincerely,', signature: cl.signature || P.data.basics.name };
}
function letterExport(m) { return Object.assign({}, m, { paragraphs: (m.paragraphs || []).filter((x) => !x.hidden).map((x) => x.text) }); }
function letterText(m) { return [m.date, ...(m.recipient || []), m.re, m.salutation, ...(m.paragraphs || []).map((x) => x.text), m.closing, m.signature].filter(Boolean).join('\n\n'); }
function letterFit() {
  clearTimeout(LT.fitT);
  const seq = (LT.fitSeq = (LT.fitSeq || 0) + 1), key = LT.key;
  LT.fitT = setTimeout(async () => {
    if (!LT.model) return;
    let fit = null;
    try { fit = await api('POST', 'api/resume/fit', { resume: letterExport(LT.model) }); } catch (_) { fit = null; }
    if (LT.fitSeq !== seq || LT.key !== key) return;
    LT.fit = fit; letterLive();
  }, 350);
}
function letterSave() { queueSave('letter', JOB, LT.model); }
async function letterVersion(label, by, J, model, notes) {
  J = J || JOB; model = model || LT.model; notes = notes !== undefined ? notes : LT.notes;
  await flushJob(J, 'letter');
  const doc = await putDoc('letter', J, model, { label, by, notes: notes || {} });
  I.loadKit(); return doc;
}
function letterLive() {
  const pv = $('#ltPaper'); if (pv && LT.fit && LT.fit.render) { pv.innerHTML = svgPages(LT.fit); pv.classList.toggle('over', LT.fit.pages > 1); }
  const ck = $('#ltChecks'); if (ck && LT.model) ck.innerHTML = checksBox(letterChecks(LT.model, LT.fit, JOB.company), 'Cover letter checklist');
  const ft = $('#ltFit'); if (ft) ft.innerHTML = LT.fit ? (LT.fit.pages === 1 ? `<span class="pos">Fits one page</span> <span class="sub">at ${LT.fit.size} pt</span>` : `<span class="neg">${LT.fit.pages} pages</span> <span class="sub">shorten a paragraph</span>`) : '';
}
function letterForm(J) {
  const cl = P.data.coverLetter || {}, fm = LT.form;
  const ents = ['experience', 'projects', 'leadership'].flatMap((k) => P.data[k].filter((e) => !e.hidden).map((e) => entryName(k, e)));
  const e = est('cover', (JSON.stringify(P.data).length * 0.55 + (cl.samples || []).join('').length) / 3.6 + 3200, 900);
  return `<div class="lt-form">
    <div class="dgrid"><label class="field"><span>Address it to <span class="hint">a name and title if you know it</span></span><input type="text" id="ltTo" value="${esc(fm.to || '')}" placeholder="e.g. Ms. Jane Lee, University Recruiter — or leave blank"></label>
      <label class="field"><span>Availability</span><input type="text" id="ltAvail" value="${esc(fm.avail !== undefined ? fm.avail : cl.availability || '')}" placeholder="e.g. May 18 – Aug 14, 2027; can relocate"></label></div>
    <label class="field"><span>Why this company or team, in your words <span class="hint">the most persuasive part — Claude won’t invent it</span></span><textarea id="ltWhy" class="auto" rows="2" placeholder="e.g. I use Pinterest for project ideas and want to work on its recommendation experiments">${esc(fm.why || '')}</textarea></label>
    <details class="why lt-emph" ${(fm.emph || []).length ? 'open' : ''}><summary>Experiences to emphasize <span class="hint">optional · otherwise Claude picks the best fit${(fm.emph || []).length ? ` · ${fm.emph.length} chosen` : ''}</span></summary><div class="checks sm">${ents.map((n) => `<label><input type="checkbox" data-lt-emph value="${esc(n)}" ${(fm.emph || []).includes(n) ? 'checked' : ''}> ${esc(n.length > 48 ? n.slice(0, 46) + '…' : n)}</label>`).join('')}</div></details>
    <label class="field"><span>Other instructions <span class="hint">optional</span></span><input type="text" id="ltIns" value="${esc(fm.ins || '')}" placeholder="e.g. Keep it under 300 words; mention I can work on-site in Sunnyvale"></label>
    <div class="row"><button class="btn primary" type="button" data-lt="write" ${ready('cover') && !LT.busy ? '' : 'disabled'}>${LT.busy ? `Writing… (about ${usesPro('cover') ? '1 min' : '20–40 s'})` : `${LT.model ? 'Rewrite the letter' : 'Write with Claude'}`}</button>
      <span class="sub">${costLabel('cover', e)} · uses your Profile${(cl.samples || []).length ? ` and the style of ${plural(cl.samples.length, 'past letter')}` : ''}${ST.model ? ' and this job’s resume' : ''}</span>
      <span class="grow"></span>${LT.model ? '' : '<button class="btn ghost" type="button" data-lt="blank">Start from a template · free</button>'}</div>
    ${(cl.samples || []).length ? '' : '<p class="sub">Tip: add one or two of your past letters in <a href="#profile/cover">Profile → Cover letters</a> so drafts sound like you.</p>'}</div>`;
}
function letterEditor(m) {
  const t = (path, val, cls = '', ph = '') => `<input type="text" class="${cls}" data-lt-p="${path}" value="${esc(val)}" placeholder="${esc(ph)}" aria-label="${esc(ph)}">`;
  return `<div class="rs-ed">
    <div class="rs-hd">${t('date', m.date, '', 'Date')}<textarea class="auto" rows="2" data-lt-p="recipient" data-lt-t="lines" aria-label="Recipient lines" placeholder="Recipient lines">${esc((m.recipient || []).join('\n'))}</textarea>${t('re', m.re, 'b', 'Re: position')}${t('salutation', m.salutation, '', 'Dear …,')}</div>
    <ul class="rbs lt-ps">${m.paragraphs.map((p, i) => { const srcs = (p.src || '').split(',').map((x) => x.trim()).filter(Boolean), ok = srcs.every((x) => pointText(x) !== null), open = LT.rw && LT.rw.id === p.id;
      return `<li class="rb${p.hidden ? ' off' : ''}"><textarea class="auto" rows="3" data-lt-p="paragraphs.${i}.text" aria-label="Paragraph ${i + 1}">${esc(p.text)}</textarea>
        <div class="rb-acts"><span class="src ${ok ? 'ok' : 'no'}" title="${srcs.length ? esc(srcs.map((x) => x + ': ' + (pointText(x) || 'not in your Profile')).join('\n')) : 'No profile facts cited'}">${srcs.length ? (ok ? '✓ ' : '⚠ ') + esc(srcs.join(', ')) : 'no facts cited'}</span>${(() => { const iss = paraIssues(p); return iss.length ? `<span class="src no fc" title="${esc(iss.join('\n'))}">⚠ ${esc(iss[0])}${iss.length > 1 ? ` +${iss.length - 1}` : ''}</span>` : ''; })()}<span class="grow"></span>
          <button class="btn sm ghost${open ? ' on' : ''}" type="button" data-lt="rw:${p.id}">Rewrite</button>
          <button class="btn icon sm ghost" type="button" data-lt="mv:${i}:-1" aria-label="Move up" ${i ? '' : 'disabled'}>${IC.up}</button><button class="btn icon sm ghost" type="button" data-lt="mv:${i}:1" aria-label="Move down" ${i < m.paragraphs.length - 1 ? '' : 'disabled'}>${IC.down}</button>
          <button class="btn icon sm ghost danger" type="button" data-lt="del:${i}" aria-label="Delete paragraph">${IC.x}</button></div>
        ${open ? ltRwPanel(p) : ''}</li>`; }).join('')}</ul>
    <div class="row"><button class="btn sm ghost" type="button" data-lt="add">+ Paragraph</button></div>
    <div class="rs-hd">${t('closing', m.closing, '', 'Sincerely,')}${t('signature', m.signature, '', 'Your name')}
      <div class="row"><label class="field inline"><span>Font</span><select data-lt-p="font"><option value="serif" ${m.font !== 'sans' ? 'selected' : ''}>Times New Roman</option><option value="sans" ${m.font === 'sans' ? 'selected' : ''}>Arial</option></select></label><span class="sub">Header and font match your resume.</span></div></div></div>`;
}
function ltRwPanel(p) {
  const r = LT.rw, e = est('rewrite', 900, 600);
  const presets = [['concise', 'More concise'], ['specific', 'More specific'], ['warmer', 'Warmer'], ['company', 'Tie it to the company']];
  return `<div class="rw"><div class="row">${presets.map(([k, l]) => `<button class="btn sm${r.mode === k ? ' primary' : ''}" type="button" data-lt="rwm:${k}">${l}</button>`).join('')}</div>
    <input type="text" id="ltRwCustom" placeholder="Or your own instruction" value="${esc(r.custom || '')}">
    <div class="row"><button class="btn sm primary" type="button" data-lt="rwgo:${p.id}" ${ready('rewrite') && !r.busy ? '' : 'disabled'}>${r.busy ? 'Writing…' : 'Get 2 options'}</button><span class="sub">${costLabel('rewrite', e)}</span><button class="btn sm ghost" type="button" data-lt="rw:${p.id}">Close</button></div>
    ${r.options ? `<ol class="rw-opts">${r.options.map((o, i) => `<li><span>${esc(o.text)}</span><button class="btn sm" type="button" data-lt="rwuse:${p.id}:${i}">Use</button></li>`).join('')}</ol>` : ''}</div>`;
}
function letterPanel(J, st) {
  const a = st.job && st.job.analysis, doc = st.letter;
  const id = esc(encodeURIComponent(J.id));
  if (!a) return `<section class="panel rs-start"><h2>Cover letter <small>optional</small></h2><p class="sub">Analyze the posting first so the letter can speak to its requirements.</p><div class="row"><a class="btn primary" href="#job/${id}">Go to step 1 →</a><a class="btn ghost" href="#job/${id}/apply">Skip to Apply</a></div></section>`;
  if (!LT.model) return `<section class="panel rs-start"><h2>Write the cover letter <small>optional</small></h2><p class="sub">One page, same header and font as your resume. Many internship applications don’t ask for one; skip this step if this one doesn’t.</p>
    ${ST.model ? '' : `<div class="notice"><span>Tip: build the resume first. The letter then reuses its strongest points, so both tell the same story. <a href="#job/${id}/resume">Go to the resume →</a></span></div>`}${letterForm(J)}</section>${stepNav(J, 'resume', [['apply', false, 'Skip to Apply']])}`;
  const n = LT.notes;
  const lorigin = n && n.model ? `<span class="chip v-yes">Written with Claude</span><span class="sub">${esc(n.model)}${n.cost ? ' · ' + money(n.cost) : ''}</span>` : '<span class="chip tag">Draft</span>';
  return `<section class="panel rs"><div class="rs-top"><div class="rs-origin"><div class="row">${lorigin}<span id="ltState" class="savestate">${doc && doc.updatedAt ? 'Saved' : ''}</span></div>${lifecycle(doc, 'letter', J)}</div>
    <div class="row rs-bar">${doc && (doc.versions || []).length ? `<select id="ltVer" aria-label="Versions"><option value="">Versions (${doc.versions.length})…</option>${doc.versions.slice().reverse().map((v) => `<option value="${v.id}">${esc(new Date(v.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} · ${esc(v.label)}</option>`).join('')}</select>` : ''}<button class="btn sm ghost" type="button" data-lt="version">Save version</button><button class="btn sm${LT.showForm ? ' on' : ''}" type="button" data-lt="form" aria-expanded="${!!LT.showForm}">${LT.showForm ? 'Close' : 'Rewrite with Claude…'}</button></div></div>
    ${LT.showForm ? `<div class="panel inset">${letterForm(J)}</div>` : ''}
    ${n && ((n.notes || []).length || (n.questions || []).length) ? `<details class="why rs-notes"><summary>Notes from Claude${n.model ? ` · ${esc(n.model)} · ${money(n.cost)}` : ''}</summary><ul class="jb-ul">${(n.notes || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${(n.questions || []).length ? `<div class="notice"><span><b>Could make it stronger:</b> ${n.questions.map(esc).join(' · ')}</span></div>` : ''}</details>` : ''}
    <div class="rs-grid"><div class="rs-left">${letterEditor(LT.model)}</div>
      <div class="rs-right"><div class="rs-sticky"><div class="row rs-exp"><span id="ltFit"></span><span class="grow"></span><div class="dlpair" role="group" aria-label="Download"><span class="dlp-l" aria-hidden="true">${IC.dl}</span><button type="button" data-lt="docx">.docx</button><button type="button" data-lt="pdf">.pdf</button></div><button class="btn sm ghost" type="button" data-lt="copy">Copy text</button></div>
        <div id="ltPaper" class="rs-paper">${LT.fit && LT.fit.render ? svgPages(LT.fit) : '<p class="empty" style="padding:16px">Laying out…</p>'}</div><div id="ltChecks">${checksBox(letterChecks(LT.model, LT.fit, J.company), 'Cover letter checklist')}</div></div></div></div></section>
    ${stepNav(J, 'resume', [['apply', true]])}`;
}
async function writeLetter() {
  const J = JOB, fm = LT.form;
  fm.to = ($('#ltTo') || {}).value || ''; fm.avail = ($('#ltAvail') || {}).value || ''; fm.why = ($('#ltWhy') || {}).value || ''; fm.ins = ($('#ltIns') || {}).value || '';
  fm.emph = $$('[data-lt-emph]').filter((x) => x.checked).map((x) => x.value);
  LT.busy = true; I.render();
  try {
    if (LT.model) await letterVersion('Before rewriting', 'you', J, LT.model);
    const r = await api('POST', 'api/ai/cover', Object.assign(meta(J), { track: J.track, recipient: fm.to, why: fm.why, emphasis: fm.emph.join('; '), availability: fm.avail, instructions: fm.ins, resumeText: ST.model && ST.key === J.key ? resumeText(ST.model) : '' }));
    AI.status = r.status; const x = r.result;
    const letter = Object.assign(blankLetter(J), { font: (ST.model && ST.model.font) || 'serif', recipient: x.recipientLines, re: x.reLine, salutation: x.salutation, closing: x.closing || 'Sincerely,',
      paragraphs: (x.paragraphs || []).map((p) => ({ id: sid(), text: p.text, src: p.source, unverified: p.unverified, issues: p.issues || [], generic: !!p.generic })) });
    const model = (AI.status.modelLabels[r.usage.model] || r.usage.model) + (r.usage.provider === 'pro' ? ' via Claude Pro' : '');
    const notes = { notes: x.notes, questions: x.questions, keywordsUsed: x.keywordsUsed, model, cost: r.usage.cost };
    await letterVersion(`Claude · ${model}`, 'ai', J, letter, notes);
    if ((JOB && JOB.key === J.key)) { LT.model = letter; LT.notes = notes; LT.showForm = false; letterFit(); }
    I.toast(`${(JOB && JOB.key === J.key) ? 'Cover letter written' : `Cover letter for ${J.company} written`} · ${usedText(r.usage)}`);
  } catch (e) { I.toast(e.message); } finally { LT.busy = false; I.render(); }
}
async function letterAction(k, el) {
  const [a, ...r] = k.split(':'), m = LT.model, J = JOB;
  const mv = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
  if (a === 'write') return writeLetter();
  if (a === 'form') { LT.showForm = !LT.showForm; return I.render(); }
  if (a === 'blank') { LT.model = blankLetter(J); LT.notes = null; await letterVersion('Template', 'base'); letterFit(); I.render(); return; }
  if (a === 'version') { await letterVersion('Saved by you', 'you'); I.render(); return I.toast('Version saved'); }
  if (a === 'review') return markReviewed('letter');
  if (a === 'copy') return navigator.clipboard.writeText(letterText(m)).then(() => I.toast('Letter text copied'), () => I.toast('Copy failed'));
  if (a === 'docx' || a === 'pdf') return exportDoc(letterExport(m), a, (P.data.coverLetterFileName || (P.data.resumeFileName || 'Resume_[Company]').replace(/Resume/, 'Cover_Letter')), null, 'letter');
  if (a === 'rw') { LT.rw = LT.rw && LT.rw.id === r[0] ? null : { id: r[0], mode: 'specific', options: null }; return rerenderKeepFocus(); }
  if (a === 'rwm') { LT.rw.mode = r[0]; LT.rw.custom = ($('#ltRwCustom') || {}).value || ''; return rerenderKeepFocus(); }
  if (a === 'rwgo') {
    const p = m.paragraphs.find((x) => x.id === r[0]); if (!p) return;
    const ins = { concise: 'Make it more concise (about 20% shorter) without losing facts', specific: 'Make it more specific using the source facts', warmer: 'Make the tone warmer and more personal without adding new claims', company: `Connect it more clearly to ${J.company} and this role, using only the job information` }[LT.rw.mode] || '';
    LT.rw.custom = ($('#ltRwCustom') || {}).value || ''; LT.rw.busy = true; rerenderKeepFocus();
    const st = JOBS.get(J.key), an = st.job && st.job.analysis;
    const rw = LT.rw;
    try { const res = await api('POST', 'api/ai/rewrite', Object.assign(meta(J), { kind: 'paragraph', bullet: p.text, sources: (p.src || '').split(',').map((x) => pointText(x.trim())).filter(Boolean), keywords: an ? an.keywords.map((x) => x.term) : [], instruction: [ins, rw.custom].filter(Boolean).join('. ') })); AI.status = res.status; if (LT.rw === rw && (JOB && JOB.key === J.key)) rw.options = res.result.options || []; }
    catch (e) { I.toast(e.message); } finally { rw.busy = false; if (LT.rw === rw) rerenderKeepFocus(); }
    return;
  }
  if (a === 'rwuse') { const p = m.paragraphs.find((x) => x.id === r[0]); p.text = LT.rw.options[+r[1]].text; LT.rw = null; }
  else if (a === 'mv') mv(m.paragraphs, +r[0], +r[1]);
  else if (a === 'del') { if (!el.dataset.armed) { el.dataset.armed = '1'; el.textContent = '?'; el.title = 'Click again to delete'; return; } m.paragraphs.splice(+r[0], 1); }
  else if (a === 'add') m.paragraphs.push({ id: sid(), text: '', src: '' });
  else return;
  letterSave(); letterFit(); rerenderKeepFocus();
}

/* ---------- actions ---------- */
async function analyze(pasted, refetch) {
  const J = JOB; ST.busy = 'analyze'; ST.err = null; I.render();
  try {
    const r = await api('POST', 'api/ai/analyze', Object.assign(meta(J), { text: pasted || undefined, refetch: !!refetch }));
    const st = JOBS.get(J.key); if (st) st.job = r.job; AI.status = r.status; if ((JOB && JOB.key === J.key)) { ST.paste = false; ST.pasteText = ""; }
    if (J.app && r.job.analysis) syncApp(J.app, r.job.analysis);
    I.loadKit();
    I.toast(`Analyzed · ${usedText(r.usage)} · ${r.usage.in + r.usage.cacheRead + r.usage.cacheWrite} in / ${r.usage.out} out tokens`);
  } catch (e) {
    if (e.status === 422) ST.paste = true;
    ST.err = { task: 'analyze', key: J.key, msg: e.message || 'The local server did not answer.' }; // stays on the page until you retry
    I.toast(e.message);
  } finally { ST.busy = ''; I.render(); }
}
/* Fill empty application fields from the analysis (never overwrite what you entered). */
function syncApp(app, a) {
  let ch = false;
  const sp = (a.sponsorship || {}).status;
  if (app.sponsor === 'unknown' && sp && sp !== 'not_stated') { app.sponsor = sp === 'sponsors' || sp === 'cpt_opt_ok' ? 'yes' : 'no'; ch = true; }
  if (!app.deadline && a.timing && /^\d{4}-\d{2}-\d{2}$/.test(a.timing.deadline || '')) { app.deadline = a.timing.deadline; ch = true; }
  if (ch) I.save();
}
/* One Claude call that writes or revises the resume for job J. revise: apply one request to the current draft and keep the rest. */
/* Once a page exists (this job's draft, or a Claude-tailored base for the track), tailoring UPDATES that page: Claude keeps
   its sections, entries and wording and changes only what this posting needs. fresh: rebuild from the Profile instead. */
const hasPage = (J, track) => !!((JOB && JOB.key === J.key && ST.model) || (JOBS.get(J.key) || {}).resume && JOBS.get(J.key).resume.current || tbTailored(track || J.track));
async function runTailor(J, track, instructions, revise, fresh) {
  const st = JOBS.get(J.key);
  ST.busy = revise ? 'revise' : 'tailor'; ST.busyKey = J.key; I.render();
  try {
    const here0 = JOB && JOB.key === J.key;
    const cur = (here0 && ST.model) || (st && st.resume && st.resume.current) || null;
    const before = cur && here0 ? { model: I.clone(ST.model), notes: ST.notes ? I.clone(ST.notes) : null } : null;
    if (cur) await saveVersion(revise ? 'Before revising' : 'Before updating', 'you', J, cur);
    const start = cur || masterFor(track), update = !revise && !fresh && !!(cur || tbTailored(track));
    const baseline = revise || update ? draftText(start) : resumeText(start);
    const r = await api('POST', 'api/ai/tailor', Object.assign(meta(J), { track, instructions, baseline, revise: !!revise, update }));
    AI.status = r.status;
    /* Bound to J: if you opened another job meanwhile, the result is saved to this job and that editor is not touched. */
    const model = fromAI(r.result, P.data);
    if (cur) { model.font = cur.font || model.font; model.size = cur.size || model.size; if (cur.boldKeywords === false) model.boldKeywords = false; }
    const kws = (st.job && st.job.analysis && st.job.analysis.keywords) || [];
    model.bold = boldTerms(model, kws, r.result.keywordsUsed, (st.job && st.job.analysis && st.job.analysis.requiredSkills) || []);
    const trimmed = await fitOnePage(model, kws);
    const notes = { changes: r.result.changes, questions: r.result.questions, keywordsSkipped: r.result.keywordsSkipped, keywordsUsed: r.result.keywordsUsed, model: (AI.status.modelLabels[r.usage.model] || r.usage.model) + (r.usage.provider === 'pro' ? ' via Claude Pro' : ''), cost: r.usage.cost, track };
    if (revise) notes.request = instructions.trim();
    await saveVersion(`Claude · ${notes.model}${revise ? ' · revise: ' + instructions.slice(0, 40) : update ? ' · update' + (instructions ? ': ' + instructions.slice(0, 32) : '') : fresh && cur ? ' · rebuilt from Profile' : instructions ? ' · ' + instructions.slice(0, 40) : ''}`, 'ai', J, model, notes);
    const unv = model.sections.reduce((n, s) => n + (s.entries || []).reduce((m, e) => m + e.bullets.filter((b) => needsCheck(b)).length, 0), 0);
    const here = JOB && JOB.key === J.key;
    if (here) { ST.model = model; ST.notes = notes; ST.trimmed = trimmed; ST.undo = before ? Object.assign(before, { key: J.key }) : null; ST.revText = revise ? '' : ST.revText; scheduleFit(); }
    I.toast(`${here ? (revise ? 'Revised' : update ? 'Updated for this posting' : 'Tailored') : `Resume for ${J.company} ${revise ? 'revised' : update ? 'updated' : 'tailored'}`} · ${usedText(r.usage)}${trimmed.length ? ' · trimmed to one page' : ''}${unv ? ` · ${unv} bullet${unv > 1 ? 's' : ''} to check` : ''}`);
  } catch (e) { I.toast(e.message); }
  finally { ST.busy = ''; ST.busyKey = null; I.render(); }
}
/* Ask Claude for a change in your own words, applied to the current draft. Sits under the resume header once there is a draft. */
const REVISE_IDEAS = ['Use more of the posting’s required skills, where true', 'Stronger numbers and results', 'Shorten every bullet to one line', 'Swap in my most relevant project'];
function revisePanel(J, a, canTailor, why) {
  if (!a) return '';
  const busy = ST.busy === 'revise' && ST.busyKey === J.key, undo = ST.undo && ST.undo.key === J.key;
  const req = ST.notes && ST.notes.request;
  return `<form class="revise" id="rvForm" aria-label="Ask Claude to revise this resume">
    <label for="rvIns" class="rv-l"><b>Ask Claude to revise</b><span class="sub">Describe the change. Claude edits this draft, keeps the rest, and still uses only your Profile’s facts.</span></label>
    <div class="rv-box"><textarea id="rvIns" rows="2" maxlength="1500" placeholder="e.g. Lead with my internship and mention SQL in its first bullet" ${busy ? 'disabled' : ''}>${esc(ST.revText || '')}</textarea>
      <button class="btn primary" type="submit" ${canTailor && !busy ? '' : 'disabled'} title="${esc(why || '')}">${busy ? `Revising… ${usesPro('tailor') ? '1–2 min' : '30–60 s'}` : 'Revise'}</button></div>
    <div class="rv-foot"><div class="rv-ideas" role="group" aria-label="Ideas">${REVISE_IDEAS.map((x) => `<button type="button" class="chip rv-idea" data-rv="${esc(x)}" ${busy ? 'disabled' : ''}>${esc(x)}</button>`).join('')}</div>
      <span class="sub">${why ? esc(why) : `${usesPro('tailor') ? 'Claude Pro · no API cost' : 'about the cost of a tailor'} · ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'}↵ to send`}</span></div>
    ${req || undo ? `<div class="rv-last">${req ? `<span class="sub">Last request: “${esc(req)}”</span>` : ''}${undo ? `<button class="btn sm ghost" type="button" data-jb="rv-undo">Undo last Claude change</button>` : ''}</div>` : ''}
  </form>`;
}
async function tailor() {
  const J = JOB, st = JOBS.get(J.key);
  const trackOpts = TRACKS.map((t) => `<option value="${t}" ${t === J.track ? 'selected' : ''}>${t} · ${I.TRACK_NAME[t]}</option>`).join('');
  const cfg = AI.status.config, page = hasPage(J, J.track), mine = !!ST.model;
  I.openDialog(`<form class="mbody" id="tlForm" method="dialog"><h2 id="dlgTitle">${page ? 'Update' : 'Tailor'} the resume for ${esc(J.company)}</h2>
    <p class="empty">${page ? `Claude edits ${mine ? 'the page you have now' : `your ${esc(J.track)} base resume`}: it keeps the sections, entries and wording, and changes only what makes it fit this posting better (true keywords, a stronger point, skill order). Every change is listed afterwards.` : 'Claude writes from your Profile only (confirmed points), targets this posting’s keywords and follows your resume rules.'} ${mine ? 'Your current page is kept as a version.' : ''}</p>
    <div class="grid2"><label class="field"><span>Track</span><select id="tlTrack">${trackOpts}</select><span class="hint">sets the lead-with order from your Profile</span></label>
      <label class="field"><span>Model</span><input type="text" readonly value="${esc(modelName('tailor'))}"><span class="hint">change in Settings → Claude API</span></label></div>
    <label class="field"><span>Instructions for this version <span class="hint">optional</span></span><textarea id="tlIns" rows="3" placeholder="e.g. Lead with the tracker project; keep the TrailUp project off"></textarea></label>
    <label class="switch"><input type="checkbox" id="tlPost" ${cfg.includePosting ? 'checked' : ''}> Include a trimmed posting excerpt (better wording, about 1.5K more input tokens)</label>
    ${page ? '<label class="switch"><input type="checkbox" id="tlFresh"> Start over: rebuild the page from my Profile instead of editing it</label>' : ''}
    <div class="mfoot"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="submit">${page ? 'Update' : 'Tailor'}</button></div></form>`);
  $('#tlForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const track = $('#tlTrack').value, instructions = $('#tlIns').value, inc = $('#tlPost').checked, fresh = !!($('#tlFresh') && $('#tlFresh').checked);
    I.dlg.close();
    if (inc !== cfg.includePosting) { try { AI.status = await api('POST', 'api/ai/config', { includePosting: inc }); } catch (e) { I.toast('Could not save this choice: ' + e.message + ' Try again.'); } }
    await runTailor(J, track, instructions, false, fresh);
  });
}
async function rewrite(bid) {
  const J = JOB, r = ST.rw, b = findBullet(bid); if (!b) return;
  const st = JOBS.get(J.key), a = st.job && st.job.analysis;
  const ins = { stronger: 'Use a stronger action verb and make the impact clearer', shorter: 'Make it fit on one line (under 120 characters) without losing the key fact', specific: 'Make it more specific using the source facts' }[r.mode] || '';
  const kw = r.mode === 'keyword' ? ($('#rwKw') || {}).value : '';
  r.custom = ($('#rwCustom') || {}).value || '';
  const instruction = [ins, kw ? `Work in the keyword "${kw}" only if the source facts truthfully support it` : '', r.custom].filter(Boolean).join('. ');
  const srcs = (b.src || '').split(',').map((x) => pointText(x.trim())).filter(Boolean);
  r.busy = true; rerenderKeepFocus();
  try {
    const res = await api('POST', 'api/ai/rewrite', Object.assign(meta(J), { bullet: b.text, sources: srcs, keywords: a ? a.keywords.map((k) => k.term) : [], instruction, context: b._ctx || '' }));
    AI.status = res.status;
    if (ST.rw !== r || !(JOB && JOB.key === J.key)) return; // closed, or another bullet/job is open now
    r.options = res.result.options || []; r.kw = kw;
  } catch (e) { I.toast(e.message); }
  finally { r.busy = false; rerenderKeepFocus(); }
}
function findBullet(bid) { for (const s of ST.model.sections) for (const e of s.entries || []) for (const b of e.bullets || []) if (b.id === bid) return b; return null; }
async function exportDoc(model, fmt, template, after, kind) {
  const J = JOB, name = (template || 'Resume_[Company]').replace('[Company]', J.company.replace(/[^A-Za-z0-9]+/g, '')) || 'Document';
  kind = kind || 'resume';
  try {
    await flushJob(J, kind); // the export is recorded against the saved content, so save it first
    const r = await fetch('api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume: model, format: fmt, filename: name, key: J.key, kind }) });
    if (!r.ok) { let m = 'Export failed'; try { m = (await r.json()).error; } catch (_) { /* ignore */ } throw new Error(m); }
    const blob = await r.blob(), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${name}.${fmt}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    if (after) await after(name);
    try { const d = await api('GET', 'api/job?key=' + encodeURIComponent(J.key)); const st = JOBS.get(J.key); if (st) { st.resume = d.resume; st.letter = d.letter; } } catch (_) { I.toast('Exported. The “exported” mark updates after a reload.'); }
    I.loadKit(); if (JOB && JOB.key === J.key) I.render();
    I.toast(`Downloaded ${name}.${fmt} · a copy is in data/exports`);
  } catch (e) { I.toast(e.message); }
}
function exportAs(fmt) {
  const J = JOB;
  return exportDoc(ST.model, fmt, P.data.resumeFileName, async (name) => {
    if (J.app && J.app.resume !== `${name}.${fmt}` && (fmt === 'docx' || !J.app.resume)) { I.checkpoint(); J.app.resume = `${name}.${fmt}`; I.save(); }
  }, 'resume');
}
function rerenderKeepFocus() {
  const ae = document.activeElement, key = ae && (ae.dataset.rs || ae.dataset.pf || ae.dataset.ltP || ae.id), sel = ae && 'selectionStart' in ae ? [ae.selectionStart, ae.selectionEnd] : null;
  const y = window.scrollY; I.render(); window.scrollTo(0, y);
  if (!key) return;
  const el = $(`[data-rs="${key}"]`) || $(`[data-pf="${key}"]`) || $(`[data-lt-p="${key}"]`) || document.getElementById(key);
  if (el) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (_) { /* ignore */ } }
}
function rsAction(a, el) {
  const [k, ...r] = a.split(':'), m = ST.model, n = r.map(Number);
  const mv = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
  if (k === 'rw') { ST.rw = ST.rw && ST.rw.id === r[0] ? null : { id: r[0], mode: 'stronger', options: null }; return rerenderKeepFocus(); }
  if (k === 'rwm') { ST.rw.mode = r[0]; ST.rw.custom = ($('#rwCustom') || {}).value || ''; return rerenderKeepFocus(); }
  if (k === 'rwgo') return rewrite(r[0]);
  if (k === 'okb') { const b = findBullet(r[0]); if (b) b.unverified = false; I.toast('Marked as checked'); }
  else if (k === 'rwuse') { const b = findBullet(r[0]); b.text = ST.rw.options[n[1]].text; ST.rw = null; }
  else if (k === 'mvb') mv(m.sections[n[0]].entries[n[1]].bullets, n[2], n[3]);
  else if (k === 'hideb') { const b = m.sections[n[0]].entries[n[1]].bullets[n[2]]; b.hidden = !b.hidden; }
  else if (k === 'delb') m.sections[n[0]].entries[n[1]].bullets.splice(n[2], 1);
  else if (k === 'addb') { const bs = m.sections[n[0]].entries[n[1]].bullets; bs.push({ id: sid(), text: '', src: '' }); setTimeout(() => { const t = $(`[data-rs="sections.${n[0]}.entries.${n[1]}.bullets.${bs.length - 1}.text"]`); if (t) t.focus(); }, 0); }
  else if (k === 'hidee') { const e = m.sections[n[0]].entries[n[1]]; e.hidden = !e.hidden; }
  else if (k === 'mve') mv(m.sections[n[0]].entries, n[1], n[2]);
  else if (k === 'dele') { if (!el.dataset.armed) { el.dataset.armed = '1'; el.textContent = 'Click again'; return; } m.sections[n[0]].entries.splice(n[1], 1); }
  else if (k === 'hides') m.sections[n[0]].hidden = !m.sections[n[0]].hidden;
  else if (k === 'mvs') mv(m.sections, n[0], n[1]);
  else if (k === 'addl') m.sections[n[0]].lines.push({ label: '', value: '' });
  else if (k === 'dell') m.sections[n[0]].lines.splice(n[1], 1);
  else if (k === 'mvl') mv(m.sections[n[0]].lines, n[1], n[2]);
  else return;
  scheduleSave(); scheduleFit(); rerenderKeepFocus();
}
/* Keep the resume on one page at 10 pt or larger by hiding the least valuable content first, and say what was hidden.
   Order: Leadership & Activities (unless you chose "Always"), then the bullets that match the fewest posting keywords
   (experience keeps 3, projects keep 2), then extra projects, then the summary. Nothing is deleted: each item keeps its eye button. */
const COMFORT_PT = 10.5; // trimming stops once the page fits at this size with normal spacing
async function fitOnePage(m, keywords) {
  const mode = (P.data && P.data.resumeActivities) || 'auto', hidden = [];
  const kws = (keywords || []).map((k) => ({ re: new RegExp('(^|[^a-z0-9])' + String(k.term || k).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])'), w: +k.importance || 1 }));
  const rel = (txt) => { const t = String(txt || '').toLowerCase(); return kws.reduce((n, k) => n + (k.re.test(t) ? k.w : 0), 0); };
  const vis = (arr) => (arr || []).filter((x) => !x.hidden);
  const sec = (k) => m.sections.find((x) => x.key === k && !x.hidden);
  const name = (e) => (e.title || e.subtitle || 'an entry').split(',')[0];
  const trimLeadership = (keepEntries, keepBullets) => {
    const L = sec('leadership'); if (!L) return false;
    const es = vis(L.entries);
    for (let i = es.length - 1; i >= 0; i--) { const bs = vis(es[i].bullets); if (bs.length > keepBullets) { bs[bs.length - 1].hidden = true; hidden.push(`1 bullet in ${name(es[i])} (activity)`); return true; } }
    if (es.length > keepEntries) { es[es.length - 1].hidden = true; hidden.push(`${name(es[es.length - 1])} (activity)`); return true; }
    if (!keepEntries) { L.hidden = true; for (let j = hidden.length - 1; j >= 0; j--) if (hidden[j].endsWith('(activity)')) hidden.splice(j, 1); hidden.push('Leadership & Activities section'); return true; }
    return false;
  };
  /* Value of a bullet: posting relevance first, then evidence (a number is worth about one important keyword),
     then position (Claude and you put the strongest first), with experience kept over projects. Long bullets cost space. */
  const trimBullet = () => {
    let best = null;
    for (const k of ['projects', 'experience']) {
      const S2 = sec(k); if (!S2) continue;
      vis(S2.entries).forEach((e, ei) => {
        const bs = vis(e.bullets), floor = k === 'experience' ? 3 : 2; if (bs.length <= floor) return;
        bs.forEach((b, bi) => { const sc = rel(b.text) * 100 + (/\d/.test(b.text || '') ? 250 : 0) - (b.text || '').length / 10 - ei * 3 - bi * 4 + (bi === 0 ? 200 : 0) + (k === 'experience' ? 40 : 0); /* the first bullet says what the work was: keep it */ if (!best || sc < best.sc) best = { b, e, sc }; });
      });
    }
    if (!best) return false; best.b.hidden = true; hidden.push(`1 bullet in ${name(best.e)}`); return true;
  };
  const trimProject = () => {
    const P2 = sec('projects'), es = P2 ? vis(P2.entries) : []; if (es.length <= 2) return false;
    const worst = es.slice().sort((x, y) => rel(x.title + ' ' + vis(x.bullets).map((b) => b.text).join(' ')) - rel(y.title + ' ' + vis(y.bullets).map((b) => b.text).join(' ')) || es.indexOf(y) - es.indexOf(x))[0];
    worst.hidden = true; hidden.push(`${name(worst)} (project)`); return true;
  };
  const trimSummary = () => { const s2 = m.sections.find((x) => x.kind === 'summary' && !x.hidden); if (!s2) return false; s2.hidden = true; hidden.push('Summary'); return true; };
  const steps = mode === 'always' ? [trimBullet, trimProject, () => trimLeadership(1, 1), trimSummary] : [() => trimLeadership(0, 1), trimBullet, trimProject, trimSummary];
  for (let i = 0; i < 40; i++) {
    let f; try { f = await api('POST', 'api/resume/fit', { resume: m }); } catch (_) { break; }
    ST.fit = f;
    if (f.pages === 1 && f.size >= COMFORT_PT && f.tight >= 1) break;
    if (!steps.some((fn) => fn())) break;
  }
  return hidden;
}
const trimText = (h) => { const c = {}; h.forEach((x) => { c[x] = (c[x] || 0) + 1; }); return Object.entries(c).map(([k, n]) => n > 1 && k.startsWith('1 bullet') ? k.replace('1 bullet', n + ' bullets') : k).join(' · '); };
async function jobAction(k) {
  const J = JOB, st = JOBS.get(J.key);
  if (k === 'analyze') return analyze();
  if (k === 'reanalyze') return analyze(null, true);
  if (k === 'paste') { ST.paste = true; I.render(); const t = $('#jbPaste'); if (t) t.focus(); return; }
  if (k === 'paste-cancel') { ST.paste = false; ST.pasteText = ''; return I.render(); }
  if (k === 'analyze-paste') { const t = ($('#jbPaste') || {}).value || ''; if (t.trim().length < 200) return I.toast('Paste the full job description (at least a few paragraphs).'); return analyze(t); }
  if (k === 'tailor') return tailor();
  if (k === 'rv-undo') {
    const u = ST.undo; if (!u || u.key !== J.key) return;
    await saveVersion('Revision undone', 'you'); ST.model = u.model; ST.notes = u.notes; ST.undo = null; ST.trimmed = null;
    try { await putDoc('resume', J, ST.model, { notes: ST.notes || {} }); I.loadKit(); } catch (_) { scheduleSave(); }
    scheduleFit(); I.render(); return I.toast('Revision undone · the revised draft is kept as a version');
  }
  if (k === 'base') {
    if (!P.data || !P.data.basics.name) return I.toast('Fill in your Profile first.');
    if (ST.model) await saveVersion('Before reset to master', 'you');
    const tb = tbTailored(J.track), m = masterFor(J.track), A = st.job && st.job.analysis; if (A) m.bold = boldTerms(m, A.keywords, [], A.requiredSkills); const h = await fitOnePage(m, A && A.keywords); ST.model = m; ST.notes = null; ST.trimmed = h; await saveVersion(tb ? `${J.track} base resume` : 'Master resume', 'base'); I.render();
    return I.toast(`Started from your ${tb ? J.track + ' base' : 'master'} resume · free${h.length ? ' · trimmed to fit one page' : ''}`);
  }
  if (k === 'version') { await saveVersion('Saved by you', 'you'); I.render(); return I.toast('Version saved'); }
  if (k === 'compare') {
    const vs = ((st.resume && st.resume.versions) || []).slice().reverse(); if (!vs.length || !ST.model) return;
    const pick = vs.find((v) => v.label.startsWith('Before')) || vs[0];
    I.openDialog(`<div class="mbody"><h2 id="dlgTitle">Compare the current page with…</h2><ul class="vd-pick">${vs.slice(0, 15).map((v) => `<li><button type="button" class="btn sm ${v === pick ? 'primary' : 'ghost'}" data-vdiff="${esc(v.id)}">${esc(new Date(v.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} · ${esc(v.label)}</button></li>`).join('')}</ul><div class="mfoot"><span class="spacer"></span><button class="btn ghost" type="button" data-close>Cancel</button></div></div>`, 'wide');
    return;
  }
  if (k === 'review') return markReviewed('resume');
  if (k === 'fit1') { const A = st.job && st.job.analysis; const h = await fitOnePage(ST.model, A && A.keywords); ST.trimmed = h; scheduleSave(); I.render(); return I.toast(h.length ? `Hid ${h.length} item${h.length > 1 ? 's' : ''} so it fits one page at ${COMFORT_PT} pt` : ST.fit && ST.fit.pages > 1 ? 'Still over one page: shorten some bullets by hand' : ST.fit && ST.fit.size < COMFORT_PT ? 'Nothing left to hide safely: shorten a bullet by hand' : 'Already fits one page'); }
  if (k === 'trim-ok') { ST.trimmed = null; return I.render(); }
  if (k === 'docx' || k === 'pdf') return exportAs(k);
  if (k === 'copy') { const t = resumeText(ST.model); return navigator.clipboard.writeText(t).then(() => I.toast('Resume text copied'), () => I.toast('Copy failed')); }
  return st;
}

/* ---------- Data check: wrong or stale data, each with its fix ---------- */
function dataChecks() {
  const S = I.S, F = I.F, out = [], today = new Date().toISOString().slice(0, 10), add = (sev, area, text, fix) => out.push({ sev, area, text, fix });
  const open = (a) => `<button class="btn xs" type="button" data-open="${esc(a.id)}">Edit application</button>`;
  // Applications
  const seen = new Map();
  for (const a of S.apps) {
    const h = a.history || [], ds = h.map((x) => x.d);
    if (['applied', 'oa', 'interview', 'offer', 'rejected', 'ghosted'].includes(a.status) && !h.some((x) => x.s === 'applied')) add('err', 'Applications', `${a.company}: ${I.LABEL[a.status]} but no applied date, so follow-ups and weekly counts miss it`, open(a));
    if (ds.some((d, i) => i && d < ds[i - 1])) add('warn', 'Applications', `${a.company}: status history dates are out of order`, open(a));
    if (a.status === 'saved' && a.deadline && a.deadline < today) add('warn', 'Applications', `${a.company}: still saved, but the deadline was ${I.fmt(a.deadline)}`, open(a));
    if (h.some((x) => x.d > today)) add('warn', 'Applications', `${a.company}: a status date is in the future`, open(a));
    const k = I.listingKey(a); if (seen.has(k)) add('err', 'Applications', `${a.company} · ${a.role}: tracked twice`, open(a)); else seen.set(k, a);
  }
  // Documents
  if (DOCS.list) for (const r of DOCS.list) {
    const app = I.appForKey(r.key), d = r.resume;
    if (!d) continue;
    if (app && ['applied', 'oa', 'interview', 'offer'].includes(app.status) && !d.submittedAt) add('warn', 'Resumes', `${r.company}: applied, but no “Submitted” resume is recorded, so you can’t tell what the employer has`, `<button class="btn xs" type="button" data-freeze="${esc(r.key)}" title="Only if the current page is what you sent">Current page is what I sent</button>`);
    if (d.editedSinceSubmit && app && ['oa', 'interview'].includes(app.status)) add('warn', 'Resumes', `${r.company}: you have an ${app.status === 'oa' ? 'assessment' : 'interview'}, and the resume changed after you sent it. Prepare from the submitted version`, `<button class="btn xs" type="button" data-dl="resumesent:pdf:${esc(r.key)}">Download sent .pdf</button>`);
  }
  // Profile
  if (P.data) {
    const n = toConfirm(P.data).length; if (n) add('warn', 'Profile', `${plural(n, 'point')} not confirmed: Claude can’t use them`, '<button class="btn xs" type="button" data-goto="sec:basics">Review them</button>');
    const Sk = C.skillSet(P.data, {}), no = new Set((P.data.notYet || []).flatMap(C.splitTerms).map(C.nk));
    const bad = (S.settings.mySkills || []).filter((x) => no.has(C.nk(x)));
    if (bad.length) add('err', 'Profile', `Ticked for listing scores but on your Do not claim list: ${bad.join(', ')}`, '<a class="btn xs" href="#profile/skills">Open Skills</a>');
    const unshown = (S.settings.mySkills || []).filter((x) => !C.hasSkill(x, Sk));
    if (unshown.length) add('info', 'Profile', `Ticked for listing scores but not in any Profile skill line or job: ${unshown.join(', ')}. Add them to a skill line if true, or untick them`, '<a class="btn xs" href="#profile/skills">Open Skills</a>');
  }
  // Listings feed
  const f = F.fetch;
  if (!f) add('warn', 'Listings', 'Listings have never been refreshed', '');
  else {
    const age = (Date.now() - new Date(f.at).getTime()) / 36e5;
    if (f.error) add('err', 'Listings', `The last refresh failed: ${f.error}`, '<a class="btn xs" href="#settings/search">Refresh settings</a>');
    else if (age > 26) add('warn', 'Listings', `Listings were last refreshed ${Math.round(age)} hours ago (the Mac may have been asleep or offline)`, '<a class="btn xs" href="#settings/search">Refresh now</a>');
    if (f.usingCache) add('warn', 'Listings', 'SimplifyJobs could not be reached at the last refresh, so an older copy of the feed was used', '');
    /* USCIS stopped publishing yearly employer files after FY2023, so an old USCIS year is not something you can fix.
       Current sponsorship comes from DOL's quarterly LCA files: ask for one when none is loaded or the newest is
       more than two quarters behind (DOL publishes about six weeks after each quarter ends). */
    const lm = (AI.status && AI.status.lca) || {}, DOL = '<a class="btn xs" href="https://www.dol.gov/agencies/eta/foreign-labor/performance" target="_blank" rel="noopener">Open DOL data ↗</a><button class="btn xs" type="button" data-ai="lcapick">Import file…</button>';
    const lagDays = lm.to ? (Date.now() - new Date(lm.to + 'T12:00:00').getTime()) / 864e5 : 0;
    if (AI.status && !lm.to) add('warn', 'Listings', `Sponsorship counts use USCIS approvals from ${f.h1b || 'FY2023'}, the last year USCIS published. Import DOL’s latest quarterly LCA file to see which employers filed for software and data H-1Bs in the last 12 months`, DOL);
    else if (lagDays > 200) add('warn', 'Listings', `The newest DOL filing data ends ${I.fmt(lm.to)}. A newer quarter is out; import it`, DOL);
    else if (lm.partial) add('info', 'Listings', `DOL filing counts cover ${lm.label}, less than 12 months. Import the earlier quarters of the same year for full-year counts`, DOL);
    const unread = F.listings.filter((l) => l.source === 'simplify' && !l.textRead).length;
    if (unread) add('info', 'Listings', `${plural(unread, 'listing')} could not be read (the career site blocked it), so skills, deadline and sponsorship come from the feed only`, '');
  }
  return out;
}
function dataCheckPanel() {
  if (!DOCS.list && !DOCS.loading) loadDocs();
  const L = dataChecks(), SEV = { err: ['bad', 'Fix'], warn: ['warn', 'Check'], info: ['', 'Note'] };
  const errs = L.filter((x) => x.sev === 'err').length, warns = L.filter((x) => x.sev === 'warn').length;
  return `<section class="panel" id="s-health"><h2>Data check <small>${L.length ? `${errs ? plural(errs, 'problem') : ''}${errs && warns ? ' · ' : ''}${warns ? plural(warns, 'thing') + ' to check' : ''}${!errs && !warns ? 'notes only' : ''}` : 'everything looks right'}</small></h2>
    <p class="sub">Checks your applications, resumes, Profile and listings for missing, contradictory or stale data. Runs every time you open this page; nothing is changed until you press a button.</p>
    ${L.length ? `<ul class="fixlist dcheck">${L.map((x) => `<li><span class="fix-w"><b><span class="dc-sev ${SEV[x.sev][0]}">${SEV[x.sev][1]}</span> ${esc(x.area)}</b><span class="fix-t">${esc(x.text)}</span></span><span class="fix-a">${x.fix}</span></li>`).join('')}</ul>` : '<p class="pos">No missing, contradictory or stale data found.</p>'}</section>`;
}
/* ---------- settings: DOL LCA filings (current sponsorship signal) ---------- */
function lcaField(m) {
  const n = (x) => Number(x || 0).toLocaleString('en-US');
  return `<div class="field" id="s-lca"><span>Recent H-1B filings <span class="hint">U.S. Department of Labor · the current signal that an employer sponsors software and data roles</span></span>
    <div class="row">${m.to ? `<span class="chip v-yes">${esc(m.label)}</span><span class="sub">${n(m.techFilings)} tech filings (SOC 15-) of ${n(m.filings)} certified H-1B filings · ${n(m.employers)} employers · ${esc((m.files || []).join(', ').replace(/_/g, ' '))}</span>` : '<span class="chip tag">Not imported</span><span class="sub">Listings use USCIS approvals only</span>'}
      <button class="btn sm" type="button" data-ai="lcapick">Import a DOL quarter…</button><input type="file" id="lcaFile" accept=".xlsx,.csv" hidden></div>
    <details class="why"><summary>How to import and what the number means</summary><ol class="jb-ul">
      <li>Open DOL’s <a href="https://www.dol.gov/agencies/eta/foreign-labor/performance" target="_blank" rel="noopener noreferrer">OFLC performance data</a> page, Disclosure Data, LCA Programs (H-1B, H-1B1, E-3).</li>
      <li>Download the newest quarter (for example LCA_Disclosure_Data_FY2026_Q4.xlsx). Files are large; import as many quarters as you like, a case is counted once.</li>
      <li>Import it here. Reading takes about a minute; every listing updates right away.</li></ol>
      <p class="sub">Counted: certified H-1B Labor Condition Applications in computer and math occupations (software, data, analytics: SOC 15-xxxx) in the 12 months up to the newest decision date. An LCA is filed before every H-1B petition, so it shows an employer sponsoring these roles now. It is not an approved visa and includes transfers and extensions, and a posting’s own words about sponsorship always override it.</p></details></div>`;
}
/* ---------- settings: Claude API ---------- */
function rSettings() {
  const st = AI.status;
  if (!st) return `<section class="panel" id="s-claude"><h2>Claude API</h2><p class="empty">Start the local server (python3 server.py) to use Claude features.</p></section>`;
  const c = st.config, u = st.usage, budget = c.monthlyBudget, pct = budget ? Math.min(100, u.spend / budget * 100) : 0;
  const models = Object.keys(st.prices);
  const sel = (task) => { const cur = c.models[task]; const all = models.includes(cur) ? models : [...models, cur]; return `<select data-ai-model="${task}">${all.map((m) => { const p = st.prices[m]; return `<option value="${m}" ${m === cur ? 'selected' : ''}>${esc(st.modelLabels[m] || m)}${p ? ` · $${p[0]} in / $${p[1]} out per M` : ''}</option>`; }).join('')}</select>`; };
  const fw = Object.assign({}, C.FIT_WEIGHTS, I.S.settings.fitWeights || {});
  const cc = st.claudeCode || {}, ok = ccOK();
  const ccLine = !cc.found ? `<span class="chip v-no">Not installed</span><span class="sub">Install Claude Code, then sign in with your Pro account, to write resumes and letters on your plan.</span>`
    : !cc.loggedIn ? `<span class="chip v-no">Not signed in</span><span class="sub">Open Terminal, run <span class="kbd">claude</span> and sign in with your Claude Pro account.</span>`
      : !cc.subscription ? `<span class="chip v-no">${esc(cc.method)}</span><span class="sub">Signed in for API billing, not your plan. Run <span class="kbd">claude auth login</span> and choose your Claude account.</span>`
        : `<span class="chip v-yes">Ready</span><span class="sub">Claude Code ${esc(cc.version)} · ${esc(cc.method)}</span>`;
  const PROV = [['analyze', 'Job analysis', 'API recommended: ~$0.001, fast, guaranteed format'], ['tailor', 'Resume tailoring', 'Pro saves ~$0.04 each'], ['cover', 'Cover letters', 'Pro saves ~$0.03 each'], ['rewrite', 'Bullet and paragraph rewrites', 'API recommended: under $0.001 and faster']];
  const provSel = (k) => `<select data-ai-prov="${k}" aria-label="Who runs ${esc(k)}"><option value="api" ${c.providers[k] !== 'pro' ? 'selected' : ''}>Claude API · billed per token</option><option value="pro" ${c.providers[k] === 'pro' ? 'selected' : ''}>Claude Pro · via Claude Code, no API cost</option></select>`;
  const h = st.h1b || {}, ch = st.changes || {};
  return `<section class="panel" id="s-claude"><h2>Claude <small>who writes, API key, models, usage and data sources</small></h2>
    <div class="field"><span>Claude Pro through Claude Code</span><div class="row">${ccLine}<button class="btn sm ghost" type="button" data-ai="cccheck">Check again</button></div>
      <span class="hint">Runs on this Mac with your own Pro plan: no API charges, but it shares your Pro usage limits with claude.ai and takes about a minute. For your own use only.</span></div>
    <div class="field"><span>Who runs each task</span><div class="prov">${PROV.map(([k, l, hint]) => `<label class="field"><span>${l} <span class="hint">${hint}</span></span>${provSel(k)}</label>`).join('')}</div>
      <label class="switch"><input type="checkbox" data-ai-fallback ${c.fallback ? 'checked' : ''}> If Claude Pro is unavailable or at its usage limit, use the API instead (billed per token; off until you turn it on)</label>
      ${!ok && Object.values(c.providers).includes('pro') ? `<span class="hint warn-t">Claude Pro isn’t ready, so ${c.fallback && st.configured ? 'those tasks use the API for now' : 'those tasks are paused'}.</span>` : ''}</div>
    <div class="field"><span>API key</span>${st.configured ? `<div class="row"><span class="chip v-yes">Connected</span><span class="mono sub">sk-ant-…${esc(st.keyEnds)}${st.keySource === 'environment' ? ' · from ANTHROPIC_API_KEY' : ' · stored in data/secrets.json'}</span><button class="btn sm" type="button" data-ai="verify">Test (free)</button>${st.keySource === 'file' ? '<button class="btn sm ghost danger" type="button" data-ai="remove">Remove</button>' : ''}</div>` : ''}
      <div class="copy"><input id="aiKey" type="password" autocomplete="off" placeholder="${st.configured ? 'Replace with a new key' : 'sk-ant-…'}" aria-label="Anthropic API key"><button class="btn" type="button" data-ai="save">Save key</button></div>
      <span class="hint">Create a key at console.anthropic.com. It stays on your Mac (file mode 600, git-ignored) and is never sent to this page or anywhere except api.anthropic.com.</span></div>
    <div class="grid2"><label class="field"><span>Job analysis model</span>${sel('analyze')}<span class="hint">extraction is simple: the cheapest model is enough</span></label>
      <label class="field"><span>Resume tailoring model</span>${sel('tailor')}<span class="hint">writing quality matters most here</span></label>
      <label class="field"><span>Cover letter model</span>${sel('cover')}<span class="hint">about $0.03 per letter on Sonnet</span></label>
      <label class="field"><span>Bullet and paragraph rewrite model</span>${sel('rewrite')}</label>
      <label class="field"><span>Monthly budget (USD)</span><input type="number" min="0" max="1000" step="1" data-ai-budget value="${budget}"><span class="hint">checked before every API call: this month’s recorded cost + calls in progress + the new call’s worst case (full output limit) must fit. This app’s own limit, not an Anthropic billing cap; costs are estimates from the price table. 0 means no limit.</span></label></div>
    <label class="switch"><input type="checkbox" data-ai-post ${c.includePosting ? 'checked' : ''}> Send a trimmed posting excerpt when tailoring (better wording, ~1.5K more input tokens)</label>
    <div class="field"><span>This month <span class="hint">${esc(u.month)} · estimated from token counts and list prices</span></span>
      <div class="share"><span class="prog ${pct >= 90 ? '' : 'done'}"><span style="width:${pct}%"></span></span>${money(u.spend)} of ${budget ? money(budget) : 'no limit'}</div>
      <table class="calib" tabindex="0"><thead><tr><th>Task</th><th>Calls</th><th>Via Pro</th><th>Input</th><th>Cached</th><th>Output</th><th>API cost</th><th>Saved by Pro</th></tr></thead><tbody>${Object.entries(u.byTask).map(([k, b]) => `<tr><td>${esc(st.taskLabels[k] || k)}</td><td class="n">${b.calls}</td><td class="n">${b.proCalls || 0}</td><td class="n">${(b.in + b.cacheWrite).toLocaleString('en-US')}</td><td class="n">${b.cacheRead.toLocaleString('en-US')}</td><td class="n">${b.out.toLocaleString('en-US')}</td><td class="n">${money(b.cost)}</td><td class="n">${b.saved ? money(b.saved) : '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No calls yet this month.</td></tr>'}</tbody></table>
      ${u.recent.length ? `<details class="why"><summary>Last ${u.recent.length} calls · ${money(u.allTime)} all time</summary><ul class="snaps">${u.recent.map((r) => `<li><span class="mono">${esc(r.at.slice(5, 16).replace('T', ' '))}</span><span>${esc(st.taskLabels[r.task] || r.task)} · ${esc(r.target)}</span><span class="mono" style="margin-left:auto">${money(r.cost)}</span></li>`).join('')}</ul></details>` : ''}</div>
    ${lcaField(st.lca || {})}
    <div class="field"><span>USCIS H-1B approvals <span class="hint">past outcomes; the stronger of the two records counts in listing scores</span></span>
      <div class="row"><span class="chip ${h.label && h.label !== 'FY2023' ? 'v-yes' : 'tag'}">${esc(h.label || 'FY2023')}</span><span class="sub">${h.employers ? `${Number(h.employers).toLocaleString('en-US')} employers · imported ${esc((h.importedAt || '').slice(0, 10))}` : 'USCIS archive file: the last year USCIS published as a file'}</span>
        <button class="btn sm ghost" type="button" data-ai="h1bpick">Import a USCIS file…</button><input type="file" id="h1bFile" accept=".csv,.xlsx,.txt,text/csv" hidden></div>
      <span class="hint">USCIS has not published an employer file after FY2023. If the <a href="https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub" target="_blank" rel="noopener noreferrer">Employer Data Hub</a> offers a newer year as a full download (all employers, Excel or CSV), import it here.</span></div>
    <div class="field"><span>Posting change checks <span class="hint">free · once a day, analyzed postings are re-read (no Claude call)</span></span>
      <span class="sub">${ch.lastRun ? `Last run ${esc(ch.lastRun)}: ${ch.checked} read, ${ch.changed} changed, ${ch.closed} closed.` : 'Runs after the next listings refresh.'}</span></div>
    <div class="field"><span>Fit score weights ${I.eff(true)} <span class="hint">relative; the job page’s match breakdown</span></span><div class="weights" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr) 70px);max-width:720px">${C.FIT_KEYS.map((k) => `<label for="fw-${k}">${C.FIT_LABEL[k]}</label><input id="fw-${k}" type="number" min="0" max="100" step="5" data-fitw="${k}" value="${fw[k]}">`).join('')}</div></div>
    <p class="empty">How tokens are saved: analysis uses the cheapest model on boilerplate-trimmed text and is cached per job; tailoring caches your profile (re-tailoring within 5 minutes reads it at a tenth of the price) and only sends confirmed points; rewrites send one bullet and its source facts; match and keyword scores run here without any call.</p></section>`;
}

/* ---------- events ---------- */
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.ltP && LT.model) {
    setPath(LT.model, t.dataset.ltP, t.dataset.ltT === 'lines' ? lines(t.value) : t.value);
    if (t.classList.contains('auto')) autosize(t);
    clearTimeout(LT.liveT); LT.liveT = setTimeout(() => { const ck = $('#ltChecks'); if (ck) ck.innerHTML = checksBox(letterChecks(LT.model, LT.fit, JOB.company), 'Cover letter checklist'); }, 200);
    letterSave(); letterFit(); return;
  }
  if (t.id === 'ltWhy') { autosize(t); LT.form.why = t.value; return; }
  if (t.dataset.pf) {
    const v = t.dataset.pft === 'lines' ? lines(t.value) : t.dataset.pft === 'num' ? (t.value === '' ? '' : +t.value) : t.dataset.pft === 'bool' ? t.checked : t.dataset.pft === 'inv' ? !t.checked : t.value;
    setPath(P.data, t.dataset.pf, v); saveProfile(); if (t.classList.contains('auto')) autosize(t); return;
  }
  if (t.dataset.rs && ST.model) {
    const v = t.dataset.rst === 'lines' ? lines(t.value) : t.dataset.rst === 'num' ? +t.value : t.dataset.rst === 'bool' ? t.checked : t.value;
    setPath(ST.model, t.dataset.rs, v);
    if (t.classList.contains('auto')) autosize(t);
    clearTimeout(ST.liveT); ST.liveT = setTimeout(() => { const kw = $('#rsKw'); if (kw) kw.innerHTML = kwPanel(); }, 150); scheduleSave(); scheduleFit();
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.pfIn) { const cur = new Set(getPath(P.data, t.dataset.pfIn) || []); t.checked ? cur.add(t.value) : cur.delete(t.value); setPath(P.data, t.dataset.pfIn, [...cur]); saveProfile(); return; }
  if (t.dataset.pf && (t.tagName === 'SELECT' || t.type === 'checkbox')) { setPath(P.data, t.dataset.pf, t.dataset.pft === 'bool' ? t.checked : t.dataset.pft === 'inv' ? !t.checked : t.dataset.pft === 'tri' ? (t.value === 'yes' ? true : t.value === 'no' ? false : null) : t.value); saveProfile(); if (I.route() === 'profile') rerenderKeepFocus(); return; }
  if (I.route() === 'profile' && (t.dataset.target || t.dataset.skill || t.id === 'p-places')) { setTimeout(rerenderKeepFocus, 0); return; }
  if (t.dataset.rs && t.tagName === 'SELECT' && ST.model) { setPath(ST.model, t.dataset.rs, t.dataset.rst === 'num' ? +t.value : t.value); scheduleSave(); scheduleFit(); updateLive(); return; }
  if (t.id === 'ltVer' && t.value) {
    const doc = JOBS.get(JOB.key).letter, v = doc.versions.find((x) => x.id === t.value); if (!v) return;
    (async () => {
      await letterVersion('Before restoring a version', 'you'); LT.model = I.clone(v.resume);
      LT.notes = v.notes && Object.keys(v.notes).length ? I.clone(v.notes) : v.by === 'ai' ? { model: v.label.replace(/^Claude · /, '').split(' · ')[0] } : null;
      try { await putDoc('letter', JOB, LT.model, { notes: LT.notes || {} }); I.loadKit(); } catch (_) { letterSave(); }
      letterFit(); I.render(); I.toast(`Restored: ${v.label}`);
    })();
    return;
  }
  if (t.dataset.ltP && t.tagName === 'SELECT' && LT.model) { setPath(LT.model, t.dataset.ltP, t.value); letterSave(); letterFit(); return; }
  if (t.id === 'rsVer' && t.value) {
    const doc = JOBS.get(JOB.key).resume, v = doc.versions.find((x) => x.id === t.value); if (!v) return;
    (async () => {
      await saveVersion('Before restoring a version', 'you'); ST.model = I.clone(v.resume);
      ST.notes = v.notes && Object.keys(v.notes).length ? I.clone(v.notes) : v.by === 'ai' ? { model: v.label.replace(/^Claude · /, '').split(' · ')[0] } : null; ST.trimmed = null;
      try { await putDoc('resume', JOB, ST.model, { notes: ST.notes || {} }); I.loadKit(); } catch (_) { scheduleSave(); }
      scheduleFit(); I.render(); I.toast(`Restored: ${v.label}`);
    })();
    return;
  }
  if (t.id === 'pfFile' && t.files && t.files[0]) {
    t.files[0].text().then((txt) => { const d = JSON.parse(txt); if (!d || !d.basics) throw new Error('bad'); P.data = normProfile(d); saveProfile(true); I.render(); I.toast('Profile imported (the previous one is in data/backups/profile)'); }).catch(() => I.toast('That is not a profile JSON file.'));
    return;
  }
  if (t.dataset.aiModel) return aiConfig({ models: { [t.dataset.aiModel]: t.value } }, 'Model saved');
  if (t.hasAttribute('data-ai-budget')) return aiConfig({ monthlyBudget: +t.value || 0 }, 'Budget saved');
  if (t.hasAttribute('data-ai-post')) return aiConfig({ includePosting: t.checked }, 'Saved');
  if (t.dataset.aiProv) return aiConfig({ providers: { [t.dataset.aiProv]: t.value } }, t.value === 'pro' ? 'This task now runs on your Claude Pro plan' : 'This task now runs on the API');
  if (t.hasAttribute('data-ai-fallback')) return aiConfig({ fallback: t.checked }, t.checked ? 'API fallback on' : 'API fallback off');
  if (t.id === 'h1bFile' && t.files && t.files[0]) {
    const f = t.files[0]; I.toast(`Reading ${f.name}…`);
    fetch('api/h1b', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(f.name) }, body: f })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Import failed'); AI.status = d.status; await I.refreshFeed(); I.render(); I.toast(`H-1B data updated to ${d.h1b.label} · ${Number(d.h1b.employers).toLocaleString('en-US')} employers · listings re-scored`); })
      .catch((e) => I.toast(e.message));
    return;
  }
  if (t.id === 'lcaFile' && t.files && t.files[0]) {
    const f = t.files[0]; I.toast(`Reading ${f.name}… a full quarter takes about a minute`);
    fetch('api/lca', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(f.name) }, body: f })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Import failed'); AI.status = d.status; await I.refreshFeed(); I.render(); I.toast(`DOL filings updated: ${d.lca.label} · ${Number(d.lca.techFilings).toLocaleString('en-US')} tech H-1B filings · listings re-scored`); })
      .catch((e) => I.toast(e.message));
    return;
  }
  if (t.dataset.fitw) { I.S.settings.fitWeights = Object.assign({}, C.FIT_WEIGHTS, I.S.settings.fitWeights || {}, { [t.dataset.fitw]: Math.max(0, Math.min(100, +t.value || 0)) }); I.settingChanged('Fit weights saved', false); }
});
async function aiConfig(patch, msg) { try { AI.status = await api('POST', 'api/ai/config', patch); I.toast(msg); I.render(); } catch (e) { I.toast(e.message); } }
document.addEventListener('click', async (e) => {
  const t = e.target;
  const pfa = t.closest('[data-pfa]'); if (pfa) { e.preventDefault(); return profileAction(pfa.dataset.pfa, pfa); }
  const toc = t.closest('[data-pftoc]'); if (toc) { e.preventDefault(); history.replaceState(null, '', '#profile/' + toc.dataset.pftoc); rProfile.scrolled = true; I.render(); window.scrollTo(0, 0); const h = document.querySelector('#s-' + toc.dataset.pftoc + ' h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } return; }
  const jb = t.closest('[data-jb]'); if (jb) { e.preventDefault(); return jobAction(jb.dataset.jb); }
  const fz = t.closest('[data-freeze]'); if (fz) { e.preventDefault(); const r = (DOCS.list || []).find((x) => x.key === fz.dataset.freeze); try { await api('POST', 'api/submitted', { key: fz.dataset.freeze, company: r ? r.company : '', role: r ? r.role : '' }); DOCS.list = null; await loadDocs(); I.toast('Recorded as the version you submitted'); I.render(); } catch (err) { I.toast(err.message); } return; }
  const sd = t.closest('[data-subdl]'); if (sd) { e.preventDefault(); return subDownload(sd.dataset.subdl); }
  const sc2 = t.closest('[data-subcmp]'); if (sc2) { e.preventDefault(); const v = submittedOf((JOBS.get(JOB.key) || {}).resume); if (v) I.openDialog(diffDialog(v), 'wide'); return; }
  const pt = t.closest('[data-rspane]'); if (pt) { setPane(pt.dataset.rspane, pt.closest('.rs-flag') ? 'review' : ''); return; }
  const zt = t.closest('[data-rszoom]'); if (zt) { ST.zoom = zt.dataset.rszoom; const cv = $('.rs-canvas'); if (cv) cv.classList.toggle('actual', ST.zoom === 'actual'); $$('[data-rszoom]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rszoom === ST.zoom || (ST.zoom !== 'actual' && b.dataset.rszoom === 'fit')))); fitPaper(); return; }
  const vd = t.closest('[data-vdiff]'); if (vd) { e.preventDefault(); const v = ((JOBS.get(JOB.key) || {}).resume.versions || []).find((x) => x.id === vd.dataset.vdiff); if (v) I.dlg.innerHTML = diffDialog(v); return; }
  const vr = t.closest('[data-vrestore]'); if (vr) { e.preventDefault(); const sel = $('#rsVer'); I.dlg.close(); if (sel) { sel.value = vr.dataset.vrestore; sel.dispatchEvent(new Event('change', { bubbles: true })); } return; }
  const gt = t.closest('[data-goto]'); if (gt) { e.preventDefault(); if (gt.hasAttribute('data-close') && I.dlg && I.dlg.open) I.dlg.close(); return goTo(gt.dataset.goto); }
  const jc = t.closest('[data-jcopy]'); if (jc) { e.preventDefault(); return navigator.clipboard.writeText(jc.dataset.jcopy).then(() => { jc.textContent = 'Copied'; setTimeout(() => { jc.textContent = 'Copy'; }, 1400); }, () => I.toast('Copy failed')); }
  const rsa = t.closest('[data-rsa]'); if (rsa) { e.preventDefault(); return rsAction(rsa.dataset.rsa, rsa); }
  const lt = t.closest('[data-lt]'); if (lt) { e.preventDefault(); return letterAction(lt.dataset.lt, lt); }
  const sum = t.closest('.pf-entry > summary'); if (sum) { const d = sum.parentElement; P.open = Object.assign({}, P.open, { [d.dataset.eid]: !d.open }); return; }
  const rsum = t.closest('.rs-sec > summary'); if (rsum) { const d = rsum.parentElement; ST.sec[d.dataset.sid] = !d.open; return; }
  const ai = t.closest('[data-ai]');
  if (ai) {
    const k = ai.dataset.ai;
    try {
      if (k === 'save') { const v = $('#aiKey').value.trim(); if (!v) return I.toast('Paste your API key first.'); AI.status = await api('POST', 'api/ai/key', { key: v }); I.render(); return I.toast('API key saved on your Mac'); }
      if (k === 'remove') {
        // Not undoable: ask for a second click, as Clear all data does.
        if (!ai.dataset.armed) { ai.dataset.armed = '1'; ai.textContent = 'Click again to remove'; setTimeout(() => { if (ai.isConnected) { delete ai.dataset.armed; ai.textContent = 'Remove'; } }, 3000); return; }
        AI.status = await api('POST', 'api/ai/key', { key: '' }); I.render(); return I.toast('API key removed');
      }
      if (k === 'cccheck') { ai.disabled = true; AI.status = await api('POST', 'api/ai/claude-check', {}); I.render(); return I.toast(ccOK() ? 'Claude Code is ready with your Claude plan' : 'Claude Code is not ready yet'); }
      if (k === 'h1bpick') { const fi = $('#h1bFile'); fi.value = ''; return fi.click(); }
      if (k === 'lcapick') { const fi = $('#lcaFile'); if (!fi) { location.hash = '#settings/claude'; return; } fi.value = ''; return fi.click(); }
      if (k === 'verify') { ai.disabled = true; const r = await api('POST', 'api/ai/verify', {}); const want = Object.values(AI.status.config.models); const miss = want.filter((m) => !r.models.includes(m)); return I.toast(miss.length ? `Key works, but these models are not available to it: ${miss.join(', ')}` : `Key works · ${r.models.length} models available`); }
    } catch (err) { I.toast(err.message); } finally { ai.disabled = false; }
  }
});
let rzT; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(fitPaper, 100); });

/* ---------- Documents: every resume and cover letter, by job ---------- */
const DOCS = { list: null, loading: false, q: '', kind: 'all' };
async function loadDocs() { if (DOCS.loading) return; DOCS.loading = true; try { DOCS.list = await api('GET', 'api/studio/docs'); } catch (_) { DOCS.list = []; } DOCS.loading = false; if (I.route() === 'docs') I.render(); }
const when = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
function rDocs() {
  if (!P.server) return `<div class="panel"><p class="empty">Documents are saved by the local server. Start it with python3 server.py.</p></div>`;
  if (!DOCS.list) { loadDocs(); return '<div class="panel"><p class="empty">Loading…</p></div>'; }
  const q = DOCS.q.toLowerCase().trim();
  /* Needs you: changed after you sent it, or never exported while the job is still open. */
  const needs = (r) => ['resume', 'letter'].some((k) => r[k] && (r[k].editedSinceSubmit || (!r[k].submittedAt && !r[k].exported && (I.appForKey(r.key) || {}).status === 'saved')));
  const rows = DOCS.list.filter((r) => (DOCS.kind === 'all' || (DOCS.kind === 'needs' ? needs(r) : r[DOCS.kind])) && (!q || (r.company + ' ' + r.role).toLowerCase().includes(q)));
  const nR = DOCS.list.filter((r) => r.resume).length, nL = DOCS.list.filter((r) => r.letter).length;
  const cell = (r, kind) => {
    const d = r[kind]; if (!d) return `<td class="dc-c"><span class="na-s">—</span></td>`;
    const tag = kind === 'resume' ? (d.tailored ? '<span class="chip v-yes">Tailored</span>' : '<span class="chip tag">Master</span>') : (d.tailored ? '<span class="chip v-yes">Written with Claude</span>' : '<span class="chip tag">Draft</span>');
    const subd = d.submittedAt ? `<span class="chip v-yes">Submitted ${esc(when(d.submittedAt))}</span>${d.editedSinceSubmit ? '<span class="warn-t na-s">edited since</span>' : ''}` : '';
    const sc = kind === 'resume' && d.current && r.fit ? C.resumeScore(d.current, { analysis: r.fit, skills: P.data ? C.skillSet(P.data, I.S.settings) : null }) : null;
    const scs = sc && sc.total !== null ? `<span class="na-s" title="Resume score for this posting (wording and evidence)">score ${sc.total}</span>` : '';
    if (subd) return `<td class="dc-c"><div class="dc-st">${subd}${scs}</div>${dlPair(`${kind}:%:${r.key}`, r.company + ' ' + (kind === 'letter' ? 'cover letter' : 'resume') + ' (current)')}${d.submittedModel ? `<div class="dlpair sm" role="group" aria-label="Download the submitted ${kind}"><span class="dlp-l" aria-hidden="true">${IC.dl} sent</span><button type="button" data-dl="${kind}sent:docx:${esc(r.key)}">.docx</button><button type="button" data-dl="${kind}sent:pdf:${esc(r.key)}">.pdf</button></div>` : ''}</td>`;
    return `<td class="dc-c"><div class="dc-st">${tag}${scs}<span class="na-s">${d.exported ? 'exported ' + when(d.exportedAt) : d.exportedBefore ? `<span class="warn-t">edited since export</span> · ${when(d.updatedAt)}` : 'not exported · edited ' + when(d.updatedAt)}${d.reviewed ? ' · reviewed' : ''}</span></div>
      ${dlPair(`${kind}:%:${r.key}`, r.company + ' ' + (kind === 'letter' ? 'cover letter' : 'resume'))}</td>`;
  };
  const trackOf = (r) => { const app = I.appForKey(r.key); if (app && app.track) return app.track; const l = I.scored().find((x) => I.listingKey(x) === r.key); return (l && l.t) || I.inferTrack(r.role) || 'Other'; };
  const row = (r) => {
    const id = I.jobIdForKey(r.key), app = I.appForKey(r.key);
    return `<tr><td class="co"><b>${esc(r.company)}</b><span class="sub2">${esc(r.role)}</span></td><td>${app ? I.stChip(app.status) : '<span class="na-s">Not saved</span>'}</td>${cell(r, 'resume')}${cell(r, 'letter')}
      <td class="acts-c">${id ? `<a class="btn sm" href="#job/${esc(encodeURIComponent(id))}/resume">Open</a>` : '<span class="na-s" title="The listing is no longer in your feed">Listing gone</span>'}</td></tr>`;
  };
  const groups = {}; rows.forEach((r) => { const t = trackOf(r); (groups[t] = groups[t] || []).push(r); });
  const order = [...I.TRACKS, 'Other'].filter((t) => groups[t]);
  const head = '<colgroup><col class="c-co"><col class="c-app"><col class="c-doc"><col class="c-doc"><col class="c-open"></colgroup><thead><tr><th scope="col">Company · Role</th><th scope="col">Application</th><th scope="col">Resume</th><th scope="col">Cover letter</th><th scope="col"><span class="sr">Open</span></th></tr></thead>';
  const tables = order.map((t) => `<section class="dgrp" aria-label="${esc(t)} documents"><h2 class="dgrp-h"><span class="chip tag">${esc(t)}</span>${esc(I.TRACK_NAME[t] || t)}<span class="cnt">${plural(groups[t].length, 'job')}</span></h2>
    <div class="tablewrap"><table class="docs-t">${head}<tbody>${groups[t].map(row).join('')}</tbody></table></div></section>`).join('');
  const targets = (I.S.settings.targets || []).filter((t) => I.TRACKS.includes(t));
  /* Base resumes as one grouped list: each row shows the full ordering, so nothing is cut off. */
  const lead = (t) => { const w = ((P.data.tracks || {})[t] || {}).leadWith; return w ? 'Leads with ' + w.split('→').map((x) => x.trim()).filter(Boolean).join(' → ') : 'Profile order'; };
  if (!TB.docs && !TB.loading) loadBases();
  const tbRow = (t) => {
    const d = tbDoc(t), on = tbTailored(t), busy = TB.busy === t;
    const st = on ? `<span class="chip v-yes">Tailored by Claude</span><span class="sub">${esc(when(d.updatedAt))}${d.notes && d.notes.model ? ' · ' + esc(d.notes.model) : ''}</span>` : `<span class="sub">${esc(lead(t))}</span>`;
    const act = busy ? `<button class="btn sm" type="button" disabled>Tailoring… ${usesPro('tailor') ? '1–2 min' : '30–60 s'}</button>`
      : on ? `<button class="btn sm" type="button" data-tb="open:${t}">Review</button>`
        : `<button class="btn sm" type="button" data-tb="tailor:${t}" ${ready('tailor') && !TB.busy ? '' : 'disabled'} title="${esc(ready('tailor') ? costLabel('tailor', est('tailor', 9000, 2600)).replace(/<[^>]+>/g, '') : notReadyTip('tailor'))}">Tailor for ${t}</button>`;
    return `<li><span class="dbase-t"><b>${esc(t)}</b><span class="sub">${esc(I.TRACK_NAME[t] || t)}</span></span><span class="dbase-o">${st}</span><span class="dbase-a">${act}</span>${dlPair(`base:%:${t}`, t + ' base resume')}</li>`;
  };
  const base = P.data && P.data.basics.name && targets.length ? `<section class="panel dbase"><h2>Base resumes <small>the starting point for every job resume in a track</small></h2>
    <ul class="dbase-l">${targets.map(tbRow).join('')}</ul>
    <p class="sub">Without tailoring, a base resume is your Profile in its lead-with order. Tailor one with Claude and it leads with what that track’s recruiters screen for, worded for the track, from your Profile’s facts only. Every job resume in the track then starts from it.</p></section>` : '';
  const nN = DOCS.list.filter(needs).length;
  const seg = [['all', `All ${DOCS.list.length}`], ['resume', `Resumes ${nR}`], ['letter', `Cover letters ${nL}`], ...(nN ? [['needs', `Needs you ${nN}`]] : [])];
  return `${base}<div class="toolbar" style="margin:${base ? '16px' : '0'} 0 12px"><input type="search" id="docQ" placeholder="Search company or role" aria-label="Search documents" value="${esc(DOCS.q)}" style="max-width:280px">
      <div class="stagef" role="group" aria-label="Show">${seg.map(([k, l]) => `<button type="button" data-dockind="${k}" aria-pressed="${DOCS.kind === k}">${l}</button>`).join('')}</div><span class="grow"></span>
      <span class="hint">File names follow Profile → Basics</span></div>
    ${DOCS.list.length ? (rows.length ? `<div class="dgrps">${tables}</div>` : '<div class="panel"><p class="empty">Nothing matches.</p></div>')
      : `<div class="panel" style="align-items:flex-start"><h2>No job documents yet</h2><p class="empty">Open a job from New listings or Applications, then build its resume (step 2) or cover letter (step 3). Every draft shows up here, grouped by track, with one-click downloads.</p><div class="row"><a class="btn tint" href="#inbox">Go to New listings</a></div></div>`}`;
}
/* Download pair: one control, both formats equal ("Download  .docx | .pdf"). */
/* ---------- track base resumes: one Claude-tailored starting point per track ---------- */
const TB = { docs: null, loading: false, busy: '', open: null, undo: null, rev: '' };
async function loadBases() {
  TB.loading = true;
  try { TB.docs = (await api('GET', 'api/bases')).bases || {}; } catch (_) { TB.docs = TB.docs || {}; }
  finally { TB.loading = false; I.render(); }
}
const tbDoc = (t) => (TB.docs || {})[t] || null;
const tbTailored = (t) => { const d = tbDoc(t); return !!(d && d.current && d.state && d.state.generated); };
/* The resume a job in this track starts from: the tailored base when there is one, else the Profile in lead-with order. */
function masterFor(track) {
  if (!tbTailored(track)) return baseResume(P.data, track);
  const m = I.clone(tbDoc(track).current);
  m.header = { name: P.data.basics.name, contact: contactLine(P.data.basics) }; // contact details always from the Profile as it is now
  normResume(m); return m;
}
function tbPaper(m) { const keep = ST.fit; ST.fit = null; try { return paper(m); } finally { ST.fit = keep; } }
function tbDialog(t) {
  const d = tbDoc(t), n = (d && d.notes) || {}, busy = TB.busy === t, m = masterFor(t), undo = TB.undo && TB.undo.t === t;
  return `<div class="mbody tb-dlg"><div class="tb-head"><h2 id="dlgTitle">${esc(t)} base resume</h2><span class="sub">${tbTailored(t) ? `Tailored by Claude${n.model ? ' · ' + esc(n.model) : ''} · ${esc(when(d.updatedAt))}` : 'Your Profile in lead-with order'}</span><span class="grow"></span>${dlPair(`base:%:${t}`, t + ' base resume')}</div>
    <div class="tb-grid"><div class="tb-paper rs-paper">${tbPaper(m)}</div>
      <div class="tb-side">
        ${(n.changes || []).length ? `<details class="why" open><summary>What Claude did for ${esc(t)}</summary><ul class="jb-ul">${n.changes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
        ${(n.questions || []).length ? questionList(n.questions, true) : ''}
        ${(n.keywordsSkipped || []).length ? `<p class="sub">Left out (not supported by your Profile): ${n.keywordsSkipped.map(esc).join(', ')}</p>` : ''}
        <form class="revise" id="tbForm" aria-label="Ask Claude to revise the ${esc(t)} base resume">
          <label for="tbIns" class="rv-l"><b>Ask Claude to revise</b><span class="sub">Claude edits this base and keeps the rest.</span></label>
          <div class="rv-box"><textarea id="tbIns" rows="3" maxlength="1500" placeholder="e.g. Put the databases course in Education and lead Skills with SQL" ${busy ? 'disabled' : ''}>${esc(TB.rev)}</textarea>
            <button class="btn primary" type="submit" ${busy || !ready('tailor') ? 'disabled' : ''}>${busy ? 'Working…' : 'Revise'}</button></div>
          <span class="sub">${busy ? `Claude is writing. About ${usesPro('tailor') ? '1–2 min' : '30–60 s'}; you can close this and keep working.` : `${usesPro('tailor') ? 'Claude Pro · no API cost' : 'about the cost of a tailor'} · ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'}↵ to send`}</span>
        </form>
        <div class="tb-acts">${undo ? '<button class="btn sm ghost" type="button" data-tb="undo:' + t + '">Undo last change</button>' : ''}
          <button class="btn sm ghost" type="button" data-tb="retailor:${t}" ${busy || !ready('tailor') ? 'disabled' : ''} title="Claude edits this page and keeps the rest">${tbTailored(t) ? 'Update with Claude' : 'Tailor with Claude'}</button>
          ${tbTailored(t) ? `<button class="btn sm ghost" type="button" data-tb="rebuild:${t}" ${busy || !ready('tailor') ? 'disabled' : ''} title="Writes a new page from your Profile">Rebuild from Profile</button>` : ''}
          ${tbTailored(t) ? `<button class="btn sm ghost" type="button" data-tb="reset:${t}" ${busy ? 'disabled' : ''}>Back to Profile order</button>` : ''}</div>
        <p class="sub">Hand edits belong in a job’s resume (step 2). To change the facts themselves, edit your Profile, then update.</p>
      </div></div>
    <div class="mfoot"><span class="spacer"></span><button class="btn primary" type="button" data-close>Done</button></div></div>`;
}
function tbRefresh() { if (TB.open && I.dlg.open && I.dlg.classList.contains('tbd')) { const y = (I.dlg.querySelector('.tb-side') || {}).scrollTop; I.dlg.innerHTML = tbDialog(TB.open); const sd = I.dlg.querySelector('.tb-side'); if (sd && y) sd.scrollTop = y; } I.render(); }
function tbOpen(t) { TB.open = t; TB.rev = ''; I.openDialog(tbDialog(t), 'tbd wide', () => { TB.open = null; }); }
async function tbSave(t, model, label, by, notes) {
  const d = tbDoc(t);
  const r = await api('PUT', 'api/base', { track: t, resume: model, label, by, notes: notes || {}, baseUpdatedAt: d && d.updatedAt });
  TB.docs = Object.assign({}, TB.docs, { [t]: r.resume }); return r.resume;
}
async function tbRun(t, instructions, revise, fresh) {
  if (TB.busy) return;
  TB.busy = t; tbRefresh();
  try {
    const before = tbTailored(t) ? { model: I.clone(tbDoc(t).current), notes: I.clone(tbDoc(t).notes || {}) } : null;
    const cur = masterFor(t);
    const update = !!before && !revise && !fresh;
    const r = await api('POST', 'api/ai/base', { track: t, instructions, baseline: revise || update ? draftText(cur) : resumeText(baseResume(P.data, t)), revise: !!revise, update });
    AI.status = r.status;
    const model = fromAI(r.result, P.data), keep = ST.fit; model.bold = boldTerms(model, [], r.result.keywordsUsed); await fitOnePage(model, []); ST.fit = keep;
    const notes = { changes: r.result.changes, questions: r.result.questions, keywordsSkipped: r.result.keywordsSkipped, keywordsUsed: r.result.keywordsUsed, model: (AI.status.modelLabels[r.usage.model] || r.usage.model) + (r.usage.provider === 'pro' ? ' via Claude Pro' : ''), cost: r.usage.cost };
    if (revise) notes.request = instructions.trim();
    if (before) await tbSave(t, before.model, revise ? 'Before revising' : 'Before re-tailoring', 'you', before.notes);
    await tbSave(t, model, `Claude · ${notes.model}${revise ? ' · revise: ' + instructions.slice(0, 40) : update ? ' · update' : ''}`, 'ai', notes);
    TB.undo = before ? Object.assign(before, { t }) : null; if (revise) TB.rev = '';
    I.toast(`${t} base resume ${revise ? 'revised' : 'tailored'} · ${usedText(r.usage)}${TB.open !== t ? ' · open Documents to review it' : ''}`);
    if (!TB.open && !revise) tbOpen(t);
  } catch (e) { I.toast(e.message); }
  finally { TB.busy = ''; tbRefresh(); }
}
async function tbAction(act, t) {
  if (act === 'open') return tbOpen(t);
  if (act === 'tailor' || act === 'retailor') return tbRun(t, '', false);
  if (act === 'rebuild') return tbRun(t, '', false, true);
  if (act === 'reset') {
    const m = baseResume(P.data, t), keep = ST.fit; await fitOnePage(m, []); ST.fit = keep;
    TB.undo = { t, model: I.clone(tbDoc(t).current), notes: I.clone(tbDoc(t).notes || {}) };
    try { await tbSave(t, m, 'Back to Profile order', 'base', {}); I.toast(`${t} base is your Profile order again · the Claude version is kept`); } catch (e) { I.toast(e.message); }
    return tbRefresh();
  }
  if (act === 'undo') {
    const u = TB.undo; if (!u || u.t !== t) return;
    try { await tbSave(t, u.model, 'Change undone', u.notes && u.notes.model ? 'ai' : 'base', u.notes); TB.undo = null; I.toast('Undone'); } catch (e) { I.toast(e.message); }
    return tbRefresh();
  }
}
function tbSend() {
  const i = $('#tbIns'); if (!i || !TB.open) return;
  if (!i.value.trim()) { i.focus(); return I.toast('Write what you want changed first.'); }
  TB.rev = i.value; return tbRun(TB.open, i.value.trim(), true);
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-tb]'); if (!b) return; e.preventDefault(); const [act, t] = b.dataset.tb.split(':'); tbAction(act, t); });
document.addEventListener('input', (e) => { if (e.target.id === 'tbIns') TB.rev = e.target.value; });
document.addEventListener('submit', (e) => { if (e.target.id === 'tbForm') { e.preventDefault(); tbSend(); } });
document.addEventListener('keydown', (e) => { if (e.target.id === 'tbIns' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); tbSend(); } });
const dlPair = (ref, label) => `<div class="dlpair" role="group" aria-label="Download ${esc(label)}"><span class="dlp-l" aria-hidden="true">${IC.dl}</span><button type="button" data-dl="${esc(ref.replace('%', 'docx'))}" title="Word document, for most application forms">.docx</button><button type="button" data-dl="${esc(ref.replace('%', 'pdf'))}" title="PDF, for email and portals that prefer it">.pdf</button></div>`;
async function docDownload(kind, fmt, key) {
  let model, label;
  if (kind === 'base') {
    model = masterFor(key); const keep = ST.fit; await fitOnePage(model, []); ST.fit = keep; label = key;
  } else if (kind.endsWith('sent')) {
    kind = kind.slice(0, -4); const r = (DOCS.list || []).find((x) => x.key === key); if (!r || !r[kind] || !r[kind].submittedModel) return;
    model = kind === 'letter' ? letterExport(r[kind].submittedModel) : r[kind].submittedModel; label = r.company + '_submitted';
  } else {
    const r = (DOCS.list || []).find((x) => x.key === key); if (!r || !r[kind]) return;
    model = kind === 'letter' ? letterExport(r[kind].current) : r[kind].current; label = r.company;
    if (kind === 'resume') { model = I.clone(model); normResume(model); }
  }
  const tpl = kind === 'letter' ? (P.data.coverLetterFileName || (P.data.resumeFileName || 'Resume_[Company]').replace(/Resume/, 'Cover_Letter')) : P.data.resumeFileName;
  const name = (tpl || 'Resume_[Company]').replace('[Company]', label.replace(/[^A-Za-z0-9]+/g, '')) || 'Document';
  try {
    const res = await fetch('api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume: model, format: fmt, filename: name }) });
    if (!res.ok) { let m = 'Export failed'; try { m = (await res.json()).error; } catch (_) { /* ignore */ } throw new Error(m); }
    const blob = await res.blob(), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${name}.${fmt}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    I.toast(`Downloaded ${name}.${fmt}`);
  } catch (e) { I.toast(e.message); }
}
document.addEventListener('click', (e) => {
  const dl = e.target.closest('[data-dl]'); if (dl) { const [kind, fmt, ...k] = dl.dataset.dl.split(':'); return docDownload(kind, fmt, k.join(':')); }
  const dk = e.target.closest('[data-dockind]'); if (dk) { DOCS.kind = dk.dataset.dockind; return I.render(); }
});
/* Keep typed-but-unsent text through background re-renders (refresh checks, saves). */
document.addEventListener('input', (e) => { if (e.target.id === 'jbPaste') ST.pasteText = e.target.value; });
document.addEventListener('input', (e) => { if (e.target.id === 'docQ') { DOCS.q = e.target.value; clearTimeout(DOCS.t); DOCS.t = setTimeout(() => { I.render(); const i = $('#docQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 150); } });

/* ---------- register ---------- */
I.VIEWS.profile = ['Profile', () => 'The single source of facts for your resumes, fit and eligibility', () => I.backCrumb()];
I.VIEWS.docs = ['Documents', () => 'Every resume and cover letter you have made, by job', () => I.backCrumb()];
I.R.docs = rDocs;
I.VIEWS.job = { get 0() { const J = resolveJob(curId()); return J ? J.company : 'Job'; }, 1: () => { const J = resolveJob(curId()); return J ? J.role : ''; },
  2: () => { const J = resolveJob(curId()); return J && J.app ? ['#' + (I.S.ui.layout === 'board' ? 'board' : 'table'), 'Back to Applications'] : ['#inbox', 'Back to New listings']; } };
I.R.profile = rProfile;
I.R.job = rJob;
I.HOOKS.settings = rSettings;
I.HOOKS.dataCheck = dataCheckPanel;
/* Eligibility of an analyzed job for the listing rows (computed from your Profile; null when not analyzed). */
I.HOOKS.verdictOf = (x) => {
  const k = I.kitOf(x); if (!k || !k.fitIn || !P.data) return null;
  try { return C.fit(P.data, k.fitIn, { settings: I.S.settings, role: x.role, track: x.track || x.t }); } catch (_) { return null; }
};
I.HOOKS.onApplied = async (a) => {
  const key = I.listingKey(a);
  try {
    const r = await api('POST', 'api/submitted', { key, company: a.company, role: a.role, url: a.url || '' });
    if (r.versions && (r.versions.resume || r.versions.letter)) {
      const st = JOBS.get(key); if (st) { try { const d = await api('GET', 'api/job?key=' + encodeURIComponent(key)); st.resume = d.resume; st.letter = d.letter; } catch (_) { /* shown on next load */ } }
      I.loadKit(); I.toast(`${a.company}: the resume${r.versions.letter ? ' and letter' : ''} you sent are saved as “Submitted”`); I.render();
    }
  } catch (_) { /* no documents for this job yet */ }
};
I.HOOKS.jobNav = () => { const J = resolveJob(curId()); return J && J.app ? 'apps' : 'inbox'; };
I.HOOKS.afterRender.push(() => {
  /* Stub mode (IAT_AI_STUB=1, for tests and the demo) must never be mistaken for real Claude output. */
  const on = !!(AI.status && AI.status.stub); let b = document.getElementById('stubBanner');
  if (on && !b) { b = document.createElement('div'); b.id = 'stubBanner'; b.className = 'stub-banner'; b.setAttribute('role', 'status'); b.textContent = 'Demo / test mode: Claude answers are local stubs (no API calls, no cost).'; document.body.prepend(b); }
  if (!on && b) b.remove();
});
I.HOOKS.afterRender.push((v) => {
  const add = $('#addBtn'); if (add) add.hidden = !['dashboard', 'board', 'table', 'inbox'].includes(v);
  if (v === 'job' || v === 'profile') autosizeAll($('#view'));
  if (v !== 'docs' && DOCS.list && !DOCS.loading) DOCS.list = null; // reload fresh next time
  if (v === 'job') { fitPaper(); if (ST.model && !ST.fit) scheduleFit(); if (LT.model && !LT.fit) letterFit(); }
  if (v === 'profile' && P.focus) { const el = $(P.focus); P.focus = null; if (el) el.focus(); }
  if (v === 'profile') { const sub = location.hash.split('/')[1]; if (sub && !rProfile.scrolled) { rProfile.scrolled = true; const el = document.getElementById('s-' + sub); if (el) el.scrollIntoView({ block: 'start' }); } }
  if (v !== 'profile') rProfile.scrolled = false;
  applyGoto();
});
/* Revise box: keep the typed request across re-renders, fill it from an idea, send with the button or ⌘↵ / Ctrl+↵. */
function sendRevise() {
  const J = JOB, i = $('#rvIns'); if (!J || !i) return;
  const text = i.value.trim();
  if (!text) { i.focus(); return I.toast('Write what you want changed first.'); }
  if (ST.busy) return;
  const track = (ST.notes && ST.notes.track) || J.track;
  ST.revText = i.value;
  return runTailor(J, track, text, true);
}
document.addEventListener('input', (e) => { if (e.target.id === 'rvIns') ST.revText = e.target.value; });
document.addEventListener('submit', (e) => { if (e.target.id === 'rvForm') { e.preventDefault(); sendRevise(); } });
document.addEventListener('keydown', (e) => { if (e.target.id === 'rvIns' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendRevise(); } });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-rv]'); if (!b) return;
  const i = $('#rvIns'); if (!i) return;
  const v = i.value.trim(), add = b.dataset.rv;
  i.value = v ? (v.replace(/[.;,\s]+$/, '') + '; ' + add.charAt(0).toLowerCase() + add.slice(1)) : add;
  ST.revText = i.value; i.focus(); i.setSelectionRange(i.value.length, i.value.length);
});

window.IATStudio = { boot: async () => { await Promise.all([loadProfile(), refreshStatus()]); loadBases(); }, get P() { return P; }, get ST() { return ST; }, baseResume, fromAI, resumeText };
})();

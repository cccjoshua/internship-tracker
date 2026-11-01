/* Search palette (⌘K / Ctrl K, /, or the sidebar Search field).
   Spotlight-style: one field, results grouped under small headers, keyboard first.
   Ranking lives in search.js (IATSearch); this file builds the local index and draws the panel.
   The index is rebuilt only when the data changes (new revision, refresh, documents), never per keystroke.
   Hidden listings (filtered out by your gates) are searched on the server: GET /api/search?scope=hidden. */
(function () {
'use strict';
const I = window.IAT, X = window.IATSearch;
const { $, esc } = I;
const MAX_ROWS = 50;
const ORDER = ['Applications', 'Listings', 'Documents', 'Pages', 'Settings', 'Actions', 'Hidden listings'];
const PER = { Applications: 8, Listings: 8, Documents: 5, Pages: 6, Settings: 6, Actions: 6, 'Hidden listings': 30 };
const SCOPES = [['all', 'All'], ['Applications', 'Applications'], ['Listings', 'Listings'], ['Actions', 'Actions']];
const RECENT_KEY = 'iat-palette-recent';

/* ---------- icons (16px line icons, stroke = currentColor) ---------- */
const svg = (d) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  dashboard: svg('<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>'),
  board: svg('<rect x="2" y="2.5" width="3.4" height="11" rx="1"/><rect x="6.3" y="2.5" width="3.4" height="7" rx="1"/><rect x="10.6" y="2.5" width="3.4" height="9" rx="1"/>'),
  table: svg('<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'),
  inbox: svg('<path d="M2 9.5 4 3h8l2 6.5V13H2z"/><path d="M2 9.5h3.5l1 1.5h3l1-1.5H14"/>'),
  docs: svg('<path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5.2h3.5M6 8.3h4.5M6 10.8h4.5"/>'),
  profile: svg('<circle cx="8" cy="5.5" r="2.7"/><path d="M2.8 14c.6-2.7 2.7-4.2 5.2-4.2s4.6 1.5 5.2 4.2"/>'),
  settings: svg('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>'),
  slider: svg('<path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6"/><circle cx="10" cy="5" r="1.5"/><circle cx="6" cy="11" r="1.5"/>'),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  refresh: svg('<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 2.5V5h-2.5"/>'),
  download: svg('<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>'),
  calendar: svg('<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>'),
  keyboard: svg('<rect x="1.5" y="4" width="13" height="8" rx="1.5"/><path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6"/>'),
  moon: svg('<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/>'),
  undo: svg('<path d="M5 6H10a3 3 0 0 1 0 6H7"/><path d="M7 3.5 4.5 6 7 8.5"/>'),
  check: svg('<path d="m3.5 8.5 3 3 6-7"/>'),
  eyeOff: svg('<path d="M2 2l12 12M6.6 6.6a2 2 0 0 0 2.8 2.8M4.2 4.6C3 5.4 2.1 6.6 1.5 8c1.2 2.8 3.7 4.5 6.5 4.5 1.2 0 2.3-.3 3.3-.9M7 3.6c.3 0 .7-.1 1-.1 2.8 0 5.3 1.7 6.5 4.5-.3.7-.7 1.4-1.2 2"/>'),
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>'),
};
const kbd = (...k) => k.map((x) => `<kbd>${esc(x)}</kbd>`).join('');
const MODK = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';

/* ---------- recent items (per browser; a convenience, so failures are ignored) ---------- */
function recentRead() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 8); } catch (_) { return []; } }
function recentPush(key) { try { const r = recentRead().filter((k) => k !== key); r.unshift(key); localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 8))); } catch (_) { /* storage off */ } }

/* ---------- the local index ---------- */
let INDEX = null, INDEX_KEY = '', DOC_LIST = null, DOC_AT = 0;
function dataKey() {
  const S = I.S, F = I.F;
  return [I.UI.scoredRev, S.apps.length, S.apps.reduce((m, a) => Math.max(m, +new Date(a.updated || 0) || 0), 0), (F && F.fetch && F.fetch.at) || '', (I.visibleListings() || []).length, DOC_AT, JSON.stringify(S.settings.weights), S.settings.topScore].join('|');
}
const active = (a) => !I.CLOSED.includes(a.status);
const scoreTxt = (n) => (n || n === 0) && isFinite(n) ? String(Math.round(n)) : '';
const daysAgo = (d) => { const t = +new Date(d); return t ? (Date.now() - t) / 864e5 : 999; };

function pages() {
  return [
    ['dashboard', 'Dashboard', 'dashboard', ['G', 'D']], ['board', 'Applications', 'board', ['G', 'A'], 'Board'], ['table', 'Applications · List', 'table', ['G', 'T']],
    ['inbox', 'New listings', 'inbox', ['G', 'L']], ['docs', 'Documents', 'docs', ['G', 'O']], ['profile', 'Profile', 'profile', ['G', 'P']], ['settings', 'Settings', 'settings', ['G', 'S']],
  ].map(([v, title, icon, keys, extra]) => ({ id: 'page:' + v, group: 'Pages', title, extra: 'go to open page ' + (extra || ''), icon, keys, run: () => I.go(v) }));
}
function actions() {
  const P = I.palette;
  return [
    ['add', 'Add application', 'plus', ['N'], 'new create application', () => I.openDrawer(null)],
    ['saved', 'Review saved applications', 'check', null, 'to apply queue saved', () => { I.S.ui.stage = 'todo'; I.go('table'); }],
    ['refresh', 'Refresh listings now', 'refresh', null, 'fetch update listings simplify', () => P.startRefresh()],
    ['export', 'Export JSON backup', 'download', null, 'backup download data', () => P.doExport()],
    ['ics', 'Download calendar (.ics)', 'calendar', null, 'ics calendar deadlines subscribe', () => { location.href = 'calendar.ics?download=1'; }],
    ['help', 'Keyboard shortcuts', 'keyboard', ['?'], 'help keys shortcuts', () => P.showHelp()],
    ['theme', 'Toggle dark mode', 'moon', null, 'appearance theme light dark', () => P.cycleTheme()],
    ['undo', 'Undo', 'undo', [MODK, 'Z'], 'undo revert', () => P.undo()],
  ].map(([id, title, icon, keys, extra, run]) => ({ id: 'act:' + id, group: 'Actions', title, extra, icon, keys, run }));
}
/* Every labelled setting, read from the Settings page markup itself so new settings are searchable automatically. */
function settings() {
  let html = '';
  try { html = I.R.settings(); } catch (_) { return []; }
  const box = document.createElement('template'); box.innerHTML = html;
  const out = [], seen = new Set();
  const clean = (el) => { const c = el.cloneNode(true); c.querySelectorAll('.hint,.eff,input,select,textarea,button,small').forEach((x) => x.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
  box.content.querySelectorAll('section[id^="s-"]').forEach((sec) => {
    const h = sec.querySelector('h2'); const secName = h ? clean(h) : '';
    if (secName) out.push({ id: 'set:' + sec.id, group: 'Settings', title: secName, sub: 'Settings', icon: 'settings', target: sec.id, extra: 'settings section' });
    sec.querySelectorAll('label').forEach((lab) => {
      const ctl = lab.htmlFor ? sec.querySelector('#' + CSS.escape(lab.htmlFor)) : lab.querySelector('input,select,textarea');
      const id = ctl && ctl.id; if (!id || seen.has(id)) return; seen.add(id);
      const span = lab.querySelector(':scope > span'); const title = clean(span && !lab.htmlFor ? span : lab);
      if (title && title.length < 90) out.push({ id: 'set:' + id, group: 'Settings', title, sub: secName, icon: 'slider', target: id, extra: 'setting option preference' });
    });
  });
  return out;
}
function listingsDocs() {
  return I.visibleListings().filter((l) => !l.dup).map((l) => ({
    id: 'l:' + l.id, group: 'Listings', title: l.company, sub: l.role, extra: [l.location, l.t || l.track].filter(Boolean).join(' '),
    meta: [l.isNew ? 'New' : '', scoreTxt(l.total) && 'Priority ' + scoreTxt(l.total)].filter(Boolean),
    url: I.safeUrl(l.url), boost: Math.min(10, Math.max(0, (+l.total || 0) - 60) / 4) + (l.isNew ? 3 : 0),
    run: () => I.palette.openListing(l.id),
  }));
}
function appDocs() {
  return I.S.apps.map((a) => ({
    id: 'a:' + a.id, group: 'Applications', title: a.company, sub: a.role, extra: [I.LABEL[a.status], a.location, a.notes].filter(Boolean).join(' '),
    meta: [I.LABEL[a.status], a.deadline ? 'Due ' + I.fmt(a.deadline) : ''].filter(Boolean), url: I.safeUrl(a.url),
    boost: active(a) ? 15 + (daysAgo(a.updated) < 7 ? 5 : 0) : -25,
    run: () => I.openDrawer(a.id),
  }));
}
function docDocs() {
  return (DOC_LIST || []).map((r) => {
    const kinds = [r.resume && 'Resume', r.letter && 'Cover letter'].filter(Boolean);
    return { id: 'd:' + r.key, group: 'Documents', title: r.company, sub: r.role, extra: kinds.join(' ') + ' document resume letter', meta: kinds, icon: 'docs',
      run: () => { const id = I.jobIdForKey(r.key); location.hash = id ? '#job/' + encodeURIComponent(id) + '/resume' : '#docs'; } };
  });
}
function buildIndex() {
  const recent = new Set(recentRead());
  const docs = [...appDocs(), ...listingsDocs(), ...docDocs(), ...pages(), ...settings(), ...actions()];
  for (const d of docs) if (recent.has(d.id)) d.boost = (d.boost || 0) + 8;
  INDEX = X.buildIndex(docs); INDEX.byId = new Map(docs.map((d) => [d.id, d])); INDEX_KEY = dataKey();
}
function ensureIndex() { if (!INDEX || INDEX_KEY !== dataKey()) buildIndex(); }
function loadDocs() {
  if (DOC_LIST && Date.now() - DOC_AT < 60e3) return;
  fetch('api/studio/docs').then((r) => (r.ok ? r.json() : [])).then((list) => { DOC_LIST = Array.isArray(list) ? list : []; DOC_AT = Date.now(); if (st.open) { ensureIndex(); draw(); } }).catch(() => { DOC_LIST = DOC_LIST || []; });
}

/* ---------- state + DOM ---------- */
const st = { open: false, idx: 0, rows: [], scope: 'all', opener: null, hidden: null, hiddenFor: '', q: '' };
let el, inp, list, foot, live, scopesEl;
function mount() {
  if (el) return;
  el = document.createElement('dialog'); el.className = 'pal'; el.id = 'pal'; el.setAttribute('aria-label', 'Search');
  el.innerHTML = `<div class="pal-field">${ICON.search}<input id="palIn" type="text" role="combobox" aria-expanded="true" aria-controls="palList" aria-autocomplete="list" aria-haspopup="listbox" autocomplete="off" spellcheck="false" placeholder="Search applications, listings, and actions" aria-describedby="palHint"><kbd class="pal-esc" aria-hidden="true">esc</kbd></div>
    <div class="pal-scopes" role="radiogroup" aria-label="Search in" id="palScopes"></div>
    <div class="pal-list" id="palList" role="listbox" aria-label="Results"></div>
    <div class="pal-foot" id="palFoot"></div>
    <p class="sr" id="palHint">Up and down arrows move, Enter opens, Command Enter opens the posting, Tab changes the search scope, Escape closes.</p>
    <div class="sr" id="palLive" role="status" aria-live="polite"></div>`;
  document.body.appendChild(el);
  inp = $('#palIn', el); list = $('#palList', el); foot = $('#palFoot', el); live = $('#palLive', el); scopesEl = $('#palScopes', el);
  inp.addEventListener('input', () => { st.idx = 0; st.hidden = null; draw(); });
  inp.addEventListener('keydown', onKey);
  list.addEventListener('mousemove', (e) => { const o = e.target.closest('[role=option]'); if (o && +o.dataset.i !== st.idx) { st.idx = +o.dataset.i; paintActive(); } });
  list.addEventListener('click', (e) => { const o = e.target.closest('[role=option]'); if (o) run(+o.dataset.i, e.metaKey || e.ctrlKey); });
  scopesEl.addEventListener('click', (e) => { const b = e.target.closest('[data-scope]'); if (b) { setScope(b.dataset.scope); inp.focus(); } });
  el.addEventListener('cancel', (e) => { e.preventDefault(); close(true); });
  el.addEventListener('click', (e) => { if (e.target === el) close(true); }); // backdrop
}

function open() {
  mount();
  if (st.open) { inp.select(); return; }
  st.opener = document.activeElement; st.open = true; st.idx = 0; st.scope = 'all'; st.hidden = null;
  ensureIndex(); loadDocs();
  inp.value = ''; el.classList.remove('closing'); el.showModal(); inp.focus(); draw();
}
/* restore: put focus back where it was (dismissed). after: runs once the dialog is closed, so the dialog's own
   focus restoration cannot steal focus from what the action opens. */
function close(restore, after) {
  if (!st.open) return; st.open = false;
  const done = () => {
    el.classList.remove('closing'); if (el.open) el.close();
    if (after) after(); else if (restore && st.opener && document.contains(st.opener)) st.opener.focus();
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
  el.classList.add('closing'); setTimeout(done, 120);
}
function setScope(s) { st.scope = s; st.idx = 0; draw(); }

/* ---------- results ---------- */
function query() {
  const raw = inp.value; const act = raw.trimStart().startsWith('>');
  return { text: act ? raw.trimStart().slice(1).trim() : raw.trim(), scope: act ? 'Actions' : st.scope };
}
function emptyState(scope) {
  const out = []; const add = (group, items) => { if (items.length) out.push({ group, items: items.map((doc) => ({ doc, title: [], sub: [] })) }); };
  if (scope !== 'all') {
    const docs = [...INDEX.byId.values()].filter((d) => d.group === scope);
    const sorted = scope === 'Actions' ? docs : docs.slice().sort((a, b) => (b.boost || 0) - (a.boost || 0));
    add(scope, sorted.slice(0, MAX_ROWS)); return out;
  }
  const recent = recentRead().map((k) => INDEX.byId.get(k)).filter(Boolean).slice(0, 2);
  const shown = new Set(recent.map((d) => d.id));
  const q = (I.palette.queue() || []).map((x) => INDEX.byId.get(x.kind === 'app' ? 'a:' + x.a.id : 'l:' + x.l.id)).filter((d) => d && !shown.has(d.id)).slice(0, 2);
  q.forEach((d) => shown.add(d.id));
  const here = I.route();
  const goTo = ['page:board', 'page:inbox', 'page:docs', 'page:dashboard'].filter((k) => k !== 'page:' + here && !shown.has(k)).slice(0, 2).map((k) => INDEX.byId.get(k));
  const acts = ['act:add', 'act:refresh'].map((k) => INDEX.byId.get(k));
  add('Recent', recent); add('Suggested', q); add('Go to', goTo); add('Actions', acts);
  return out;
}
function results() {
  const { text, scope } = query();
  if (!text) return emptyState(scope);
  const filter = scope === 'all' ? null : (d) => d.group === scope;
  const groups = X.group(X.search(INDEX, text, { filter, limit: 400 }), ORDER, scope === 'all' ? PER : { [scope]: MAX_ROWS }, MAX_ROWS);
  if (st.hidden && st.hiddenFor === text) groups.push({ group: 'Hidden listings', items: st.hidden.slice(0, MAX_ROWS).map((doc) => ({ doc, title: doc.hl || [], sub: [] })) });
  return groups;
}
function noResultRows(text) {
  return [{ group: '', items: [
    { doc: { id: 'nr:add', group: 'Actions', title: `Add “${text}” as an application`, icon: 'plus', run: () => I.openDrawer(null, { company: text }) }, title: [], sub: [] },
    { doc: { id: 'nr:hidden', group: 'Actions', title: 'Search hidden listings', sub: 'Listings your filters leave out', icon: 'eyeOff', keep: true, run: () => searchHidden(text) }, title: [], sub: [] },
  ] }];
}
function searchHidden(text) {
  st.hiddenFor = text;
  list.setAttribute('aria-busy', 'true'); live.textContent = 'Searching hidden listings…';
  fetch('api/search?scope=hidden&limit=30&q=' + encodeURIComponent(text)).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((d) => {
    const items = ((d.groups || [])[0] || { items: [] }).items;
    st.hidden = items.map((it) => ({ id: 'h:' + it.id, group: 'Hidden listings', title: it.company, sub: it.role, meta: [it.reason], url: I.safeUrl(it.url), icon: 'eyeOff', hl: it.hl || [], run: () => { if (I.safeUrl(it.url)) window.open(I.safeUrl(it.url), '_blank', 'noopener'); } }));
    st.idx = 0; list.removeAttribute('aria-busy');
    if (!st.hidden.length) st.hidden = [{ id: 'h:none', group: 'Hidden listings', title: `No hidden listings match “${text}”`, icon: 'eyeOff', inert: true }];
    draw();
  }).catch(() => { list.removeAttribute('aria-busy'); st.hidden = [{ id: 'h:err', group: 'Hidden listings', title: 'Could not search hidden listings', sub: 'Is the local server running? Try again in a moment.', icon: 'eyeOff', inert: true }]; draw(); });
}

function monogram(name) {
  const w = String(name || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/);
  const m = (w.length > 1 && w[1] ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
  return `<span class="pal-mono" aria-hidden="true">${esc(m)}</span>`;
}
function rowHtml(r, i) {
  const d = r.doc, isCo = d.group === 'Applications' || d.group === 'Listings' || d.group === 'Hidden listings' && !d.inert;
  const lead = isCo ? monogram(d.title) : `<span class="pal-ic" aria-hidden="true">${ICON[d.icon] || ICON.search}</span>`;
  const sub = [d.sub ? X.highlight(d.sub, r.sub, esc) : '', ...(d.meta || []).map(esc)].filter(Boolean).join(' · ');
  const keys = d.keys ? `<span class="pal-keys">${kbd(...d.keys)}</span>` : '';
  if (d.inert) return `<div class="pal-row inert" role="option" aria-disabled="true" id="pal-o${i}" data-i="${i}">${lead}<span class="pal-txt"><span class="pal-t">${esc(d.title)}</span>${d.sub ? `<span class="pal-s">${esc(d.sub)}</span>` : ''}</span></div>`;
  return `<div class="pal-row" role="option" id="pal-o${i}" data-i="${i}" aria-selected="false">${lead}<span class="pal-txt"><span class="pal-t">${X.highlight(d.title, r.title, esc)}</span>${sub ? `<span class="pal-s">${sub}</span>` : ''}</span>${keys}<kbd class="pal-ret" aria-hidden="true">↵</kbd></div>`;
}
function draw() {
  if (!st.open) return;
  ensureIndex();
  const { text, scope } = query();
  scopesEl.innerHTML = SCOPES.map(([k, l]) => `<button type="button" role="radio" tabindex="-1" data-scope="${k}" aria-checked="${scope === k}">${l}</button>`).join('');
  let groups = results(); let n = groups.reduce((s, g) => s + g.items.length, 0);
  let html = '';
  if (text && !n && !st.hidden) {
    html += `<div class="pal-none">No results for “${esc(text)}”</div>`;
    groups = noResultRows(text);
  }
  st.rows = []; let gi = 0;
  for (const g of groups) {
    const hid = 'pal-g' + gi++;
    html += `<div role="group"${g.group ? ` aria-labelledby="${hid}"` : ' aria-label="Suggestions"'}>${g.group ? `<div class="pal-h" id="${hid}" role="presentation">${esc(g.group)}${g.more ? `<span>${g.more} more · press Tab to narrow</span>` : ''}</div>` : ''}`;
    for (const r of g.items) { html += rowHtml(r, st.rows.length); st.rows.push(r); }
    html += '</div>';
  }
  if (text && scope === 'Listings' && !st.hidden && n) {
    const r = { doc: { id: 'nr:hidden', group: 'Actions', title: 'Search hidden listings too', icon: 'eyeOff', keep: true, run: () => searchHidden(text) }, title: [], sub: [] };
    html += `<div role="group" aria-label="More">${rowHtml(r, st.rows.length)}</div>`; st.rows.push(r);
  }
  list.innerHTML = html;
  n = st.rows.filter((r) => !r.doc.inert).length;
  st.idx = Math.min(st.idx, Math.max(0, st.rows.length - 1));
  if (st.rows[st.idx] && st.rows[st.idx].doc.inert) st.idx = nextIdx(st.idx, 1);
  paintActive();
  clearTimeout(draw.t); draw.t = setTimeout(() => { live.textContent = text ? (n ? `${n} result${n === 1 ? '' : 's'}` : `No results for ${text}`) : ''; }, 250);
}
function nextIdx(from, dir) {
  const L = st.rows.length; if (!L) return 0;
  for (let k = 1; k <= L; k++) { const i = (from + dir * k + L * 2) % L; if (!st.rows[i].doc.inert) return i; }
  return from;
}
function paintActive() {
  list.querySelectorAll('[aria-selected="true"]').forEach((o) => o.setAttribute('aria-selected', 'false'));
  const o = $('#pal-o' + st.idx, list); const row = st.rows[st.idx];
  if (o && row && !row.doc.inert) { o.setAttribute('aria-selected', 'true'); inp.setAttribute('aria-activedescendant', o.id); o.scrollIntoView({ block: 'nearest' }); }
  else inp.removeAttribute('aria-activedescendant');
  footFor(row && !row.doc.inert ? row.doc : null);
}
function footFor(d) {
  const hint = (k, t) => `<span>${k} ${t}</span>`;
  const g = d && d.group;
  const primary = !d ? '' : g === 'Applications' ? 'Open' : g === 'Listings' ? 'Preview' : g === 'Documents' ? 'Open resume' : g === 'Settings' ? 'Jump to setting' : g === 'Pages' ? 'Go' : g === 'Hidden listings' ? 'Open posting' : 'Run';
  const parts = [];
  if (d) parts.push(hint(kbd('↵'), primary));
  if (d && d.url && g !== 'Hidden listings') parts.push(hint(kbd(MODK, '↵'), 'Open posting'));
  parts.push(hint(kbd('↑', '↓'), 'Move'), hint(kbd('tab'), 'Scope'));
  foot.innerHTML = parts.join('') + `<span class="pal-tip">${kbd('>')} actions only</span>`;
}

/* ---------- running ---------- */
function run(i, secondary) {
  const r = st.rows[i]; if (!r || r.doc.inert) return;
  const d = r.doc;
  if (secondary) { if (d.url) { window.open(d.url, '_blank', 'noopener'); recentPush(d.id); } return; }
  if (d.keep) return d.run(); // stays open (e.g. search hidden listings)
  if (!d.id.startsWith('nr:') && !d.id.startsWith('h:')) recentPush(d.id);
  close(false, () => (d.target ? revealSetting(d.target) : d.run && d.run()));
}
/* Go to Settings, scroll the setting into view, focus it and highlight it briefly. */
function revealSetting(id) {
  if (I.route() !== 'settings') I.go('settings');
  let tries = 0;
  const find = () => {
    const t = document.getElementById(id);
    if (!t) { if (tries++ < 20) return requestAnimationFrame(find); return; }
    if (I.palette.showSettingsPane) I.palette.showSettingsPane(t);
    const box = t.closest('section') === t ? t : t.closest('.field, label, .switch, .weights label, .row') || t;
    const target = t.matches('section') ? t : (box.tagName === 'LABEL' && box.htmlFor ? box : box);
    target.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const ctl = t.matches('input,select,textarea') ? t : t.querySelector('input,select,textarea');
    if (ctl) ctl.focus({ preventScroll: true });
    const hl = t.matches('input,select,textarea') ? (document.querySelector(`label[for="${CSS.escape(id)}"]`) || t.closest('.field, label') || t) : t;
    hl.classList.remove('pal-flash'); void hl.offsetWidth; hl.classList.add('pal-flash');
    setTimeout(() => hl.classList.remove('pal-flash'), 1800);
  };
  requestAnimationFrame(find);
}

function onKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); st.idx = nextIdx(st.idx, e.key === 'ArrowDown' ? 1 : -1); paintActive(); return; }
  if (e.key === 'Enter') { e.preventDefault(); run(st.idx, e.metaKey || e.ctrlKey); return; }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (inp.value.trimStart().startsWith('>')) inp.value = inp.value.trimStart().slice(1).trimStart();
    const k = SCOPES.findIndex(([s]) => s === st.scope);
    setScope(SCOPES[(k + (e.shiftKey ? -1 : 1) + SCOPES.length) % SCOPES.length][0]); return;
  }
  if (e.key === 'Escape') { e.preventDefault(); close(true); }
}

window.IATPalette = { open, close, get isOpen() { return st.open; }, rebuild: () => { INDEX_KEY = ''; }, _search: (q) => { ensureIndex(); return X.search(INDEX, q, { limit: 50 }); } };
})();

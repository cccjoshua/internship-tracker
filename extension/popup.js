import { extractJob } from './extract.js';

const $ = (s) => document.querySelector(s);
const FROM = { 'page data': 'from page data', page: 'from page', title: 'from title', heading: 'from heading', 'site name': 'from site name', address: 'from address',
  'posting text': 'from posting text', 'listing expiry': 'listing expiry · check it', 'largest text block': 'best guess', 'your selection': 'your selection' };
const S = { base: 'http://127.0.0.1:8765', job: null, online: false, claude: false, match: null, url: '', trackTouched: false };

const store = {
  get: (k, d) => new Promise((r) => { try { chrome.storage.sync.get({ [k]: d }, (v) => r(v[k])); } catch (_) { r(d); } }),
  set: (k, v) => { try { chrome.storage.sync.set({ [k]: v }); } catch (_) { /* ignore */ } },
};
async function api(path, body) {
  const r = await fetch(S.base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-IAT-Client': 'extension' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  let j = null; try { j = await r.json(); } catch (_) { /* not JSON */ }
  if (!r.ok && r.status !== 409) throw new Error((j && j.error) || `Tracker answered ${r.status}`);
  return Object.assign({ status: r.status }, j);
}
function setConn(state, text) { const c = $('#conn'); c.className = 'conn ' + state; c.querySelector('span').textContent = text; }
function showErr(t) { const e = $('#err'); e.textContent = t || ''; e.hidden = !t; }
const val = (id) => $('#' + id).value.trim();
const fmt = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };

function fill(job) {
  for (const k of ['company', 'role', 'location', 'posted', 'deadline', 'pay', 'description']) $('#' + k).value = job[k] || '';
  if (['Remote', 'Hybrid', 'On-site'].includes(job.workMode)) $('#workMode').value = job.workMode;
  document.querySelectorAll('[data-from]').forEach((i) => {
    const k = i.dataset.from, how = job.from && job.from[k];
    i.textContent = how ? FROM[how] || how : (['company', 'role'].includes(k) ? 'not found · type it' : '');
    i.classList.toggle('miss', !how && ['company', 'role'].includes(k) || how === 'listing expiry' || how === 'largest text block');
  });
  $('#descBox').open = !job.description; // nothing found: show the box so it can be pasted
  descSummary();
}
function descSummary() {
  const n = val('description').length;
  $('#descSum').textContent = n ? `Job description · ${n.toLocaleString('en-US')} characters${S.job && S.job.from.description ? ' · ' + (FROM[S.job.from.description] || S.job.from.description) : ''}` : 'Job description · not found (paste or select it on the page)';
  const an = $('#analyze'), was = an.disabled; an.disabled = !S.claude || n < 200;
  if (was && !an.disabled && !S.anTouched) an.checked = S.anPref; // enabled once a description is there: use your last choice
  $('#anHint').textContent = !S.claude ? '(add your Claude API key in the tracker’s Settings first)' : n < 200 ? '(needs the job description)' : '(≈ $0.001, about 10 seconds)';
}

async function checkDup() {
  if (!S.online) return;
  const company = val('company'), role = val('role');
  if (!company && !S.url) return;
  try {
    const r = await api('/api/clip/check', { url: S.url, company, role });
    S.match = r.match;
    if (r.track && !S.trackTouched) $('#track').value = r.track;
    const box = $('#dup');
    if (r.match) {
      const m = r.match, st = m.pending ? 'waiting for the tracker page to add it' : m.status === 'applied' ? `Applied${m.applied ? ' ' + fmt(m.applied) : ''}` : m.status ? m.status[0].toUpperCase() + m.status.slice(1) : 'Saved';
      box.innerHTML = `<b>Already in your tracker</b><span>${esc(m.company)} · ${esc(m.role)} — ${esc(st)}</span><a href="${esc(S.base)}/#job/${encodeURIComponent(m.id)}" target="_blank">Open it in the tracker →</a>`;
      box.hidden = false; $('#save').disabled = true; $('#save').textContent = 'Already saved';
    } else { box.hidden = true; $('#save').disabled = false; $('#save').textContent = 'Save to tracker'; }
  } catch (_) { /* ignore: saving reports problems */ }
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function connect() {
  try {
    const r = await api('/api/clip/ping');
    S.online = !!r.ok; S.claude = !!r.claude;
    setConn('on', 'Connected'); $('#offline').hidden = true;
  } catch (_) {
    S.online = false; setConn('off', 'Not running'); $('#offline').hidden = false;
  }
  $('#save').disabled = !S.online;
  descSummary();
}

async function readPage() {
  let tab = null;
  try {
    const pick = +new URLSearchParams(location.search).get('tab'); // opened as a page (tests, or "pop out"): read that tab
    [tab] = pick ? [await chrome.tabs.get(pick)] : await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) { /* no tabs API */ }
  if (!tab || !/^https?:/.test(tab.url || '')) {
    $('#pageNote').textContent = 'This page cannot be read. Open a job posting, or fill in the fields yourself.'; $('#pageNote').hidden = false;
    S.job = { from: {} }; fill(S.job); return;
  }
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJob });
    S.job = res.result || { from: {} };
  } catch (e) {
    S.job = { url: tab.url, role: tab.title || '', from: { role: 'title' } };
    $('#pageNote').textContent = 'Could not read this page (the browser blocks it). Check the fields below.'; $('#pageNote').hidden = false;
  }
  S.url = S.job.url || tab.url;
  fill(S.job);
  if (!S.job.company || !S.job.role) { $('#pageNote').textContent = `Some details were not found on this ${S.job.source || 'page'}. Fill in the highlighted fields.`; $('#pageNote').hidden = false; }
}

async function submit(e) {
  e.preventDefault(); showErr('');
  for (const id of ['company', 'role']) $('#' + id).classList.add('touched');
  if (!val('company') || !val('role')) { showErr('Company and role are required.'); (val('company') ? $('#role') : $('#company')).focus(); return; }
  const btn = $('#save'); btn.disabled = true; btn.textContent = 'Saving…';
  const analyze = $('#analyze').checked && !$('#analyze').disabled;
  store.set('analyze', $('#analyze').checked);
  try {
    const body = { company: val('company'), role: val('role'), location: val('location'), url: S.url, posted: val('posted'), deadline: val('deadline'), pay: val('pay'), workMode: val('workMode'),
      track: val('track'), status: document.querySelector('input[name=status]:checked').value, notes: val('notes'), description: $('#description').value, source: (S.job && S.job.source) || '', analyze };
    const r = await api('/api/clip', body);
    if (r.status === 409) { S.match = r.match; await checkDup(); return; }
    $('#main').hidden = true; $('#done').hidden = false;
    $('#doneTitle').textContent = body.status === 'applied' ? 'Added as Applied' : 'Saved to your tracker';
    const sp = r.clip.sponsor === 'no' ? ' Heads-up: the posting says it does not sponsor visas.' : r.clip.sponsor === 'yes' ? ' The posting mentions sponsorship or CPT/OPT.' : '';
    $('#doneSub').textContent = `${body.company} · ${body.role}.${analyze ? ' Claude is analyzing it now.' : ''}${sp}`;
    $('#openJob').href = r.open; $('#openJob').focus();
  } catch (err) {
    showErr(/fetch|network|Failed/i.test(err.message) ? 'Could not reach the tracker. Is it running?' : err.message);
    btn.disabled = false; btn.textContent = 'Save to tracker';
  }
}

(async () => {
  S.base = (await store.get('base', S.base)).replace(/\/+$/, '');
  $('#base').value = S.base;
  try { chrome.commands.getAll((cs) => { const c = (cs || []).find((x) => x.name === '_execute_action'); if (c && c.shortcut) $('#kbd').textContent = c.shortcut; }); } catch (_) { /* ignore */ }
  const pref = await store.get('analyze', true); S.anPref = pref;
  await Promise.all([connect(), readPage()]);
  $('#analyze').checked = pref && !$('#analyze').disabled;
  await checkDup();
  (val('company') && val('role') ? $('#save') : (val('company') ? $('#role') : $('#company'))).focus();
})();

$('#f').addEventListener('submit', submit);
$('#description').addEventListener('input', descSummary);
$('#analyze').addEventListener('change', () => { S.anTouched = true; });
$('#track').addEventListener('change', () => { S.trackTouched = true; });
for (const id of ['company', 'role']) $('#' + id).addEventListener('change', checkDup);
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); $('#f').requestSubmit(); } });
const openTracker = (e) => { e.preventDefault(); chrome.tabs.create({ url: S.base + '/#inbox' }); window.close(); };
$('#openTracker').addEventListener('click', openTracker); $('#openTracker2').addEventListener('click', openTracker);
$('#close').addEventListener('click', () => window.close());
$('#saveBase').addEventListener('click', async () => { S.base = (val('base') || 'http://127.0.0.1:8765').replace(/\/+$/, ''); store.set('base', S.base); await connect(); await checkDup(); });

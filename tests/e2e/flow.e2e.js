/* End-to-end flow in a real browser against an isolated server with stubbed Claude (no network, no cost).
   Start the server first:
     python3 scripts/make_demo_data.py /tmp/iat-e2e
     IAT_AI_STUB=1 python3 server.py --data /tmp/iat-e2e --no-fetch --no-browser --port 8783
   Then: node tests/e2e/flow.e2e.js http://127.0.0.1:8783 [screenshot-dir] */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.argv[2] || 'http://127.0.0.1:8783', shots = process.argv[3] || '';
const step = (m) => console.log('✓ ' + m);
const api = async (p, path) => p.evaluate(async (u) => (await fetch(u, { cache: 'no-store' })).json(), path);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  global.__page = p;
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  p.on('response', async (r) => { if (r.status() >= 500) console.log('HTTP', r.status(), r.url(), (await r.text().catch(() => '')).slice(0, 200)); });
  await p.goto(base + '/#inbox', { waitUntil: 'networkidle' });
  assert.ok(await p.locator('#stubBanner').isVisible(), 'stub banner is shown');

  // 1. search and filter
  const search = p.getByPlaceholder(/Search company, role, loc/);
  await search.fill('mesa');
  await p.waitForTimeout(400);
  const rows = await p.locator('article.lrow').count();
  assert.equal(rows, 1, 'search narrows the list to one listing');
  step('search finds the fixture listing');

  // 2. save it
  await p.locator('article.lrow').first().locator('[data-trackl]').click();
  await p.waitForFunction(() => window.IAT.S.apps.some((a) => a.company === 'Mesa Verde Software'));
  const appId = await p.evaluate(() => window.IAT.S.apps.find((a) => a.company === 'Mesa Verde Software').id);
  await search.fill('');
  step('saved to Applications');

  // 3. analyze (stub) and see fit + eligibility
  await p.goto(base + '/#job/' + encodeURIComponent(appId), { waitUntil: 'networkidle' });
  // The fictional posting link cannot be read, so the app offers to paste the description (as it would for a login-only page).
  await p.locator('[data-jb="analyze"]').first().click();
  await p.locator('#jbPaste').waitFor();
  await p.locator('#jbPaste').fill('Backend Software Engineer Intern at Mesa Verde Software. You will build services in Java with SQL databases, ' +
    'ship them with Docker and Kubernetes, and write tests. Pursuing a BS or MS in Computer Science. International students on CPT or OPT are welcome to apply. '.repeat(3));
  await p.locator('[data-jb="analyze-paste"]').click();
  await p.locator('.verdict').waitFor();
  assert.ok(await p.locator('.elig .el').count() >= 3, 'eligibility rows are listed');
  step('analysis shows a verdict and eligibility rows');

  // 4. resume: tailor (stub), edit a bullet, autosave
  await p.goto(base + '/#job/' + encodeURIComponent(appId) + '/resume', { waitUntil: 'networkidle' });
  await p.locator('[data-jb="tailor"]').first().click();
  await p.locator('#tlForm button[type="submit"]').click();
  await p.locator('[data-rs$=".text"]').first().waitFor();
  const bullet = p.locator('textarea[data-rs*="bullets"]').first();
  await bullet.fill('Built SQL Server stored procedures for an approval workflow used by 3 departments (edited)');
  await p.waitForFunction(() => (document.querySelector('#rsState') || {}).textContent === 'Saved', null, { timeout: 15000 });
  if (shots) await p.screenshot({ path: shots + '/e2e-resume.png' });
  step('tailored (stub), edited a bullet, autosaved');

  // 4b. revise in your own words, then undo it
  await p.locator('.rv-idea').first().click();
  assert.equal(await p.inputValue('#rvIns'), await p.locator('.rv-idea').first().getAttribute('data-rv'), 'an idea fills the box');
  await p.fill('#rvIns', 'Put SQL first');
  await p.press('#rvIns', 'Control+Enter');
  await p.locator('.rv-last', { hasText: 'Last request: “Put SQL first”' }).waitFor({ timeout: 15000 });
  assert.equal(await p.inputValue('#rvIns'), '', 'the box clears after a revision');
  assert.ok(!(await p.inputValue('textarea[data-rs*="bullets"] >> nth=0')).includes('(edited)'), 'the revised draft replaced the edited one');
  await p.locator('[data-jb="rv-undo"]').click();
  await p.waitForFunction(() => [...document.querySelectorAll('textarea[data-rs*="bullets"]')].some((t) => t.value.includes('(edited)')));
  assert.equal(await p.locator('[data-jb="rv-undo"]').count(), 0, 'undo is offered once');
  if (shots) await p.screenshot({ path: shots + '/e2e-revise.png' });
  step('revised with a request (⌘/Ctrl+↵), then undone');

  // 5. race: edit, then switch to another job before the debounce fires; the edit must land on the right job only
  await bullet.fill('RACE EDIT for Mesa Verde');
  const other = await p.evaluate(() => window.IAT.S.apps.find((a) => a.company === 'Copperline Telecom').id);
  await p.goto(base + '/#job/' + encodeURIComponent(other) + '/resume');
  await p.waitForTimeout(1600);
  const keyOf = (id) => p.evaluate((x) => { const a = window.IAT.S.apps.find((y) => y.id === x); return window.IAT.listingKey(a); }, id);
  const mine = await api(p, 'api/job?key=' + encodeURIComponent(await keyOf(appId)));
  const theirs = await api(p, 'api/job?key=' + encodeURIComponent(await keyOf(other)));
  assert.ok(JSON.stringify(mine.resume.current).includes('RACE EDIT'), 'pending edit saved to its own job');
  assert.ok(!theirs.resume || !JSON.stringify(theirs.resume.current).includes('RACE EDIT'), 'other job untouched');
  step('switching jobs mid-save keeps each edit with its own job');

  // 6. cover letter (stub)
  await p.goto(base + '/#job/' + encodeURIComponent(appId) + '/letter', { waitUntil: 'networkidle' });
  await p.locator('[data-lt="write"]').first().click();
  await p.locator('textarea[data-lt-p^="paragraphs"]').first().waitFor();
  step('cover letter written (stub)');

  // 6b. a Claude-tailored base resume for a track, revised, then used as a job's starting point
  await p.goto(base + '/#docs', { waitUntil: 'networkidle' });
  await p.locator('[data-tb="tailor:DE"]').click();
  await p.locator('dialog#dlg.tbd .tb-paper .paper').waitFor({ timeout: 15000 });
  assert.match(await p.textContent('dialog#dlg .tb-head'), /DE base resume.*Tailored by Claude/s, 'opens for review once tailored');
  await p.fill('#tbIns', 'Lead Skills with SQL');
  await p.press('#tbIns', 'Control+Enter');
  await p.locator('[data-tb="undo:DE"]').waitFor({ timeout: 15000 });
  const vers = await api(p, 'api/bases');
  assert.ok(vers.bases.DE.versions.some((v) => /revise: Lead Skills with SQL/.test(v.label)), 'revision saved as a version');
  if (shots) await p.screenshot({ path: shots + '/e2e-base.png' });
  await p.locator('dialog#dlg [data-close].primary').click();
  assert.ok(await p.locator('.dbase-l [data-tb="open:DE"]').isVisible(), 'the row offers Review now');
  const deApp = await p.evaluate(() => window.IAT.S.apps.find((a) => a.track === 'DE'));
  assert.ok(deApp, 'demo data has a DE application');
  await p.goto(base + '/#job/' + encodeURIComponent(deApp.id) + '/resume', { waitUntil: 'networkidle' });
  await p.locator('[data-jb="base"]').first().click();
  await p.locator('#toast', { hasText: 'Started from your DE base resume' }).waitFor({ timeout: 5000 });
  step('DE base resume tailored, revised, and used as the starting point');

  // 7. export resume (.docx, .pdf) and mark reviewed
  await p.goto(base + '/#job/' + encodeURIComponent(appId) + '/resume', { waitUntil: 'networkidle' });
  await p.locator('[data-jb="review"]').click();
  await p.waitForTimeout(500);
  for (const fmt of ['docx', 'pdf']) {
    const [dl] = await Promise.all([p.waitForEvent('download'), p.locator(`[data-jb="${fmt}"]`).click()]);
    assert.ok(dl.suggestedFilename().endsWith('.' + fmt), dl.suggestedFilename());
  }
  await p.waitForTimeout(800);
  const doc = (await api(p, 'api/job?key=' + encodeURIComponent(await keyOf(appId)))).resume;
  assert.equal(doc.state.exported, true); assert.deepEqual(doc.state.exportedFormats, ['docx', 'pdf']); assert.equal(doc.state.reviewed, true);
  step('exported .docx and .pdf; reviewed + exported recorded for this exact content');

  // 8. editing after export: no longer "exported"
  await p.locator('textarea[data-rs*="bullets"]').first().fill('Changed after export');
  await p.waitForFunction(() => (document.querySelector('#rsState') || {}).textContent === 'Saved', null, { timeout: 15000 });
  const doc2 = (await api(p, 'api/job?key=' + encodeURIComponent(await keyOf(appId)))).resume;
  assert.equal(doc2.state.exported, false); assert.equal(doc2.state.exportedBefore, true); assert.equal(doc2.state.reviewed, false);
  step('an edit after export clears "exported" and "reviewed"');

  // 9. mark applied, reload, confirm
  await p.goto(base + '/#job/' + encodeURIComponent(appId) + '/apply', { waitUntil: 'networkidle' });
  await p.locator(`[data-applied-app="${appId}"]`).first().click();
  await p.waitForTimeout(1200);
  await p.reload({ waitUntil: 'networkidle' });
  const st = await p.evaluate((x) => window.IAT.S.apps.find((a) => a.id === x).status, appId);
  assert.equal(st, 'applied');
  const saved = await api(p, 'api/state');
  assert.equal(saved.apps.find((a) => a.id === appId).status, 'applied');
  step('marked applied; still applied after reload and in tracker.json');

  assert.deepEqual(errors, [], 'no page errors');
  await b.close();
  console.log('E2E OK');
})().catch(async (e) => {
  console.error(e);
  if (shots && global.__page) await global.__page.screenshot({ path: shots + '/e2e-failure.png' }).catch(() => {});
  process.exit(1);
});

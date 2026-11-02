/* Keyboard interaction test for the ⌘K search palette, in a real browser against demo data (fictional companies).
   Run by tests/e2e/run.sh, or:  node tests/e2e/palette.e2e.js http://127.0.0.1:8783 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.argv[2] || 'http://127.0.0.1:8783';
const step = (m) => console.log('✓ palette: ' + m);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/#dashboard', { waitUntil: 'networkidle' });
  if (await p.locator('dialog#dlg[open]').count()) await p.keyboard.press('Escape');
  const MOD = (await p.evaluate(() => /Mac/.test(navigator.platform))) ? 'Meta' : 'Control';
  const isOpen = () => p.evaluate(() => !!document.querySelector('dialog#pal[open]'));
  const active = () => p.evaluate(() => { const id = document.getElementById('palIn').getAttribute('aria-activedescendant'); const o = id && document.getElementById(id); return o ? o.querySelector('.pal-t').textContent : null; });
  const groups = () => p.$$eval('#palList .pal-h', (hs) => hs.map((h) => h.firstChild.textContent));

  // Triggers: ⌘K / Ctrl K, "/", the sidebar Search field
  await p.keyboard.press(MOD + '+k'); assert.ok(await isOpen(), MOD + '+K opens');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'palIn', 'input has focus');
  assert.equal(await p.getAttribute('#palIn', 'role'), 'combobox');
  assert.equal(await p.getAttribute('#palIn', 'aria-controls'), 'palList');
  assert.equal(await p.getAttribute('#palList', 'role'), 'listbox');
  assert.ok((await groups()).includes('Actions') && (await groups()).includes('Go to'), 'empty state shows Go to and Actions');
  assert.ok(await p.locator('#palList [role=option]').count() <= 8, 'empty state has at most 8 rows');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  assert.ok(!(await isOpen()), 'Esc closes');
  await p.locator('.rail-search').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  assert.ok(await isOpen(), 'sidebar Search opens');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.activeElement.className), 'rail-search', 'focus returns to the trigger');
  await p.locator('main h1').click(); await p.keyboard.press('/'); assert.ok(await isOpen(), '/ opens when not typing');
  step('opens from ⌘K, / and the sidebar; Esc closes and restores focus');

  // Ranking, highlighting, arrows, live region
  await p.keyboard.type('juniper');
  await p.waitForTimeout(50);
  assert.equal(await active(), 'Juniper Atlas', 'first row is active');
  assert.equal(await p.locator('#palList [aria-selected=true] mark').first().textContent(), 'Juniper', 'matched characters are emphasized');
  await p.waitForTimeout(300);
  assert.match(await p.textContent('#palLive'), /\d+ results?/, 'live region announces the count');
  await p.fill('#palIn', 'data'); await p.waitForTimeout(50);
  const first = await active();
  await p.keyboard.press('ArrowDown'); assert.notEqual(await active(), first, 'ArrowDown moves');
  await p.keyboard.press('ArrowUp'); assert.equal(await active(), first, 'ArrowUp moves back');
  await p.fill('#palIn', 'junpier'); await p.waitForTimeout(50);
  assert.equal(await active(), 'Juniper Atlas', 'one typo still finds it');
  step('ranks, highlights, moves with arrows, tolerates a typo, announces counts');

  // Scopes: Tab cycles; ">" = actions only
  await p.fill('#palIn', 'data');
  await p.keyboard.press('Tab');
  assert.equal(await p.getAttribute('#palScopes [aria-checked=true]', 'data-scope'), 'Applications');
  assert.deepEqual(await groups(), ['Applications'], 'Tab narrows to Applications');
  await p.keyboard.press('Shift+Tab'); assert.equal(await p.getAttribute('#palScopes [aria-checked=true]', 'data-scope'), 'all', 'Shift+Tab goes back');
  await p.fill('#palIn', '>refresh');
  assert.deepEqual(await groups(), ['Actions'], '> shows actions only');
  assert.equal(await active(), 'Refresh listings now');
  step('Tab cycles scopes and > limits to actions');

  // Enter opens an application in the editor
  await p.fill('#palIn', 'juniper'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  assert.ok(!(await isOpen()), 'closes after running');
  assert.ok(await p.locator('#drawer').isVisible(), 'Enter opens the application');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  step('Enter opens the application');

  // ⌘↵ opens the posting of the active row
  await p.keyboard.press(MOD + '+k'); await p.keyboard.type('bayou grid');
  await p.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await p.keyboard.press(MOD + '+Enter');
  const opened = await p.evaluate(() => window.__opened);
  assert.equal(opened.length, 1, 'secondary action opens one posting'); assert.match(opened[0], /^https?:/);
  assert.ok(await isOpen(), 'palette stays open after opening a posting');
  step('⌘↵ opens the posting');

  // No results: recovery rows, then hidden listings from the server
  await p.fill('#palIn', 'northwnd analytics');
  await p.waitForTimeout(50);
  assert.match(await p.textContent('.pal-none'), /No results for “northwnd analytics”/);
  assert.equal(await active(), 'Add “northwnd analytics” as an application');
  await p.keyboard.press('ArrowDown'); assert.equal(await active(), 'Search hidden listings');
  await p.keyboard.press('Enter');
  await p.waitForSelector('#palList .pal-h:has-text("Hidden listings")');
  assert.ok(await isOpen(), 'stays open for hidden results');
  assert.match(await p.textContent('#palList'), /Northwind Analytics.*Not Summer 2027/s, 'hidden result shows why it is hidden');
  step('no results offers recovery and searches hidden listings');

  // Settings deep link
  await p.fill('#palIn', 'recency half-life');
  assert.equal(await active(), 'Recency half-life (days)');
  await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => location.hash), '#settings/scoring', 'opens the pane that holds the setting');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'p-hl', 'jumps to and focuses the field');
  assert.ok(await p.locator('.pal-flash').count(), 'briefly highlights it');
  step('settings deep link focuses and highlights the field');

  // Recent: the opened items lead the empty state next time
  await p.keyboard.press('Escape'); await p.locator('main h1').click();
  await p.keyboard.press(MOD + '+k');
  assert.equal((await groups())[0], 'Recent', 'Recent leads the empty state');
  await p.keyboard.press('Escape');

  // Regression: Settings panes must not hide the Profile page's sections (both use the same section list layout)
  await p.evaluate(() => { location.hash = 'profile'; }); await p.waitForTimeout(500);
  assert.ok(await p.locator('#s-basics').isVisible() && await p.locator('#s-skills').isVisible(), 'Profile shows every section');
  await p.evaluate(() => { location.hash = 'settings/goals'; }); await p.waitForTimeout(400);
  assert.deepEqual(await p.$$eval('.sbody > section[id^=s-]', (s) => s.filter((x) => !x.hidden).map((x) => x.id)), ['s-goals'], 'Settings shows one pane');
  step('Profile shows all sections; Settings shows one pane');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('Palette E2E passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

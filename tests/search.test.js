/* Ranking tests for search.js (the ⌘K palette). Run: node --test tests/search.test.js */
const test = require('node:test');
const assert = require('node:assert');
const S = require('../search.js');

const ids = (rs) => rs.map((r) => r.doc.id);
const idx = (docs) => S.buildIndex(docs);

test('normalizes case, accents and spacing', () => {
  assert.strictEqual(S.norm('  Société   Générale '), 'societe generale');
  assert.deepStrictEqual(S.tokens('Data-Eng / Intern'), ['data', 'eng', 'intern']);
});

test('tier order: exact > prefix > word start > substring > fuzzy', () => {
  const ix = idx([
    { id: 'sub', group: 'g', title: 'Bigmeta Labs' },
    { id: 'word', group: 'g', title: 'Open Meta Works' },
    { id: 'prefix', group: 'g', title: 'Metaverse Co' },
    { id: 'exact', group: 'g', title: 'Meta' },
    { id: 'fuzzy', group: 'g', title: 'Mtea Corp' },
  ]);
  assert.deepStrictEqual(ids(S.search(ix, 'meta')), ['exact', 'prefix', 'word', 'sub', 'fuzzy']);
  assert.deepStrictEqual(ids(S.search(ix, 'metaa')).slice(0, 1), ['exact']); // one typo still finds Meta (fuzzy)
});

test('light typo tolerance: transposition and one wrong letter, but not on short tokens', () => {
  const ix = idx([{ id: 'n', group: 'g', title: 'NVIDIA' }, { id: 's', group: 'g', title: 'Salesforce' }]);
  assert.deepStrictEqual(ids(S.search(ix, 'nvdiia')), ['n']);
  assert.deepStrictEqual(ids(S.search(ix, 'salesfroce')), ['s']);
  assert.deepStrictEqual(ids(S.search(ix, 'nvx')), []); // 3 letters: no fuzzy
});

test('every token must match; title beats role', () => {
  const ix = idx([
    { id: 'a', group: 'g', title: 'Amazon', sub: 'Data Engineer Intern' },
    { id: 'b', group: 'g', title: 'Data Corp', sub: 'Software Intern' },
  ]);
  assert.deepStrictEqual(ids(S.search(ix, 'amazon data')), ['a']);
  assert.deepStrictEqual(ids(S.search(ix, 'data')), ['b', 'a']);
});

test('boosts: active and recent rank above closed at the same tier', () => {
  const ix = idx([
    { id: 'rejected', group: 'g', title: 'Acme', boost: -25 },
    { id: 'active', group: 'g', title: 'Acme', sub: 'SWE', boost: 15 },
  ]);
  assert.deepStrictEqual(ids(S.search(ix, 'acme')), ['active', 'rejected']);
});

test('a boost never lifts a weaker tier over a much better match', () => {
  const ix = idx([{ id: 'sub', group: 'g', title: 'Bigacme', boost: 15 }, { id: 'exact', group: 'g', title: 'Acme', boost: -25 }]);
  assert.strictEqual(ids(S.search(ix, 'acme'))[0], 'exact');
});

test('highlight ranges point at the original text, including accented letters', () => {
  const [r] = S.search(idx([{ id: 'x', group: 'g', title: 'Société Générale', sub: 'Quant Intern' }]), 'gene');
  assert.deepStrictEqual(r.title, [[8, 12]]);
  const esc = (s) => s.replace(/</g, '&lt;');
  assert.strictEqual(S.highlight('Société Générale', r.title, esc), 'Société <mark>Géné</mark>rale');
});

test('settings labels are found by words in any order', () => {
  const ix = idx([{ id: 'p-hl', group: 'Settings', title: 'Recency half-life (days)' }, { id: 'p-top', group: 'Settings', title: 'Apply-now threshold' }]);
  assert.deepStrictEqual(ids(S.search(ix, 'recency half-life')), ['p-hl']);
  assert.deepStrictEqual(ids(S.search(ix, 'half life')), ['p-hl']);
});

test('grouping orders groups by their best hit and caps rows', () => {
  const docs = [];
  for (let i = 0; i < 20; i++) docs.push({ id: 'l' + i, group: 'Listings', title: 'Northwind ' + i });
  docs.push({ id: 'p', group: 'Pages', title: 'Northwind' });
  const g = S.group(S.search(idx(docs), 'northwind'), ['Applications', 'Listings', 'Pages'], 8, 50);
  assert.deepStrictEqual(g.map((x) => x.group), ['Pages', 'Listings']);
  assert.strictEqual(g[1].items.length, 8);
  assert.strictEqual(g[1].more, 12);
});

test('stays under 16 ms per keystroke on 3,000 documents', () => {
  const words = ['Data', 'Software', 'Engineer', 'Analyst', 'Intern', 'Machine', 'Learning', 'Platform', 'Cloud', 'Research'];
  const docs = Array.from({ length: 3000 }, (_, i) => ({ id: i, group: 'Listings', title: 'Company ' + i + ' ' + words[i % 10], sub: words[(i * 3) % 10] + ' ' + words[(i * 7) % 10] + ' Intern', extra: 'Austin, TX' }));
  const ix = idx(docs);
  const queries = ['d', 'da', 'dat', 'data', 'data e', 'data en', 'data eng', 'data engi', 'enginer', 'compny 12'];
  S.search(ix, 'warm up');
  let worst = 0;
  for (const q of queries) {
    let best = Infinity; // best of 3 runs, so a GC pause or a busy CI machine does not fail the test
    for (let k = 0; k < 3; k++) { const t = process.hrtime.bigint(); S.search(ix, q, { limit: 50 }); best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6); }
    worst = Math.max(worst, best);
  }
  assert.ok(worst < 16, `slowest keystroke took ${worst.toFixed(1)} ms`);
});

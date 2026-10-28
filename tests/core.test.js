// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const L = (o) => Object.assign({ company: 'Acme', role: 'Data Analyst Intern', posted: '2026-10-28', h1b: 999, skillsFound: ['Python', 'SQL'], locations: ['Austin, TX'], degrees: ["Master's"], source: 'simplify', textRead: true }, o);

test('settings change the score immediately', () => {
  const base = C.score(L(), {}, '2026-10-28').total;
  assert.ok(base >= 90);
  assert.ok(C.score(L(), { targets: ['SWE'] }, '2026-10-28').total < base);
  assert.ok(C.score(L(), { places: ['Seattle'] }, '2026-10-28').total < base);
  assert.ok(C.score(L(), { mySkills: ['Python'] }, '2026-10-28').total < base);
  assert.deepEqual(C.score(L(), { mySkills: ['Python'] }, '2026-10-28').missing, ['SQL']);
});

test('manual listings use the sponsorship field and free-text degree', () => {
  const s = C.score({ company: 'B', role: 'Data Engineer Intern', sponsor: 'no', location: 'Dallas, TX', degree: 'BS/MS', posted: '2026-10-28' }, {}, '2026-10-28');
  assert.equal(s.sponsor, 'no');
  assert.equal(s.pen, 20);
  assert.equal(s.track, 'DE');
  assert.deepEqual(s.flags, ['No sponsorship']);
});

test('action labels', () => {
  const st = { topScore: 75, minScore: 55 };
  assert.equal(C.action({ total: 80, missing: [], sponsor: 'unknown' }, st)[0], 'now');
  assert.equal(C.action({ total: 80, missing: ['A', 'B'], sponsor: 'unknown' }, st)[0], 'tailor');
  assert.equal(C.action({ total: 60, missing: [], sponsor: 'yes' }, st)[0], 'tailor');
  assert.equal(C.action({ total: 90, missing: [], sponsor: 'no' }, st)[0], 'low');
  assert.equal(C.action({ total: 40, missing: [], sponsor: 'yes' }, st)[0], 'low');
});

test('merge3 keeps both sides of non-overlapping edits', () => {
  const base = { apps: [{ id: 'a', s: 1 }, { id: 'b', s: 1 }, { id: 'c', s: 1 }], dismissed: ['x'], settings: { dailyGoal: 3, weeklyGoal: 10 }, rev: 4 };
  const mine = { apps: [{ id: 'a', s: 2 }, { id: 'b', s: 1 }, { id: 'd', s: 1 }], dismissed: ['x', 'y'], settings: { dailyGoal: 5, weeklyGoal: 10 } };
  const theirs = { apps: [{ id: 'a', s: 1 }, { id: 'b', s: 9 }, { id: 'c', s: 1 }, { id: 'e', s: 1 }], dismissed: ['x', 'z'], settings: { dailyGoal: 3, weeklyGoal: 12 }, rev: 5 };
  const { merged, conflicts } = C.merge3(base, mine, theirs);
  const byId = Object.fromEntries(merged.apps.map((a) => [a.id, a.s]));
  assert.deepEqual(byId, { a: 2, b: 9, d: 1, e: 1 }); // c deleted by me, e added by them, d added by me
  assert.deepEqual(merged.dismissed.sort(), ['x', 'y', 'z']);
  assert.deepEqual(merged.settings, { dailyGoal: 5, weeklyGoal: 12 });
  assert.equal(merged.rev, 5);
  assert.equal(conflicts, 0);
});

test('merge3 resolves a double edit in my favour and counts it', () => {
  const base = { apps: [{ id: 'a', notes: '' }] };
  const { merged, conflicts } = C.merge3(base, { apps: [{ id: 'a', notes: 'mine' }] }, { apps: [{ id: 'a', notes: 'theirs' }] });
  assert.equal(merged.apps[0].notes, 'mine');
  assert.equal(conflicts, 1);
});

test('merge3 with no base treats everything as new', () => {
  const { merged } = C.merge3(null, { apps: [{ id: 'a' }] }, { apps: [{ id: 'b' }] });
  assert.deepEqual(merged.apps.map((a) => a.id).sort(), ['a', 'b']);
});

test('daysBetween handles DST and bad input', () => {
  assert.equal(C.daysBetween('2026-11-01', '2026-11-02'), 1);
  assert.equal(C.daysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(C.daysBetween('', '2026-03-09'), null);
});

// Fixed synthetic job set: verdicts, ranking order, score ranges, monotonicity and stability of the fit model.
// Labels in tests/fixtures/jobs.json are provisional (written during the review, not confirmed by the owner).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const F = require('./fixtures/jobs.json');
const run = (j, p = F.profile) => C.fit(p, j.a, { settings: F.settings, role: j.role });

test('every fixture gets its expected verdict', () => {
  for (const j of F.jobs) assert.equal(run(j).verdict, j.expect, `${j.id}: ${j.why}`);
});

test('blocked jobs never outrank eligible ones and stay at or under the cap', () => {
  const r = F.jobs.map((j) => ({ j, f: run(j) }));
  const minEligible = Math.min(...r.filter((x) => x.f.verdict !== 'blocked' && x.f.total !== null).map((x) => x.f.total));
  for (const x of r.filter((x) => x.f.verdict === 'blocked')) {
    assert.ok(x.f.total === null || x.f.total <= 35, x.j.id);
    assert.ok(x.f.total === null || x.f.total <= minEligible, `${x.j.id} outranks an eligible job`);
  }
});

test('eligible jobs rank in tier order', () => {
  const r = F.jobs.filter((j) => j.tier).map((j) => ({ j, t: run(j).total }));
  for (const a of r) for (const b of r) if (a.j.tier < b.j.tier) assert.ok(a.t > b.t, `${a.j.id} (${a.t}) should beat ${b.j.id} (${b.t})`);
});

test('scores are integers in 0..100 or null, coverage in 0..1, and the model is deterministic', () => {
  for (const j of F.jobs) {
    const a = run(j), b = run(j);
    assert.deepEqual(a, b, j.id);
    assert.ok(a.total === null || (Number.isInteger(a.total) && a.total >= 0 && a.total <= 100), j.id);
    assert.ok(a.coverage >= 0 && a.coverage <= 1, j.id);
    for (const p of a.parts) assert.ok(p.v === null || (p.v >= 0 && p.v <= 1), `${j.id}.${p.k}`);
  }
});

test('adding a required skill to the Profile never lowers the fit (monotonic)', () => {
  for (const j of F.jobs) {
    const before = run(j).total; if (before === null) continue;
    for (const s of j.a.requiredSkills || []) {
      const p = JSON.parse(JSON.stringify(F.profile)); p.skills.push({ value: s });
      assert.ok(run(j, p).total >= before, `${j.id} + ${s}`);
    }
  }
});

test('rephrasing the resume cannot change candidate fit (fit ignores resume text)', () => {
  const j = F.jobs[0];
  const f1 = run(j), kw1 = C.keywordScore('Built dashboards', [{ term: 'SQL', importance: 3 }]).score;
  const kw2 = C.keywordScore('Built SQL dashboards', [{ term: 'SQL', importance: 3 }]).score;
  assert.ok(kw2 > kw1);
  assert.deepEqual(run(j), f1);
});

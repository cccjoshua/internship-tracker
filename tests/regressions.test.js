// Regression tests for the review findings (scoring, eligibility, keyword coverage, fact checks, merge).
// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const PROFILE = {
  preferences: { degreePursuing: 'Master', degreesHeld: ['Bachelor'], graduation: '2028-05', needsSponsorship: true, needsCptOpt: true, regions: ['United States'] },
  skills: [{ label: 'Languages', value: 'Python, SQL, C++' }],
  experience: [{ id: 'dw', tech: '.NET, Microsoft SQL Server' }],
};
const SET = { targets: ['SWE', 'DA'], places: ['TX'], mySkills: [] };

test('#1 empty Profile + empty analysis: no score, not 74', () => {
  const r = C.fit({}, {}, { settings: SET, role: 'Software Engineer Intern' });
  assert.equal(r.total, null);
  assert.equal(r.verdict, 'insufficient');
  assert.ok(r.coverage < C.MIN_COVERAGE, String(r.coverage));
  assert.ok(r.parts.filter((p) => !p.known).length >= 4);
});

test('#1 unknown components get no free points and are not counted as gaps', () => {
  const a = { requiredSkills: ['Python', 'SQL'] };
  const r = C.fit(PROFILE, a, { settings: SET, role: 'Software Engineer Intern' });
  // skills 1.0 + role 1.0 known; education/experience/location/auth unknown -> excluded, coverage 50% -> no total
  assert.equal(r.total, null);
  const r2 = C.fit(PROFILE, Object.assign({ audience: { degreeLevels: ['Master'] }, location: { workMode: 'onsite', places: ['Austin, TX'] } }, a), { settings: SET, role: 'Software Engineer Intern' });
  assert.equal(r2.total, 93); // Python is only listed (0.7 credit), SQL is shown at work: skills 0.85, everything else full
  assert.equal(r2.verdict, 'check'); // sponsorship and CPT/OPT not stated: open questions, not a score bonus
  assert.ok(r2.open.includes('Future sponsorship'));
});

test('#2 graduation outside the window blocks and caps, whatever else scores', () => {
  const a = { requiredSkills: ['Python', 'SQL'], audience: { degreeLevels: ['Master'], gradFrom: '2026-12', gradTo: '2027-06' }, location: { workMode: 'onsite', places: ['Austin, TX'] }, sponsorship: { status: 'sponsors' } };
  const r = C.fit(PROFILE, a, { settings: SET, role: 'Software Engineer Intern' });
  assert.equal(r.verdict, 'blocked');
  assert.ok(r.total <= 35, String(r.total));
  assert.equal(r.eligibility.find((e) => e.key === 'graduation').status, 'fails');
});

test('#2 missing graduation date is unknown, not a pass or a fail', () => {
  const p = JSON.parse(JSON.stringify(PROFILE)); delete p.preferences.graduation;
  const r = C.fit(p, { audience: { degreeLevels: ['Master'], gradFrom: '2026-12', gradTo: '2027-06' } }, { settings: SET, role: 'SWE Intern' });
  assert.equal(r.eligibility.find((e) => e.key === 'graduation').status, 'unknown');
  assert.equal(r.blockers.length, 0);
});

test('#3 inference is one level, partial and labelled; .NET does not imply C#, C++ does not imply C', () => {
  const S = C.skillSet(PROFILE, {});
  assert.equal(C.hasSkill('C#', S), null);
  assert.equal(C.hasSkill('C', S), null);
  assert.equal(C.hasSkill('C/C++', S), null);
  assert.equal(C.hasSkill('C++', S), 'direct');
  assert.equal(C.hasSkill('SQL Server', S), 'direct');      // "Microsoft SQL Server" is a spelling of it
  const S2 = C.skillSet({ skills: [{ value: 'PyTorch' }] }, {});
  assert.equal(C.hasSkill('Deep learning', S2), 'implied');
  assert.equal(C.hasSkill('Machine learning', S2), null);    // not chained PyTorch -> DL -> ML
  const S3 = C.skillSet({ skills: [{ value: 'C/C++' }] }, {});
  assert.equal(C.hasSkill('C', S3), 'direct');              // an explicit combined claim
  const r = C.fit({ preferences: {}, skills: [{ value: 'PyTorch' }] }, { requiredSkills: ['Deep learning'] }, { settings: SET, role: 'ML Intern' });
  assert.equal(r.skills.inferred[0].term, 'Deep learning');
  assert.equal(r.parts.find((p) => p.k === 'skills').v, 0.5);
});

test('#4 keywordScore ignores negated mentions', () => {
  const kws = [{ term: 'Python', importance: 3 }, { term: 'SQL', importance: 1 }];
  const r = C.keywordScore('No Python experience yet. Wrote SQL queries.', kws);
  assert.deepEqual(r.hit.map((k) => k.term), ['SQL']);
  assert.deepEqual(r.negated.map((k) => k.term), ['Python']);
  assert.equal(C.keywordScore('Without Python; later automated reports in Python.', kws).hit.length, 1); // one affirmed mention counts
  assert.equal(C.keywordScore('Not limited to dashboards: built SQL models', kws).hit[0].term, 'SQL');    // negation far from the term
});

test('#5 factCheck: invented years, transplanted tools and solo claims are flagged; no source is flagged', () => {
  const S = C.skillSet({ skills: [{ value: 'Python, SQL, Tableau' }] }, {});
  assert.ok(C.factCheck('Shipped the dashboard in 2024', 'Shipped the internal dashboard', S).some((x) => /Year 2024/.test(x)));
  assert.deepEqual(C.factCheck('Shipped it in 2024', 'Shipped it (2024)', S), []);
  assert.ok(C.factCheck('Built Tableau dashboards', 'Built dashboards with Python', S).some((x) => /Tableau is not in the cited facts/.test(x)));
  assert.ok(C.factCheck('Independently built the scheduler', 'Our team of three built the scheduler', S).some((x) => /alone/.test(x)));
  assert.deepEqual(C.factCheck('Built a scheduler', '', S), ['No Profile fact is cited']);
});

test('#6 merge3 keeps both sides when the same application changes on different fields', () => {
  const base = { apps: [{ id: 'a', status: 'saved', notes: '', rounds: [{ id: 'r1', d: '2026-11-01' }] }] };
  const mine = { apps: [{ id: 'a', status: 'applied', notes: '', rounds: [{ id: 'r1', d: '2026-11-01' }] }] };
  const theirs = { apps: [{ id: 'a', status: 'saved', notes: 'call Tue', rounds: [{ id: 'r1', d: '2026-11-01' }, { id: 'r2', d: '2026-11-05' }] }] };
  const { merged, conflicts } = C.merge3(base, mine, theirs);
  assert.equal(merged.apps[0].status, 'applied');
  assert.equal(merged.apps[0].notes, 'call Tue');
  assert.deepEqual(merged.apps[0].rounds.map((r) => r.id), ['r1', 'r2']);
  assert.equal(conflicts, 0);
});

test('#6 a delete never silently drops the other side\'s edit', () => {
  const base = { apps: [{ id: 'a', notes: '' }] };
  const r = C.merge3(base, { apps: [] }, { apps: [{ id: 'a', notes: 'new info' }] });
  assert.equal(r.merged.apps[0].notes, 'new info');
  assert.equal(r.conflicts, 1);
});

test('#13 mergeDeep merges Profile edits from two tabs', () => {
  const base = { basics: { name: 'A', email: 'a@x' }, skills: [{ id: 's1', value: 'Python' }] };
  const mine = { basics: { name: 'A', email: 'new@x' }, skills: [{ id: 's1', value: 'Python' }] };
  const theirs = { basics: { name: 'A', email: 'a@x' }, skills: [{ id: 's1', value: 'Python' }, { id: 's2', value: 'SQL' }] };
  const r = C.mergeDeep(base, mine, theirs);
  assert.equal(r.merged.basics.email, 'new@x');
  assert.equal(r.merged.skills.length, 2);
  assert.equal(r.conflicts, 0);
});

test('CPT/OPT exclusion is a fail for a student who needs CPT/OPT, never "friendly"', () => {
  for (const ev of ['Candidates on CPT or OPT are not eligible.', 'This role does not accept OPT candidates.']) {
    assert.ok(C.OPT_EXCLUDED.test(ev), ev);
    const r = C.fit(PROFILE, { sponsorship: { status: 'cpt_opt_ok', evidence: ev } }, { settings: SET, role: 'SWE Intern' });
    assert.equal(r.eligibility.find((e) => e.key === 'cptopt').status, 'fails', ev);
    assert.equal(r.verdict, 'blocked');
  }
  assert.ok(!C.OPT_EXCLUDED.test('CPT and OPT students are welcome to apply.'));
});

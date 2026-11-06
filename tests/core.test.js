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

/* ---------- fit and keyword score ---------- */
const PROFILE = {
  preferences: { degreePursuing: 'Master', degreesHeld: ['Bachelor'], graduation: '2028-05', yearsExperience: 0.25, needsSponsorship: true, regions: ['United States'] },
  skills: [{ label: 'Languages', value: 'Python, SQL (T-SQL), C/C++, C#' }, { label: 'Data', value: 'pandas, Tableau' }],
  experience: [{ id: 'dw', tech: 'JavaScript, .NET, Microsoft SQL Server' }],
  notYet: ['Power BI', 'A/B testing'],
};
const SETTINGS = { targets: ['DA', 'DS'], places: ['TX', 'Remote'], mySkills: [] };

test('fit: skills match through aliases and implications, never through "do not claim"', () => {
  const a = { requiredSkills: ['SQL', 'Python', 'Power BI'], preferredSkills: ['JS', 'PostgreSQL'], audience: { degreeLevels: ['Bachelor', 'Master'] }, sponsorship: { status: 'cpt_opt_ok' }, location: { workMode: 'onsite', places: ['Austin, TX'] } };
  const r = C.fit(PROFILE, a, { settings: SETTINGS, role: 'Data Analyst Intern' });
  assert.deepEqual(r.skills.reqHit, ['SQL', 'Python']);
  assert.deepEqual(r.skills.reqMiss, ['Power BI']);
  assert.deepEqual(r.skills.optHit, ['JS']);
  assert.deepEqual(r.flagged, ['Power BI']);
  assert.equal(r.track, 'DA');
  assert.equal(r.parts.find((p) => p.k === 'location').v, 1);
  assert.ok(r.total > 70 && r.total <= 100, r.total);
});

test('fit: citizenship and PhD-only postings are capped and explained', () => {
  const r = C.fit(PROFILE, { audience: { degreeLevels: ['PhD'] }, sponsorship: { status: 'citizens_only' } }, { settings: SETTINGS, role: 'Data Scientist Intern' });
  assert.ok(r.total <= 35);
  assert.ok(r.blockers.some((b) => /citizenship/.test(b)) && r.blockers.some((b) => /PhD/.test(b)));
});

test('fit: graduation window outside your date is a blocker', () => {
  const r = C.fit(PROFILE, { audience: { degreeLevels: ['Master'], gradFrom: '2026-12', gradTo: '2027-06' } }, { settings: SETTINGS, role: 'Data Analyst Intern' });
  assert.ok(r.blockers.some((b) => /Graduation window/.test(b)));
  assert.ok(r.parts.find((p) => p.k === 'education').v < 0.5);
});

test('keywordScore: weighted coverage with word boundaries', () => {
  const kws = [{ term: 'SQL', importance: 3 }, { term: 'Java', importance: 1 }, { term: 'Machine Learning', importance: 2 }, { term: 'C++', importance: 1 }];
  const r = C.keywordScore('Wrote T-SQL queries in JavaScript; trained ML models in C/C++.', kws);
  assert.deepEqual(r.hit.map((k) => k.term), ['SQL', 'Machine Learning', 'C++']); // "C/C++" counts as C++; "JavaScript" is not Java
  assert.deepEqual(r.miss.map((k) => k.term), ['Java']);
  assert.equal(r.score, Math.round(6 / 7 * 100));
});

test('factCheck flags numbers, unclaimable tools and inflated verbs that the cited facts do not support', () => {
  const S = C.skillSet({ skills: [{ value: 'Python, SQL (T-SQL)' }], notYet: ['Power BI'] }, {});
  assert.deepEqual(C.factCheck('Built SQL reports for 1,200 users across 3 teams', 'Built SQL reports used by 1200 users in 3 teams', S), []);
  assert.deepEqual(C.factCheck('Cut load time 40% with Python', 'Sped up loads with Python scripts', S), ['Number 40 not in the cited facts']);
  const r = C.factCheck('Led Power BI and Kafka dashboard work in 2025', 'Contributed to dashboard work', S);
  assert.ok(r.includes('Power BI is on your Do-not-claim list'));
  assert.ok(r.includes('Kafka is not in your Profile'));
  assert.ok(r.some((x) => x.includes('“Led”')));
  assert.deepEqual(C.factCheck('Led a 4-person team', 'Led a team of 4 students', S), []); // years and supported verbs are fine
  assert.deepEqual(C.factCheck('Used R&D data in Go', 'R&D data', S), []);                 // one- and two-letter names are skipped
});

test('save failures: what is retried and what needs you', () => {
  assert.equal(C.saveFailure(0), 'offline');
  assert.equal(C.saveFailure(undefined), 'offline');
  assert.equal(C.saveFailure(409), 'conflict');
  assert.equal(C.saveFailure(400), 'rejected');
  assert.equal(C.saveFailure(413), 'rejected');
  assert.equal(C.saveFailure(503), 'corrupt');
  assert.equal(C.saveFailure(500), 'server');
  assert.deepEqual([0, 1, 2, 3, 9].map(C.retryDelay), [5, 15, 60, 60, 60]);
});

test('budget: scoring 3,000 listings stays under 150 ms', () => {
  const roles = ['Data Analyst Intern', 'Software Engineer Intern', 'Data Engineer Intern', 'Data Science Intern', 'BI Engineer Intern'];
  const many = Array.from({ length: 3000 }, (_, i) => L({ company: 'Co ' + i, role: roles[i % 5], h1b: i % 7 ? i : null, skillsFound: ['Python', 'SQL', 'Tableau', 'Spark'].slice(0, 1 + (i % 4)), posted: '2026-10-' + String(10 + (i % 18)).padStart(2, '0') }));
  C.score(many[0], {}, '2026-10-28'); // warm up
  let best = Infinity;
  for (let k = 0; k < 3; k++) { const t = process.hrtime.bigint(); for (const l of many) C.score(l, {}, '2026-10-28'); best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6); }
  assert.ok(best < 150, `scoring 3,000 listings took ${best.toFixed(0)} ms`);
});

test('a one-of requirement counts once and is met by any option', () => {
  const P = { skills: [{ value: 'Python, Java, SQL' }], experience: [{ id: 'w', tech: 'Python, Java, SQL', points: [] }] }, ctx = { settings: {}, role: 'Software Engineer Intern' };
  const r = C.fit(P, { requiredSkills: ['Java | Python | C++ | Go', 'Rust'], preferredSkills: ['Ruby | Perl'] }, ctx);
  const sk = r.parts.find((p) => p.k === 'skills');
  assert.equal(sk.note, '1/2 required · 0/1 preferred');
  assert.deepEqual(r.skills.reqHit, ['Java / Python']);
  assert.deepEqual(r.skills.optMiss, ['Ruby or Perl']);
  // A full-credit group is worth one required skill, not four
  assert.equal(C.fit(P, { requiredSkills: ['Java | Python | C++'] }, ctx).parts.find((p) => p.k === 'skills').v, 1);
});

test('without concrete skills, work habits are not scored as missing skills', () => {
  const P = { skills: [{ value: 'Python' }] };
  const a = { requiredSkills: [], preferredSkills: [], keywords: [{ term: 'Code review', importance: 3, kind: 'skill' }, { term: 'Agile', importance: 2, kind: 'skill' }] };
  const sk = C.fit(P, a, { settings: {} }).parts.find((p) => p.k === 'skills');
  assert.equal(sk.known, false);
  assert.equal(sk.note, 'The posting lists no concrete skills');
  const b = Object.assign({}, a, { keywords: [...a.keywords, { term: 'Python', importance: 2, kind: 'tool' }] });
  assert.equal(C.fit(P, b, { settings: {} }).parts.find((p) => p.k === 'skills').note, '1/1 required · 0/0 preferred · 1 listed only (not shown in a job or project)');
});

test('one-of options inside a label, and Git suggests version control', () => {
  const P = { skills: [{ value: 'Python, Git' }] };
  const r = C.fit(P, { requiredSkills: ['Scripting (Bash | Python | Perl)'], preferredSkills: ['Version control systems'] }, { settings: {} });
  assert.deepEqual(r.skills.reqHit, ['Python']);
  assert.deepEqual(r.skills.inferred.map((x) => x.term), ['Version control systems']);
});

test('"Database systems" in a posting matches "Databases" in the Profile', () => {
  const S = C.skillSet({ skills: [{ value: 'Databases' }] }, {});
  assert.equal(C.hasSkill('Database systems', S), 'direct');
});

/* ---------- evidence-weighted match, no-sponsorship cap, resume score ---------- */
test('skills shown at work count more than skills only listed', () => {
  const a = { requiredSkills: ['Python', 'SQL'], preferredSkills: [] };
  const listed = { skills: [{ value: 'Python, SQL' }] };
  const shown = Object.assign({}, listed, { experience: [{ id: 'w', tech: 'SQL', points: [{ id: 'w.1', text: 'Wrote Python scripts', confirm: false }] }] });
  const proj = Object.assign({}, listed, { projects: [{ id: 'p', tech: 'Python, SQL', points: [] }] });
  const v = (P) => C.fit(P, a, { settings: {} }).parts.find((p) => p.k === 'skills').v;
  assert.equal(v(shown), 1);
  assert.equal(v(proj), 0.9);
  assert.equal(v(listed), 0.7);
  const S = C.skillSet(shown, {});
  assert.equal(C.skillDepth('python', S), 'work');
  assert.equal(C.fit(listed, a, { settings: {} }).skills.evidence[0].depth, 'listed');
  // an unconfirmed point is not evidence
  const unconf = Object.assign({}, listed, { experience: [{ id: 'w', points: [{ id: 'w.1', text: 'Wrote Python scripts', confirm: true }] }] });
  assert.equal(C.skillDepth('Python', C.skillSet(unconf, {})), 'listed');
});

test('a posting that will not sponsor never ranks above the cap', () => {
  const s = C.score(L({ noSponsor: true, h1b: 99999 }), {}, '2026-10-28');
  assert.ok(s.total <= C.DEFAULTS.noSponsorCap);
  assert.equal(C.action(s, {})[0], 'low');
});

const RES = (bullets, extra) => Object.assign({ header: { name: 'A', contact: 'Houston, TX | a@b.c | linkedin.com/in/a' }, sections: [
  { id: 's1', kind: 'skills', title: 'Technical Skills', lines: [{ label: 'Languages', value: 'Python' }] },
  { id: 's2', kind: 'entries', key: 'experience', title: 'Professional Experience', entries: [{ id: 'e1', title: 'Acme', bullets }] }] }, extra || {});
test('resume score: match counts only skills you have, and every lost point has a fix', () => {
  const P = { skills: [{ value: 'Python, SQL' }], experience: [{ id: 'w', tech: 'Python, SQL', points: [] }] };
  const a = { requiredSkills: ['Python', 'SQL', 'Kafka'], preferredSkills: [], keywords: [] };
  const good = [{ id: 'b1', text: 'Built a Python ETL job that loads 2,000 records nightly into SQL Server for 3 teams' }, { id: 'b2', text: 'Reduced report runtime 40% by rewriting SQL queries with window functions and indexes' }];
  const r = C.resumeScore(RES(good), { analysis: a, skills: C.skillSet(P, {}), layout: { pages: 1, size: 10.5, tight: 1, fill: 0.9 } });
  assert.equal(r.parts.find((p) => p.k === 'match').v, 1);          // Kafka is not yours, so it is not counted against you
  assert.equal(r.total, 100);
  assert.deepEqual(r.fixes, []);
  const weak = [{ id: 'b1', text: 'Responsible for various reports.' }, { id: 'b2', text: 'Helped the team' }];
  const w = C.resumeScore(RES(weak), { analysis: a, skills: C.skillSet(P, {}), layout: { pages: 1, size: 10, tight: 0.8, fill: 0.99 }, flagged: ['b1'] });
  assert.ok(w.total < 50, String(w.total));
  assert.ok(w.fixes.some((f) => f.k === 'match' && /SQL/.test(f.text)));
  assert.ok(w.fixes.some((f) => f.k === 'truth' && f.ref.bullet === 'b1'));
  assert.ok(w.fixes.some((f) => f.k === 'format' && /dense/.test(f.text)));
  assert.ok(w.fixes.some((f) => f.k === 'clarity' && /vague/.test(f.text)));
  // without an analysis or a layout those parts are left out, not scored as zero
  const n = C.resumeScore(RES(good), {});
  assert.equal(n.parts.find((p) => p.k === 'match').v, null);
  assert.ok(n.total >= 90);
});

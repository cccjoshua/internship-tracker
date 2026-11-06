/* Extension page-reader tests: each fixture is served at a real job-site address, so the site rules run as they would in Chrome.
   Run: node tests/ext/extract.test.js   (needs Playwright; the Python suite runs it when available) */
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const src = fs.readFileSync(path.join(__dirname, '../../extension/extract.js'), 'utf8').replace('export function', 'function');

const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const CASES = [
  ['https://boards.greenhouse.io/acme/jobs/4455?gh_src=x', `<html><head><title>Job Application for Data Engineer Intern at Acme</title>${ld({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Data Engineer Intern', hiringOrganization: { '@type': 'Organization', name: 'Acme Robotics' },
    jobLocation: [{ '@type': 'Place', address: { addressLocality: 'Austin', addressRegion: 'TX', addressCountry: 'US' } }], datePosted: '2026-10-20', validThrough: '2099-01-01',
    description: '<p>Build pipelines in <b>Python</b> and SQL.</p><p>Application deadline: November 15, 2026.</p>' + '<p>More text about the role and the team.</p>'.repeat(8), baseSalary: { currency: 'USD', value: { minValue: 30, maxValue: 45, unitText: 'HOUR' } } })}</head><body><h1 class="app-title">Data Engineer Intern</h1></body></html>`,
    { company: 'Acme Robotics', role: 'Data Engineer Intern', location: 'Austin, TX', posted: '2026-10-20', deadline: '2026-11-15', pay: 'USD 30–45 per hour', source: 'Greenhouse', fromDeadline: 'posting text' }],
  ['https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=intern', `<html><head><title>(3) Software Engineer Intern | T-Mobile | LinkedIn</title></head><body><main>
    <div class="job-details-jobs-unified-top-card__job-title"><h1>Software Engineer Intern</h1></div>
    <div class="job-details-jobs-unified-top-card__company-name"><a href="/company/t-mobile/">T-Mobile</a></div>
    <div class="job-details-jobs-unified-top-card__primary-description-container"><span class="tvm__text">Overland Park, KS</span> · <span>2 days ago</span> · 87 applicants</div>
    <div id="job-details"><p>About the job</p><p>Implement IVR self-service experiences. Hybrid schedule. Intern wages range from $27/hour to $50/hour.</p>${'<p>Responsibilities and requirements for the internship.</p>'.repeat(8)}</div></main></body></html>`,
    { company: 'T-Mobile', role: 'Software Engineer Intern', location: 'Overland Park, KS', url: 'https://www.linkedin.com/jobs/view/4012345678/', source: 'LinkedIn', workMode: 'Hybrid', pay: '$27/hour to $50/hour', postedDaysAgo: 2 }],
  ['https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Systems-Software-Intern_JR123', `<html><head><title>Systems Software Intern</title><meta property="og:site_name" content="NVIDIA"></head><body>
    <h2 data-automation-id="jobPostingHeader">Systems Software Intern - Aerial PHY</h2><div data-automation-id="locations"><dt>locations</dt><dd>US, CA, Santa Clara</dd></div>
    <div data-automation-id="postedOn"><dt>posted on</dt><dd>Posted 10 Days Ago</dd></div><div data-automation-id="jobPostingDescription">${'<p>Develop 5G/6G physical-layer software in C++ and CUDA.</p>'.repeat(10)}</div></body></html>`,
    { company: 'NVIDIA', role: 'Systems Software Intern - Aerial PHY', location: 'US, CA, Santa Clara', source: 'Workday', postedDaysAgo: 10 }],
  ['https://jobs.lever.co/acme-ai/abc-123?lever-source=LinkedIn', `<html><head><title>Acme AI - Machine Learning Intern</title></head><body><div class="posting-headline"><h2>Machine Learning Intern</h2><div class="posting-categories"><div class="location">Berlin, Germany</div></div></div>
    <div data-qa="job-description">${'<p>Train models with PyTorch. Remote friendly.</p>'.repeat(10)}</div></body></html>`,
    { company: 'Acme Ai', role: 'Machine Learning Intern', location: 'Berlin, Germany', source: 'Lever' }],
  ['https://www.tokyodev.com/companies/mercari/jobs/backend-intern', `<html lang="ja"><head><title>Backend Engineer Intern at Mercari | TokyoDev</title><meta property="og:site_name" content="TokyoDev">${ld({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'バックエンドエンジニア インターン', hiringOrganization: 'Mercari, Inc.',
    jobLocation: { address: { addressLocality: '港区', addressRegion: '東京都', addressCountry: 'JP' } }, datePosted: '2026-10-25T09:00:00+09:00', description: '<p>Go と Kubernetes を使ったバックエンド開発。応募締切 2026年11月30日</p>' + '<p>詳細</p>'.repeat(60) })}</head><body><h1>Backend Engineer Intern</h1></body></html>`,
    { company: 'Mercari, Inc.', role: 'バックエンドエンジニア インターン', location: '港区, 東京都, JP', posted: '2026-10-25', deadline: '2026-11-30', source: 'TokyoDev' }],
  ['https://careers.example-bank.de/stellen/working-student-data-analytics', `<html><head><title>Working Student Data Analytics (m/w/d) - Example Bank Careers</title></head><body><main><h1>Working Student Data Analytics (m/w/d)</h1>
    <div class="job-location">Frankfurt am Main, Germany</div><section class="description">${'<p>Analyse data with SQL and Power BI. Apply by 2026-12-01.</p>'.repeat(8)}</section></main></body></html>`,
    { company: 'Example Bank', role: 'Working Student Data Analytics', location: 'Frankfurt am Main, Germany', deadline: '2026-12-01' }],
];

(async () => {
  const b = await chromium.launch(); let fail = 0;
  for (const [url, html, want] of CASES) {
    const p = await b.newPage();
    await p.route('**/*', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    await p.goto(url);
    const got = await p.evaluate(`(${src.match(/function extractJob[\s\S]*$/)[0]})()`);
    const today = new Date();
    for (const [k, v] of Object.entries(want)) {
      let ok, actual;
      if (k === 'postedDaysAgo') { const d = new Date(); d.setDate(today.getDate() - v); const exp = d.toISOString().slice(0, 10); actual = got.posted; ok = Math.abs(new Date(actual) - new Date(exp)) <= 864e5 * 1.01; }
      else if (k === 'fromDeadline') { actual = got.from.deadline; ok = actual === v; }
      else { actual = got[k]; ok = actual === v; }
      if (!ok) { fail++; console.log(`FAIL ${new URL(url).hostname} ${k}: got ${JSON.stringify(actual)} want ${JSON.stringify(v)}`); }
    }
    if (got.description.length < 200) { fail++; console.log(`FAIL ${new URL(url).hostname} description too short (${got.description.length})`); }
    await p.close();
  }
  await b.close();
  console.log(fail ? `${fail} failures` : `OK ${CASES.length} sites`); process.exit(fail ? 1 : 0);
})();

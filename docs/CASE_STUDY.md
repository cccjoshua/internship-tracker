# Case study: building an honest internship search assistant

*Chia-Chun (Joshua) Chang · Rice University MCS · Sep–Nov 2026*

This note explains the problem, the main design decisions and their trade-offs, and what I would do next. The README covers features and setup.

## 1. Problem

An international MS student applying for Summer 2027 internships repeats the same work for every posting:

1. **Find** postings that match the degree, dates, region and field, out of 17,000+ public listings.
2. **Check eligibility** before investing time: graduation window, degree level, CPT/OPT, U.S. citizenship or clearance, and whether the employer will sponsor a visa later.
3. **Prepare** a one-page resume that uses the posting's words without claiming anything untrue.
4. **Track** what was sent, to whom, and what happens next.

Job boards sort by recency, spreadsheets and Notion get messy, and an LLM asked to "rank these jobs for me" gives answers that are hard to check and cost tokens on every run.

## 2. Iterations

| | Approach | What I learned |
|---|---|---|
| v1 (Sep 2026) | Python scraper of the SimplifyJobs feed → Notion | Collecting data is easy; deciding is the hard part |
| v2 (Sep–Oct 2026) | Scheduled AI agent with MCP connectors filtering into Notion | Automation helped, but Notion became cluttered and each run cost tokens |
| v3 (Oct 27, 2026 →) | Local web app + Chrome extension; rules rank, Claude reads and drafts | Separate what must be explainable (ranking, eligibility) from what benefits from a language model (reading postings, writing) |

v3 itself went through roughly 55 commits in two weeks: a data-safety pass, the scheduled refresh and scoring, a macOS-style redesign, Claude features, a resume standard based on Rice career-center guidance, and a data-correctness pass (see [CHANGELOG.md](../CHANGELOG.md)).

## 3. Key decisions and trade-offs

### Rules rank, the model reads
- **Decision.** The listing priority is a fixed, weighted formula (role fit 30, skill overlap 25, sponsorship evidence 20, recency 15, degree 5, location 5) that I chose and can explain. Claude is used only to turn one posting into structured data (requirements, keywords, eligibility rules with quotes) and to draft text.
- **Why.** A ranking must be repeatable and free to recompute for 170+ postings every two hours. Reading messy job descriptions is where a model is genuinely better than regular expressions.
- **Trade-off.** The formula cannot "understand" a posting; it relies on detected skills and wording. That is why the per-job page re-reads the posting with Claude on demand.

### Eligibility is never averaged into fit
- **Decision.** Degree level, graduation window, CPT/OPT, citizenship or clearance, and future sponsorship are judged one by one as meets / does not meet / to confirm / not applicable, each with the quote that decided it. A single "does not meet" shows **Not eligible**, whatever the fit score is.
- **Why.** A 90% skills match is worthless if the posting requires U.S. citizenship. Averaging would hide exactly the information that saves the most time.
- **Unknown is not zero.** A requirement the posting does not state is left out of the score instead of counted as a gap, and the page shows how much of the weight it could assess.

### Truthful tailoring
- **Decision.** The resume writer only receives facts I have confirmed in my Profile. Every bullet cites the fact IDs it came from, and the app flags numbers, tools or "led" claims that the cited facts do not contain. Unconfirmed points are never sent.
- **Why.** The most expensive resume mistake is a claim you cannot defend in an interview.
- **Trade-off.** Tailored resumes are more conservative than what an unconstrained model would write. Missing facts come back as questions ("Do you have row counts for that SQL work?") instead of invented numbers.

### Sponsorship evidence from public data
- **Decision.** Two employer-level signals: USCIS H-1B approvals (FY2023, the last year USCIS published an employer file) and Department of Labor LCA filings in computer and math occupations over the last 12 months. The listing uses the stronger of the two; the posting's own "no sponsorship" wording overrides both.
- **Hard part.** Employer names differ between job boards and government files ("AMD" vs. "Advanced Micro Devices", "PNNL" vs. "Battelle Memorial Institute"). Matching uses a small alias table, drops only organization words ("BancShares", "Holdings"), and never shortens a name to a generic word, because a wrong match is worse than no match. Approximate matches are labelled as such.

### Local-first
- **Decision.** One Python standard-library server on 127.0.0.1 and plain files in `data/`. No account, no cloud database, no framework or build step.
- **Why.** The data is personal (Profile, applications, resumes). Keeping it local removed whole classes of problems: authentication, hosting cost, and sending personal data to third parties.
- **Trade-off.** It cannot be shown as a live website. The README offers a demo mode with synthetic data and stubbed Claude answers instead.

### Cost control
- Every Claude call is a button with a cost estimate, checked against a monthly budget before it runs. Posting analysis uses the cheapest model on boilerplate-trimmed text and is cached per job. Tailoring can run on a Claude Pro plan through Claude Code at no API cost.
- In my own use: 41 calls (23 analyses, 17 tailorings, 1 cover letter) for about $0.12 in API fees.

## 4. Results (Nov 2026)

- 17,664 listings in the feed narrowed to about 170 that fit my Profile, refreshed every 2 hours.
- 40 applications tracked in one place (22 migrated from Notion).
- Each tailored resume is one page, cites its sources, and the version sent is kept for interview prep.
- ~11,600 lines of Python, JavaScript and CSS; unit, regression, parity and browser end-to-end tests run in GitHub Actions without secrets.

## 5. How it was built

I designed the product, wrote the requirements, chose the filtering rules and scoring weights, and review and test every change while using the app daily. The code was written with Claude Code as an AI pair programmer.

## 6. What I would do next

- **Calibrate the weights** against real outcomes once enough applications have replies (the app already logs score vs. outcome).
- **More sources** than one public feed, through the Chrome extension's queue or official job-board APIs.
- **A hosted read-only demo** built from the synthetic data, so the app can be tried without cloning it.

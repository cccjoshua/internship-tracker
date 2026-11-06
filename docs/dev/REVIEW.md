# Review and change record — 2026-10-31

This file summarises one review pass: what was found, what changed and how each change was checked. Tests are the detailed record; the test names below point to them.

## Findings and status

| # | Finding (from the external review, re-checked on this version) | Status | Regression test |
|---|---|---|---|
| 1 | Empty Profile + empty analysis + SWE title scored 74 | Fixed: unknown components are excluded; coverage < 60% or unassessable skills → "not enough information" | `regressions.test.js` #1 |
| 2 | High score despite a graduation-window mismatch | Fixed: eligibility rows; any "fails" → verdict `blocked`, total capped at 35, UI shows ✕ / Not eligible | #2, `fixtures.test.js` |
| 3 | `.NET → C#`, `C++ → C/C++ → C` over-inference | Fixed: spelling variants vs. one-level partial-credit inference, labelled; `.NET` no longer detected as C# in postings either | #3, `test_dotnet_is_not_csharp` |
| 4 | "No Python experience" counted as a Python hit | Fixed: negation window before each mention | #4 |
| 5 | factCheck let new years through; source id ≠ support | Fixed: years must be in the cited facts; tools must be in the cited facts (not just the Profile); solo-vs-team claims; no source → flagged. Still a heuristic | #5 |
| 6 | merge3 lost the other side's edit to another field of the same application | Fixed: field-level 3-way merge, id-keyed sub-lists merged, edit beats delete | #6 |
| 7 | "CPT/OPT not eligible" read as friendly | Fixed: sentence-level classification in `fetcher.py`, `OPT_EXCLUDED` in `core.js`; clips use it too | `SponsorshipWording`, `fixtures` |
| 8 | Hard-coded term/country/degree gates | Fixed: gates follow Profile → What I am looking for (terms, regions, degree levels) | `Gates.test_regions_from_profile`, `test_terms_from_settings` |
| 9 | company+title dedup (season/year stripped) merged different jobs | Fixed: season/year kept; different requisition ids on the same host are kept apart; a different link is never hidden as "already tracking" | `Gates.*` |
| 10 | New posting text kept the old analysis | Fixed: analyses carry a text hash; a change marks them stale, pauses tailoring/letters, banner on the job page | `test_new_posting_text_marks_the_analysis_stale` |
| 11 | Empty letter source / no sentence-level support | Fixed: sentence-level checks server- and client-side; generic sentences need no source, factual ones do | `test_cover_letter_sentences_are_checked_against_their_sources` |
| 12 | Delayed save/preview/generation shared global state across job switches | Fixed: saves are queued per job with a snapshot; late Claude results are saved to their own job and never written into another editor; stale layouts are dropped | E2E step 5 |
| 13 | Profile 409 re-sent the whole profile; resume/letter saves unchecked | Fixed: Profile 3-way merge; documents carry a revision, a conflict keeps both (yours as a named version) | `test_resume_save_conflict_keeps_both_versions`, #13 |
| 14 | "Exported" meant "ever exported" | Fixed: exports are recorded with a content hash; any edit clears exported and reviewed | E2E steps 7–8, `test_studio_index_summarizes_progress_per_job` |
| 15 | PDF turned Chinese names into "?" | Fixed (by refusing): PDF export lists the characters it cannot show and suggests .docx; preview warns. Embedding a CJK font was not added | `test_pdf_refuses_characters_it_cannot_show_and_docx_keeps_them` |
| 16 | Same file name overwrote exports | Fixed: stored copies are unique per job, kind and content; download name unchanged | `test_exports_never_overwrite_other_jobs_or_versions` |
| 17 | Budget, fallback, fetch failures, corrupt data | Budget is now a pre-call worst-case reservation; API fallback off by default; corrupt JSON is quarantined and never overwritten; clips are removed from the queue only once saved | `test_budget_*`, `test_corrupt_files_are_never_overwritten`, `test_clips` |

Found during this pass:
- Blank Profiles pre-filled "needs sponsorship = yes", "Master's". These are now Yes / No / Not set.
- The "paste the job description" box lost its text on background re-renders. It now keeps the text.
- The listing score was labelled "fit/match". It is now called priority.
- Contact details were sent to Claude. They are now added back locally.
- There were two complete design-token sets, and the web fonts were loaded but unused. The tokens now live only in `apple.css`, and the inline CSS was moved to `base.css`.

## Follow-up (same day): navigation and filters

- **Filters include your applications.** A search or filter on New listings now also lists matching open applications ("In your Applications"), since saved jobs leave the listings. Sponsorship options read "Sponsorship: yes / not stated / no" and refer to what the posting says; H-1B history alone does not count.
- **Clicking outside closes the preview.** Clicking a row switches the preview, and menus, dialogs, the drawer and toasts are ignored.
- **Sidebar follows Mail/Notes.** Search sits at the top (⌘K), Settings stays at the bottom of the list, and the footer shows only the save state and a "?" for shortcuts. Theme lives in Settings → Appearance.
- **Phones get five tabs.** Search and Settings moved to icon buttons in the page header, above the title.

## Verification (this pass)

- Python: 73 tests, `python3 -m unittest discover -s tests` (includes the extension page-reader test in a real browser).
- JavaScript: 29 tests (`core`, `regressions`, `fixtures`).
- Browser: `tests/e2e/run.sh` end-to-end flow, Chromium.
- Accessibility: axe-core 4.10 (WCAG 2.0/2.1/2.2 A and AA rules) on 9 pages × {1440, 768, 390} px × {light, dark}. 0 violations after contrast token fixes. No horizontal scroll at any of these widths.

Not verified:
- Real paid Claude calls (stub only).
- Claude Code CLI flags against the current CLI release.
- Safari / WebKit.
- VoiceOver.
- 200% zoom beyond the 768/390 reflow checks.
- The live SimplifyJobs feed (network stubbed).
- Your real `data/`, which was never opened by tests.

## References (read 2026-10-31)

- Anthropic pricing: platform.claude.com/docs/en/about-claude/pricing. Matches `ai.PRICES`.
- Simplify resume score help article: general description only, no formula.
- Apple HIG (materials, accessibility).
- WCAG 2.2.
- OWASP SSRF and LLM prompt-injection cheat sheets. Existing SSRF checks were kept, and posting text is wrapped as data.

## Before you publish

1. **History.** No API keys or tokens were found in any commit. However:
   - every commit's author email is your personal Gmail;
   - commits before `1e96719` ("Use fictional companies in example data") contain your real application records (company names, statuses, résumé file names).

   If the GitHub repository is or will be public, decide whether to rewrite history (for example `git filter-repo`) or start a fresh repository from the current tree. The `origin` remote answered without a login, so check its visibility on GitHub.
2. **Author email.** Consider your GitHub `noreply` address for future commits: `git config user.email <id>+<user>@users.noreply.github.com`.
3. **License.** Choose one:
   - **MIT**: simplest and most permissive;
   - **Apache-2.0**: permissive, with an explicit patent grant;
   - **GPL-3.0**: derivatives must stay open;
   - **no license**: all rights reserved, so others may view but not reuse.

   Then add `LICENSE`.
4. **Fonts.** `fonts/` is no longer used and can be removed: `git rm -r fonts`, then drop the font check in `tests/test_server.py`.
5. Review `git status` and `git diff`, then commit and push yourself.

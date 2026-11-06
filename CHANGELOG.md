# Changelog

How the Internship Tracker grew, grouped by milestone. Dates are when the work landed in this repository.

## Before this repository (Sep–Oct 2026)
- **v1:** a Python scraper of the SimplifyJobs feed writing into a Notion database.
- **v2:** a scheduled AI agent with MCP connectors that filtered listings by my criteria into Notion. Replaced because the Notion layout became too cluttered and every run cost tokens.

## 0.4 · Truthful resumes and correct data (Nov 6, 2026)
- **Resume standard** based on Rice Center for Career Development guidance: one page, a reference layout, bolded posting keywords, Professional Experience under Skills, tailoring that updates the current page instead of rewriting it.
- **Resume score** (match, impact, clarity, format, truth) with the biggest fixes and links to the exact bullet or Profile fact to change; evidence-weighted skill match.
- **Track briefs:** what employers look for in SWE, data engineering, data analyst/BI and data science internships, used to order each base resume.
- **Resume page:** edit on the left, the exact export on the right with Fit/100% zoom; Edit, Review and Ask Claude on one segmented control; focusing a bullet marks it on the page.
- **Submitted versions:** marking a job applied freezes the resume you sent; Documents shows Submitted, edited since, and score per resume.
- **Data check:** missing or out-of-order dates, duplicates, applied jobs without a submitted resume, unconfirmed Profile points, stale refreshes or sponsorship data.
- **Sponsorship data:** better employer-name matching for USCIS H-1B approvals (aliases, organization words, labelled approximate matches) and import of Department of Labor LCA filings as the current signal.
- **Tracker Clipper:** restyled to match the app (Apple-style controls, light and dark).
- Release polish from an accessibility and design audit: drawn icons, no emoji or decorative stripes, AA contrast.

## 0.3 · A native-feeling app with Claude (Nov 1–2, 2026)
- Redesign as a macOS-style app with a written design system (`DESIGN.md`) and product brief (`PRODUCT.md`): Dashboard, Applications (board and list), New listings, Documents, Profile, Settings, a ⌘K search palette.
- **Tracker Clipper**, a Chrome extension (Manifest V3) that reads the posting you are viewing (page data, then site-specific readers for LinkedIn, Workday, Greenhouse, Lever and Ashby) and queues it for the tracker.
- **Claude features:** posting analysis into structured requirements with quotes; eligibility and fit computed locally; resume tailoring from confirmed Profile facts; "Ask Claude to revise"; base resumes per track; cover letters; a budget and cost estimates; Claude Pro through Claude Code as an alternative to the API.
- Backend hardening: host and origin checks, safe link following, corrupt-file protection, revision-checked saves.
- Fixes: long postings cut off during analysis, page scripts leaking into posting text, soft skills counted as skills.

## 0.2 · Listings and a daily workflow (Oct 28, 2026)
- Scheduled SimplifyJobs refresh every 2 hours with Profile-driven filters, H-1B approval counts and an evidence-based 0–100 priority; a terminal CLI that uses the same formula.
- Daily checks for closed postings, today's queue and goals, deadlines, follow-ups, one-click Applied, file backups.
- Migrated 22 applications from Notion.

## 0.1 · Local tracker (Oct 27, 2026)
- First version: a local single-page tracker served by a Python standard-library server, with fictional example data and data-safety fixes.

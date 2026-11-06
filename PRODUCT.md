# Product

Internship Tracker — a personal, local internship tracker for one job seeker. Source: the owner's written redesign brief (2026-11-01).

## Platform
web

## Stack
Vanilla JavaScript (core.js, app.js, studio.js) and two CSS layers (base.css, apple.css) served by a Python standard-library server (server.py) on 127.0.0.1:8765, started at login by a macOS LaunchAgent. Data in `data/tracker.json` (atomic writes, revisioned saves, rolling backups). Listings refreshed on a schedule by fetcher.py from the SimplifyJobs feed. Claude API used for job analysis, resume tailoring and cover letters (ai.py). No frontend framework or build step; Playwright for tests only.

## Users
One user — the owner, a Rice MCS student targeting Summer 2027 SWE / Data Engineering / Data Analyst-BI / Data Science internships in the US. Uses it daily during recruiting season, on a MacBook, mostly with the keyboard.

## Product Purpose
1. Decide what to apply to today in under a minute.
2. Keep the application pipeline current (Saved → Applied → OA → Interview → Offer / Closed).
3. Prepare tailored resumes and cover letters from a single authoritative Profile.

## Positioning
A replacement for a messy Notion database: one calm, fast place that ranks new listings by the owner's own scoring rules and tracks every application.

## Operating Context
Opened many times a day for a few minutes at a time; long sessions only when tailoring a resume. Light and dark mode. Desktop-first; the phone layout is a fallback.

## Capabilities and Constraints
- Pages: Dashboard, Applications (kanban board + list), New listings, Documents, Profile, Settings, ⌘K search palette.
- Must keep every feature and every existing keyboard shortcut.
- Scoring logic, ranking semantics and Claude prompts do not change without the owner's approval.
- No heavy dependencies; prefer the platform (CSS, native elements).
- Profile data is personal: never sent anywhere new, never logged.
- Example data in the public repo uses fictional companies only.

## Brand Commitments
Feel like a native macOS app (Apple Mail, Reminders, System Settings): quiet, precise, information over decoration. Logo: "Waypoint" (see DESIGN.md §9).

## Evidence on Hand
Live app at http://127.0.0.1:8765; `docs/screenshots/`; `docs/dev/REVIEW.md` (2026-10-31 review and axe-core results).

## Product Principles
- Today first: the next action is always visible without scrolling.
- Color only when it carries meaning.
- One primary action per view.
- Never lose data.

## Accessibility & Inclusion
WCAG 2.2 AA (contrast, keyboard, focus-visible, reduced motion). Full keyboard operation. CJK names (Chinese/Japanese) must render correctly.

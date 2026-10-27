# Internship Application Tracker

A lightweight, local-first web app for tracking internship applications from first save to offer. It runs entirely on your own computer: one HTML page plus a small Python server, with no third-party packages and no account.

## Features

- **Dashboard**: to-apply count, applications, response rate (rejections count as replies), interview rate, offers; a "needs attention" list for deadlines, next steps and follow-ups; pipeline funnel; applications per week; breakdown by role track.
- **Board**: kanban by stage (Saved, Applied, Assessment, Interviewing, Offer, Closed). Drag cards, or use `Shift + ←/→` from the keyboard; touch devices get a stage menu.
- **Table**: sortable columns with inline status changes.
- **New listings**: incoming job listings ranked by a configurable score (role fit, recency, visa sponsorship, degree level, location), with a per-listing score breakdown.
- **Data safety**: duplicate detection (same company and role, or same link), multi-step undo, follow-up and missed-deadline actions, date-order validation, editable status history for backfilling dates, link validation (only `http`/`https`), CSV import (e.g. a Notion export) and JSON export/restore.
- **Accessible**: modal dialog with focus management, keyboard shortcuts (`N` new, `/` search, `Ctrl+Z` undo), WCAG AA text contrast, light and dark themes.

## Run it

Requires Python 3.8+.

```bash
python3 server.py            # opens http://127.0.0.1:8765
python3 server.py --port 9000 --no-browser
```

Data is saved to `data/tracker.json` (atomic writes). Backups go to `data/backups/`: at most one every 30 minutes, plus one before every delete, import, restore or clear; all are kept for 3 days, then thinned to one per day for 60 days. Each save is revision-checked, so two open tabs cannot silently overwrite each other. The server listens on `127.0.0.1` only and rejects cross-origin writes. `data/` is git-ignored, so personal application records never reach the repository.

### Start automatically on macOS

A LaunchAgent (`~/Library/LaunchAgents/com.joshua.internship-tracker.plist`) with `RunAtLoad` and `KeepAlive` starts the server at login and restarts it if it stops.

```bash
launchctl kickstart -k gui/$(id -u)/com.joshua.internship-tracker   # restart after editing server.py
launchctl bootout gui/$(id -u)/com.joshua.internship-tracker        # stop and unload
```

## Project structure

```
internship-tracker.html   UI: views, state, scoring, import/export (vanilla JS, no build step)
server.py                 Local server: serves the page, GET/PUT /api/state, daily backups
data/                     Your data (not committed)
```

## Roadmap

- Fetch new listings from SimplifyJobs on a schedule and score them automatically
- Calendar (.ics) export for deadlines and interviews
- Contacts and per-round interview notes
- Load the data into SQL (star schema) for a Tableau dashboard of the application funnel

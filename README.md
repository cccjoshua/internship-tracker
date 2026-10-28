# Internship Application Tracker

A local-first web app for tracking internship applications from first save to offer, with a scheduled feed of new listings ranked by a transparent score. It runs entirely on your own computer: one page plus a small Python server, no third-party packages, no account and no AI calls.

## Features

- **Dashboard**: one row of five tiles (applied today and this week against goals you can edit in place, needs attention, response and interview rates with small-sample warnings); a "needs attention" list for deadlines, next steps, interviews, follow-ups and saved applications you have not applied to; today's queue (your saved applications first, then "Apply now" listings, anything due within 7 days first of all); pipeline funnel; applications per week; breakdown by role track. Nav badges count only what needs you.
- **Saved workflow**: Save a listing to commit to applying; one-click **Applied ✓** or **Not applying** wherever a saved application appears; a reminder after 7 days and a soft limit of 15 saved applications (both adjustable).
- **Applications**, as a **Board** or a **List** (the choice is remembered). Board: kanban by stage; drag cards, or use `Shift + ←/→`; touch devices get a stage menu; dropping on Closed asks why. List: a stage filter (Open, To apply, In progress, Closed, All) and separate sections with their own columns and sorting: To apply (score, deadline, saved date, resume, actions) and In progress (status, applied, a computed next action, resume, visa); CSV export.
- **Application panel**: details, dates and next step, interview rounds (date, time, type, interviewer, notes), contacts, follow-up log and an editable status history.
- **New listings**: SimplifyJobs listings ranked by a configurable score with a per-listing breakdown, the application deadline when the posting states one, "Apply now / Tailor first / Low priority" labels (explained behind an info button), bulk save or dismiss, and a reason for each dismissal.
- **Settings** (gear icon): target tracks, locations, your skills, weights with each one's share of 100 points, thresholds, penalty and recency half-life, a live preview of how the ranking moves, score-vs-outcome calibration, goals, desktop notifications, resume versions, calendar, data and theme. Every setting says whether it applies instantly or from the next refresh.
- **Calendar**: `/calendar.ics` with deadlines, next steps and interview rounds, for a subscription in Apple Calendar or a one-off import.
- **Search everything** with `⌘K` / `Ctrl K`; press `?` for all keyboard shortcuts.
- **Data safety**: revision-checked saves with automatic three-way merge when two tabs edit at once, backups, multi-step undo, duplicate detection, date-order validation, link validation, backup download and import/restore from a .json or .csv file.
- **Accessible**: dialogs with focus management, full keyboard use, WCAG AA text contrast, light and dark themes, phone layout.

## Run it

Requires Python 3.8+.

```bash
python3 server.py                     # opens http://127.0.0.1:8765
python3 server.py --port 9000 --no-browser --data /path/to/data
```

The first visit with no data opens a short setup guide (target tracks, locations, skills, daily and weekly goals).

### Files

| File | Written by | Contents |
|---|---|---|
| `data/tracker.json` | the page | applications, settings, dismissed listings |
| `data/listings.json` | the scheduled refresh | listings, last refresh summary, postings found closed |
| `data/backups/` | the server | copies of tracker.json: at most one every 30 minutes, plus one before every delete, import, restore or clear; all kept for 3 days, then one per day for 60 days |
| `data/cache/` | the refresh | feed, H-1B index, posting-text cache |

Your edits and the refresh never write the same file, so a refresh can never overwrite an edit. Each save carries the revision it was based on; if another tab saved first, the page merges both versions (your version wins only where both changed the same application) and saves again. The server listens on `127.0.0.1` only, serves only the app's own files and rejects cross-origin writes. `data/` is git-ignored. Data from older versions (listings inside tracker.json) is moved to listings.json automatically on start, after a backup.

### Start automatically on macOS

A LaunchAgent (`~/Library/LaunchAgents/com.joshua.internship-tracker.plist`) with `RunAtLoad` and `KeepAlive` starts the server at login and restarts it if it stops.

```bash
launchctl kickstart -k gui/$(id -u)/com.joshua.internship-tracker   # restart after updating the code
launchctl bootout gui/$(id -u)/com.joshua.internship-tracker        # stop and unload
```

## Job listings: fetch, filter and score

`fetcher.py` downloads the [SimplifyJobs](https://github.com/SimplifyJobs) listings feed (ETag-cached), keeps Summer 2027 US postings from the last 10 days, and drops ones that are PhD/MBA-only, outside the target fields, require U.S. citizenship or a security clearance, or are already tracked or dismissed. It reads each new posting once (Workday, Greenhouse and Lever APIs, otherwise the page) and stores the facts: track, locations, degrees, the employer's H-1B approvals in the USCIS H-1B Employer Data Hub, sponsorship wording, the tools the posting names and the application deadline it states (or Workday's posting end date). Listings past their deadline are dropped.

The page scores those facts with your settings (`core.js`), so every setting takes effect at once:

| Component | Default weight | How it is measured |
|---|---|---|
| Role fit | 30 | title maps to a target track (SWE, DE, DA, DS, BIE); halved for PhD, senior, staff or MBA titles |
| Skill match | 25 | share of the tools the posting names that are in your skills (Laplace-smoothed) |
| Sponsorship evidence | 20 | H-1B approvals on a log scale; 0.9 if the posting welcomes CPT/OPT/F-1 |
| Recency | 15 | halves every 5 days (adjustable) |
| Degree | 5 | Master's listed |
| Location | 5 | one of your preferred places (default Texas or remote) |

A posting that says it will not sponsor loses 20 points (adjustable). Postings are rechecked once a day: listings whose page is gone are removed; a deadline found in a saved application's posting fills an empty deadline (never one you entered); and Saved applications whose posting closed or whose deadline passed move to Closed as "Posting closed" (reopening one stops the check for it). The refresh runs every 2 hours (adjustable) and the same data is available in the terminal:

```bash
python3 jobs.py                               # top 20
python3 jobs.py --track DS,DA,BIE --min 70 --days 5 --sponsor ok
python3 jobs.py show 1                        # score breakdown, matched and missing skills
python3 jobs.py open 1                        # open the posting
python3 jobs.py fetch                         # refresh now
```

## Tests

```bash
python3 -m unittest discover -s tests         # fetcher, server, and JS/Python scoring parity (needs node for parity)
node --test tests/core.test.js                # scoring, labels and merge in core.js
```

`tests/test_parity.py` scores 600 random listings under random settings in both `core.js` and `fetcher.py` and requires identical results, so the page and the terminal can never disagree.

## Project structure

```
internship-tracker.html   Page markup and styles
app.js                    Views, state, storage, dialogs, import/export, notifications
core.js                   Scoring formula, track inference, three-way merge (shared with tests)
server.py                 Local server: files, revisions, backups, calendar, scheduled refresh
fetcher.py                Feed download, gates, posting text checks, the same scoring for the terminal
jobs.py                   Terminal list/show/open/fetch
fonts/                    Instrument Sans and IBM Plex Mono (SIL Open Font License)
tests/                    Unit and parity tests
data/                     Your data (not committed)
```

## Roadmap

- Calibrate the weights against real outcomes (Settings → Score vs. outcomes shows the numbers)
- Load the data into SQL (star schema) for a Tableau dashboard of the application funnel

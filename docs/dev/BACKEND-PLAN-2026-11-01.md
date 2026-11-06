# Backend review and plan — Phase 5 (2026-11-01)

Inspection only. Nothing below has been implemented yet.

## What is already solid (keep as is)

- **Writes are atomic.** `server._write`, `fetcher._write_bytes` and `ai._write` write a temp file in the same folder, then `os.replace`.
- **Saves carry a revision.** A stale save gets HTTP 409, and the page runs a field-level three-way merge (`core.merge3`).
- **Backups.** `tracker.json` is copied at most every 30 minutes, plus before every delete, import, restore or clear. All copies from the last 3 days are kept, then one per day up to 60 days. The profile keeps 60 copies.
- **Corrupt files are never overwritten.** An unreadable `tracker.json` or `profile.json` is copied to `backups/corrupt/`, and the API answers 503 with a recovery message.
- **One refresh at a time.** `FETCH_LOCK` is non-blocking, and `POST /api/fetch` answers 202 `busy` while a refresh runs. A failed refresh keeps the old listings and records the error.
- **Claude calls.**
  - Timeouts: 180 s for the API, 420 s for Claude Code.
  - Two retries on 429/500/502/503/529, honouring `retry-after`.
  - Every failure has a specific message.
  - The budget is reserved before each call.
  - Only confirmed facts are sent (`test_tailor_sends_only_confirmed_facts…`), and contact details are added back locally.
  - The Claude Code status check is cached for 10 minutes.
- **Performance on real data** (168 listings, 29 applications), measured in the browser:

  | Measurement | Result |
  |---|---|
  | Every `/api/*` call | under 15 ms (`/api/ai/status`: 0.4 s once, then cached) |
  | Render: Board, Docs, Settings | 1.5–1.7 ms |
  | Render: Dashboard, New listings, List | 3–6 ms |
  | Render: Profile | 34 ms |
  | Scoring all listings | 3.8 ms cold, then cached per data revision |
  | JS heap | about 5 MB |
  | Hidden listings (about 2,600) | searched on the server since Phase 3; never shipped to the page |

## Findings and proposed changes

### Data safety

| # | Finding | Proposal | Risk |
|---|---|---|---|
| D1 | The three writers never `fsync`, so a power loss right after `os.replace` can leave an empty or partial file. A failed write leaves `.tmp-*` files behind. | One shared helper, `safeio.write_json` / `write_bytes`. It writes the temp file, `fsync`s it, renames it, `fsync`s the folder and removes the temp file on any error. Used by `server`, `fetcher` and `ai`. | Low |
| D2 | On save, the server only checks that `apps` is a list. A malformed body (e.g. an app without an `id`) is written as is. On load, only JSON syntax is checked. | Lenient type validation on save and on load. `apps` must be a list of objects with a string `id` and a known `status`; `settings` must be an object; dates must be strings. Unknown fields are kept. A failing save gets a 400 that names the bad fields. A failing load gets the existing 503 path. No schema change and no migration. | Low |
| D3 | A corrupt `listings.json` is silently treated as empty, so the page shows no listings and gives no reason. | Quarantine it like the other files, show "Listings file was unreadable; rebuilding" in the status line, and rebuild on the next refresh (it is regenerable). | Low |

### API and error handling in the page

| # | Finding | Proposal |
|---|---|---|
| A1 | Every failed save is reported as "Server not reachable; kept in this browser" and retried every 15 s forever. That includes 400 (invalid data), 413 (too large) and 503 (corrupt file), which retrying cannot fix. | Classify the failure. **Offline:** keep the queue, retry with backoff (5 s → 15 s → 60 s), and show a **Retry now** button. **400/413:** stop retrying, show the server's message, and offer **Download unsaved changes** (a .json of the queued data). **503:** stop retrying and show a banner with **Open Settings → Your data** to restore a backup. |
| A2 | Error bodies are mostly `{"error": ...}`, but some 500s carry raw exception text. | Use one shape everywhere: `{"error": "<what happened>", "hint": "<what to do>"}`. Internal details go to `server.log` only, never profile data. |
| A3 | Three UI failures are swallowed silently: the Claude config switch save (`studio.js` ~1045), the job reload after an export (~1093) and the application-kit index load (`app.js` ~427). | Show a toast with a retry, or a quiet inline note for the kit index. |

### Listing refresh job

| # | Finding | Proposal |
|---|---|---|
| R1 | No retries. Each feed URL is tried once, then the cached feed is used. A brief network blip falls back to stale data. | 3 attempts per feed URL with backoff (2 s, 8 s) for network errors and 5xx, before the existing cache fallback. Record `usingCache: true` in `fetch` so the page can say so. |
| R2 | The lock is in-process only. `python3 fetcher.py` from Terminal (or a second server on the same data folder) can run a refresh at the same time and race on `cache/` and `listings.json`. | Add a cross-process file lock (`fcntl.flock` on `data/.refresh.lock`) around the whole refresh, alongside `FETCH_LOCK`. |
| R3 | The page only knows a refresh is running when it started the refresh itself. Scheduled runs and their progress are invisible, and an error is shown only after the fact. | Add `GET /api/fetch/status` returning `{running, startedAt, step, lastAt, lastError, nextAt, usingCache}`. The New listings status line polls it while running and shows "Refreshing… (reading postings 40/120)". A failure shows the reason and **Retry**. |
| R4 | The scheduler sleeps 300 s at a time. After the Mac wakes, a due refresh can wait up to 5 minutes. `search.py` is missing from the code-watcher list, so an update to it does not restart the server. | Tick every 30 s against the wall clock, and treat a jump of more than 2 minutes as a wake: a due refresh then starts within about 30 s. Add `search.py` to `CODE`. Extract the "is a refresh due?" decision into a pure function so it can be tested. |

### Performance

| # | Finding | Proposal |
|---|---|---|
| P1 | Nothing slow today. At 3,000 visible listings, scoring would take about 70 ms once per data change. Rows already render 25 at a time with "Show more", and hidden listings stay on the server. | **No change.** Add a budget test instead: score 3,000 synthetic listings in under 150 ms, and keep the search-index test at under 16 ms per keystroke. |
| P2 | The Profile page re-renders fully (34 ms) on some autosaves. | Skip unless it feels laggy. |
| P3 | `studio.js` (162 KB) loads at start. | Skip. It is read from local disk, and lazy loading would add complexity for no visible gain. |

### Claude calls

| # | Finding | Proposal |
|---|---|---|
| C1 | A dropped connection (`URLError`) is not retried, only HTTP 429/5xx. | Retry once after 2 s for connection resets and timeouts on the API path (not on the Claude Code path, which can take minutes). |
| C2 | The privacy guarantees are tested only for unconfirmed facts. | Add a test that the request sent to Claude never contains `basics.email`, `phone`, `linkedin`, `github`, `website`, or entries marked hidden. |

## Tests to add

- `safeio`: fsync and rename happen; temp files are removed on error; private files keep mode 600.
- Validation: a good state passes; each bad shape gets a 400 naming the field; unknown fields survive.
- Save failure classes (a pure function in `core.js`, tested with `node --test`).
- Refresh: retry/backoff with a stubbed `http_get`; the file lock blocks a second run; the status endpoint; the wake/due decision.
- Budgets: scoring 3,000 listings, and the palette index (exists).
- Privacy: no contact fields in Claude requests.

## Not changing

Scoring logic and ranking semantics, Claude prompts, the data schema (no migration), dependencies (standard library only).

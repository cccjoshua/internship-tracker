#!/usr/bin/env python3
"""Terminal view of your scored internship listings (same scores as the web page).

Examples
  python3 jobs.py                                 top 20 by score
  python3 jobs.py --track DS,DA,BIE --min 70      only these tracks, score 70+
  python3 jobs.py --days 3 --sponsor friendly     posted in the last 3 days, posting welcomes CPT/OPT
  python3 jobs.py --sponsor h1b --loc TX          employer has H-1B history, Texas locations
  python3 jobs.py --skill SQL --skill Tableau     posting asks for SQL and Tableau
  python3 jobs.py --company amazon --all          every listing from one company
  python3 jobs.py show 3                          score breakdown for row 3 of the last list
  python3 jobs.py open 3                          open row 3's posting in your browser
  python3 jobs.py fetch                           refresh from SimplifyJobs now

--sponsor values: any (default), h1b (employer has H-1B approvals), friendly
(posting mentions CPT/OPT/F-1), ok (h1b or friendly, and no "no sponsorship" wording).
Tracks: SWE, DE, DA, DS, BIE, Quant.
"""
import argparse
import datetime as dt
import json
import os
import shutil
import sys
import urllib.request
import webbrowser

import fetcher

ROOT = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(ROOT, "data", "tracker.json")
LAST = os.path.join(ROOT, "data", "cache", "last_list.json")
SERVER = "http://127.0.0.1:8765"

BOLD, DIM, GREEN, YELLOW, RED, RESET = ("\033[1m", "\033[2m", "\033[32m", "\033[33m", "\033[31m", "\033[0m") if sys.stdout.isatty() else ("",) * 6


def load():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        sys.exit("No data yet. Start the tracker (python3 server.py) or run: python3 jobs.py fetch")


def weights(state):
    w = (state.get("settings") or {}).get("weights") or {}
    return w if "skills" in w else fetcher.DEFAULT_WEIGHTS


def age_days(l):
    try:
        return (dt.date.today() - dt.date.fromisoformat(l.get("posted"))).days
    except (TypeError, ValueError):
        return None


def cut(s, n):
    s = s or ""
    return s if len(s) <= n else s[: n - 1] + "…"


def color_score(s):
    c = GREEN if s >= 80 else YELLOW if s >= 65 else DIM
    return f"{c}{s:>3}{RESET}"


def cmd_list(a):
    state = load()
    w = weights(state)
    tracks = {t.strip().upper() for t in (a.track or "").split(",") if t.strip()}
    rows = []
    for l in state.get("listings") or []:
        if l.get("source") != "simplify":
            continue
        s = fetcher.score(l, w)
        d = age_days(l)
        friendly = "CPT/OPT friendly" in (l.get("flags") or [])
        nosp = "No sponsorship" in (l.get("flags") or [])
        if tracks and (l.get("track") or "").upper() not in tracks:
            continue
        if a.min and s < a.min:
            continue
        if a.days is not None and (d is None or d > a.days):
            continue
        if a.sponsor == "h1b" and not l.get("h1b"):
            continue
        if a.sponsor == "friendly" and not friendly:
            continue
        if a.sponsor == "ok" and (nosp or not (l.get("h1b") or friendly)):
            continue
        if a.loc and a.loc.lower() not in (l.get("location") or "").lower():
            continue
        if a.company and a.company.lower() not in (l.get("company") or "").lower():
            continue
        have = set((l.get("skills") or {}).get("matched", [])) | set((l.get("skills") or {}).get("missing", []))
        if a.skill and not all(any(k.lower() == h.lower() for h in have) for k in a.skill):
            continue
        rows.append((s, d, l))
    rows.sort(key=lambda r: (-r[0], r[1] if r[1] is not None else 99))
    shown = rows if a.all else rows[: a.limit]
    width = shutil.get_terminal_size((140, 20)).columns
    role_w = max(24, min(52, width - 82))
    f = state.get("fetch") or {}
    print(f"{BOLD}{len(rows)} listings match{RESET}  {DIM}(refreshed {f.get('at', 'never')[:16].replace('T', ' ')}){RESET}")
    print(f"{DIM}{'#':>3}  {'Fit':>3}  {'Trk':5} {'Company':22} {'Role':{role_w}} {'Location':18} {'Age':>4} {'H-1B':>6}  Notes{RESET}")
    ids = []
    for i, (s, d, l) in enumerate(shown, 1):
        ids.append(l["id"])
        sk = l.get("skills") or {}
        n_all = len(sk.get("matched", [])) + len(sk.get("missing", []))
        notes = []
        if l.get("isNew"):
            notes.append(f"{GREEN}new{RESET}")
        if "CPT/OPT friendly" in (l.get("flags") or []):
            notes.append(f"{GREEN}CPT/OPT{RESET}")
        if "No sponsorship" in (l.get("flags") or []):
            notes.append(f"{RED}no-sponsor{RESET}")
        if n_all:
            notes.append(f"skills {len(sk.get('matched', []))}/{n_all}")
        if l.get("deadline"):
            left = (dt.date.fromisoformat(l["deadline"]) - dt.date.today()).days
            notes.append(f"{RED if left <= 3 else YELLOW if left <= 7 else ''}due {l['deadline'][5:]}{RESET}")
        h = l.get("h1b")
        print(f"{i:>3}  {color_score(s)}  {(l.get('track') or ''):5} {cut(l.get('company'), 22):22} {cut(l.get('role'), role_w):{role_w}} "
              f"{cut(l.get('location'), 18):18} {(str(d) + 'd') if d is not None else '?':>4} {('-' if h is None else h):>6}  {' '.join(notes)}")
    os.makedirs(os.path.dirname(LAST), exist_ok=True)
    with open(LAST, "w", encoding="utf-8") as fh:
        json.dump(ids, fh)
    if len(rows) > len(shown):
        print(f"{DIM}… {len(rows) - len(shown)} more. Use --limit N or --all.{RESET}")


def pick(ref):
    state = load()
    items = {l["id"]: l for l in state.get("listings") or []}
    if ref.isdigit():
        try:
            with open(LAST, encoding="utf-8") as fh:
                ids = json.load(fh)
            return state, items[ids[int(ref) - 1]]
        except (OSError, ValueError, IndexError, KeyError):
            sys.exit("Row not found. Run a list first, then use its row number.")
    if ref in items:
        return state, items[ref]
    sys.exit("Listing not found.")


def cmd_show(a):
    state, l = pick(a.ref)
    w = weights(state)
    v = dict(l.get("v") or {})
    d = age_days(l) or 0
    v["recency"] = 0.5 ** (d / fetcher.RECENCY_HALF_LIFE)
    tot = sum(max(0, float(w.get(k, 0) or 0)) for k in fetcher.DEFAULT_WEIGHTS)
    print(f"{BOLD}{l['company']} — {l['role']}{RESET}")
    print(f"{l.get('location')}  ·  posted {d} days ago  ·  {l.get('degree')}  ·  track {l.get('track')}")
    print(f"Application deadline: {l.get('deadline') or 'not stated in the posting'}")
    print(f"{l.get('url')}\n")
    print(f"{BOLD}Score {fetcher.score(l, w)}{RESET}")
    for k in fetcher.DEFAULT_WEIGHTS:
        wk = max(0, float(w.get(k, 0) or 0))
        print(f"  {k:9} {wk * v.get(k, 0) / tot * 100:5.1f} / {wk / tot * 100:4.1f}   (value {v.get(k, 0):.2f})")
    if l.get("penalty"):
        print(f"  {'penalty':9} -{l['penalty']}   (posting says it will not sponsor)")
    h = l.get("h1b")
    print(f"\nSponsorship: {'no H-1B record found' if h is None else f'{h:,} H-1B approvals (USCIS FY2023)'}; flags: {', '.join(l.get('flags') or []) or 'none'}")
    sk = l.get("skills") or {}
    print(f"Skills on your resume: {', '.join(sk.get('matched', [])) or '-'}")
    print(f"Asked for, not on resume: {', '.join(sk.get('missing', [])) or '-'}")


def cmd_open(a):
    _, l = pick(a.ref)
    webbrowser.open(l["url"])
    print("Opened", l["url"])


def cmd_fetch(_):
    try:
        req = urllib.request.Request(SERVER + "/api/fetch?wait=1", method="POST", data=b"")
        with urllib.request.urlopen(req, timeout=600) as r:
            info = json.loads(r.read())
        if info.get("busy"):
            print("A refresh is already running; try again in a minute.")
            return
    except OSError:
        print("Server not running; refreshing directly.")
        state = load() if os.path.exists(STATE) else {"apps": [], "listings": []}
        info = fetcher.apply(state, fetcher.refresh(state))
        state["rev"] = int(state.get("rev", 0) or 0) + 1
        fetcher._write_json(STATE, state)
    if info.get("error"):
        print("Refresh failed:", info["error"])
    else:
        print(f"Refreshed: {info.get('matched')} listings ({info.get('new', 0)} new) from {info.get('feed')} in the feed.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")
    for name in ("list",):
        p = sub.add_parser(name)
    for p in (ap, sub.choices["list"]):
        p.add_argument("--track", help="comma separated: SWE,DE,DA,DS,BIE,Quant")
        p.add_argument("--min", type=int, default=0, help="minimum score")
        p.add_argument("--days", type=int, help="posted within N days")
        p.add_argument("--sponsor", choices=["any", "h1b", "friendly", "ok"], default="any")
        p.add_argument("--loc", help="location contains, e.g. TX or Seattle")
        p.add_argument("--company", help="company contains")
        p.add_argument("--skill", action="append", help="posting mentions this skill (repeatable)")
        p.add_argument("--limit", type=int, default=20)
        p.add_argument("--all", action="store_true")
    sub.add_parser("show").add_argument("ref")
    sub.add_parser("open").add_argument("ref")
    sub.add_parser("fetch")
    a = ap.parse_args()
    {"show": cmd_show, "open": cmd_open, "fetch": cmd_fetch}.get(a.cmd, cmd_list)(a)


if __name__ == "__main__":
    main()

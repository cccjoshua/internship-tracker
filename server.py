#!/usr/bin/env python3
"""Local server for the Internship Application Tracker.

Run:  python3 server.py            (opens http://127.0.0.1:8765)
      python3 server.py --port 9000 --no-browser --data /path/to/data

Files (all in the data folder, which is git-ignored):
- tracker.json   your applications, settings and dismissed listings. Written
                 atomically. Every save carries the revision it was based on;
                 a save based on an older revision is refused (HTTP 409) and the
                 page merges both versions instead of overwriting either.
- listings.json  job listings from the scheduled refresh. Only the refresh
                 writes it, so a refresh never conflicts with your edits.
- backups/       copies of tracker.json: at most one every 30 minutes while you
                 work, plus one before every delete, import, restore or clear.
                 All from the last 3 days are kept; older ones are thinned to
                 one per day and removed after 60 days.
- cache/         downloaded feed, H-1B index and posting-text cache.

- profile.json    your Profile: the only source of facts for resumes and match scores.
- ai/, resumes/, letters/, exports/, secrets.json   Claude API results, resume and cover letter drafts, exported files and
                 the API key (see ai.py). Never served as files.

Also serves /calendar.ics (deadlines, next steps and interviews) for a calendar
subscription. Listens on 127.0.0.1 only and refuses cross-origin writes.
When started by launchd it exits after its own code changes, so KeepAlive restarts it with the new code.
Uses only the Python standard library (Python 3.8+).
"""
import argparse
import datetime as dt
import hashlib
import http.server
import json
import os
import re
import shutil
import socketserver
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
import webbrowser

import ai
import clips
import fetcher
import resume_export
import search

ROOT = os.path.dirname(os.path.abspath(__file__))
PAGE = "internship-tracker.html"
STATIC = {"/core.js": ("core.js", "text/javascript; charset=utf-8"), "/app.js": ("app.js", "text/javascript; charset=utf-8"),
          "/studio.js": ("studio.js", "text/javascript; charset=utf-8"),
          "/base.css": ("base.css", "text/css; charset=utf-8"), "/apple.css": ("apple.css", "text/css; charset=utf-8"),
          "/search.js": ("search.js", "text/javascript; charset=utf-8"), "/palette.js": ("palette.js", "text/javascript; charset=utf-8"),
          "/icon.svg": ("icon.svg", "image/svg+xml"), "/favicon.svg": ("favicon.svg", "image/svg+xml")}
FONT = re.compile(r"^/fonts/([a-z0-9-]+\.woff2)$")
LOCAL_HOSTS = ("127.0.0.1", "localhost", "[::1]")
BACKUP_EVERY = dt.timedelta(minutes=30)
KEEP_ALL_DAYS = 3
KEEP_MAX_DAYS = 60
MAX_BODY = 20 * 1024 * 1024  # 20 MB
BACKUP_NAME = re.compile(r"^tracker-\d{4}-\d{2}-\d{2}(-\d{6})?\.json$")
LOCK = threading.Lock()           # tracker.json
PROFILE_LOCK = threading.Lock()   # profile.json
LISTINGS_LOCK = threading.Lock()  # listings.json
FETCH_LOCK = threading.Lock()     # one refresh at a time

DATA_DIR = STATE = LISTINGS = BACKUPS = PROFILE = ""


def configure(data_dir):
    """Point the server (and the fetcher's cache and the AI module) at a data folder."""
    global DATA_DIR, STATE, LISTINGS, BACKUPS, PROFILE
    DATA_DIR = os.path.abspath(data_dir)
    STATE = os.path.join(DATA_DIR, "tracker.json")
    LISTINGS = os.path.join(DATA_DIR, "listings.json")
    BACKUPS = os.path.join(DATA_DIR, "backups")
    PROFILE = os.path.join(DATA_DIR, "profile.json")
    fetcher.CACHE = os.path.join(DATA_DIR, "cache")
    ai.configure(DATA_DIR)
    clips.configure(DATA_DIR)


configure(os.environ.get("IAT_DATA_DIR") or os.path.join(ROOT, "data"))


# ---------------------------------------------------------------- files
def _read(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def load_state():
    return _read(STATE)


def load_listings():
    try:
        return _read(LISTINGS) or {}
    except (OSError, ValueError):
        return {}


def write_state(data):
    _write(STATE, data)


def migrate_files():
    """Older versions kept listings inside tracker.json. Move them to listings.json once."""
    with LOCK, LISTINGS_LOCK:
        try:
            state = load_state()
        except (OSError, ValueError):
            return
        if not state or ("listings" not in state and "fetch" not in state):
            return
        backup(force=True)
        old = state.pop("listings", None) or []
        feed = [fetcher.upgrade_listing(l) for l in old if l.get("source") == "simplify"]
        manual = [l for l in old if l.get("source") != "simplify"]
        state["manualListings"] = (state.get("manualListings") or []) + manual
        listings = load_listings()
        listings.setdefault("listings", feed)
        listings.setdefault("fetch", state.pop("fetch", None))
        state.pop("fetch", None)
        listings.setdefault("closures", [])
        listings["liveChecked"] = {a["id"]: a["liveAt"] for a in state.get("apps") or [] if a.get("id") and a.get("liveAt")}
        listings["lrev"] = int(listings.get("lrev", 0) or 0) + 1
        settings = state.setdefault("settings", {})
        if state.get("apps"):
            settings["onboarded"] = True
        state["rev"] = int(state.get("rev", 0) or 0) + 1
        _write(LISTINGS, listings)
        write_state(state)
        print(f"Moved {len(feed)} listings to {LISTINGS}", flush=True)


# ---------------------------------------------------------------- backups
def _backup_time(name):
    stem = name[len("tracker-"):-len(".json")]
    fmt = "%Y-%m-%d-%H%M%S" if len(stem) > 10 else "%Y-%m-%d"
    return dt.datetime.strptime(stem, fmt)


def list_backups():
    if not os.path.isdir(BACKUPS):
        return []
    names = [n for n in os.listdir(BACKUPS) if BACKUP_NAME.match(n)]
    return sorted(names, key=_backup_time, reverse=True)


def prune_backups(now=None):
    now = now or dt.datetime.now()
    seen_days = set()
    for name in list_backups():  # newest first
        t = _backup_time(name)
        age = now - t
        day = t.date()
        keep = age <= dt.timedelta(days=KEEP_ALL_DAYS) or (age <= dt.timedelta(days=KEEP_MAX_DAYS) and day not in seen_days)
        seen_days.add(day)
        if not keep:
            os.remove(os.path.join(BACKUPS, name))


def backup(force=False):
    """Copy the current state into backups/ if forced or the last backup is old enough."""
    if not os.path.exists(STATE):
        return
    os.makedirs(BACKUPS, exist_ok=True)
    existing = list_backups()
    now = dt.datetime.now()
    if not force and existing and now - _backup_time(existing[0]) < BACKUP_EVERY:
        return
    target = os.path.join(BACKUPS, f"tracker-{now:%Y-%m-%d-%H%M%S}.json")
    if not os.path.exists(target):
        shutil.copy2(STATE, target)
    prune_backups(now)


# ---------------------------------------------------------------- refresh
def with_profile_filters(user):
    """The refresh gates follow Profile → What you are looking for (term, regions, degree levels) when set."""
    try:
        pref = (load_profile() or {}).get("preferences") or {}
    except Exception:
        pref = {}
    settings = dict((user or {}).get("settings") or {})
    if pref.get("terms") and not settings.get("terms"):
        settings["terms"] = [t.strip() for t in str(pref["terms"]).split(",") if t.strip()]
    if pref.get("regions") and not settings.get("regions"):
        settings["regions"] = list(pref["regions"])
    deg = {"Bachelor": "Bachelor's", "Master": "Master's", "PhD": "PhD", "MBA": "MBA"}
    if pref.get("degreePursuing") and not settings.get("degreeLevels"):
        levels = {deg.get(pref["degreePursuing"], pref["degreePursuing"])} | {deg.get(d, d) for d in pref.get("degreesHeld") or []}
        settings["degreeLevels"] = sorted(levels | {"Bachelor's", "Master's"} if "Master's" in levels else levels)
    return dict(user or {}, settings=settings)


def run_fetch():
    """Download and describe listings, then write listings.json. Never writes tracker.json."""
    if not FETCH_LOCK.acquire(blocking=False):
        return {"busy": True}
    try:
        try:
            user = load_state() or {}
        except (OSError, ValueError):
            user = {}
        before = load_listings()
        try:
            result = fetcher.refresh(with_profile_filters(user), before, log=lambda m: print(m, flush=True))
            error = None
        except Exception as e:
            print(traceback.format_exc(), flush=True)
            result, error = None, e
        with LISTINGS_LOCK:
            current = load_listings()
            try:
                user = load_state() or {}  # latest tracked and dismissed, read only
            except (OSError, ValueError):
                pass
            out = fetcher.apply(user, current, result) if result else fetcher.failed(current, error)
            _write(LISTINGS, out)
        return out["fetch"]
    finally:
        FETCH_LOCK.release()


def scheduler():
    time.sleep(5)
    while True:
        try:
            state = load_state() or {}
            hours = float((state.get("settings") or {}).get("fetchHours") or 2)
            last = (load_listings().get("fetch") or {}).get("at")
            due = True
            if last:
                elapsed = dt.datetime.now().astimezone() - dt.datetime.fromisoformat(last)
                due = elapsed >= dt.timedelta(hours=max(0.5, hours))
            if due:
                run_fetch()
            ai.check_changes(log=lambda m: print(m, flush=True))  # once a day: did analyzed postings change or close? (no AI calls)
        except Exception:
            print(traceback.format_exc(), flush=True)
        time.sleep(300)


def import_h1b(data, filename):
    """Load a USCIS H-1B Employer Data Hub file and update every listing's H-1B count right away."""
    meta = fetcher.import_h1b(data, filename)
    h1b = fetcher.H1B(lambda m: None)
    with LISTINGS_LOCK:
        cur = load_listings()
        for l in cur.get("listings") or []:
            l["h1b"] = h1b.lookup(l.get("company"))
        if cur.get("fetch"):
            cur["fetch"]["h1b"] = meta["label"]
        cur["lrev"] = int(cur.get("lrev", 0) or 0) + 1
        _write(LISTINGS, cur)
    return meta


# ---------------------------------------------------------------- calendar
CLOSED = {"rejected", "withdrawn", "missed", "ghosted", "expired"}


def _ics_text(s):
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\\n").replace("\n", "\\n")


def _fold(line):
    out, b = [], line.encode("utf-8")
    while len(b) > 75:
        cut = 75 if not out else 74
        while cut > 0 and (b[cut] & 0xC0) == 0x80:  # do not split a UTF-8 character
            cut -= 1
        out.append(b[:cut].decode("utf-8"))
        b = b[cut:]
    out.append(b.decode("utf-8"))
    return "\r\n ".join(out)


def _date(s):
    try:
        return dt.date.fromisoformat(s)
    except (TypeError, ValueError):
        return None


def calendar(state, now=None):
    """iCalendar text: deadlines of saved applications, next steps and interview rounds."""
    now = now or dt.datetime.now(dt.timezone.utc)
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Internship Tracker//EN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", "X-WR-CALNAME:Internship Tracker", "REFRESH-INTERVAL;VALUE=DURATION:PT1H"]

    def event(uid, summary, day, time_=None, desc="", url=""):
        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{uid}@internship-tracker.local")
        lines.append(f"DTSTAMP:{stamp}")
        m = re.match(r"^(\d{2}):(\d{2})$", time_ or "")
        if m:
            lines.append(f"DTSTART:{day:%Y%m%d}T{m.group(1)}{m.group(2)}00")
            lines.append("DURATION:PT1H")
        else:
            lines.append(f"DTSTART;VALUE=DATE:{day:%Y%m%d}")
            lines.append(f"DTEND;VALUE=DATE:{day + dt.timedelta(days=1):%Y%m%d}")
        lines.append("SUMMARY:" + _ics_text(summary))
        if desc:
            lines.append("DESCRIPTION:" + _ics_text(desc))
        if re.match(r"^https?://\S+$", url or ""):
            lines.append("URL:" + url)
        lines.append("END:VEVENT")

    for a in (state or {}).get("apps") or []:
        aid, co, role, url = a.get("id", ""), a.get("company", ""), a.get("role", ""), a.get("url", "")
        if a.get("sample"):
            continue
        is_open = a.get("status") not in CLOSED
        d = _date(a.get("deadline"))
        if d and a.get("status") == "saved":
            event(f"{aid}-deadline", f"Apply by: {co} – {role}", d, desc="Application deadline", url=url)
        d = _date(a.get("nextDate"))
        if d and is_open and a.get("nextText"):
            event(f"{aid}-next", f"{co}: {a['nextText']}", d, desc=role, url=url)
        for i, r in enumerate(a.get("rounds") or []):
            d = _date(r.get("date"))
            if d:
                who = f" with {r['with']}" if r.get("with") else ""
                event(f"{aid}-round-{r.get('id') or i}", f"Interview: {co} – {r.get('kind') or 'Interview'}", d, r.get("time"),
                      desc=f"{role}{who}\n{r.get('notes') or ''}".strip(), url=url)
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(l) for l in lines) + "\r\n"


# ---------------------------------------------------------------- profile
class Corrupt(Exception):
    """A data file exists but cannot be read. It is kept (and copied aside) and never overwritten."""


def quarantine(path):
    """Copy an unreadable data file to backups/corrupt/ once, so a restore can never lose it."""
    d = os.path.join(BACKUPS, "corrupt")
    os.makedirs(d, exist_ok=True)
    dst = os.path.join(d, f"{os.path.basename(path)}.{dt.datetime.now():%Y-%m-%d-%H%M%S}")
    if not any(n.startswith(os.path.basename(path) + ".") and os.path.getsize(os.path.join(d, n)) == os.path.getsize(path) for n in os.listdir(d)):
        shutil.copy2(path, dst)
    return dst


def read_checked(path):
    """None when the file does not exist; Corrupt when it exists but is not valid JSON."""
    try:
        return _read(path)
    except (OSError, ValueError) as e:
        if os.path.exists(path):
            quarantine(path)
            raise Corrupt(f"{os.path.basename(path)} could not be read ({e}). It was left untouched and copied to data/backups/corrupt/. Restore a backup in Settings → Data, or fix the file.")
        return None


def load_profile():
    try:
        return _read(PROFILE)
    except (OSError, ValueError):
        return None


def save_profile(data, base):
    """Revision-checked save; keeps a copy of the previous version in backups/profile/ (at most one per 30 minutes)."""
    with PROFILE_LOCK:
        try:
            cur = read_checked(PROFILE) or {}
        except Corrupt as e:
            raise ai.AIError(str(e), 503)
        rev = int(cur.get("rev", 0) or 0)
        try:
            base = None if base is None else int(base)
        except (TypeError, ValueError):
            raise ai.AIError("Invalid baseRev.")
        if base is not None and base != rev:
            return False, cur
        if cur:
            d = os.path.join(BACKUPS, "profile")
            os.makedirs(d, exist_ok=True)
            names = sorted(n for n in os.listdir(d) if n.endswith(".json"))
            stamp = dt.datetime.now()
            last = names[-1] if names else ""
            if not last or stamp - dt.datetime.strptime(last[8:-5], "%Y-%m-%d-%H%M%S") >= BACKUP_EVERY:
                shutil.copy2(PROFILE, os.path.join(d, f"profile-{stamp:%Y-%m-%d-%H%M%S}.json"))
                for old in names[:-59]:  # keep 60
                    os.remove(os.path.join(d, old))
        data["rev"] = rev + 1
        data["updatedAt"] = dt.datetime.now().isoformat(timespec="seconds")
        _write(PROFILE, data)
        return True, data


def job_meta(body):
    m = {k: str(body.get(k) or "")[:500] for k in ("key", "company", "role", "url", "location")}
    if not m["key"]:
        raise ai.AIError("Missing job key.")
    return m


# ---------------------------------------------------------------- HTTP
class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "InternshipTracker"
    sys_version = ""

    def _send(self, code, body, ctype, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self._cors()
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _file(self, path, ctype, cache=False):
        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError:
            return self._json(404, {"error": "Not found."})
        self._send(200, body, ctype, {"Cache-Control": "max-age=31536000, immutable"} if cache else None)

    def _path(self):
        return self.path.split("?", 1)[0].split("#", 1)[0]

    def _host_ok(self):
        """Answer only requests addressed to this machine by name. Blocks DNS rebinding: a website whose domain
        re-resolves to 127.0.0.1 would otherwise be "same origin" and could read your profile or spend API credit."""
        port = self.server.server_address[1]
        return (self.headers.get("Host") or "").lower() in {f"{h}:{port}" for h in LOCAL_HOSTS}

    def _blocked(self):
        if self._host_ok():
            return False
        body = b'{"error": "Unknown host. Open the tracker at http://127.0.0.1 or http://localhost."}'
        self.send_response(421)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        return True

    def _length(self):
        try:
            return int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return -1

    def _same_origin(self):
        return self.headers.get("Origin") in (None, f"http://{self.headers.get('Host')}")

    # ---- Chrome extension ("clips"): the tracker page or an installed extension may call these; other websites may not.
    def _ext_origin(self):
        o = self.headers.get("Origin")
        return o is None or o == f"http://{self.headers.get('Host')}" or bool(re.match(r"^chrome-extension://[a-p]{32}$", o or ""))

    def _cors(self):
        o = self.headers.get("Origin") or ""
        if o.startswith("chrome-extension://"):
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")

    def do_OPTIONS(self):
        if self._blocked():
            return
        if self._path().startswith("/api/clip") and self._ext_origin():
            self.send_response(204); self._cors()
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-IAT-Client")
            self.send_header("Content-Length", "0"); self.end_headers()
            return
        self.send_response(403); self.send_header("Content-Length", "0"); self.end_headers()

    def _clip(self, method, path):
        """Returns True when handled."""
        ext = {("GET", "/api/clip/ping"), ("POST", "/api/clip/check"), ("POST", "/api/clip")}
        page = {("GET", "/api/clips"), ("POST", "/api/clips/ack")}
        if (method, path) not in ext | page:
            return False
        if not (self._ext_origin() if (method, path) in ext else self._same_origin()):
            self._json(403, {"error": "Not allowed from this origin."})
            return True
        try:
            if path == "/api/clip/ping":
                st = ai.status()
                return self._json(200, {"ok": True, "app": "Internship Tracker", "claude": bool(st.get("configured")), "tracks": ["SWE", "DE", "DA", "DS", "BIE"]}) or True
            if path == "/api/clips":
                return self._json(200, {"pending": clips.pending()}) or True
            b = self._body(200 * 1024)
            if path == "/api/clips/ack":
                # "added": clips the page turned into applications; removed only once tracker.json has them.
                # "skipped": duplicates the page chose not to add.
                try:
                    saved = {a.get("id") for a in (read_checked(STATE) or {}).get("apps") or []}
                except Corrupt as e:
                    return self._json(503, {"error": str(e)}) or True
                n = clips.ack(b.get("added") or [], saved) + clips.ack(b.get("skipped") or [])
                n += clips.ack(b.get("ids") or [], saved)  # older pages
                return self._json(200, {"removed": n}) or True
            state = load_state() or {}
            if path == "/api/clip/check":
                url = clips.canonical_url(b.get("url") or "")
                tr = fetcher.infer_track(str(b.get("role") or ""))
                return self._json(200, {"match": clips.find(state, url, str(b.get("company") or ""), str(b.get("role") or "")), "url": url,
                                        "track": tr if tr in ("SWE", "DE", "DA", "DS", "BIE") else ""}) or True
            try:
                c, dup = clips.add(b, state)
            except ValueError as e:
                return self._json(400, {"error": str(e)}) or True
            if dup:
                return self._json(409, {"error": "Already in your tracker.", "match": dup}) or True
            desc = str(b.get("description") or "")
            if c["hasText"]:
                meta = {"key": c["key"], "company": c["company"], "role": c["role"], "url": c["url"]}
                try:
                    rec = ai.ensure_text(meta, pasted=desc)
                    rec["textSource"] = "extension"; ai.save_job(c["key"], rec)
                except Exception as e:  # the clip still counts; analysis can fetch or take pasted text later
                    print("clip text not stored:", e)
                if b.get("analyze") and ai.status().get("configured"):
                    threading.Thread(target=self._analyze_clip, args=(meta,), daemon=True).start()
            host = self.headers.get("Host") or "127.0.0.1:8765"
            return self._json(200, {"ok": True, "clip": {k: c[k] for k in ("id", "company", "role", "track", "status", "sponsor", "url")}, "open": f"http://{host}/#job/{c['id']}"}) or True
        except ai.AIError as e:
            return self._json(e.code, {"error": str(e)}) or True

    @staticmethod
    def _analyze_clip(meta):
        try:
            ai.analyze(meta)
        except Exception as e:
            print("clip analysis failed:", e)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if self._blocked():
            return
        path = self._path()
        if self._clip("GET", path):
            return
        try:
            if path == "/api/state":
                try:
                    return self._json(200, read_checked(STATE))
                except Corrupt as e:
                    return self._json(503, {"error": str(e), "corrupt": True})
            if path == "/api/listings":
                return self._json(200, load_listings())
            if path == "/api/profile":
                try:
                    return self._json(200, read_checked(PROFILE))
                except Corrupt as e:
                    return self._json(503, {"error": str(e), "corrupt": True})
            if path == "/api/ai/status":
                return self._json(200, ai.status())
            if path == "/api/studio/index":
                return self._json(200, ai.studio_index())
            if path == "/api/studio/docs":
                return self._json(200, ai.studio_docs())
            if path == "/api/search":
                q = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
                scope = (q.get("scope") or ["hidden"])[0]
                if scope != "hidden":
                    return self._json(400, {"error": "Only scope=hidden is searched on the server; the page searches everything else itself."})
                text = (q.get("q") or [""])[0][:200]
                try:
                    limit = max(1, min(100, int((q.get("limit") or ["30"])[0])))
                except ValueError:
                    return self._json(400, {"error": "limit must be a number from 1 to 100."})
                settings = ((load_state() or {}).get("settings") or {})
                feed_path = os.path.join(fetcher.CACHE, "simplify.json")
                if not os.path.exists(feed_path):
                    return self._json(200, {"groups": [{"group": "Hidden listings", "items": []}], "note": "No feed downloaded yet."})
                rows = search.HIDDEN.rows(feed_path, LISTINGS, settings,
                                          lambda: (_read(feed_path), (load_listings() or {}).get("listings") or []))
                return self._json(200, {"groups": [{"group": "Hidden listings", "items": search.HiddenIndex.search(rows, text, limit), "total": len(rows)}]})
            if path == "/api/job":
                q = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
                key = (q.get("key") or [""])[0]
                if not key:
                    return self._json(400, {"error": "Missing key."})
                return self._json(200, {"job": ai.load_job(key), "resume": ai.load_resume(key), "letter": ai.load_resume(key, "letter")})
            if path == "/api/backups":
                out = []
                for name in list_backups():
                    t = _backup_time(name)
                    label = t.strftime("%b %d, %Y %H:%M:%S") if len(name) > len("tracker-YYYY-MM-DD.json") else t.strftime("%b %d, %Y")
                    out.append({"name": name, "label": label, "size": os.path.getsize(os.path.join(BACKUPS, name))})
                return self._json(200, out)
            if path.startswith("/api/backups/"):
                name = path.rsplit("/", 1)[1]
                if not BACKUP_NAME.match(name) or not os.path.exists(os.path.join(BACKUPS, name)):
                    return self._json(404, {"error": "No such backup."})
                return self._json(200, _read(os.path.join(BACKUPS, name)))
            if path == "/calendar.ics":
                body = calendar(load_state() or {}).encode("utf-8")
                extra = {"Content-Disposition": 'attachment; filename="internship-tracker.ics"'} if "download=1" in self.path else None
                return self._send(200, body, "text/calendar; charset=utf-8", extra)
        except (OSError, ValueError) as e:
            return self._json(500, {"error": f"Could not read data: {e}"})
        if path in ("/", "", "/" + PAGE):
            return self._file(os.path.join(ROOT, PAGE), "text/html; charset=utf-8")
        if path in STATIC:
            name, ctype = STATIC[path]
            return self._file(os.path.join(ROOT, name), ctype)
        m = FONT.match(path)
        if m:
            return self._file(os.path.join(ROOT, "fonts", m.group(1)), "font/woff2", cache=True)
        return self._json(404, {"error": "Not found."})  # never data/, scripts or anything else

    def _body(self, limit=MAX_BODY):
        length = self._length()
        if length <= 0 or length > limit:
            raise ai.AIError("Body is empty or too large.", 413)
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError as e:
            raise ai.AIError(f"Invalid JSON: {e}")
        if not isinstance(data, dict):
            raise ai.AIError("Expected a JSON object.")
        return data

    def _studio(self, method, path):
        """Profile, Claude API and resume endpoints. Returns True when handled."""
        routes = {("PUT", "/api/profile"), ("PUT", "/api/resume"), ("POST", "/api/ai/key"), ("POST", "/api/ai/config"), ("POST", "/api/ai/verify"),
                  ("POST", "/api/job/text"), ("POST", "/api/ai/analyze"), ("POST", "/api/ai/tailor"), ("POST", "/api/ai/rewrite"), ("POST", "/api/ai/cover"), ("PUT", "/api/letter"), ("POST", "/api/ai/claude-check"), ("POST", "/api/h1b"),
                  ("POST", "/api/resume/fit"), ("POST", "/api/export")}
        if (method, path) not in routes:
            return False
        if not self._same_origin():
            self._json(403, {"error": "Cross-origin requests are not allowed."})
            return True
        try:
            if path == "/api/h1b":  # raw file upload
                length = self._length()
                if length <= 0 or length > 80 * 1024 * 1024:
                    raise ai.AIError("The file is empty or larger than 80 MB.", 413)
                try:
                    meta = import_h1b(self.rfile.read(length), urllib.parse.unquote(self.headers.get("X-Filename") or ""))
                except ValueError as e:
                    raise ai.AIError(f"Could not read that file: {e}.")
                return self._json(200, {"ok": True, "h1b": meta, "status": ai.status()}) or True
            b = self._body()
            if path == "/api/ai/claude-check":
                ai.claude_code(refresh=True)
                return self._json(200, ai.status()) or True
            if path == "/api/profile":
                p = b.get("profile")
                if not isinstance(p, dict):
                    raise ai.AIError("Expected a profile object.")
                ok, out = save_profile(p, b.get("baseRev"))
                return self._json(200 if ok else 409, {"ok": ok, "rev": out.get("rev"), "updatedAt": out.get("updatedAt"), "profile": None if ok else out}) or True
            if path == "/api/ai/key":
                ai.set_key(b.get("key") or "")
                return self._json(200, ai.status()) or True
            if path == "/api/ai/config":
                ai.set_config(b)
                return self._json(200, ai.status()) or True
            if path == "/api/ai/verify":
                ids = ai.verify_key()
                return self._json(200, {"ok": True, "models": ids}) or True
            if path == "/api/job/text":
                rec = ai.ensure_text(job_meta(b), b.get("text"), bool(b.get("refetch")))
                return self._json(200, {"job": rec}) or True
            if path == "/api/ai/analyze":
                rec, row = ai.analyze(job_meta(b), b.get("text"), bool(b.get("refetch")))
                return self._json(200, {"job": rec, "usage": row, "status": ai.status()}) or True
            if path == "/api/ai/tailor":
                profile = load_profile()
                if not profile:
                    raise ai.AIError("Fill in your Profile first: it is the only source of facts for the resume.", 409)
                track = str(b.get("track") or "SWE")
                lead = ((profile.get("tracks") or {}).get(track) or {}).get("leadWith", "")
                result, row = ai.tailor(job_meta(b), profile, track, lead, str(b.get("instructions") or ""), profile.get("resumeRules") or [],
                                        str(profile.get("resumeActivities") or "auto"), str(b.get("baseline") or "")[:8000])
                return self._json(200, {"result": result, "usage": row, "status": ai.status()}) or True
            if path == "/api/ai/rewrite":
                result, row = ai.rewrite(job_meta(b), str(b.get("bullet") or ""), [str(x) for x in b.get("sources") or []][:8],
                                         [str(x) for x in b.get("keywords") or []], str(b.get("instruction") or ""), str(b.get("context") or ""),
                                         "paragraph" if b.get("kind") == "paragraph" else "bullet")
                return self._json(200, {"result": result, "usage": row, "status": ai.status()}) or True
            if path == "/api/ai/cover":
                profile = load_profile()
                if not profile:
                    raise ai.AIError("Fill in your Profile first: it is the only source of facts for the letter.", 409)
                g = lambda k: str(b.get(k) or "")
                result, row = ai.cover(job_meta(b), profile, g("track") or "SWE", g("resumeText"), g("recipient"), g("why"), g("emphasis"), g("availability"), g("instructions"))
                return self._json(200, {"result": result, "usage": row, "status": ai.status()}) or True
            if path in ("/api/resume", "/api/letter"):
                if not isinstance(b.get("resume"), dict):
                    raise ai.AIError("Expected a document object.")
                kind = "letter" if path == "/api/letter" else "resume"
                try:
                    doc = ai.save_resume(job_meta(b), b["resume"], str(b.get("label") or ""), str(b.get("by") or "you"), b.get("notes"), kind=kind,
                                         base=b.get("baseUpdatedAt"), keep_current=bool(b.get("keepCurrent")),
                                         reviewed=b.get("reviewed") if isinstance(b.get("reviewed"), bool) else None)
                except ai.DocConflict as e:
                    return self._json(409, {"error": str(e), "resume": e.doc}) or True
                return self._json(200, {"ok": True, "resume": doc}) or True
            if path == "/api/resume/fit":
                return self._json(200, resume_export.render(b.get("resume") or {})) or True
            if path == "/api/export":
                model, fmt = b.get("resume") or {}, b.get("format")
                if fmt not in ("docx", "pdf"):
                    raise ai.AIError("Format must be docx or pdf.")
                if fmt == "pdf":
                    bad = resume_export.unsupported_chars(model)
                    if bad:
                        raise ai.AIError("The PDF export uses the standard Times/Helvetica fonts, which cannot show "
                                         + " ".join(bad[:12]) + (" …" if len(bad) > 12 else "")
                                         + ". Export .docx (it keeps every character), or write those words in Latin letters.", 422)
                data = resume_export.to_docx(model) if fmt == "docx" else resume_export.to_pdf(model)
                name = resume_export.safe_name(b.get("filename") or "Resume")
                kind = "letter" if b.get("kind") == "letter" else "resume"
                key = str(b.get("key") or "")
                # The download keeps your chosen name; the copy kept in data/exports is unique per job, kind and content,
                # so two jobs at one company (or two versions) never overwrite each other.
                tag = "-".join(x for x in (ai.job_hash(key)[:6] if key else "", kind, hashlib.sha1(data).hexdigest()[:6]) if x)
                rel = f"{name}__{tag}.{fmt}"
                out = os.path.join(DATA_DIR, "exports", rel)
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with open(out, "wb") as f:
                    f.write(data)
                if key:
                    ai.record_export(key, kind, fmt, rel)
                ctype = "application/pdf" if fmt == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                self._send(200, data, ctype, {"Content-Disposition": f'attachment; filename="{name}.{fmt}"; filename*=UTF-8\'\'{urllib.parse.quote(name + "." + fmt)}',
                                              "X-Saved-To": "data/exports/" + urllib.parse.quote(rel)})
                return True
        except ai.AIError as e:
            self._json(e.code, {"error": str(e)})
        except Exception as e:  # never leave the page hanging
            print(traceback.format_exc(), flush=True)
            self._json(500, {"error": f"Server error: {e}"})
        return True

    def do_POST(self):
        if self._blocked():
            return
        if self._clip("POST", self._path()) or self._studio("POST", self._path()):
            return
        if self._path() != "/api/fetch":
            return self._json(404, {"error": "Not found."})
        if not self._same_origin():
            return self._json(403, {"error": "Cross-origin requests are not allowed."})
        if "wait=1" in self.path:
            return self._json(200, run_fetch())
        if FETCH_LOCK.locked():
            return self._json(202, {"started": False, "busy": True})
        threading.Thread(target=run_fetch, daemon=True).start()
        return self._json(202, {"started": True})

    def do_PUT(self):
        if self._blocked():
            return
        if self._studio("PUT", self._path()):
            return
        if self._path() != "/api/state":
            return self._json(404, {"error": "Not found."})
        if not self._same_origin():
            return self._json(403, {"error": "Cross-origin writes are not allowed."})
        length = self._length()
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"error": "Body is empty or too large."})
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("apps"), list):
                raise ValueError("expected an object with an 'apps' list")
        except ValueError as e:
            return self._json(400, {"error": f"Invalid data: {e}"})
        base = data.pop("baseRev", None)
        try:
            base = None if base is None else int(base)
        except (TypeError, ValueError):
            return self._json(400, {"error": "Invalid baseRev."})
        data.pop("listings", None)  # listings live in listings.json
        data.pop("fetch", None)
        with LOCK:
            try:
                current = read_checked(STATE) or {}
            except Corrupt as e:
                return self._json(503, {"error": str(e)})
            rev = int(current.get("rev", 0) or 0)
            if base is not None and int(base) != rev:
                return self._json(409, {"error": "Changed in another tab.", "rev": rev, "state": current})
            backup(force=self.headers.get("X-Backup") == "1")
            data["rev"] = rev + 1
            data["savedAt"] = dt.datetime.now().isoformat(timespec="seconds")
            write_state(data)
        return self._json(200, {"ok": True, "rev": data["rev"], "savedAt": data["savedAt"]})

    def log_message(self, fmt, *args):  # keep the terminal quiet
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


CODE = ("server.py", "ai.py", "clips.py", "fetcher.py", "resume_export.py", "fontmetrics.py")


def code_watcher():
    """Under launchd (KeepAlive), exit when the server's own code changes so launchd restarts it with the new code."""
    stamp = lambda: tuple(os.path.getmtime(os.path.join(ROOT, f)) for f in CODE if os.path.exists(os.path.join(ROOT, f)))
    first = stamp()
    while True:
        time.sleep(5)
        try:
            if stamp() != first:
                time.sleep(2)  # let a multi-file update finish
                print("Code changed; exiting so launchd restarts the server with it.", flush=True)
                os._exit(0)
        except OSError:
            pass


def main():
    ap = argparse.ArgumentParser(description="Internship Application Tracker (local)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--data", help="data folder (default: ./data)")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--no-fetch", action="store_true", help="do not refresh listings in the background")
    args = ap.parse_args()
    if args.data:
        configure(args.data)
    if not os.path.exists(os.path.join(ROOT, PAGE)):
        sys.exit(f"{PAGE} must be in the same folder as server.py")
    migrate_files()
    backup(force=False)
    url = f"http://127.0.0.1:{args.port}/"
    with Server(("127.0.0.1", args.port), Handler) as httpd:
        print(f"Internship Tracker running at {url}  (Ctrl+C to stop)", flush=True)
        print(f"Data folder: {DATA_DIR}", flush=True)
        if not args.no_browser:
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        if not args.no_fetch:
            threading.Thread(target=scheduler, daemon=True).start()
        if os.getppid() == 1 or os.environ.get("IAT_RELOAD") == "1":  # started by launchd
            threading.Thread(target=code_watcher, daemon=True).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()

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

Also serves /calendar.ics (deadlines, next steps and interviews) for a calendar
subscription. Listens on 127.0.0.1 only and refuses cross-origin writes.
Uses only the Python standard library (Python 3.8+).
"""
import argparse
import datetime as dt
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
import webbrowser

import fetcher

ROOT = os.path.dirname(os.path.abspath(__file__))
PAGE = "internship-tracker.html"
STATIC = {"/core.js": ("core.js", "text/javascript; charset=utf-8"), "/app.js": ("app.js", "text/javascript; charset=utf-8")}
FONT = re.compile(r"^/fonts/([a-z0-9-]+\.woff2)$")
BACKUP_EVERY = dt.timedelta(minutes=30)
KEEP_ALL_DAYS = 3
KEEP_MAX_DAYS = 60
MAX_BODY = 20 * 1024 * 1024  # 20 MB
BACKUP_NAME = re.compile(r"^tracker-\d{4}-\d{2}-\d{2}(-\d{6})?\.json$")
LOCK = threading.Lock()           # tracker.json
LISTINGS_LOCK = threading.Lock()  # listings.json
FETCH_LOCK = threading.Lock()     # one refresh at a time

DATA_DIR = STATE = LISTINGS = BACKUPS = ""


def configure(data_dir):
    """Point the server (and the fetcher's cache) at a data folder."""
    global DATA_DIR, STATE, LISTINGS, BACKUPS
    DATA_DIR = os.path.abspath(data_dir)
    STATE = os.path.join(DATA_DIR, "tracker.json")
    LISTINGS = os.path.join(DATA_DIR, "listings.json")
    BACKUPS = os.path.join(DATA_DIR, "backups")
    fetcher.CACHE = os.path.join(DATA_DIR, "cache")


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
            result = fetcher.refresh(user, before, log=lambda m: print(m, flush=True))
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
        except Exception:
            print(traceback.format_exc(), flush=True)
        time.sleep(300)


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

    def _same_origin(self):
        return self.headers.get("Origin") in (None, f"http://{self.headers.get('Host')}")

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self._path()
        try:
            if path == "/api/state":
                return self._json(200, load_state())
            if path == "/api/listings":
                return self._json(200, load_listings())
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

    def do_POST(self):
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
        if self._path() != "/api/state":
            return self._json(404, {"error": "Not found."})
        if not self._same_origin():
            return self._json(403, {"error": "Cross-origin writes are not allowed."})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"error": "Body is empty or too large."})
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("apps"), list):
                raise ValueError("expected an object with an 'apps' list")
        except ValueError as e:
            return self._json(400, {"error": f"Invalid data: {e}"})
        base = data.pop("baseRev", None)
        data.pop("listings", None)  # listings live in listings.json
        data.pop("fetch", None)
        with LOCK:
            try:
                current = load_state() or {}
            except (OSError, ValueError):
                current = {}
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
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()

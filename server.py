#!/usr/bin/env python3
"""Local server for the Internship Application Tracker.

Run:  python3 server.py            (opens http://127.0.0.1:8765)
      python3 server.py --port 9000 --no-browser

- Serves internship-tracker.html from this folder.
- Saves your data to data/tracker.json, written atomically so a crash never
  leaves a half-written file.
- Every save carries the revision it was based on. If another tab saved in the
  meantime, the write is refused (HTTP 409) instead of silently overwriting it.
- Backups in data/backups/: at most one every 30 minutes while you work, plus
  one before every delete, import, restore or clear. All backups from the last
  3 days are kept; older ones are thinned to one per day and removed after 60
  days.
- Listens on 127.0.0.1 only and refuses cross-origin writes.
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
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
PAGE = "internship-tracker.html"
DATA_DIR = os.path.join(ROOT, "data")
STATE = os.path.join(DATA_DIR, "tracker.json")
BACKUPS = os.path.join(DATA_DIR, "backups")
BACKUP_EVERY = dt.timedelta(minutes=30)
KEEP_ALL_DAYS = 3
KEEP_MAX_DAYS = 60
MAX_BODY = 20 * 1024 * 1024  # 20 MB
BACKUP_NAME = re.compile(r"^tracker-\d{4}-\d{2}-\d{2}(-\d{6})?\.json$")
LOCK = threading.Lock()


def load_state():
    if not os.path.exists(STATE):
        return None
    with open(STATE, encoding="utf-8") as f:
        return json.load(f)


def _backup_time(name):
    stem = name[len("tracker-"):-len(".json")]
    fmt = "%Y-%m-%d-%H%M%S" if len(stem) > 10 else "%Y-%m-%d"
    return dt.datetime.strptime(stem, fmt)


def list_backups():
    if not os.path.isdir(BACKUPS):
        return []
    names = [n for n in os.listdir(BACKUPS) if BACKUP_NAME.match(n)]
    return sorted(names, key=_backup_time, reverse=True)


def prune_backups():
    now = dt.datetime.now()
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
    prune_backups()


def write_state(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=DATA_DIR, prefix=".tracker-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, STATE)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _path(self):
        return self.path.split("?", 1)[0].split("#", 1)[0]

    def do_GET(self):
        path = self._path()
        try:
            if path == "/api/state":
                return self._json(200, load_state())
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
                with open(os.path.join(BACKUPS, name), encoding="utf-8") as f:
                    return self._json(200, json.load(f))
        except (OSError, ValueError) as e:
            return self._json(500, {"error": f"Could not read data: {e}"})
        if path in ("/", ""):
            self.path = "/" + PAGE
        elif path != "/" + PAGE:
            return self.send_error(404)  # serve the page only, never data/ or this script
        return super().do_GET()

    def do_PUT(self):
        if self._path() != "/api/state":
            return self.send_error(404)
        if self.headers.get("Origin") not in (None, f"http://{self.headers.get('Host')}"):
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
        with LOCK:
            try:
                current = load_state() or {}
            except (OSError, ValueError):
                current = {}
            rev = int(current.get("rev", 0) or 0)
            if base is not None and int(base) != rev:
                return self._json(409, {"error": "Changed in another tab.", "rev": rev})
            backup(force=self.headers.get("X-Backup") == "1")
            data["rev"] = rev + 1
            data["savedAt"] = dt.datetime.now().isoformat(timespec="seconds")
            write_state(data)
        return self._json(200, {"ok": True, "rev": data["rev"], "savedAt": data["savedAt"]})

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the terminal quiet
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ap = argparse.ArgumentParser(description="Internship Application Tracker (local)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    if not os.path.exists(os.path.join(ROOT, PAGE)):
        sys.exit(f"{PAGE} must be in the same folder as server.py")
    backup(force=False)
    url = f"http://127.0.0.1:{args.port}/"
    with Server(("127.0.0.1", args.port), Handler) as httpd:
        print(f"Internship Tracker running at {url}  (Ctrl+C to stop)", flush=True)
        print(f"Data file: {STATE}", flush=True)
        if not args.no_browser:
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()

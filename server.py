#!/usr/bin/env python3
"""Local server for the Internship Application Tracker.

Run:  python3 server.py            (opens http://127.0.0.1:8765)
      python3 server.py --port 9000 --no-browser

- Serves internship-tracker.html from this folder.
- Saves your data to data/tracker.json (written atomically, so a crash never
  leaves a half-written file).
- Keeps one backup per day in data/backups/ and deletes backups older than the
  newest 30.
- Listens on 127.0.0.1 only, so nothing outside your computer can reach it.
Uses only the Python standard library (Python 3.8+).
"""
import argparse
import datetime as dt
import http.server
import json
import os
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
KEEP_BACKUPS = 30
MAX_BODY = 20 * 1024 * 1024  # 20 MB
LOCK = threading.Lock()


def load_state():
    if not os.path.exists(STATE):
        return None
    with open(STATE, encoding="utf-8") as f:
        return json.load(f)


def daily_backup():
    """Copy the current state to backups/tracker-YYYY-MM-DD.json once per day."""
    if not os.path.exists(STATE):
        return
    os.makedirs(BACKUPS, exist_ok=True)
    target = os.path.join(BACKUPS, f"tracker-{dt.date.today().isoformat()}.json")
    if not os.path.exists(target):
        shutil.copy2(STATE, target)
    files = sorted(f for f in os.listdir(BACKUPS) if f.startswith("tracker-") and f.endswith(".json"))
    for old in files[:-KEEP_BACKUPS]:
        os.remove(os.path.join(BACKUPS, old))


def save_state(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    with LOCK:
        daily_backup()
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
        if path == "/api/state":
            try:
                return self._json(200, load_state())
            except (OSError, ValueError) as e:
                return self._json(500, {"error": f"Could not read data/tracker.json: {e}"})
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
        save_state(data)
        return self._json(200, {"ok": True, "savedAt": dt.datetime.now().isoformat(timespec="seconds")})

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
    daily_backup()
    url = f"http://127.0.0.1:{args.port}/"
    with Server(("127.0.0.1", args.port), Handler) as httpd:
        print(f"Internship Tracker running at {url}  (Ctrl+C to stop)")
        print(f"Data file: {STATE}")
        if not args.no_browser:
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()

"""Tests for server.py: files, revision checks, migration, backups, security and the calendar feed."""
import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        server.configure(self.tmp)
        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        shutil.rmtree(self.tmp)

    def req(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.base + path, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(r) as res:
                raw = res.read()
                return res.status, res.headers, raw
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def jreq(self, *a, **k):
        code, _, raw = self.req(*a, **k)
        return code, json.loads(raw) if raw else None

    def test_save_and_conflict(self):
        self.assertEqual(self.jreq("GET", "/api/state"), (200, None))
        code, res = self.jreq("PUT", "/api/state", {"apps": [], "baseRev": 0})
        self.assertEqual((code, res["rev"]), (200, 1))
        code, res = self.jreq("PUT", "/api/state", {"apps": [{"id": "a"}], "baseRev": 1})
        self.assertEqual(res["rev"], 2)
        code, res = self.jreq("PUT", "/api/state", {"apps": [], "baseRev": 1})  # stale
        self.assertEqual(code, 409)
        self.assertEqual(res["state"]["apps"], [{"id": "a"}])  # the latest version comes back for merging
        code, res = self.jreq("PUT", "/api/state", {"apps": [], "listings": [1], "fetch": {}})
        self.assertNotIn("listings", server.load_state())  # listings never go into tracker.json

    def test_rejects_bad_bodies_and_cross_origin(self):
        self.assertEqual(self.jreq("PUT", "/api/state", {"nope": 1})[0], 400)
        self.assertEqual(self.jreq("PUT", "/api/state", {"apps": []}, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.jreq("POST", "/api/fetch", {}, {"Origin": "https://evil.example"})[0], 403)

    def test_only_the_app_files_are_served(self):
        for path in ("/", "/app.js", "/core.js", "/fonts/instrument-sans-400.woff2"):
            self.assertEqual(self.req("GET", path)[0], 200, path)
        for path in ("/server.py", "/data/tracker.json", "/../server.py", "/fonts/../server.py", "/tests/test_server.py", "/.git/config"):
            self.assertEqual(self.req("GET", path)[0], 404, path)
        _, headers, _ = self.req("GET", "/")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")

    def test_migration_moves_listings_out(self):
        old = {"rev": 7, "apps": [{"id": "a1", "company": "A", "status": "saved", "liveAt": "2026-10-27"}],
               "listings": [{"id": "sx-1", "source": "simplify", "company": "X", "role": "Data Analyst Intern", "flags": ["No sponsorship"], "skills": {"matched": ["SQL"], "missing": []}, "location": "Austin, TX"},
                            {"id": "m1", "company": "Manual", "role": "SWE Intern", "sample": True}],
               "fetch": {"at": "2026-10-28T10:00:00-05:00", "matched": 1}}
        with open(server.STATE, "w") as f:
            json.dump(old, f)
        server.migrate_files()
        st, li = server.load_state(), server.load_listings()
        self.assertNotIn("listings", st)
        self.assertNotIn("fetch", st)
        self.assertEqual([l["id"] for l in st["manualListings"]], ["m1"])
        self.assertTrue(st["settings"]["onboarded"])
        self.assertEqual(st["rev"], 8)
        self.assertEqual(li["listings"][0]["skillsFound"], ["SQL"])
        self.assertTrue(li["listings"][0]["noSponsor"])
        self.assertEqual(li["liveChecked"], {"a1": "2026-10-27"})
        self.assertEqual(li["fetch"]["matched"], 1)
        self.assertEqual(len(server.list_backups()), 1)  # backed up before migrating
        server.migrate_files()  # second run is a no-op
        self.assertEqual(server.load_state()["rev"], 8)

    def test_backup_pruning(self):
        os.makedirs(server.BACKUPS)
        now = dt.datetime(2026, 10, 28, 12, 0, 0)
        stamps = [now - dt.timedelta(hours=h) for h in (1, 30, 60, 100, 101, 24 * 20, 24 * 20 + 1, 24 * 70)]
        for t in stamps:
            with open(os.path.join(server.BACKUPS, f"tracker-{t:%Y-%m-%d-%H%M%S}.json"), "w") as f:
                f.write("{}")
        server.prune_backups(now)
        kept = server.list_backups()
        self.assertEqual(len(kept), 5)  # 3 within 3 days, one per older day, nothing past 60 days
        self.assertFalse(any("2026-08" in k for k in kept))

    def test_calendar(self):
        state = {"apps": [
            {"id": "a1", "company": "Acme, Inc.", "role": "Data Analyst Intern", "status": "saved", "deadline": "2026-11-05", "url": "https://acme.example/job"},
            {"id": "a2", "company": "Beta", "role": "SWE Intern", "status": "interview", "nextText": "Thank-you note", "nextDate": "2026-11-01",
             "rounds": [{"id": "r1", "date": "2026-11-03", "time": "14:30", "kind": "Technical", "with": "Team lead", "notes": "Line one\nLine two"}]},
            {"id": "a3", "company": "Gamma", "role": "DS Intern", "status": "rejected", "deadline": "2026-11-09", "nextText": "x", "nextDate": "2026-11-09"},
            {"id": "a4", "company": "Example", "role": "Sample", "status": "saved", "deadline": "2026-11-09", "sample": True},
        ]}
        ics = server.calendar(state, now=dt.datetime(2026, 10, 28, tzinfo=dt.timezone.utc))
        self.assertTrue(ics.startswith("BEGIN:VCALENDAR\r\n"))
        self.assertIn("SUMMARY:Apply by: Acme\\, Inc. – Data Analyst Intern", ics)
        self.assertIn("DTSTART;VALUE=DATE:20261105", ics)
        self.assertIn("DTSTART:20261103T143000", ics)
        self.assertIn("Line one\\nLine two", ics)
        self.assertIn("SUMMARY:Beta: Thank-you note", ics)
        self.assertNotIn("Gamma", ics)  # closed applications have no reminders
        self.assertNotIn("Example", ics)  # example data stays out
        self.assertTrue(all(len(line.encode()) <= 75 for line in ics.split("\r\n")))
        self.assertEqual(ics.count("BEGIN:VEVENT"), 3)

    def test_calendar_endpoint(self):
        code, headers, body = self.req("GET", "/calendar.ics?download=1")
        self.assertEqual(code, 200)
        self.assertIn("text/calendar", headers["Content-Type"])
        self.assertIn("attachment", headers["Content-Disposition"])
        self.assertIn(b"END:VCALENDAR", body)


if __name__ == "__main__":
    unittest.main()

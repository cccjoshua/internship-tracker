"""Phase 5 backend tests: durable writes, state validation, corrupt listings, refresh retries, the refresh lock,
the refresh status endpoint and the scheduler's due/wake decision."""
import datetime as dt
import json
import os
import shutil
import stat
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import fetcher  # noqa: E402
import safeio  # noqa: E402
import server  # noqa: E402


class SafeIO(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_writes_atomically_with_fsync(self):
        calls, real = [], os.fsync
        os.fsync = lambda fd: (calls.append(fd), real(fd))[1]
        try:
            p = os.path.join(self.tmp, "sub", "a.json")
            safeio.write_json(p, {"x": "é"}, indent=2)
        finally:
            os.fsync = real
        with open(p, encoding="utf-8") as f:
            self.assertEqual(json.load(f), {"x": "é"})
        self.assertGreaterEqual(len(calls), 1)  # the file (and, where possible, the folder)
        self.assertEqual([n for n in os.listdir(os.path.dirname(p)) if n.startswith(".tmp-")], [])

    def test_failed_write_keeps_the_old_file_and_leaves_no_temp_file(self):
        p = os.path.join(self.tmp, "a.json")
        safeio.write_json(p, {"v": 1})
        real = os.replace
        os.replace = lambda a, b: (_ for _ in ()).throw(OSError("disk full"))
        try:
            with self.assertRaises(OSError):
                safeio.write_json(p, {"v": 2})
        finally:
            os.replace = real
        with open(p) as f:
            self.assertEqual(json.load(f), {"v": 1})
        self.assertEqual([n for n in os.listdir(self.tmp) if n.startswith(".tmp-")], [])

    def test_private_files_are_owner_only(self):
        p = os.path.join(self.tmp, "secrets.json")
        safeio.write_json(p, {"k": "v"}, private=True)
        self.assertEqual(stat.S_IMODE(os.stat(p).st_mode), 0o600)


class Validation(unittest.TestCase):
    def test_good_state_passes_and_unknown_fields_are_fine(self):
        ok = {"apps": [{"id": "a", "status": "applied", "company": "Acme", "history": [], "myOwnField": {"x": 1}}],
              "settings": {}, "dismissed": [], "somethingNew": True}
        self.assertEqual(server.validate_state(ok), [])

    def test_each_problem_names_its_field(self):
        bad = {"apps": [{"id": "", "status": "done", "notes": 3, "history": "x"}, "nope"], "settings": [], "dismissed": {}}
        p = server.validate_state(bad)
        self.assertIn("apps[0].id: must be a non-empty string", p)
        self.assertIn('apps[0].status: "done" is not a known stage', p)
        self.assertIn("apps[0].notes: must be text", p)
        self.assertIn("apps[0].history: must be a list", p)
        self.assertIn("apps[1]: must be an object", p)
        self.assertIn("settings: must be an object", p)
        self.assertIn("dismissed: must be a list", p)
        self.assertEqual(server.validate_state([]), ["the data must be an object"])
        self.assertEqual(server.validate_state({}), ["apps: must be a list"])


class Scheduler(unittest.TestCase):
    NOW = dt.datetime(2026, 11, 1, 18, 0, tzinfo=dt.timezone(dt.timedelta(hours=-6)))

    def iso(self, **kw):
        return (self.NOW - dt.timedelta(**kw)).isoformat()

    def test_due_after_the_interval(self):
        self.assertTrue(server.refresh_due(self.NOW, None, 2))
        self.assertFalse(server.refresh_due(self.NOW, self.iso(minutes=90), 2))
        self.assertTrue(server.refresh_due(self.NOW, self.iso(hours=2), 2))
        self.assertTrue(server.refresh_due(self.NOW, self.iso(hours=9), 2))  # woke up after a long sleep
        self.assertFalse(server.refresh_due(self.NOW, self.iso(minutes=10), 0.1))  # never more often than every 30 min
        self.assertTrue(server.refresh_due(self.NOW, self.iso(minutes=31), 0.1))
        self.assertTrue(server.refresh_due(self.NOW, "not a date", 2))
        self.assertTrue(server.refresh_due(self.NOW, (self.NOW + dt.timedelta(hours=3)).isoformat(), 2))  # clock moved back
        self.assertFalse(server.refresh_due(self.NOW, self.iso(minutes=30), "garbage"))  # bad setting: 2 hours


class FeedRetries(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._cache, self._get, self._sleep, self._feeds = fetcher.CACHE, fetcher.http_get, fetcher._sleep, fetcher.FEEDS
        fetcher.CACHE = self.tmp
        fetcher.FEEDS = ["https://feed.example/a.json", "https://feed.example/b.json"]
        self.waits, self.calls = [], []
        fetcher._sleep = self.waits.append

    def tearDown(self):
        fetcher.CACHE, fetcher.http_get, fetcher._sleep, fetcher.FEEDS = self._cache, self._get, self._sleep, self._feeds
        shutil.rmtree(self.tmp)

    def stub(self, *answers):
        answers = list(answers)

        def get(url, headers=None, timeout=20, public_only=False):
            self.calls.append(url)
            a = answers.pop(0)
            if isinstance(a, Exception):
                raise a
            return 200, {"ETag": "e1"}, json.dumps(a).encode()
        fetcher.http_get = get

    def test_network_errors_are_retried_with_backoff(self):
        self.stub(urllib.error.URLError("reset"), TimeoutError("slow"), [{"id": "x"}])
        meta = {}
        self.assertEqual(fetcher.load_feed(lambda m: None, meta), [{"id": "x"}])
        self.assertEqual(self.waits, [2, 8])
        self.assertEqual(meta, {"usingCache": False})

    def test_404_moves_to_the_next_feed_without_waiting(self):
        self.stub(urllib.error.HTTPError("u", 404, "nf", {}, None), [{"id": "y"}])
        self.assertEqual(fetcher.load_feed(lambda m: None), [{"id": "y"}])
        self.assertEqual(self.waits, [])
        self.assertEqual(self.calls, fetcher.FEEDS)

    def test_falls_back_to_the_last_copy_and_says_so(self):
        with open(os.path.join(self.tmp, "simplify.json"), "w") as f:
            json.dump([{"id": "old"}], f)
        self.stub(*[urllib.error.URLError("down")] * 6)
        meta, logs = {}, []
        self.assertEqual(fetcher.load_feed(logs.append, meta), [{"id": "old"}])
        self.assertEqual(meta, {"usingCache": True})
        self.assertEqual(len(self.calls), 6)  # 3 tries x 2 feeds

    def test_no_copy_at_all_is_an_error(self):
        self.stub(*[urllib.error.URLError("down")] * 6)
        with self.assertRaises(RuntimeError):
            fetcher.load_feed(lambda m: None)


class RefreshLock(unittest.TestCase):
    def test_a_second_holder_is_turned_away(self):
        tmp = tempfile.mkdtemp()
        try:
            with fetcher.refresh_lock(tmp) as a:
                self.assertTrue(a)
                # flock locks belong to the open file, so a second open (as another process would do) is refused
                with fetcher.refresh_lock(tmp) as b:
                    self.assertFalse(b)
            with fetcher.refresh_lock(tmp) as c:
                self.assertTrue(c)  # released
        finally:
            shutil.rmtree(tmp)


class Endpoints(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        server.configure(self.tmp)
        server.LISTINGS_NOTICE["text"] = ""
        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        server.LISTINGS_NOTICE["text"] = ""
        shutil.rmtree(self.tmp)

    def req(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.base + path, data=data, method=method, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(r) as res:
                return res.status, json.loads(res.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null")

    def test_bad_saves_get_400_with_problems_and_nothing_is_written(self):
        code, res = self.req("PUT", "/api/state", {"apps": [{"id": "a", "status": "saved"}]})
        self.assertEqual(code, 200)
        code, res = self.req("PUT", "/api/state", {"apps": [{"id": "a", "status": "nope"}], "baseRev": 1})
        self.assertEqual(code, 400)
        self.assertIn("problems", res)
        self.assertIn("hint", res)
        self.assertEqual(server.load_state()["apps"][0]["status"], "saved")

    def test_corrupt_listings_are_copied_aside_and_reported(self):
        with open(server.LISTINGS, "w") as f:
            f.write("{not json")
        code, res = self.req("GET", "/api/listings")
        self.assertEqual(code, 200)
        self.assertIn("could not be read", res["notice"])
        self.assertTrue(any(n.startswith("listings.json.") for n in os.listdir(os.path.join(self.tmp, "backups", "corrupt"))))

    def test_fetch_status(self):
        with open(server.LISTINGS, "w") as f:
            json.dump({"fetch": {"at": "2026-11-01T10:00:00-06:00", "error": None, "usingCache": True}}, f)
        code, st = self.req("GET", "/api/fetch/status")
        self.assertEqual(code, 200)
        self.assertEqual((st["running"], st["lastAt"], st["usingCache"]), (False, "2026-11-01T10:00:00-06:00", True))
        self.assertEqual(st["nextAt"], "2026-11-01T12:00:00-06:00")

    def test_a_running_refresh_elsewhere_makes_run_fetch_busy(self):
        with fetcher.refresh_lock(self.tmp) as got:
            self.assertTrue(got)
            self.assertEqual(server.run_fetch(), {"busy": True})
        self.assertFalse(server.FETCH_STATE["running"])


if __name__ == "__main__":
    unittest.main()

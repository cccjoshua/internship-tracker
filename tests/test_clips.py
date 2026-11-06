"""Tests for the Chrome extension endpoints (clips.py + server routes)."""
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
import ai  # noqa: E402
import clips  # noqa: E402
import server  # noqa: E402

EXT = {"Origin": "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "X-IAT-Client": "extension"}
DESC = ("We are hiring a Software Engineer Intern to build IVR call flows in Java. "
        "Legally authorized to work in the United States now and in the future. " + "Responsibilities include testing and code review. " * 6)


class ClipTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        server.configure(self.tmp)
        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self._an = ai.analyze
        self.analyzed = []
        ai.analyze = lambda meta, *a, **k: self.analyzed.append(meta)

    def tearDown(self):
        ai.analyze = self._an
        self.httpd.shutdown()
        self.httpd.server_close()
        shutil.rmtree(self.tmp)

    def j(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.base + path, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(r) as res:
                return res.status, json.loads(res.read() or b"null"), res.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null"), e.headers

    def test_canonical_urls_collapse_tracking_and_job_ids(self):
        self.assertEqual(clips.canonical_url("https://www.linkedin.com/jobs/view/software-engineer-intern-at-acme-4012345678/?trk=public&refId=x"), "https://www.linkedin.com/jobs/view/4012345678/")
        self.assertEqual(clips.canonical_url("https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=intern"), "https://www.linkedin.com/jobs/view/4012345678/")
        self.assertEqual(clips.canonical_url("https://app.joinhandshake.com/stu/postings/9876543?ref=feed"), "https://app.joinhandshake.com/jobs/9876543")
        self.assertEqual(clips.canonical_url("https://boards.greenhouse.io/acme/jobs/123?gh_src=abc&utm_source=x#app"), "https://boards.greenhouse.io/acme/jobs/123")
        self.assertEqual(clips.listing_key("https://Example.com/Job/1/", "A", "B"), "https://example.com/job/1")
        self.assertEqual(clips.listing_key("", "Acme Inc", "Software Intern - Summer 2027"), "k:acmeinc|software")

    def test_extension_can_ping_check_and_add_but_other_sites_cannot(self):
        code, r, h = self.j("GET", "/api/clip/ping", headers=EXT)
        self.assertEqual((code, r["ok"]), (200, True))
        self.assertEqual(h.get("Access-Control-Allow-Origin"), EXT["Origin"])
        self.assertEqual(self.j("GET", "/api/clip/ping", headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.j("POST", "/api/clip", {"company": "A", "role": "B"}, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.j("GET", "/api/clips", headers=EXT)[0], 403)  # only the tracker page reads the queue
        code, r, _ = self.j("POST", "/api/clip/check", {"url": "https://www.linkedin.com/jobs/view/4012345678/?trk=x", "company": "Acme", "role": "Data Engineer Intern"}, EXT)
        self.assertEqual((code, r["match"], r["track"]), (200, None, "DE"))
        self.assertEqual(r["url"], "https://www.linkedin.com/jobs/view/4012345678/")

    def test_add_queues_the_job_stores_its_text_and_flags_sponsorship(self):
        body = {"company": "T-Mobile", "role": "Software Engineer Intern", "url": "https://www.linkedin.com/jobs/view/4012345678/?trk=x", "location": "Overland Park, KS",
                "deadline": "2026-11-04", "posted": "nonsense", "status": "applied", "source": "LinkedIn", "description": DESC, "analyze": True, "pay": "$27–$50 per hour"}
        self.assertEqual(self.j("POST", "/api/clip", {"company": "", "role": "x"}, EXT)[0], 400)
        code, r, _ = self.j("POST", "/api/clip", body, EXT)
        self.assertEqual(code, 200)
        c = r["clip"]
        self.assertEqual((c["status"], c["sponsor"], c["track"], c["url"]), ("applied", "no", "SWE", "https://www.linkedin.com/jobs/view/4012345678/"))
        self.assertTrue(r["open"].endswith("/#job/" + c["id"]))
        q = self.j("GET", "/api/clips")[1]["pending"]
        self.assertEqual([x["id"] for x in q], [c["id"]])
        self.assertEqual((q[0]["posted"], q[0]["deadline"], q[0]["pay"]), ("", "2026-11-04", "$27–$50 per hour"))
        rec = ai.load_job(q[0]["key"])
        self.assertEqual(rec["textSource"], "extension")
        self.assertIn("IVR call flows", rec["text"])
        # a second save of the same job (any tracking link) is a duplicate, also while still queued
        code, r, _ = self.j("POST", "/api/clip", dict(body, url="https://www.linkedin.com/jobs/search/?currentJobId=4012345678"), EXT)
        self.assertEqual((code, r["match"]["pending"]), (409, True))
        # The queue keeps the clip until tracker.json really contains it (a failed page save never loses it).
        self.assertEqual(self.j("POST", "/api/clips/ack", {"added": [c["id"]]})[1]["removed"], 0)
        self.assertEqual(len(self.j("GET", "/api/clips")[1]["pending"]), 1)
        server.write_state({"rev": 1, "apps": [{"id": c["id"], "company": "x", "role": "y"}]})
        self.assertEqual(self.j("POST", "/api/clips/ack", {"added": [c["id"]]})[1]["removed"], 1)
        self.assertEqual(self.j("GET", "/api/clips")[1]["pending"], [])

    def test_check_finds_jobs_already_in_the_tracker(self):
        server.write_state({"rev": 1, "apps": [{"id": "x1", "company": "Acme", "role": "Data Analyst Intern", "status": "applied", "url": "https://jobs.lever.co/acme/123",
                                                  "history": [{"s": "saved", "d": "2026-10-20"}, {"s": "applied", "d": "2026-10-22"}]}]})
        m = self.j("POST", "/api/clip/check", {"url": "https://jobs.lever.co/acme/123?lever-source=LinkedIn", "company": "", "role": ""}, EXT)[1]["match"]
        self.assertEqual((m["id"], m["status"], m["applied"]), ("x1", "applied", "2026-10-22"))
        m = self.j("POST", "/api/clip/check", {"url": "", "company": "ACME", "role": "Data Analyst Intern (Summer 2027)"}, EXT)[1]["match"]
        self.assertEqual(m["id"], "x1")
        self.assertEqual(self.j("POST", "/api/clip", {"company": "Acme", "role": "Data Analyst Intern"}, EXT)[0], 409)


if __name__ == "__main__":
    unittest.main()

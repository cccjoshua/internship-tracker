"""Tests for search.py (hidden-listings search) and GET /api/search, plus norm() parity with search.js."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import search  # noqa: E402
import server  # noqa: E402

NODE = shutil.which("node")
NOW = int(time.time())


def item(i, company, title, term="Summer 2027", loc=("Austin, TX",), degrees=("Bachelor's", "Master's"), age_days=2, **kw):
    d = {"id": f"f{i}", "company_name": company, "title": title, "active": True, "is_visible": True, "terms": [term],
         "date_posted": NOW - age_days * 86400, "url": f"https://example.com/{i}", "locations": list(loc), "degrees": list(degrees),
         "category": "Software", "sponsorship": "Other"}
    d.update(kw)
    return d


class Normalize(unittest.TestCase):
    SAMPLES = ["  Société   Générale ", "Data-Eng / Intern", "ÅNGSTRÖM Labs", "Café · Résumé", "東京 Analytics", "  "]

    def test_norm_and_tokens(self):
        self.assertEqual(search.norm("  Société   Générale "), "societe generale")
        self.assertEqual(search.tokens("Data-Eng / Intern"), ["data", "eng", "intern"])

    @unittest.skipUnless(NODE, "node not installed")
    def test_matches_search_js(self):
        js = "const S=require('./search.js');const a=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(a.map(s=>[S.norm(s),S.tokens(s)])))"
        out = json.loads(subprocess.run([NODE, "-e", js], input=json.dumps(self.SAMPLES), capture_output=True, text=True, cwd=ROOT, check=True).stdout)
        self.assertEqual(out, [[search.norm(s), search.tokens(s)] for s in self.SAMPLES])


class HiddenReasons(unittest.TestCase):
    def setUp(self):
        self.idx = search.HiddenIndex()
        self.feed = [
            item(1, "Northwind Analytics", "Data Engineer Intern", term="Summer 2026"),
            item(2, "Contoso Robotics", "Software Engineer Intern", loc=("Toronto, ON",)),
            item(3, "Fabrikam Health", "Data Science Intern", degrees=("PhD",)),
            item(4, "Litware Systems", "Software Engineer Intern - Clearance Required"),
            item(5, "Tailspin Toys", "Marketing Intern"),
            item(6, "Shown Co", "Data Analyst Intern"),
            item(7, "Gone Co", "Data Analyst Intern"),  # passes the gates but is not listed: a later check removed it
            item(8, "Old Co", "Data Analyst Intern", age_days=40),  # outside the window: not counted as hidden
            item(9, "Inactive Co", "Data Analyst Intern", active=False),
            item(10, "Contoso Robotics", "Software Engineer Intern", loc=("Montreal, QC",)),  # same job, another city
        ]
        self.listings = [{"url": "https://example.com/6"}]

    def rows(self):
        return {r["company"]: r["reason"] for r in self.idx._build(self.feed, self.listings, {"windowDays": 10, "regions": []})}

    def test_reasons_follow_the_refresh_order(self):
        self.assertEqual(self.rows(), {
            "Northwind Analytics": "Not Summer 2027", "Contoso Robotics": "Outside the US", "Fabrikam Health": "PhD/MBA only",
            "Litware Systems": "Citizenship or clearance required", "Tailspin Toys": "Not a target field",
            "Gone Co": "Deadline passed, dismissed or already tracking"})

    def test_ranking_prefix_before_substring_and_one_typo(self):
        rows = self.idx._build(self.feed, self.listings, {"windowDays": 10})
        self.assertEqual([r["company"] for r in search.HiddenIndex.search(rows, "northwnd")], ["Northwind Analytics"])
        self.assertEqual(search.HiddenIndex.search(rows, "intern")[0]["company"], "Northwind Analytics")  # role match, newest first
        self.assertEqual([r["company"] for r in search.HiddenIndex.search(rows, "con rob")], ["Contoso Robotics"])
        self.assertEqual(search.HiddenIndex.search(rows, ""), [])
        self.assertNotIn("_c", search.HiddenIndex.search(rows, "contoso")[0])

    def test_index_is_reused_until_the_feed_changes(self):
        tmp = tempfile.mkdtemp()
        try:
            feed_path, lst = os.path.join(tmp, "simplify.json"), os.path.join(tmp, "listings.json")
            with open(feed_path, "w") as f:
                json.dump(self.feed, f)
            loads = []

            def load():
                loads.append(1)
                return self.feed, self.listings
            self.idx.rows(feed_path, lst, {}, load)
            self.idx.rows(feed_path, lst, {}, load)
            self.assertEqual(len(loads), 1)
            os.utime(feed_path, (time.time() + 5, time.time() + 5))  # a refresh rewrote the feed
            self.idx.rows(feed_path, lst, {}, load)
            self.assertEqual(len(loads), 2)
            self.idx.rows(feed_path, lst, {"windowDays": 3}, load)  # filters changed
            self.assertEqual(len(loads), 3)
        finally:
            shutil.rmtree(tmp)


class SearchEndpoint(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        server.configure(self.tmp)
        search.HIDDEN = search.HiddenIndex()
        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        shutil.rmtree(self.tmp)

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_no_feed_yet(self):
        code, d = self.get("/api/search?q=data")
        self.assertEqual(code, 200)
        self.assertEqual(d["groups"][0]["items"], [])

    def test_grouped_results_and_validation(self):
        os.makedirs(os.path.join(self.tmp, "cache"), exist_ok=True)
        with open(os.path.join(self.tmp, "cache", "simplify.json"), "w") as f:
            json.dump([item(1, "Northwind Analytics", "Data Engineer Intern", term="Summer 2026")], f)
        code, d = self.get("/api/search?q=northwind&scope=hidden&limit=5")
        self.assertEqual(code, 200)
        g = d["groups"][0]
        self.assertEqual((g["group"], g["items"][0]["company"], g["items"][0]["reason"]), ("Hidden listings", "Northwind Analytics", "Not Summer 2027"))
        self.assertEqual(self.get("/api/search?q=x&scope=all")[0], 400)
        self.assertEqual(self.get("/api/search?q=x&limit=abc")[0], 400)


if __name__ == "__main__":
    unittest.main()

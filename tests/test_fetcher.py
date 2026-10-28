"""Unit tests for fetcher.py: classification, text checks, scoring and the refresh pipeline (network stubbed)."""
import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import fetcher  # noqa: E402


class Classification(unittest.TestCase):
    def test_infer_track(self):
        cases = {
            "Software Engineer Intern": "SWE", "Data Engineer Intern": "DE", "Analytics Engineer Intern": "DE",
            "Business Intelligence Engineer Intern": "BIE", "Data Analyst Intern": "DA", "Data Science Intern": "DS",
            "Machine Learning Engineer Intern": "DS", "Quantitative Research Intern": "Quant", "Product Manager Intern": "Other",
            "Hardware Engineer Intern": "Other", "Financial Analyst Intern": "Other", "Credit Risk Data Analyst": "DA",
            "Mechanical Engineering Intern": "Other", "iOS Developer Intern": "SWE", "Office Assistant": "Other",
        }
        for title, want in cases.items():
            with self.subTest(title=title):
                self.assertEqual(fetcher.infer_track(title), want)
        self.assertEqual(fetcher.infer_track("Research Intern", "Quant"), "Quant")

    def test_is_us(self):
        self.assertTrue(fetcher.is_us(["Austin, TX"]))
        self.assertTrue(fetcher.is_us(["Remote in USA"]))
        self.assertTrue(fetcher.is_us([]))
        self.assertFalse(fetcher.is_us(["Toronto, ON, Canada"]))
        self.assertTrue(fetcher.is_us(["London, UK", "New York, NY"]))

    def test_posting_text_checks(self):
        self.assertTrue(fetcher.CITIZEN.search("Applicants must be a U.S. citizen."))
        self.assertTrue(fetcher.CLEARANCE.search("Must be able to obtain a Secret security clearance."))
        self.assertTrue(fetcher.NO_SPONSOR.search("We are unable to sponsor visas for this role."))
        self.assertTrue(fetcher.NO_SPONSOR.search("Candidates must be authorized to work without visa sponsorship."))
        self.assertFalse(fetcher.NO_SPONSOR.search("We sponsor visas for qualified candidates."))
        self.assertTrue(fetcher.FRIENDLY.search("Students on F-1 OPT are welcome."))
        self.assertFalse(fetcher.FRIENDLY.search("We value optimism."))

    def test_skill_patterns(self):
        text = "Python, SQL and Tableau; JavaScript; exposure to R is a plus; Spark/PySpark."
        found = {k for k, r in fetcher.SKILL_RE.items() if r.search(text)}
        self.assertTrue({"Python", "SQL", "Tableau", "JavaScript", "R", "Spark"} <= found)
        self.assertNotIn("Java", found)

    def test_norm_company_and_h1b_lookup(self):
        self.assertEqual(fetcher.norm_company("Amazon.com Services LLC"), "AMAZON COM")
        h = fetcher.H1B.__new__(fetcher.H1B)
        h.counts = {"CAPITAL ONE": 900, "CAPITAL ONE BANK": 100, "META PLATFORMS": 5000}
        h.keys = sorted(h.counts)
        self.assertEqual(h.lookup("Capital One, N.A."), 1000)
        self.assertEqual(h.lookup("Meta Platforms, Inc."), 5000)
        self.assertIsNone(h.lookup("Tiny Startup"))


class Deadlines(unittest.TestCase):
    TODAY = dt.date(2026, 10, 28)

    def test_find_deadline_formats(self):
        f = lambda t: fetcher.find_deadline(t, self.TODAY)
        self.assertEqual(f("Application deadline: November 15th, 2026."), "2026-11-15")
        self.assertEqual(f("Please apply by 11/20/2026 to be considered."), "2026-11-20")
        self.assertEqual(f("Applications will be accepted until Dec 1."), "2026-12-01")
        self.assertEqual(f("Applications accepted through January 15"), "2027-01-15")  # read in October: next January
        self.assertEqual(f("Application deadline: 2026-11-05."), "2026-11-05")  # Workday end date
        self.assertIsNone(f("We review applications on a rolling basis."))
        self.assertIsNone(f("Deadline: March 3, 2019"))  # outside the sane range

    def test_parse_date(self):
        self.assertEqual(fetcher.parse_date("15 Nov 2026", self.TODAY), dt.date(2026, 11, 15))
        self.assertIsNone(fetcher.parse_date("Nov 31", self.TODAY))


class Scoring(unittest.TestCase):
    TODAY = dt.date(2026, 10, 28)

    def listing(self, **kw):
        l = {"company": "Acme", "role": "Data Analyst Intern", "posted": "2026-10-28", "h1b": 999, "friendly": False,
             "noSponsor": False, "skillsFound": ["Python", "SQL"], "locations": ["Austin, TX"], "degrees": ["Master's"], "source": "simplify"}
        l.update(kw)
        return l

    def test_perfect_listing_scores_high(self):
        c = fetcher.score_parts(self.listing(), {}, self.TODAY)
        self.assertEqual(c["track"], "DA")
        self.assertEqual(c["matched"], ["Python", "SQL"])
        self.assertGreaterEqual(c["total"], 90)

    def test_settings_change_scores(self):
        base = fetcher.score(self.listing(), {}, self.TODAY)
        self.assertLess(fetcher.score(self.listing(), {"targets": ["SWE"]}, self.TODAY), base)
        self.assertLess(fetcher.score(self.listing(), {"places": ["Seattle"]}, self.TODAY), base)
        self.assertLess(fetcher.score(self.listing(), {"mySkills": []}, self.TODAY), base)

    def test_no_sponsor_penalty_and_recency(self):
        l = self.listing(noSponsor=True)
        c = fetcher.score_parts(l, {}, self.TODAY)
        self.assertEqual(c["penalty"], 20)
        self.assertEqual(c["v"]["sponsor"], 0)
        self.assertEqual(fetcher.score_parts(l, {"noSponsorPenalty": 0}, self.TODAY)["penalty"], 0)
        old = fetcher.score_parts(self.listing(posted="2026-10-23"), {}, self.TODAY)["v"]["recency"]
        self.assertAlmostEqual(old, 0.5)
        self.assertAlmostEqual(fetcher.score_parts(self.listing(posted="2026-10-23"), {"recencyHalfLife": 10}, self.TODAY)["v"]["recency"], 0.5 ** 0.5)

    def test_degree_rules(self):
        d = lambda **kw: fetcher.components(self.listing(**kw), {}, self.TODAY)["v"]["degree"]
        self.assertEqual(d(degrees=[]), 1.0)
        self.assertEqual(d(degrees=["Bachelor's"]), 0.7)
        self.assertEqual(d(degrees=["PhD"]), 0.0)
        self.assertEqual(d(degrees=None, degree="BS/MS"), 1.0)

    def test_zero_weights(self):
        self.assertEqual(fetcher.score(self.listing(), {"weights": {k: 0 for k in fetcher.WEIGHT_KEYS}}, self.TODAY), 0)

    def test_upgrade_legacy_listing(self):
        old = {"id": "sx-1", "source": "simplify", "company": "A", "role": "Data Analyst Intern", "location": "Austin, TX; Remote in USA +2 more",
               "v": {"fit": 1}, "penalty": 20, "flags": ["No sponsorship"], "skills": {"matched": ["SQL"], "missing": ["Spark"]}, "degree": "Master"}
        new = fetcher.upgrade_listing(old)
        self.assertEqual(new["skillsFound"], ["SQL", "Spark"])
        self.assertTrue(new["noSponsor"])
        self.assertEqual(new["locations"], ["Austin, TX", "Remote in USA"])
        self.assertNotIn("v", new)
        self.assertIs(fetcher.upgrade_listing(new), new)


def feed_item(i, **kw):
    it = {"id": f"id{i}", "company_name": f"Company {i}", "title": "Data Analyst Intern", "url": f"https://boards.greenhouse.io/c{i}/jobs/{i}",
          "locations": ["Austin, TX"], "terms": ["Summer 2027"], "active": True, "is_visible": True,
          "date_posted": int((dt.datetime.now() - dt.timedelta(days=1)).timestamp()), "degrees": ["Master's"], "sponsorship": "Other", "category": ""}
    it.update(kw)
    return it


class Refresh(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.old_cache = fetcher.CACHE
        fetcher.CACHE = os.path.join(self.tmp, "cache")

    def tearDown(self):
        fetcher.CACHE = self.old_cache
        shutil.rmtree(self.tmp)

    def run_refresh(self, feed, user=None, listings=None, texts=None):
        texts = texts or {}

        def analyze(url):
            return texts.get(url, {"read": True, "citizen": False, "clearance": False, "noSponsor": False, "friendly": False, "skills": ["SQL"], "at": dt.date.today().isoformat()})
        h1b = mock.Mock(counts={"X": 1}, lookup=lambda name: 42)
        with mock.patch.object(fetcher, "load_feed", return_value=feed), mock.patch.object(fetcher, "analyze_text", side_effect=analyze), mock.patch.object(fetcher, "H1B", return_value=h1b):
            return fetcher.refresh(user or {}, listings or {}, log=lambda m: None)

    def test_gates_and_merge(self):
        feed = [
            feed_item(1), feed_item(2, terms=["Summer 2026"]), feed_item(3, locations=["Toronto, Canada"]),
            feed_item(4, degrees=["PhD"]), feed_item(5, title="Mechanical Engineer Intern"), feed_item(6, sponsorship="U.S. Citizenship is Required"),
            feed_item(7, date_posted=int((dt.datetime.now() - dt.timedelta(days=30)).timestamp())), feed_item(8, active=False),
            feed_item(9, company_name="Company 1", locations=["Remote in USA"]),  # same company and title as 1: merged
            feed_item(10),
        ]
        closed = "https://boards.greenhouse.io/c10/jobs/10"
        res = self.run_refresh(feed, texts={closed: {"read": False, "closed": True, "why": "HTTP 404", "at": "x"}})
        ex = res["fetch"]["excluded"]
        self.assertEqual(ex["Not Summer 2027"], 1)
        self.assertEqual(ex["Outside the US"], 1)
        self.assertEqual(ex["PhD/MBA only"], 1)
        self.assertEqual(ex["Not a target field"], 1)
        self.assertEqual(ex["Citizenship or clearance required"], 1)
        self.assertEqual(ex["Posting closed"], 1)
        self.assertEqual(len(res["listings"]), 1)
        l = res["listings"][0]
        self.assertEqual(sorted(l["locations"]), ["Austin, TX", "Remote in USA"])
        self.assertEqual(l["h1b"], 42)
        self.assertEqual(l["skillsFound"], ["SQL"])
        self.assertTrue(l["textRead"])
        self.assertNotIn("v", l)

    def test_apply_excludes_tracked_and_dismissed_and_marks_new(self):
        feed = [feed_item(1), feed_item(2), feed_item(3)]
        res = self.run_refresh(feed)
        user = {"apps": [{"company": "Company 1", "role": "Data Analyst Intern", "url": ""}], "dismissed": ["https://boards.greenhouse.io/c2/jobs/2"]}
        out = fetcher.apply(user, {"lrev": 4, "listings": [{"id": "sx-id9"}]}, res)
        self.assertEqual([l["company"] for l in out["listings"]], ["Company 3"])
        self.assertTrue(out["listings"][0]["isNew"])
        self.assertEqual(out["lrev"], 5)
        self.assertEqual(out["fetch"]["excluded"]["Already tracking"], 1)
        self.assertEqual(out["fetch"]["excluded"]["Dismissed"], 1)
        self.assertNotIn("listings", user)  # your data is never changed

    def test_saved_applications_closed_and_keep_open(self):
        url = "https://jobs.lever.co/acme/123"
        user = {"apps": [
            {"id": "a1", "company": "Acme", "status": "saved", "url": url},
            {"id": "a2", "company": "Beta", "status": "saved", "url": url + "4", "keepOpen": True},
            {"id": "a3", "company": "Gamma", "status": "applied", "url": url + "5"},
        ]}
        res = self.run_refresh([], user=user, texts={url: {"read": False, "closed": True, "why": "HTTP 404", "at": "x"}})
        self.assertEqual([c["id"] for c in res["closures"]], ["a1"])
        self.assertIn("a1", res["liveChecked"])
        self.assertNotIn("a2", res["liveChecked"])
        # checked today: not checked again
        res2 = self.run_refresh([], user=user, listings={"liveChecked": res["liveChecked"]}, texts={})
        self.assertEqual(res2["closures"], [])

    def test_deadlines(self):
        today = dt.date.today()
        past, soon = (today - dt.timedelta(days=2)).isoformat(), (today + dt.timedelta(days=9)).isoformat()
        u1, u2 = "https://boards.greenhouse.io/c1/jobs/1", "https://boards.greenhouse.io/c2/jobs/2"
        ok = lambda d: {"read": True, "skills": [], "deadline": d, "at": today.isoformat()}
        res = self.run_refresh([feed_item(1), feed_item(2)], texts={u1: ok(past), u2: ok(soon)})
        self.assertEqual(res["fetch"]["excluded"].get("Deadline passed"), 1)
        self.assertEqual([l["deadline"] for l in res["listings"]], [soon])
        # saved applications: a found deadline is reported; a passed one (found or entered) closes it
        su = "https://jobs.lever.co/acme/9"
        user = {"apps": [{"id": "s1", "company": "Acme", "status": "saved", "url": su},
                         {"id": "s2", "company": "Beta", "status": "saved", "url": su + "8", "deadline": past}]}
        res = self.run_refresh([], user=user, texts={su: ok(soon), su + "8": ok("")})
        self.assertEqual(res["savedDeadlines"], {"s1": soon})
        self.assertEqual([(c["id"], c["why"]) for c in res["closures"]], [("s2", f"deadline {past} passed")])
        out = fetcher.apply(user, {}, res)
        self.assertEqual(out["savedDeadlines"], {"s1": soon})
        self.assertNotIn("deadline", user["apps"][0])  # your data is never written by the refresh

    def test_failed_keeps_listings(self):
        out = fetcher.failed({"lrev": 2, "listings": [{"id": "x"}], "fetch": {"matched": 1}}, RuntimeError("offline"))
        self.assertEqual(out["listings"], [{"id": "x"}])
        self.assertEqual(out["fetch"]["error"], "offline")
        self.assertEqual(out["lrev"], 3)


if __name__ == "__main__":
    unittest.main()

"""Regression tests for the review findings: sponsorship wording, profile-driven gates, dedup, stale analysis,
cover-letter sources, corrupt data, export identity and Unicode."""
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
from tests.test_fetcher import feed_item  # noqa: E402


class SponsorshipWording(unittest.TestCase):
    def test_cpt_opt_exclusion_is_never_friendly(self):
        for text in ["Candidates on CPT or OPT are not eligible.", "This role does not accept OPT candidates.",
                     "Please note: F-1 students on CPT are ineligible for this program."]:
            with self.subTest(text=text):
                sig = fetcher.sponsorship_signals(text)
                self.assertFalse(sig["friendly"])
                self.assertTrue(sig["optExcluded"])
                self.assertTrue(sig["noSponsor"])

    def test_friendly_and_mixed(self):
        self.assertTrue(fetcher.sponsorship_signals("International students on CPT/OPT are welcome to apply.")["friendly"])
        mixed = fetcher.sponsorship_signals("We welcome F-1 students. We will not sponsor H-1B visas for this role.")
        self.assertFalse(mixed["friendly"])
        self.assertTrue(mixed["noSponsor"])
        self.assertFalse(mixed["optExcluded"])

    def test_dotnet_is_not_csharp(self):
        self.assertFalse(fetcher.SKILL_RE["C#"].search("Experience with .NET and VB.NET"))
        self.assertTrue(fetcher.SKILL_RE["C#"].search("C# and .NET"))


class Gates(unittest.TestCase):
    def run_refresh(self, feed, user=None):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        h1b = mock.Mock(counts={}, lookup=lambda name: None)
        ana = lambda url: {"read": True, "skills": [], "at": dt.date.today().isoformat()}
        with mock.patch.object(fetcher, "CACHE", tmp), mock.patch.object(fetcher, "load_feed", return_value=feed), \
                mock.patch.object(fetcher, "analyze_text", side_effect=ana), mock.patch.object(fetcher, "H1B", return_value=h1b):
            return fetcher.refresh(user or {}, {}, log=lambda m: None)

    def test_regions_from_profile(self):
        feed = [feed_item(1), feed_item(2, locations=["Tokyo, Japan"]), feed_item(3, locations=["Berlin, Germany"])]
        self.assertEqual(len(self.run_refresh(feed)["listings"]), 1)
        res = self.run_refresh(feed, {"settings": {"regions": ["United States", "Japan"]}})
        self.assertEqual(sorted(l["company"] for l in res["listings"]), ["Company 1", "Company 2"])
        self.assertEqual(res["fetch"]["excluded"]["Outside your regions"], 1)

    def test_terms_from_settings(self):
        feed = [feed_item(1), feed_item(2, terms=["Fall 2027"])]
        res = self.run_refresh(feed, {"settings": {"terms": ["Summer 2027", "Fall 2027"]}})
        self.assertEqual(len(res["listings"]), 2)
        self.assertEqual({l["term"] for l in res["listings"]}, {"Summer 2027", "Fall 2027"})

    def test_same_title_different_requisitions_are_kept(self):
        a = feed_item(1, url="https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Austin/SWE-Intern_R12345")
        b = feed_item(2, company_name="Company 1", url="https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Dallas/SWE-Intern_R67890", locations=["Dallas, TX"])
        c = feed_item(3, company_name="Company 1", url=a["url"], locations=["Remote in USA"])  # same requisition, another location
        res = self.run_refresh([a, b, c])
        self.assertEqual(len(res["listings"]), 2)
        merged = next(l for l in res["listings"] if "Remote in USA" in l["locations"])
        self.assertIn("Austin, TX", merged["locations"])

    def test_season_year_is_not_stripped_when_matching_tracked_apps(self):
        res = self.run_refresh([feed_item(1, title="Data Analyst Intern (Summer 2027)")])
        user = {"apps": [{"company": "Company 1", "role": "Data Analyst Intern (Summer 2026)", "url": ""}]}
        out = fetcher.apply(user, {}, res)
        self.assertEqual(len(out["listings"]), 1)
        user = {"apps": [{"company": "Company 1", "role": "Data Analyst Internship (Summer 2027)", "url": ""}]}
        self.assertEqual(len(fetcher.apply(user, {}, res)["listings"]), 0)

    def test_different_link_same_title_is_not_hidden(self):
        res = self.run_refresh([feed_item(1)])
        user = {"apps": [{"company": "Company 1", "role": "Data Analyst Intern", "url": "https://boards.greenhouse.io/c1/jobs/999"}]}
        self.assertEqual(len(fetcher.apply(user, {}, res)["listings"]), 1)



# ---------------------------------------------------------------- server-level: AI stubbed, isolated data folder
import copy  # noqa: E402
import io  # noqa: E402
import zipfile  # noqa: E402

import ai  # noqa: E402
import resume_export  # noqa: E402
import server  # noqa: E402
from tests import test_studio as ts  # noqa: E402


class Studio(ts.StudioTest):
    """Reuses StudioTest's isolated server and stubbed API; runs only the tests defined here."""


for _n in [n for n in dir(ts.StudioTest) if n.startswith("test_")]:
    setattr(Studio, _n, None)


def _studio_test(fn):
    setattr(Studio, fn.__name__, fn)
    return fn


@_studio_test
def test_new_posting_text_marks_the_analysis_stale(self):
    self.req("POST", "/api/ai/key", {"key": ts.KEY})
    self.req("PUT", "/api/profile", {"profile": ts.PROFILE, "baseRev": 0})
    self.j("POST", "/api/ai/analyze", self.job())
    code, r = self.j("POST", "/api/job/text", self.job(text="A completely different posting about Rust and embedded firmware. " * 10))
    self.assertEqual(r["job"]["analysisState"], "stale")
    self.assertEqual(self.j("POST", "/api/ai/tailor", self.job(track="DA"))[0], 409)   # never tailors to an old analysis
    self.assertEqual(self.j("POST", "/api/ai/cover", self.job(track="DA"))[0], 409)
    code, r = self.j("POST", "/api/ai/analyze", self.job())
    self.assertEqual(r["job"]["analysisState"], "current")


@_studio_test
def test_cover_letter_sentences_are_checked_against_their_sources(self):
    self.req("POST", "/api/ai/key", {"key": ts.KEY})
    self.req("PUT", "/api/profile", {"profile": ts.PROFILE, "baseRev": 0})
    self.j("POST", "/api/ai/analyze", self.job())
    letter = copy.deepcopy(ts.LETTER)
    letter["paragraphs"] = [{"text": "Thank you for your time.", "source": ""},
                            {"text": "I wrote SQL queries for approval workflows.", "source": "acme.1"},
                            {"text": "I cut costs by 35% with Tableau.", "source": "acme.1"},
                            {"text": "I built 12 dashboards.", "source": ""}]
    self._letter = letter
    orig = ai.call_api

    def fake(body, key, timeout=180):
        if "salutation" in body["output_config"]["format"]["schema"]["properties"]:
            return {"content": [{"type": "text", "text": json.dumps(letter)}], "stop_reason": "end_turn", "usage": {"input_tokens": 10, "output_tokens": 10}}
        return orig(body, key, timeout)
    ai.call_api = fake
    code, r = self.j("POST", "/api/ai/cover", self.job(track="DA"))
    self.assertEqual(code, 200)
    ps = r["result"]["paragraphs"]
    self.assertFalse(ps[0]["unverified"]); self.assertTrue(ps[0].get("generic"))     # a thank-you needs no source
    self.assertFalse(ps[1]["unverified"])
    self.assertTrue(ps[2]["unverified"])
    self.assertTrue(any("35" in x for x in ps[2]["issues"]) and any("Tableau" in x for x in ps[2]["issues"]))
    self.assertTrue(ps[3]["unverified"])                                               # a number with no source
    sent = json.dumps(self.calls[-1])
    self.assertNotIn("t@example.edu", sent)                                             # contact details stay local


@_studio_test
def test_resume_save_conflict_keeps_both_versions(self):
    j = self.job()
    code, r = self.j("PUT", "/api/resume", dict(j, resume={"v": "A"}))
    base = r["resume"]["updatedAt"]
    self.assertEqual(self.j("PUT", "/api/resume", dict(j, resume={"v": "other tab"}, baseUpdatedAt=base))[0], 200)
    code, r = self.j("PUT", "/api/resume", dict(j, resume={"v": "mine"}, baseUpdatedAt=base))
    self.assertEqual(code, 409)
    self.assertEqual(r["resume"]["current"], {"v": "other tab"})
    code, r = self.j("PUT", "/api/resume", dict(j, resume={"v": "mine"}, label="Your edits (conflict)", by="you", keepCurrent=True))
    self.assertEqual(r["resume"]["current"], {"v": "other tab"})
    self.assertEqual(r["resume"]["versions"][-1]["resume"], {"v": "mine"})


@_studio_test
def test_exports_never_overwrite_other_jobs_or_versions(self):
    m1 = {"header": {"name": "A"}, "sections": []}
    m2 = {"header": {"name": "B"}, "sections": []}
    for key, m in (("https://a/1", m1), ("https://a/2", m1), ("https://a/1", m2)):
        self.j("PUT", "/api/resume", dict(self.job(), key=key, resume=m))
        self.assertEqual(self.req("POST", "/api/export", {"resume": m, "format": "docx", "filename": "Resume_Acme", "key": key, "kind": "resume"})[0], 200)
    self.assertEqual(len(os.listdir(os.path.join(self.tmp, "exports"))), 3)


@_studio_test
def test_pdf_refuses_characters_it_cannot_show_and_docx_keeps_them(self):
    m = {"header": {"name": "Test Person 測試者", "contact": "José Núñez · Zürich"}, "sections": []}
    self.assertEqual(resume_export.unsupported_chars(m), ["測", "試", "者"])
    code, h, raw = self.req("POST", "/api/export", {"resume": m, "format": "pdf", "filename": "R"})
    self.assertEqual(code, 422)
    self.assertIn("測", json.loads(raw)["error"])
    code, h, raw = self.req("POST", "/api/export", {"resume": m, "format": "docx", "filename": "R"})
    xml = zipfile.ZipFile(io.BytesIO(raw)).read("word/document.xml").decode()
    self.assertIn("測試者", xml); self.assertIn("Núñez", xml)
    m["header"]["name"] = "Test Person"
    code, h, raw = self.req("POST", "/api/export", {"resume": m, "format": "pdf", "filename": "R"})
    self.assertEqual(code, 200)                                                   # accents are fine in the PDF
    self.assertEqual(self.j("POST", "/api/resume/fit", {"resume": {"header": {"name": "張"}, "sections": []}})[1]["unsupported"], ["張"])


@_studio_test
def test_corrupt_files_are_never_overwritten(self):
    with open(server.STATE, "w") as f:
        f.write('{"apps": [ broken')
    code, r = self.j("GET", "/api/state")
    self.assertEqual(code, 503)
    code, r = self.j("PUT", "/api/state", {"apps": [], "baseRev": 0})
    self.assertEqual(code, 503)
    with open(server.STATE) as f:
        self.assertEqual(f.read(), '{"apps": [ broken')
    self.assertTrue(os.listdir(os.path.join(server.BACKUPS, "corrupt")))
    with open(server.PROFILE, "w") as f:
        f.write("{nope")
    self.assertEqual(self.j("PUT", "/api/profile", {"profile": {"basics": {}}, "baseRev": 0})[0], 503)
    with open(server.PROFILE) as f:
        self.assertEqual(f.read(), "{nope")


@_studio_test
def test_budget_reservations_cover_calls_in_flight(self):
    ai.release(10)
    ai.reserve(0.004, 0.01)
    with self.assertRaises(ai.AIError):
        ai.reserve(0.007, 0.01)        # the first call is still in flight
    ai.release(0.004)
    ai.reserve(0.007, 0.01)
    ai.release(0.007)


if __name__ == "__main__":
    unittest.main()

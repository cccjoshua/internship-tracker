"""The scoring formula lives in core.js (page) and fetcher.py (terminal). These tests keep them identical."""
import datetime as dt
import json
import os
import random
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import fetcher  # noqa: E402

NODE = shutil.which("node")

TITLES = [
    "Software Engineer Intern", "Data Engineer Intern", "Business Intelligence Engineer Intern", "Data Analyst Intern",
    "Machine Learning Intern (PhD)", "Quantitative Research Intern", "Product Manager Intern", "Hardware Engineer Intern",
    "Financial Analyst Intern", "Data Science Intern, MS", "Senior Software Engineer", "AI Research Scientist Intern",
    "Analytics Engineer Intern", "Mechanical Engineering Intern", "iOS Developer Intern", "Site Reliability Engineer Intern",
    "Supply Chain Analyst", "Credit Risk Data Analyst", "Firmware Engineer Intern", "Full-Stack Developer Intern",
    "Marketing Analytics Intern", "Trader Intern", "Applied Scientist Intern", "ETL Developer Intern", "UX Designer Intern",
    "BI Developer", "Computer Vision Engineer Intern", "Test Engineer Intern", "Platform Engineer Intern", "Office Assistant",
]


def run_node(script, payload):
    p = subprocess.run([NODE, "-e", script], input=json.dumps(payload), capture_output=True, text=True, cwd=ROOT, check=True)
    return json.loads(p.stdout)


def random_listing(r, today):
    posted = today - dt.timedelta(days=r.randint(-2, 40))
    l = {
        "id": f"x{r.randint(0, 10**9)}", "company": "Acme", "role": r.choice(TITLES),
        "category": r.choice(["", "", "Quant", "Software"]),
        "posted": posted.isoformat() if r.random() > 0.05 else "",
        "h1b": r.choice([None, 0, 1, 7, 150, 2400, 90000]),
        "friendly": r.random() < 0.2, "noSponsor": r.random() < 0.15, "source": "simplify", "textRead": r.random() < 0.8,
        "skillsFound": r.sample(fetcher.DEFAULT_MY_SKILLS + ["Spark", "Airflow", "AWS", "Excel", "Statistics"], r.randint(0, 8)),
        "locations": r.sample(["Austin, TX", "Remote in USA", "Seattle, WA", "Houston, Texas", "New York, NY"], r.randint(0, 3)),
    }
    if r.random() < 0.5:
        l["degrees"] = r.sample(["Bachelor's", "Master's", "PhD", "MBA"], r.randint(0, 2))
    else:
        l["degree"] = r.choice(["BS/MS", "MS", "PhD", "", "Any", "MBA"])
    if r.random() < 0.3:  # a manually added listing: sponsorship as a field, track inferred
        for k in ("friendly", "noSponsor", "skillsFound", "source", "category"):
            l.pop(k, None)
        l["sponsor"] = r.choice(["yes", "no", "unknown"])
        l["location"] = r.choice(["Dallas, TX", "Remote (US)", "Boston, MA"])
        l.pop("locations")
    elif r.random() < 0.5:
        l["track"] = r.choice(["SWE", "DS", "Quant", "Other"])
    return l


def random_settings(r):
    s = {}
    if r.random() < 0.7:
        s["weights"] = {k: r.choice([0, 5, 10, 15, 25, 30, 40]) for k in fetcher.WEIGHT_KEYS}
    if r.random() < 0.5:
        s["targets"] = r.sample(["SWE", "DE", "DA", "DS", "BIE"], r.randint(0, 5))
    if r.random() < 0.5:
        s["places"] = r.sample(["TX", "Remote", "Seattle", " ", "new york"], r.randint(0, 3))
    if r.random() < 0.5:
        s["mySkills"] = r.sample(fetcher.DEFAULT_MY_SKILLS, r.randint(0, 10))
    if r.random() < 0.4:
        s["noSponsorPenalty"] = r.choice([0, 10, 20, 35])
    if r.random() < 0.4:
        s["recencyHalfLife"] = r.choice([1, 3, 5, 7.5, 14])
    return s


@unittest.skipUnless(NODE, "node is not installed")
class Parity(unittest.TestCase):
    def test_defaults_and_skill_catalog_match(self):
        out = run_node("const c=require('./core.js');process.stdout.write(JSON.stringify({d:c.DEFAULTS,s:c.SKILL_NAMES,w:c.WEIGHT_KEYS}))", {})
        d = out["d"]
        self.assertEqual(d["weights"], fetcher.DEFAULT_WEIGHTS)
        self.assertEqual(d["targets"], fetcher.DEFAULT_TARGETS)
        self.assertEqual(d["places"], fetcher.DEFAULT_PLACES)
        self.assertEqual(d["mySkills"], fetcher.DEFAULT_MY_SKILLS)
        self.assertEqual(d["noSponsorPenalty"], fetcher.NO_SPONSOR_PENALTY)
        self.assertEqual(d["recencyHalfLife"], fetcher.RECENCY_HALF_LIFE)
        self.assertEqual(out["s"], list(fetcher.SKILLS))
        self.assertEqual(out["w"], fetcher.WEIGHT_KEYS)
        self.assertTrue(set(d["mySkills"]) <= set(fetcher.SKILLS))

    def test_track_inference_matches(self):
        cats = ["", "Quant"]
        cases = [[t, c] for t in TITLES for c in cats]
        js = run_node("const c=require('./core.js');let d='';process.stdin.on('data',x=>d+=x).on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(d).map(([t,k])=>c.inferTrack(t,k)))))", cases)
        self.assertEqual(js, [fetcher.infer_track(t, c) for t, c in cases])

    def test_scores_match_for_random_listings(self):
        r = random.Random(42)
        today = dt.date(2026, 10, 28)
        cases = [{"l": random_listing(r, today), "s": random_settings(r)} for _ in range(600)]
        js = run_node("const c=require('./core.js');let d='';process.stdin.on('data',x=>d+=x).on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(d).map(x=>{const o=c.score(x.l,x.s,'2026-10-28');return{t:o.total,p:o.parts.map(p=>p.pts),v:o.parts.map(p=>p.v),m:o.matched,x:o.missing,k:o.track,pen:o.pen}}))))", cases)
        for case, j in zip(cases, js):
            py = fetcher.score_parts(case["l"], case["s"], today)
            with self.subTest(case=case):
                self.assertEqual(py["total"], j["t"])
                self.assertEqual(py["track"], j["k"])
                self.assertEqual(py["matched"], j["m"])
                self.assertEqual(py["missing"], j["x"])
                self.assertAlmostEqual(py["penalty"], j["pen"])
                for a, b in zip([p["pts"] for p in py["parts"]], j["p"]):
                    self.assertAlmostEqual(a, b, places=9)


if __name__ == "__main__":
    unittest.main()

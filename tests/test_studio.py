"""Tests for the profile, Claude API and resume endpoints. The Claude API and posting pages are stubbed: no network."""
import io
import json
import os
import shutil
import stat
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import ai  # noqa: E402
import fetcher  # noqa: E402
import resume_export  # noqa: E402
import server  # noqa: E402

KEY = "sk-ant-api03-" + "a" * 40
PROFILE = {
    "basics": {"name": "Test Person", "email": "t@example.edu", "location": "Houston, TX"},
    "preferences": {"graduation": "2028-05"},
    "experience": [{"id": "acme", "org": "Acme Corp", "title": "Intern", "start": "Feb 2025", "end": "Apr 2025", "tech": "SQL, C#",
                    "points": [{"id": "acme.1", "kind": "bullet", "text": "Wrote SQL queries for approval workflows."},
                               {"id": "acme.2", "kind": "fact", "text": "SECRET UNCONFIRMED CLAIM", "confirm": True}]},
                   {"id": "hid", "org": "Hidden Co", "hidden": True, "points": [{"id": "hid.1", "text": "HIDDEN ENTRY POINT"}]}],
    "skills": [{"label": "Languages", "value": "Python, SQL"}],
    "notYet": ["Power BI"],
}
ANALYSIS = {"summary": "s", "audience": {"degreeLevels": ["Master"], "enrollment": "", "gradFrom": "", "gradTo": "", "gradText": "", "majors": [], "yearsExperience": None, "evidence": ""},
            "timing": {"term": "Summer 2027", "start": "", "end": "", "duration": "", "deadline": "", "evidence": ""},
            "location": {"workMode": "onsite", "places": ["Austin, TX"], "relocation": ""}, "pay": "",
            "sponsorship": {"status": "cpt_opt_ok", "evidence": "CPT welcome", "note": ""}, "requiredSkills": ["SQL"], "preferredSkills": [],
            "keywords": [{"term": "SQL", "importance": 3, "kind": "skill"}], "responsibilities": ["Write SQL"], "redFlags": []}
TAILORED = {"sectionOrder": ["experience"], "summary": "", "education": [], "skills": [], "projects": [], "leadership": [], "additional": [],
            "experience": [{"title": "Acme Corp", "date": "2025", "subtitle": "Intern", "lines": [], "bullets": [
                {"text": "Wrote SQL queries.", "source": "acme.1"}, {"text": "Invented claim.", "source": "nope.9"}, {"text": "No source.", "source": ""}]}],
            "keywordsUsed": ["SQL"], "keywordsSkipped": [], "changes": [], "questions": []}


LETTER = {"recipientLines": ["Hiring Manager", "Acme"], "reLine": "Re: Data Intern", "salutation": "Dear Hiring Manager,",
          "paragraphs": [{"text": "Intro.", "source": ""}, {"text": "SQL work.", "source": "acme.1"}, {"text": "Made up.", "source": "x.9"}, {"text": "Thanks.", "source": ""}],
          "closing": "Sincerely,", "keywordsUsed": ["SQL"], "notes": [], "questions": []}


class StudioTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        server.configure(self.tmp)
        ai.set_config({"fallback": True})  # opted in: Pro tasks may use the (stubbed) API
        self.calls = []
        # Never reach a real Claude Code install on the machine running the tests: Claude Pro looks absent here,
        # so Pro tasks fall back to the stubbed API. ClaudeProTest covers the Pro path with a fake binary.
        self._cc = ai.claude_code
        ai.claude_code = lambda refresh=False: {"found": False, "path": "", "version": "", "loggedIn": False, "method": "", "subscription": False}
        self._call, self._text = ai.call_api, fetcher.posting_text

        def fake(body, key, timeout=180):
            self.calls.append(body)
            props = body["output_config"]["format"]["schema"]["properties"]
            out = (ANALYSIS if "audience" in props else TAILORED if "sectionOrder" in props else LETTER if "salutation" in props
                   else {"options": [{"text": "x", "keywordsUsed": []}] * 3})
            return {"content": [{"type": "text", "text": json.dumps(out)}], "stop_reason": "end_turn",
                    "usage": {"input_tokens": 1000, "output_tokens": 500, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}}
        ai.call_api = fake
        fetcher.posting_text = lambda url: "We build data tools. " * 40 + "We are an equal opportunity employer without regard to race, color or religion. CPT and OPT students welcome."
        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        ai.call_api, fetcher.posting_text = self._call, self._text
        ai.claude_code = self._cc
        os.environ.pop("ANTHROPIC_API_KEY", None)
        self.httpd.shutdown()
        self.httpd.server_close()
        shutil.rmtree(self.tmp)

    def req(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.base + path, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(r) as res:
                return res.status, res.headers, res.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def j(self, *a, **k):
        code, _, raw = self.req(*a, **k)
        return code, json.loads(raw or b"null")

    def job(self, **extra):
        return dict({"key": "https://jobs.example.com/1", "company": "Acme", "role": "Data Intern", "url": "https://jobs.example.com/1"}, **extra)

    def test_profile_is_revision_checked(self):
        self.assertEqual(self.j("GET", "/api/profile"), (200, None))
        code, r = self.j("PUT", "/api/profile", {"profile": PROFILE, "baseRev": 0})
        self.assertEqual((code, r["rev"]), (200, 1))
        code, r = self.j("PUT", "/api/profile", {"profile": PROFILE, "baseRev": 0})
        self.assertEqual(code, 409)
        self.assertEqual(r["profile"]["rev"], 1)
        self.assertEqual(self.j("GET", "/api/profile")[1]["basics"]["name"], "Test Person")

    def test_key_is_stored_privately_and_never_returned(self):
        self.assertEqual(self.j("POST", "/api/ai/key", {"key": "not-a-key"})[0], 400)
        code, st = self.j("POST", "/api/ai/key", {"key": KEY})
        self.assertEqual((code, st["configured"], st["keyEnds"]), (200, True, "aaaa"))
        path = os.path.join(self.tmp, "secrets.json")
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        _, _, raw = self.req("GET", "/api/ai/status")
        self.assertNotIn(KEY.encode(), raw)
        self.assertEqual(self.j("POST", "/api/ai/key", {"key": ""})[1]["configured"], False)

    def test_cross_origin_is_refused(self):
        self.assertEqual(self.req("POST", "/api/ai/key", {"key": KEY}, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.req("PUT", "/api/profile", {"profile": PROFILE}, {"Origin": "https://evil.example"})[0], 403)

    def test_analysis_needs_a_key_then_runs_once_and_is_cached(self):
        self.assertEqual(self.j("POST", "/api/ai/analyze", self.job())[0], 412)
        self.req("POST", "/api/ai/key", {"key": KEY})
        code, r = self.j("POST", "/api/ai/analyze", self.job())
        self.assertEqual(code, 200)
        self.assertEqual(r["job"]["analysis"]["sponsorship"]["status"], "cpt_opt_ok")
        self.assertAlmostEqual(r["usage"]["cost"], (1000 * 0.10 + 500 * 0.50) / 1e6)
        sent = self.calls[0]["messages"][0]["content"]
        self.assertIn("CPT and OPT", sent)              # sponsorship wording kept
        self.assertNotIn("without regard to race", sent)  # EEO boilerplate trimmed
        self.assertEqual(self.calls[0]["model"], "claude-haiku-5-5")
        code, d = self.j("GET", "/api/job?key=" + urllib.request.quote(self.job()["key"], safe=""))
        self.assertEqual(d["job"]["analysis"]["summary"], "s")  # cached: reading it again makes no call
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.j("GET", "/api/ai/status")[1]["usage"]["byTask"]["analyze"]["calls"], 1)

    def test_budget_blocks_calls(self):
        self.req("POST", "/api/ai/key", {"key": KEY})
        # The budget is checked before the call against its worst case (full output limit), not after it.
        self.j("POST", "/api/ai/config", {"monthlyBudget": 0.0001})
        code, r = self.j("POST", "/api/ai/analyze", self.job())
        self.assertEqual(code, 402)
        self.assertIn("budget", r["error"])
        self.assertEqual(self.calls, [])  # nothing was sent
        self.j("POST", "/api/ai/config", {"monthlyBudget": 1})
        self.assertEqual(self.j("POST", "/api/ai/analyze", self.job())[0], 200)

    def test_tailor_sends_only_confirmed_facts_and_flags_unsourced_bullets(self):
        self.req("POST", "/api/ai/key", {"key": KEY})
        self.req("PUT", "/api/profile", {"profile": PROFILE, "baseRev": 0})
        self.assertEqual(self.j("POST", "/api/ai/tailor", self.job(track="DA"))[0], 409)  # analyze first
        self.j("POST", "/api/ai/analyze", self.job())
        code, r = self.j("POST", "/api/ai/tailor", self.job(track="DA"))
        self.assertEqual(code, 200)
        body = self.calls[-1]
        system = " ".join(b["text"] for b in body["system"])
        self.assertIn("acme.1", system)
        self.assertNotIn("SECRET UNCONFIRMED CLAIM", system)
        self.assertNotIn("HIDDEN ENTRY POINT", system)
        self.assertIn("Power BI", system)  # listed under DO NOT CLAIM
        self.assertIn("CANDIDATE PROFILE", body["system"][0]["text"])  # profile first, so letters and resumes share the cached prefix
        self.assertEqual(body["system"][0].get("cache_control"), {"type": "ephemeral"})
        flags = [b["unverified"] for b in r["result"]["experience"][0]["bullets"]]
        self.assertEqual(flags, [False, True, True])

    def test_a_cut_off_analysis_is_retried_with_a_larger_limit_and_saved(self):
        self.req("POST", "/api/ai/key", {"key": KEY})
        sent, real = [], ai.call_api

        def cut_once(body, key, timeout=180):
            sent.append(body["max_tokens"])
            if len(sent) == 1:  # a long posting: the first answer stops at the output limit
                return {"content": [{"type": "text", "text": '{"summary": "half an obj'}], "stop_reason": "max_tokens", "usage": {"input_tokens": 9000, "output_tokens": body["max_tokens"]}}
            return real(body, key, timeout)
        ai.call_api = cut_once
        try:
            code, r = self.j("POST", "/api/ai/analyze", self.job())
        finally:
            ai.call_api = real
        self.assertEqual(code, 200)
        self.assertEqual(sent, [ai.MAX_TOKENS["analyze"], ai.MAX_TOKENS["analyze"] * 2])
        self.assertTrue(self.j("GET", "/api/job?key=" + urllib.parse.quote(self.job()["key"]))[1]["job"]["analysis"])

    def test_an_analysis_cut_off_twice_says_so_and_saves_nothing(self):
        self.req("POST", "/api/ai/key", {"key": KEY})
        real = ai.call_api
        ai.call_api = lambda body, key, timeout=180: {"content": [{"type": "text", "text": "{"}], "stop_reason": "max_tokens", "usage": {"input_tokens": 9000, "output_tokens": body["max_tokens"]}}
        try:
            code, r = self.j("POST", "/api/ai/analyze", self.job())
        finally:
            ai.call_api = real
        self.assertEqual(code, 502)
        self.assertIn("cut off", r["error"])
        self.assertFalse((self.j("GET", "/api/job?key=" + urllib.parse.quote(self.job()["key"]))[1]["job"] or {}).get("analysis"))

    def test_contact_details_are_never_sent_to_claude(self):
        contact = {"name": "Test Person", "email": "private.person@example.edu", "phone": "+1 555 010 0199",
                   "linkedin": "linkedin.com/in/private-person-x", "github": "github.com/private-person-x", "website": "private-person.example", "location": "Houston, TX"}
        self.req("POST", "/api/ai/key", {"key": KEY})
        self.req("PUT", "/api/profile", {"profile": dict(PROFILE, basics=contact), "baseRev": 0})
        self.j("POST", "/api/ai/analyze", self.job())
        self.assertEqual(self.j("POST", "/api/ai/tailor", self.job(track="DA"))[0], 200)
        sent = json.dumps(self.calls)
        for k in ("email", "phone", "linkedin", "github", "website"):
            self.assertNotIn(contact[k], sent, k)
        self.assertNotIn("HIDDEN ENTRY POINT", sent)

    def test_tailor_follows_the_activities_choice_and_one_page_budget(self):
        self.req("POST", "/api/ai/key", {"key": KEY})
        self.j("POST", "/api/ai/analyze", self.job())
        for mode, phrase in (("never", "Do not include Leadership"), ("auto", "optional for a technical internship"), (None, "optional for a technical internship")):
            prof = dict(PROFILE, resumeActivities=mode) if mode else dict(PROFILE)
            rev = (self.j("GET", "/api/profile")[1] or {}).get("rev", 0)
            self.req("PUT", "/api/profile", {"profile": prof, "baseRev": rev})
            self.assertEqual(self.j("POST", "/api/ai/tailor", self.job(track="SWE"))[0], 200)
            system = " ".join(b["text"] for b in self.calls[-1]["system"])
            self.assertIn(phrase, system)
            self.assertIn("fill one page", system)

    def test_revise_applies_one_request_to_the_draft(self):
        self.req("POST", "/api/ai/key", {"key": KEY})
        self.req("PUT", "/api/profile", {"profile": PROFILE, "baseRev": 0})
        self.j("POST", "/api/ai/analyze", self.job())
        self.assertEqual(self.j("POST", "/api/ai/tailor", self.job(track="SWE", revise=True, baseline="DRAFT"))[0], 422)  # no request
        code, _ = self.j("POST", "/api/ai/tailor", self.job(track="SWE", revise=True, baseline="MY DRAFT LINE", instructions="Put SQL first"))
        self.assertEqual(code, 200)
        body = self.calls[-1]
        user = body["messages"][0]["content"] if isinstance(body["messages"][0]["content"], str) else " ".join(c.get("text", "") for c in body["messages"][0]["content"])
        self.assertIn("REVISION REQUEST from the candidate (apply it to the CURRENT DRAFT): Put SQL first", user)
        self.assertIn("keep every other section", user)
        self.assertIn("MY DRAFT LINE", user)
        system = " ".join(b["text"] for b in body["system"])
        self.assertNotIn("SECRET UNCONFIRMED CLAIM", system)  # the truth rules and profile filter still apply

    def test_track_base_resume_is_tailored_saved_and_kept_out_of_job_documents(self):
        self.req("POST", "/api/ai/key", {"key": KEY})
        self.req("PUT", "/api/profile", {"profile": PROFILE, "baseRev": 0})
        self.assertEqual(self.j("POST", "/api/ai/base", {"track": "XX"})[0], 400)
        code, r = self.j("POST", "/api/ai/base", {"track": "DE", "baseline": "PROFILE ORDER DRAFT"})
        self.assertEqual(code, 200)
        body = self.calls[-1]
        user = body["messages"][0]["content"] if isinstance(body["messages"][0]["content"], str) else " ".join(c.get("text", "") for c in body["messages"][0]["content"])
        self.assertIn("BASE resume for Data Engineer internship applications", user)
        self.assertIn("ETL/ELT pipelines", user)  # the track brief
        self.assertIn("PROFILE ORDER DRAFT", user)
        self.assertNotIn("SECRET UNCONFIRMED CLAIM", " ".join(b["text"] for b in body["system"]))
        code, saved = self.j("PUT", "/api/base", {"track": "DE", "resume": {"v": 1, "sections": []}, "label": "Claude", "by": "ai", "notes": {"model": "m"}})
        self.assertEqual(code, 200)
        self.assertTrue(saved["resume"]["state"]["generated"])
        bases = self.j("GET", "/api/bases")[1]["bases"]
        self.assertTrue(bases["DE"]["current"] is not None)
        self.assertIsNone(bases["SWE"])
        self.assertEqual(ai.studio_docs(), [])  # never listed as a job document
        self.assertEqual(self.j("PUT", "/api/base", {"track": "DE", "resume": {"v": 1, "sections": []}, "baseUpdatedAt": "old"})[0], 409)

    def test_tailor_sends_the_current_draft_and_the_selection_rules(self):
        self.req("POST", "/api/ai/key", {"key": KEY})
        self.req("PUT", "/api/profile", {"profile": PROFILE, "baseRev": 0})
        self.j("POST", "/api/ai/analyze", self.job())
        self.assertEqual(self.j("POST", "/api/ai/tailor", self.job(track="SWE", baseline="MY APPROVED DRAFT LINE"))[0], 200)
        body = self.calls[-1]
        system = " ".join(b["text"] for b in body["system"])
        user = body["messages"][0]["content"] if isinstance(body["messages"][0]["content"], str) else " ".join(c.get("text", "") for c in body["messages"][0]["content"])
        self.assertIn("MY APPROVED DRAFT LINE", user)
        self.assertIn("not a whitelist", system)
        self.assertIn("90-100% full", system)
        self.assertIn("PROFESSIONAL EXPERIENCE", system)
        self.assertIn("always keep a GPA", system)

    def test_versions_keep_their_notes_and_index_sees_a_restored_tailored_draft(self):
        k = self.job()["key"]
        notes = {"model": "Sonnet 5.5", "changes": ["Led with Acme"]}
        self.j("PUT", "/api/resume", self.job(resume={"header": {}, "sections": [1]}, label="Claude · Sonnet 5.5", by="ai", notes=notes))
        self.j("PUT", "/api/resume", self.job(resume={"header": {}, "sections": [2]}, label="Saved by you", by="you", notes={}))
        doc = self.j("GET", "/api/job?key=" + k)[1]["resume"]
        self.assertEqual(doc["versions"][0]["notes"], notes)
        self.assertNotIn("notes", doc["versions"][1])
        self.assertEqual(self.j("GET", "/api/studio/index")[1][k]["resume"], "base")
        self.j("PUT", "/api/resume", self.job(resume={"header": {}, "sections": [1]}))  # restored the Claude version without its notes
        self.assertEqual(self.j("GET", "/api/studio/index")[1][k]["resume"], "ai")

    def test_documents_list_every_draft_newest_first(self):
        self.assertEqual(self.j("GET", "/api/studio/docs")[1], [])
        a, b = self.job(), dict(self.job(), key="https://example.com/job/2", company="Beta", role="Data Intern")
        self.j("PUT", "/api/resume", dict(a, resume={"header": {}, "sections": [1]}, label="Claude · Sonnet", by="ai", notes={"model": "Sonnet"}))
        self.j("PUT", "/api/resume", dict(b, resume={"header": {}, "sections": [2]}, label="Master resume", by="base"))
        self.j("PUT", "/api/letter", dict(b, resume={"kind": "letter", "paragraphs": []}, label="Template", by="base"))
        # "Exported" means this exact content was exported: recorded by the export itself, not by a version label.
        self.req("POST", "/api/export", {"resume": {"kind": "letter", "paragraphs": []}, "format": "docx", "filename": "L", "key": b["key"], "kind": "letter"})
        rows = self.j("GET", "/api/studio/docs")[1]
        self.assertEqual([r["company"] for r in rows], ["Beta", a["company"]])
        self.assertTrue(rows[1]["resume"]["tailored"])
        self.assertFalse(rows[0]["resume"]["tailored"])
        self.assertTrue(rows[0]["letter"]["exportedAt"])
        self.assertEqual(rows[0]["resume"]["current"], {"header": {}, "sections": [2]})

    def test_now_and_in_the_future_wording_is_never_not_stated(self):
        for text in ("Legally authorized to work in the United States now and in the future.", "Candidates must not require visa sponsorship now or in the future."):
            a = {"sponsorship": {"status": "not_stated", "evidence": "", "note": ""}}
            ai.check_sponsorship(a, "Great team. " + text + " Apply today.")
            self.assertEqual(a["sponsorship"]["status"], "no_sponsorship")
            self.assertTrue(a["sponsorship"]["evidence"])
        a = {"sponsorship": {"status": "sponsors", "evidence": "We sponsor H-1B", "note": ""}}
        self.assertEqual(ai.check_sponsorship(a, "authorized to work in the United States now and in the future")["sponsorship"]["status"], "sponsors")
        a = {"sponsorship": {"status": "not_stated", "evidence": "", "note": ""}}
        self.assertEqual(ai.check_sponsorship(a, "Open to all students. CPT welcome.")["sponsorship"]["status"], "not_stated")

    def test_cover_letter_uses_style_samples_but_only_profile_facts(self):
        self.req("POST", "/api/ai/key", {"key": KEY})
        prof = dict(PROFILE, coverLetter={"samples": ["MY OLD LETTER STYLE SAMPLE"], "availability": "May 2027"})
        self.req("PUT", "/api/profile", {"profile": prof, "baseRev": 0})
        self.assertEqual(self.j("POST", "/api/ai/cover", self.job())[0], 409)  # analyze first
        self.j("POST", "/api/ai/analyze", self.job())
        code, r = self.j("POST", "/api/ai/cover", self.job(track="DA", why="I use Acme every day", resumeText="RESUME TEXT HERE"))
        self.assertEqual(code, 200)
        body = self.calls[-1]
        system = " ".join(b["text"] for b in body["system"])
        self.assertIn("MY OLD LETTER STYLE SAMPLE", system)
        self.assertIn("style only", system)
        self.assertNotIn("SECRET UNCONFIRMED CLAIM", system)
        user = body["messages"][0]["content"]
        self.assertIn("I use Acme every day", user)
        self.assertIn("RESUME TEXT HERE", user)
        self.assertIn("May 2027", user)  # default availability from the profile
        self.assertEqual(body["model"], "claude-sonnet-5-5")
        self.assertEqual([p["unverified"] for p in r["result"]["paragraphs"]], [False, False, True, False])
        self.assertEqual(self.j("GET", "/api/ai/status")[1]["usage"]["byTask"]["cover"]["calls"], 1)

    def test_letter_versions_and_export(self):
        letter = {"kind": "letter", "header": {"name": "Test Person", "contact": "Houston, TX"}, "date": "October 29, 2026", "recipient": ["Hiring Manager", "Acme"],
                  "re": "Re: Data Intern", "salutation": "Dear Hiring Manager,", "paragraphs": ["First paragraph.", "Second paragraph."], "closing": "Sincerely,", "signature": "Test Person"}
        code, r = self.j("PUT", "/api/letter", self.job(resume=letter, label="Draft", by="you"))
        self.assertEqual((code, len(r["resume"]["versions"])), (200, 1))
        d = self.j("GET", "/api/job?key=" + urllib.request.quote(self.job()["key"], safe=""))[1]
        self.assertEqual(d["letter"]["current"]["salutation"], "Dear Hiring Manager,")
        self.assertIsNone(d["resume"])  # letters and resumes are stored separately
        code, h, raw = self.req("POST", "/api/export", {"resume": letter, "format": "docx", "filename": "Test_Cover_Letter_Acme"})
        doc = zipfile.ZipFile(io.BytesIO(raw)).read("word/document.xml").decode()
        self.assertIn("Dear Hiring Manager,", doc)
        self.assertIn("Second paragraph.", doc)
        code, h, raw = self.req("POST", "/api/export", {"resume": letter, "format": "pdf", "filename": "Test_Cover_Letter_Acme"})
        self.assertEqual(raw[:5], b"%PDF-")
        self.assertIn(b"Cover Letter", raw)

    def test_studio_index_summarizes_progress_per_job(self):
        self.assertEqual(self.j("GET", "/api/studio/index")[1], {})
        k = self.job()["key"]
        self.j("PUT", "/api/resume", self.job(resume={"header": {}, "sections": []}, label="Master resume", by="base"))
        idx = self.j("GET", "/api/studio/index")[1][k]
        self.assertEqual((idx["resume"], idx["resumeExported"]), ("base", False))
        self.j("PUT", "/api/resume", self.job(resume={"header": {}, "sections": []}, label="Claude · Sonnet", by="ai"))
        self.req("POST", "/api/export", {"resume": {"header": {}, "sections": []}, "format": "docx", "filename": "R", "key": k, "kind": "resume"})
        self.j("PUT", "/api/letter", self.job(resume={"kind": "letter", "paragraphs": []}, label="Template", by="base"))
        idx = self.j("GET", "/api/studio/index")[1][k]
        self.assertEqual((idx["resume"], idx["resumeExported"], idx["letter"]), ("ai", True, "base"))
        # Editing after the export: the current content is no longer the exported one.
        self.j("PUT", "/api/resume", self.job(resume={"header": {"name": "edited"}, "sections": []}))
        idx = self.j("GET", "/api/studio/index")[1][k]
        self.assertEqual((idx["resumeExported"], idx["resumeExportedBefore"]), (False, True))

    def test_resume_versions_and_exports(self):
        model = {"font": "sans", "size": 10.5, "header": {"name": "Test Person", "contact": "Houston, TX"},
                 "sections": [{"kind": "entries", "title": "Experience", "entries": [{"title": "Acme Corp", "date": "2025", "subtitle": "Intern", "bullets": [{"text": "Wrote SQL – fast"}]}]}]}
        code, r = self.j("PUT", "/api/resume", self.job(resume=model, label="Mine", by="you"))
        self.assertEqual((code, len(r["resume"]["versions"])), (200, 1))
        self.j("PUT", "/api/resume", self.job(resume=model))  # autosave: no new version
        self.assertEqual(len(self.j("GET", "/api/job?key=" + urllib.request.quote(self.job()["key"], safe=""))[1]["resume"]["versions"]), 1)
        code, f = self.j("POST", "/api/resume/fit", {"resume": model})
        self.assertEqual((code, f["pages"], f["size"]), (200, 1, 10.5))
        self.assertTrue(any(o[0] == "t" and o[3] == "Acme" for o in f["render"][0]))
        code, h, raw = self.req("POST", "/api/export", {"resume": model, "format": "docx", "filename": "Test_Resume_Acme"})
        self.assertEqual(code, 200)
        self.assertIn("Test_Resume_Acme.docx", h["Content-Disposition"])
        doc = zipfile.ZipFile(io.BytesIO(raw)).read("word/document.xml").decode()
        self.assertIn("Wrote SQL – fast", doc)
        self.assertIn("Arial", doc)
        code, h, raw = self.req("POST", "/api/export", {"resume": model, "format": "pdf", "filename": "../../etc/x"})
        self.assertEqual((code, raw[:5]), (200, b"%PDF-"))
        saved = os.listdir(os.path.join(self.tmp, "exports"))
        self.assertTrue(any(n.startswith("etc_x__") and n.endswith(".pdf") for n in saved), saved)  # file name is sanitized
        self.assertIn('filename="etc_x.pdf"', h["Content-Disposition"])

    def test_fit_shrinks_long_resumes_to_one_page(self):
        bullets = [{"text": "Built and tested a data pipeline that loads and validates records every day for the analytics team, with checks and alerts that catch bad rows before they reach the dashboards."}] * 28
        model = {"header": {"name": "A"}, "sections": [{"kind": "entries", "title": "Experience", "entries": [{"title": "X", "bullets": bullets}]}]}
        size, tight, pages, fill = resume_export.fit(model)
        self.assertEqual(pages, 1)
        self.assertLess(size, 10.5)
        self.assertGreaterEqual(size, 10.0)  # never below the Rice guide's 10 pt minimum
        too_long = {"header": {"name": "A"}, "sections": [{"kind": "entries", "title": "E", "entries": [{"title": "X", "bullets": bullets * 3}]}]}
        self.assertEqual(resume_export.fit(too_long)[0], 10.0)


if __name__ == "__main__":
    unittest.main()


def _w(path, text):
    with open(path, "w") as f:
        f.write(text)


class ClaudeProTest(unittest.TestCase):
    """Claude Pro through a fake `claude` binary: isolation flags, no API key in its environment, fallback to the API."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        server.configure(os.path.join(self.tmp, "data"))
        self.bin = os.path.join(self.tmp, "bin")
        os.makedirs(self.bin)
        self.log = os.path.join(self.tmp, "calls.jsonl")
        self.mode = os.path.join(self.tmp, "mode")
        _w(self.mode, "ok")
        fake = f"""#!{sys.executable}
import json, os, sys
args = sys.argv[1:]
if args[:1] == ["--version"]:
    print("9.9.9 (Claude Code)"); sys.exit(0)
if args[:2] == ["auth", "status"]:
    print("Login method: Claude Pro account"); sys.exit(0)
mode = open({self.mode!r}).read().strip()
prompt = sys.stdin.read()
system = open(args[args.index("--system-prompt-file") + 1]).read()
with open({self.log!r}, "a") as f:
    f.write(json.dumps({{"args": args, "env_has_key": "ANTHROPIC_API_KEY" in os.environ, "cwd": os.getcwd(), "prompt": prompt[:200], "system": system[:4000]}}) + "\\n")
usage = {{"input_tokens": 100, "output_tokens": 50, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}}
if mode == "limit":
    print(json.dumps({{"is_error": True, "result": "Claude usage limit reached. Your limit resets at 7pm.", "usage": usage}})); sys.exit(1)
schema = json.loads(args[args.index("--json-schema") + 1])
out = {json.dumps(TAILORED)} if "sectionOrder" in schema["properties"] else {{"options": [{{"text": "x", "keywordsUsed": []}}]}}
print(json.dumps({{"is_error": False, "structured_output": out, "usage": usage, "result": ""}}))
"""
        p = os.path.join(self.bin, "claude")
        _w(p, fake)
        os.chmod(p, 0o755)
        self._paths, self._call, self._text = ai.CC_PATHS, ai.call_api, fetcher.posting_text
        ai.CC_PATHS = [p]
        self._env_path = os.environ.get("PATH", "")
        os.environ["PATH"] = self.bin + os.pathsep + self._env_path
        os.environ["ANTHROPIC_API_KEY"] = KEY  # must never reach Claude Code
        ai._CC.update(at=0, info=None)
        self.api_calls = []

        def fake_api(body, key, timeout=180):
            self.api_calls.append(body)
            props = body["output_config"]["format"]["schema"]["properties"]
            out = ANALYSIS if "audience" in props else TAILORED
            return {"content": [{"type": "text", "text": json.dumps(out)}], "stop_reason": "end_turn", "usage": {"input_tokens": 10, "output_tokens": 5}}
        ai.call_api = fake_api
        fetcher.posting_text = lambda url: "We build data tools with SQL and Python for analysts. " * 30
        self.meta = {"key": "https://jobs.example.com/9", "company": "Acme", "role": "Data Intern", "url": "https://jobs.example.com/9"}
        ai.analyze(self.meta)  # analysis on the API (default provider)

    def tearDown(self):
        ai.CC_PATHS, ai.call_api, fetcher.posting_text = self._paths, self._call, self._text
        os.environ["PATH"] = self._env_path
        os.environ.pop("ANTHROPIC_API_KEY", None)
        ai._CC.update(at=0, info=None)
        shutil.rmtree(self.tmp)

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log) as f:
            return [json.loads(x) for x in f]

    def test_detects_claude_code_signed_in_with_plan(self):
        info = ai.claude_code(refresh=True)
        self.assertEqual(info["path"], os.path.join(self.bin, "claude"))  # the fake, never a real install
        self.assertEqual((info["found"], info["version"], info["loggedIn"], info["subscription"]), (True, "9.9.9", True, True))

    def test_tailoring_runs_on_pro_isolated_and_without_api_key(self):
        n_api = len(self.api_calls)
        result, row = ai.tailor(self.meta, PROFILE, "DA")
        self.assertEqual(len(self.api_calls), n_api)  # no API call
        self.assertEqual((row["provider"], row["cost"]), ("pro", 0.0))
        self.assertGreater(row["apiEquivalent"], 0)
        c = self.calls()[-1]
        for flag in ("-p", "--safe-mode", "--no-session-persistence", "--json-schema"):
            self.assertIn(flag, c["args"])
        self.assertEqual(c["args"][c["args"].index("--tools") + 1], "")
        self.assertFalse(c["env_has_key"])
        self.assertIn("iat-claude-", c["cwd"])
        self.assertIn("CANDIDATE PROFILE", c["system"])
        self.assertNotIn("SECRET UNCONFIRMED CLAIM", c["system"])
        self.assertEqual([b["unverified"] for b in result["experience"][0]["bullets"]], [False, True, True])
        s = ai.usage_summary()["byTask"]["tailor"]
        self.assertEqual((s["proCalls"], s["cost"]), (1, 0.0))
        self.assertGreater(s["saved"], 0)

    def test_usage_limit_falls_back_to_api_or_reports_it(self):
        _w(self.mode, "limit")
        self.assertFalse(ai.config()["fallback"])  # off by default: falling back bills the API
        with self.assertRaises(ai.AIError):
            ai.tailor(self.meta, PROFILE, "DA")
        ai.set_config({"fallback": True})
        result, row = ai.tailor(self.meta, PROFILE, "DA")
        self.assertEqual(row.get("provider", "api"), "api")
        self.assertIn("usage limit", row["fellBack"])
        ai.set_config({"fallback": False})
        with self.assertRaises(ai.AIError) as e:
            ai.tailor(self.meta, PROFILE, "DA")
        self.assertEqual(e.exception.code, 429)

    def test_daily_change_check_flags_changed_and_closed_postings(self):
        ai.check_changes(fetch=lambda url: "We build data tools with SQL and Python for analysts. " * 30)
        rec = ai.load_job(self.meta["key"])
        self.assertNotIn("changedAt", rec)
        self.assertEqual(rec["checkedAt"], __import__("datetime").date.today().isoformat())
        os.remove(os.path.join(ai.DATA, "ai", "changes.json"))
        rec["checkedAt"] = ""
        ai.save_job(self.meta["key"], rec)
        ai.check_changes(fetch=lambda url: "Now hiring for Power BI dashboards, Snowflake and dbt pipelines with Looker. " * 30)
        rec = ai.load_job(self.meta["key"])
        self.assertIn("changedAt", rec)
        self.assertIn("snowflake", rec["changeSummary"])
        rec2, _ = ai.analyze(self.meta, refetch=True)  # re-analysis uses the text read by the check and clears the flag
        self.assertIn("Power BI", rec2["text"])
        self.assertNotIn("changedAt", rec2)

    def test_h1b_import_updates_listings(self):
        server._write(server.LISTINGS, {"lrev": 1, "listings": [{"id": "a", "company": "Acme 3, Inc.", "role": "x"}], "fetch": {"h1b": "FY2023"}})
        rows = ["Fiscal Year,Employer (Petitioner) Name,New Employment Approval,Continuation Approval"] + [f"2026,ACME {i} INC,{i},1" for i in range(80)]
        meta = server.import_h1b("\n".join(rows).encode(), "Employer Information.csv")
        self.assertEqual(meta["label"], "FY2026")
        L = server.load_listings()
        self.assertEqual((L["listings"][0]["h1b"], L["fetch"]["h1b"], L["lrev"]), (4, "FY2026", 2))
        self.assertEqual(ai.status()["h1b"]["label"], "FY2026")

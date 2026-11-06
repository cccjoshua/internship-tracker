"""Resume layout rules: organization/location and title/dates lines, bullets for details and skills, bold keywords."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import resume_export as rx  # noqa: E402

MODEL = {"header": {"name": "Sam Lee", "contact": "Austin, TX | sam@example.com"}, "bold": ["SQL", "Python", "Tableau"],
         "sections": [
             {"kind": "entries", "key": "education", "title": "Education", "entries": [
                 {"title": "State University", "loc": "Austin, TX", "date": "Expected May 2028", "subtitle": "MS in Computer Science",
                  "lines": ["GPA: 3.80/4.00", "Relevant Coursework: Databases"]}]},
             {"kind": "skills", "title": "Technical Skills", "lines": [{"label": "Languages", "value": "Python, SQL"}]},
             {"kind": "entries", "key": "experience", "title": "Professional Experience", "entries": [
                 {"title": "Example Co.", "loc": "Dallas, TX", "date": "Jun 2025 – Aug 2025", "subtitle": "Data Intern",
                  "bullets": [{"text": "Built Python and SQL jobs feeding Tableau dashboards for 3 teams"}]}]},
             {"kind": "entries", "key": "projects", "title": "Projects", "entries": [
                 {"title": "Tracker", "date": "Oct 2026 – Present", "subtitle": "Personal project", "bullets": [{"text": "Wrote a scraper"}]}]}]}


class LayoutTest(unittest.TestCase):
    def test_entry_lines(self):
        b = rx.blocks(MODEL)
        self.assertIn(("entry", "State University", "Austin, TX"), b)
        self.assertIn(("sub", "MS in Computer Science", "Expected May 2028"), b)
        self.assertIn(("entry", "Tracker", "Oct 2026 – Present"), b)  # no location: the date sits on the first line
        self.assertIn(("bullet", "GPA: 3.80/4.00"), b)                # education details are bullets
        self.assertTrue(any(x[0] == "skill" for x in b))

    def test_bold_at_most_two_terms_by_priority(self):
        segs = rx.bold_segments("Built Python and SQL jobs feeding Tableau dashboards", ["Tableau", "SQL", "Python"])
        self.assertEqual([t for t, bo in segs if bo], ["SQL", "Tableau"])
        self.assertEqual(rx.bold_segments("Used C++ daily", ["C++"])[1], ("C++", True))
        self.assertEqual(rx.bold_segments("ascii only", []), [("ascii only", False)])

    def test_bold_can_be_turned_off_and_exports_stay_one_page(self):
        off = dict(MODEL, boldKeywords=False)
        bullet = [x for x in rx.blocks(off) if x[0] == "bullet" and x[1].startswith("Built")][0]
        self.assertFalse(any(bo for _, bo in bullet[2]))
        size, tight, pages, fill = rx.fit(MODEL)
        self.assertEqual(pages, 1)
        self.assertTrue(rx.to_docx(MODEL).startswith(b"PK"))
        self.assertTrue(rx.to_pdf(MODEL).startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()


class PreviewAndSubmittedTest(unittest.TestCase):
    def test_render_marks_each_bullet(self):
        m = {"header": {"name": "A"}, "sections": [{"kind": "entries", "key": "experience", "title": "E", "entries": [
            {"title": "X", "bullets": [{"id": "b1", "text": "Built " * 40}, {"id": "b2", "text": "Wrote code"}, {"id": "b3", "text": "Hidden", "hidden": True}]}]}]}
        marks = rx.render(m)["marks"][0]
        self.assertEqual([x[2] for x in marks], ["b1", "b2"])
        self.assertGreater(marks[0][1] - marks[0][0], marks[1][1] - marks[1][0])  # the long bullet wraps

    def test_submitted_version_is_frozen_and_never_trimmed(self):
        import tempfile
        import ai
        with tempfile.TemporaryDirectory() as d:
            ai.configure(d)
            meta = {"key": "https://example.com/job/1", "company": "Example", "role": "Intern"}
            ai.save_resume(meta, {"sections": [], "header": {"name": "v1"}}, "first", "you")
            ids = ai.mark_submitted(meta)
            self.assertIn("resume", ids)
            for i in range(30):
                ai.save_resume(meta, {"sections": [], "header": {"name": f"v{i + 2}"}}, f"edit {i}", "you")
            doc = ai.load_resume(meta["key"])
            self.assertEqual(len(doc["versions"]), 25)
            sub = [v for v in doc["versions"] if v.get("submitted")]
            self.assertEqual(len(sub), 1)
            self.assertEqual(sub[0]["resume"]["header"]["name"], "v1")
            self.assertTrue(doc["state"]["editedSinceSubmit"])
            self.assertEqual(ai.mark_submitted({"key": "https://example.com/none", "company": "", "role": ""}), {})

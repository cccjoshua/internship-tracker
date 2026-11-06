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

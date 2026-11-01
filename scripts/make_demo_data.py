#!/usr/bin/env python3
"""Create a demo data folder with synthetic, fictional data only (no real people, companies or postings).

    python3 scripts/make_demo_data.py demo-data          # creates ./demo-data
    python3 server.py --data demo-data --no-fetch --port 8766

The demo never needs an API key: listings are included, two jobs come with a stored (synthetic) analysis, and the
background refresh is off with --no-fetch. Every company, school, person, email and link below is invented; links use
the reserved example.com / example.org domains.
"""
import datetime as dt
import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


def iso(days=0):
    return (dt.date.today() + dt.timedelta(days=days)).isoformat()


def job_hash(key):  # same as ai.job_hash
    return hashlib.sha1((key or "").encode("utf-8")).hexdigest()[:16]


def url_key(u):  # same as fetcher.url_key / urlKey() in the page
    return u.strip().lower().rstrip("/")


def listing(i, company, role, track, locs, days_ago, skills, h1b=None, degrees=("Bachelor's", "Master's"), friendly=False,
            no_sponsor=False, deadline=""):
    return {"id": f"sx-demo{i}", "sid": f"demo{i}", "source": "simplify", "company": company, "role": role, "category": "",
            "track": track, "locations": list(locs), "location": "; ".join(locs), "altUrls": [],
            "url": f"https://jobs.example.com/{company.lower().replace(' ', '-').replace('&', 'and')}/{1000 + i}",
            "posted": iso(-days_ago), "term": "Summer 2027", "degrees": list(degrees),
            "degree": "/".join(d.replace("'s", "") for d in degrees), "h1b": h1b, "friendly": friendly,
            "noSponsor": no_sponsor, "optExcluded": False, "textRead": True, "skillsFound": list(skills), "deadline": deadline}


LISTINGS = [
    listing(1, "Bayou Grid Energy", "Data Analytics Intern", "DA", ["Houston, TX"], 1, ["SQL", "Python", "Tableau"], 140, friendly=True, deadline=iso(9)),
    listing(2, "Lattice Freight", "Data Engineer Intern", "DE", ["Remote in USA"], 2, ["Python", "SQL", "Airflow", "AWS"], 35),
    listing(3, "Quarry Health", "Data Science Intern (MS)", "DS", ["Austin, TX"], 3, ["Python", "Machine learning", "Statistics"], 410, degrees=("Master's",)),
    listing(4, "Harbor & Pine Retail", "Business Intelligence Intern", "BIE", ["Seattle, WA"], 5, ["SQL", "Power BI", "Excel"], 8),
    listing(5, "Northwind Robotics", "Software Engineer Intern", "SWE", ["Pittsburgh, PA", "Remote in USA"], 4, ["C/C++", "Python", "Linux"], 60),
    listing(6, "Cobalt Payments", "Data Analyst Intern", "DA", ["Dallas, TX"], 6, ["SQL", "Excel", "Tableau"], 0, no_sponsor=True),
    listing(7, "Fieldnote Labs", "Machine Learning Intern", "DS", ["San Francisco, CA"], 8, ["Python", "PyTorch", "Deep learning"], None, degrees=("Master's", "PhD")),
    listing(8, "Pelican Logistics", "Business Intelligence Engineer Intern", "BIE", ["Seattle, WA"], 2, ["SQL", "Data modeling", "Python"], 2200),
    listing(9, "Mesa Verde Software", "Backend Software Engineer Intern", "SWE", ["Austin, TX"], 1, ["Java", "SQL", "Docker", "Kubernetes"], 75),
    listing(10, "Tidewater Analytics", "Analytics Engineer Intern", "DE", ["Remote in USA"], 9, ["SQL", "dbt", "Snowflake"], 12),
]

PROFILE = {
    "basics": {"name": "Alex Rivera", "email": "alex.rivera@example.edu", "phone": "(555) 010-0199", "location": "Houston, TX",
               "linkedin": "linkedin.com/in/alex-rivera-demo", "github": "github.com/alex-rivera-demo", "website": ""},
    "preferences": {"headline": "MS Computer Science student focused on data engineering and analytics", "jobTypes": ["Internship"],
                    "terms": "Summer 2027", "regions": ["United States"], "workMode": "any", "graduation": "2028-05",
                    "degreePursuing": "Master", "degreesHeld": ["Bachelor"], "yearsExperience": 0.25,
                    "needsSponsorship": True, "cptOpt": True, "usCitizen": False, "availability": "May–August 2027",
                    "authStatement": "Authorized to work in the U.S. on F-1 CPT for this internship; will need sponsorship later."},
    "education": [
        {"id": "edu1", "org": "Gulf Coast University", "location": "Houston, TX", "degree": "Master of Computer Science", "start": "Aug 2026",
         "end": "Expected May 2028", "gpa": "3.8/4.0", "coursework": "Database Systems, Probabilistic Algorithms, Data Science Tools", "points": []},
        {"id": "edu2", "org": "Lakeside Institute of Technology", "location": "Taipei, Taiwan", "degree": "B.E. Computer Science", "start": "Sep 2021",
         "end": "Jun 2025", "points": []}],
    "experience": [
        {"id": "dw", "org": "Northbeam Data Co.", "location": "Taipei, Taiwan", "title": "Software Engineering Intern", "team": "Custom Development",
         "start": "Feb 2025", "end": "Apr 2025", "tech": "JavaScript, C#, SQL Server", "bestFor": ["SWE", "DE"],
         "points": [
             {"id": "dw.1", "kind": "bullet", "text": "Built SQL Server stored procedures for an approval workflow used by 3 departments"},
             {"id": "dw.2", "kind": "bullet", "text": "Fixed 12 reported defects in a C# reporting service with the team lead"},
             {"id": "dw.3", "kind": "fact", "text": "Worked in a team of 5 engineers"},
             {"id": "dw.4", "kind": "fact", "text": "Reduced report runtime by about half", "confirm": True}]}],
    "projects": [
        {"id": "pj1", "name": "Internship Tracker", "context": "Personal project", "start": "Sep 2026", "end": "Present",
         "tech": "Python, JavaScript, SQL", "bestFor": ["SWE", "DE", "DA"],
         "points": [
             {"id": "pj1.1", "kind": "bullet", "text": "Built a local web app that ranks 1,000+ internship listings with a transparent scoring formula"},
             {"id": "pj1.2", "kind": "bullet", "text": "Wrote 90 regression tests covering scoring, merging and document export"}]},
        {"id": "pj2", "name": "Air Quality Clustering", "context": "Course project", "start": "Sep 2026", "end": "Oct 2026",
         "tech": "Python, pandas, scikit-learn, Tableau", "bestFor": ["DS", "DA"],
         "points": [
             {"id": "pj2.1", "kind": "bullet", "text": "Merged public time-series and air-quality datasets and clustered 50 regions with k-means"},
             {"id": "pj2.2", "kind": "bullet", "text": "Presented the clusters in a Tableau dashboard to a class of 40 students"}]}],
    "leadership": [], "certifications": [], "languages": "English (professional), Mandarin (native)", "additional": [],
    "skills": [{"id": "s1", "label": "Languages", "value": "Python, SQL, JavaScript, C#"},
               {"id": "s2", "label": "Data", "value": "pandas, scikit-learn, Tableau, SQL Server"},
               {"id": "s3", "label": "Tools", "value": "Git, Linux"}],
    "notYet": ["Power BI", "Kubernetes"], "resumeRules": [], "openQuestions": [], "resumeFileName": "Alex_Rivera_Resume_[Company]",
    "resumeActivities": "never", "coverLetter": {"samples": [], "availability": "May–August 2027", "signoff": "Sincerely,", "signature": "Alex Rivera", "rules": []},
    "rev": 1, "updatedAt": iso(0) + "T09:00:00",
}


def analysis(degree_levels, grad_from, grad_to, status, evidence, req, pref, keywords, places, mode="onsite"):
    return {"summary": "Synthetic analysis for the demo.", "audience": {"degreeLevels": degree_levels, "enrollment": "", "gradFrom": grad_from,
            "gradTo": grad_to, "gradText": "", "majors": [], "yearsExperience": None, "evidence": "Pursuing a BS or MS in Computer Science or a related field."},
            "timing": {"term": "Summer 2027", "start": "", "end": "", "duration": "12 weeks", "deadline": "", "evidence": ""},
            "location": {"workMode": mode, "places": places, "relocation": ""}, "pay": "$32–$40 per hour",
            "sponsorship": {"status": status, "evidence": evidence, "note": ""}, "requiredSkills": req, "preferredSkills": pref,
            "keywords": [{"term": t, "importance": i, "kind": k} for t, i, k in keywords],
            "responsibilities": ["Build and maintain data pipelines", "Write SQL for dashboards", "Document data models"], "redFlags": []}


JOBS = {
    LISTINGS[0]["url"]: analysis(["Bachelor", "Master"], "", "", "cpt_opt_ok", "Students on CPT or OPT are welcome to apply.",
                                 ["SQL", "Python"], ["Tableau", "Statistics"],
                                 [("SQL", 3, "skill"), ("Python", 3, "skill"), ("Tableau", 2, "tool"), ("Data visualization", 2, "skill"),
                                  ("Statistics", 1, "skill"), ("Stakeholder communication", 1, "soft")], ["Houston, TX"]),
    LISTINGS[5]["url"]: analysis(["Bachelor"], "2026-12", "2027-06", "no_sponsorship",
                                 "Applicants must be authorized to work in the United States now and in the future without sponsorship.",
                                 ["SQL", "Excel"], ["Tableau"], [("SQL", 3, "skill"), ("Excel", 3, "tool"), ("Tableau", 2, "tool")], ["Dallas, TX"]),
}


def apps():
    def app(i, company, role, track, status, hist, **kw):
        a = {"id": f"demo-app-{i}", "company": company, "role": role, "track": track, "status": status, "priority": 2, "sponsor": "unknown",
             "location": kw.pop("location", ""), "url": f"https://careers.example.org/{company.lower().replace(' ', '-')}/{2000 + i}",
             "posted": "", "deadline": kw.pop("deadline", ""), "applied": "", "resume": "", "notes": kw.pop("notes", ""), "nextText": kw.pop("nextText", ""),
             "nextDate": kw.pop("nextDate", ""), "followedUp": "", "snoozeUntil": "", "followLog": [], "rounds": kw.pop("rounds", []), "contacts": [],
             "history": [{"s": s, "d": iso(d)} for s, d in hist]}
        a.update(kw)
        return a
    return [
        app(1, "Saltmarsh Media", "Data Analyst Intern", "DA", "saved", [("saved", -3)], location="Remote (US)", deadline=iso(5)),
        app(2, "Granite Peak Bank", "Software Engineer Intern", "SWE", "applied", [("saved", -14), ("applied", -12)], location="Houston, TX",
            nextText="Follow up with the recruiter", nextDate=iso(1)),
        app(3, "Copperline Telecom", "Data Engineer Intern", "DE", "oa", [("saved", -20), ("applied", -18), ("oa", -4)], location="Plano, TX",
            nextText="Finish the online assessment", nextDate=iso(2)),
        app(4, "Juniper Atlas", "Data Science Intern", "DS", "interview", [("saved", -30), ("applied", -28), ("interview", -2)], location="Austin, TX",
            rounds=[{"id": "r1", "d": iso(3), "t": "10:00", "type": "Technical", "who": "", "notes": ""}]),
        app(5, "Ridgeway Insurance", "Business Intelligence Intern", "BIE", "rejected", [("saved", -40), ("applied", -38), ("rejected", -10)], location="Dallas, TX"),
        app(6, "Sable Creek Games", "Backend Engineer Intern", "SWE", "applied", [("saved", -9), ("applied", -7)], location="Remote (US)"),
    ]


def main(out):
    if os.path.exists(os.path.join(out, "tracker.json")):
        sys.exit(f"{out} already has data; choose an empty folder.")
    os.makedirs(os.path.join(out, "ai", "jobs"), exist_ok=True)
    w = lambda p, o: json.dump(o, open(os.path.join(out, p), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    settings = {"targets": ["SWE", "DE", "DA", "DS", "BIE"], "places": ["TX", "Remote"], "onboarded": True, "dailyGoal": 3, "weeklyGoal": 10,
                "mySkills": ["Python", "SQL", "JavaScript", "C#", "pandas", "scikit-learn", "Tableau", "Git", "Linux", "Data visualization", "ETL", "Databases"]}
    w("tracker.json", {"v": 3, "rev": 1, "apps": apps(), "manualListings": [], "dismissed": [], "dismissLog": [], "settings": settings,
                       "ui": {"q": "", "track": "", "sponsor": "", "stage": "open"}})
    w("listings.json", {"lrev": 1, "listings": LISTINGS, "fetch": {"at": iso(0) + "T08:00:00", "feed": 0, "window": 10, "excluded": {}, "textRead": len(LISTINGS),
                                                                    "h1b": "synthetic demo counts", "error": None, "matched": len(LISTINGS), "new": 3, "demo": True},
                        "closures": [], "liveChecked": {}, "savedDeadlines": {}})
    w("profile.json", PROFILE)
    for url, a in JOBS.items():
        key = url_key(url)
        l = next(x for x in LISTINGS if url_key(x["url"]) == key)
        text = "Synthetic posting text for the demo. " * 20
        rec = {"key": key, "company": l["company"], "role": l["role"], "url": l["url"], "text": text, "rawChars": len(text), "textSource": "pasted",
               "textAt": iso(0), "analysis": a, "analyzedAt": iso(0), "analysisModel": "demo (no API call)", "analysisCost": 0.0,
               "analysisTextHash": hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]}
        w(os.path.join("ai", "jobs", job_hash(key) + ".json"), rec)
    w(os.path.join("ai", "config.json"), {"providers": {"analyze": "api", "tailor": "api", "cover": "api", "rewrite": "api"}, "fallback": False, "monthlyBudget": 1.0})
    print(f"Demo data written to {out}. Start it with:\n  python3 server.py --data {out} --no-fetch --port 8766")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "demo-data")

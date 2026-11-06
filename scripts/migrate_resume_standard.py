"""One-time update of every saved resume to the standard layout and rules (Nov 2026).

For each job resume and track base resume in the data folder:
  - header name from the Profile
  - no "Additional" section; Leadership & Activities hidden when the Profile says "never"
  - Professional Experience directly under Technical Skills
  - "Organization ........ City" / "Title ........ Dates" (the city moves out of the title into "loc")
  - education detail lines one per bullet ("GPA: ...", "Relevant Coursework: ...")
  - no period at the end of a bullet
  - posting keywords found in the resume stored in "bold" (the page refines them with aliases when the job is opened)
The previous version of each resume is kept in its version history.

Usage: python3 scripts/migrate_resume_standard.py [data folder]   (default: ./data)
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import ai  # noqa: E402

DATA = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data"))
ai.configure(DATA)
profile = json.load(open(os.path.join(DATA, "profile.json"), encoding="utf-8"))
NAME = (profile.get("basics") or {}).get("name") or ""
NEVER_ACTIVITIES = (profile.get("resumeActivities") or "auto") == "never"
ENTRIES = [e for k in ("education", "experience", "leadership") for e in profile.get(k) or []]
POINT_ENTRY = {p.get("id"): e for k in ("education", "experience", "projects", "leadership") for e in profile.get(k) or [] for p in e.get("points") or []}


def entry_for(e):
    for b in e.get("bullets") or []:
        for i in str(b.get("src") or "").split(","):
            if i.strip() in POINT_ENTRY:
                return POINT_ENTRY[i.strip()]
    t = (e.get("title") or "").lower()
    for pe in ENTRIES:
        org = (pe.get("org") or "").lower()
        if org and t.startswith(org):
            return pe
    return None


def bold_terms(m, keywords):
    text = json.dumps(m, ensure_ascii=False).lower()
    out = []
    for k in keywords or []:
        if k.get("kind") in ("soft", "credential"):
            continue
        t = str(k.get("term") or "").strip()
        if len(t) >= 2 and re.search(r"(?<![a-z0-9])" + re.escape(t.lower()) + r"(?![a-z0-9+#])", text):
            out.append(t)
    return sorted(set(out))


def normalize(m, keywords):
    m = json.loads(json.dumps(m))
    if NAME:
        m.setdefault("header", {})["name"] = NAME
    secs = [s for s in m.get("sections") or [] if not (s.get("kind") == "list" and re.match(r"(?i)additional\b", (s.get("title") or "").strip()))]
    for s in secs:
        if s.get("key") == "leadership" and NEVER_ACTIVITIES:
            s["hidden"] = True
        for e in s.get("entries") or []:
            if s.get("key") != "projects" and not e.get("loc"):
                pe = entry_for(e)
                loc = (pe or {}).get("location") or ""
                if loc and (e.get("title") or "").endswith(", " + loc):
                    e["title"], e["loc"] = e["title"][: -(len(loc) + 2)], loc
                    if not e.get("date") and e.get("subdate"):
                        e["date"], e["subdate"] = e["subdate"], ""
            if s.get("key") == "education":
                lines = []
                for ln in e.get("lines") or []:
                    for part in re.split(r"\s+\|\s+", ln):
                        part = re.sub(r"^(Relevant )?Coursework:", "Relevant Coursework:", part.strip())
                        if part:
                            lines.append(part)
                e["lines"] = lines  # GPA stays only where it already was: leaving it off can be a deliberate choice
            for b in e.get("bullets") or []:
                b["text"] = re.sub(r"\.\s*$", "", (b.get("text") or "").rstrip())
    ex = next((i for i, s in enumerate(secs) if s.get("key") == "experience"), -1)
    sk = next((i for i, s in enumerate(secs) if s.get("kind") == "skills"), -1)
    if ex >= 0 and sk >= 0 and ex != sk + 1:
        e = secs.pop(ex)
        secs.insert(next(i for i, s in enumerate(secs) if s.get("kind") == "skills") + 1, e)
    m["sections"] = secs
    terms = bold_terms(m, keywords)
    if terms:
        m["bold"] = terms
    return m


def main():
    n = 0
    for kind, folder in (("resume", "resumes"), ("base", "bases")):
        for f in sorted(glob.glob(os.path.join(DATA, folder, "*.json"))):
            doc = json.load(open(f, encoding="utf-8"))
            cur, key = doc.get("current"), doc.get("key")
            if not cur or not key:
                continue
            rec = ai.load_job(key) if kind == "resume" else None
            kws = ((rec or {}).get("analysis") or {}).get("keywords") or []
            new = normalize(cur, kws)
            if json.dumps(new, sort_keys=True) == json.dumps(cur, sort_keys=True):
                continue
            meta = {"key": key, "company": doc.get("company"), "role": doc.get("role")}
            ai.save_resume(meta, cur, "Before the standard template", "you", kind=kind, keep_current=True)
            ai.save_resume(meta, new, "Standard template", "you", doc.get("notes"), kind=kind)
            n += 1
            print("updated", doc.get("company"), "·", doc.get("role"))
    print(f"{n} resume(s) updated")


if __name__ == "__main__":
    main()

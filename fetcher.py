#!/usr/bin/env python3
"""Fetch, filter and score SimplifyJobs internship listings for the tracker.

Everything here is deterministic Python (standard library only). No AI calls,
so running it every couple of hours costs nothing.

Pipeline
  1. Download the SimplifyJobs listings feed (ETag-cached, so unchanged data is
     not downloaded again).
  2. Gates (a listing is dropped and counted under a reason):
     inactive, not Summer 2027, older than the window, outside the US,
     PhD/MBA-only, not a target field, U.S. citizenship or security clearance
     required, already tracked, dismissed.
  3. Read each new posting's text once (Workday, Greenhouse and Lever APIs,
     otherwise the plain page) and cache what it found.
  4. Score 0-100 as a weighted sum of components in [0, 1]:
       fit      role family matches a target track
       skills   share of the posting's tools/skills that are on your resume
       sponsor  employer's H-1B approval history (USCIS data hub), raised to
                0.9 when the posting welcomes CPT/OPT/F-1 students
       recency  0.5 ** (days since posted / 5)   (computed live in the UI)
       degree   Master's listed = 1, Bachelor's only = 0.7
       location Texas or remote = 1, elsewhere in the US = 0.5
     minus a fixed penalty when the posting says it will not sponsor.
"""
import bisect
import csv
import datetime as dt
import html
import json
import math
import os
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "data", "cache")
FEEDS = [
    "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json",
]
H1B_URL = "https://www.uscis.gov/sites/default/files/document/data/h1b_datahubexport-2023.csv"
H1B_LABEL = "FY2023"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) internship-tracker/1.0 (personal use)"
TERM = "Summer 2027"
DEFAULT_WEIGHTS = {"fit": 30, "skills": 25, "sponsor": 20, "recency": 15, "degree": 5, "location": 5}
NO_SPONSOR_PENALTY = 20
RECENCY_HALF_LIFE = 5
MAX_TEXT_READS = 150  # per run; the rest are read on the next run

# Skills you can truthfully claim (from Experience_Details.md). Edit freely.
MY_SKILLS = {
    "Python", "SQL", "pandas", "NumPy", "scikit-learn", "PyTorch", "Machine learning", "Deep learning",
    "NLP", "Regression", "Tableau", "Data visualization", "ETL", "Data modeling", "Databases", "Git",
    "Java", "C#", "C/C++", "JavaScript", "LLMs", "Prompt engineering",
}
SKILLS = {  # canonical name -> pattern (case-insensitive unless listed in CASE_SENSITIVE)
    "Python": r"\bpython\b", "SQL": r"\bsql\b|t-sql|pl/sql", "pandas": r"\bpandas\b", "NumPy": r"\bnumpy\b",
    "scikit-learn": r"scikit|sklearn", "PyTorch": r"pytorch", "TensorFlow": r"tensorflow|keras",
    "Machine learning": r"machine learning", "Deep learning": r"deep learning|neural net",
    "NLP": r"\bnlp\b|natural language", "Statistics": r"statistic", "A/B testing": r"a/b test|experimentation",
    "Regression": r"regression", "Tableau": r"tableau", "Power BI": r"power ?bi\b", "Excel": r"\bexcel\b",
    "Looker": r"\blooker\b", "Data visualization": r"data visuali[sz]|dashboard", "ETL": r"\betl\b|\belt\b|data pipeline",
    "Data modeling": r"data model|dimensional model|star schema", "Spark": r"\bspark\b|pyspark",
    "Airflow": r"\bairflow\b", "dbt": r"\bdbt\b", "Snowflake": r"snowflake", "BigQuery": r"bigquery",
    "Redshift": r"redshift", "Kafka": r"\bkafka\b", "Hadoop": r"hadoop|\bhive\b", "AWS": r"\baws\b|amazon web services",
    "GCP": r"\bgcp\b|google cloud", "Azure": r"\bazure\b", "Docker": r"\bdocker\b", "Kubernetes": r"kubernetes|\bk8s\b",
    "Git": r"\bgit\b|github", "Linux": r"\blinux\b|\bunix\b", "Java": r"\bjava\b(?!script)", "C#": r"c#|\.net\b",
    "C/C++": r"c\+\+", "JavaScript": r"javascript", "TypeScript": r"typescript", "React": r"\breact\b",
    "Scala": r"\bscala\b", "Rust": r"\brust\b", "R": r"\bR\b(?![&\-/'])", "LLMs": r"\bllms?\b|large language model|generative ai|genai",
    "Prompt engineering": r"prompt engineering|prompting", "Databases": r"relational database|postgres|mysql|sql server|database",
}
CASE_SENSITIVE = {"R"}
SKILL_RE = {k: re.compile(p) if k in CASE_SENSITIVE else re.compile(p, re.I) for k, p in SKILLS.items()}

CITIZEN = re.compile(r"(must|required to)\s+be\s+(a\s+)?(u\.?s\.?|united states)\s+citizen|(u\.?s\.?|united states)\s+citizenship\s+(is\s+)?(required|needed|mandatory)|only\s+(u\.?s\.?|united states)\s+citizens|requires?\s+(u\.?s\.?|united states)\s+citizenship", re.I)
CLEARANCE = re.compile(r"(active|current|obtain|maintain|eligib\w*\s+(for|to obtain))\W+(\w+\W+){0,3}(security|secret|top secret|ts/sci)\s+clearance|(secret|top secret|ts/sci|security)\s+clearance\s+(is\s+)?required", re.I)
NO_SPONSOR = re.compile(r"(not|unable to|cannot|can't|won't|will not|does not|do not|is not able to)\s+(be able to\s+)?(offer|provide|support|sponsor|consider)\w*[^.]{0,60}(sponsorship|visa)|without\s+(the\s+)?(need\s+for\s+)?(current\s+or\s+future\s+)?(employer\s+|visa\s+)?sponsorship|sponsorship\s+(is|will)\s+not\s+(be\s+)?(available|provided|offered)|\bno\s+(visa\s+)?sponsorship", re.I)
FRIENDLY = re.compile(r"\b(CPT|OPT)\b|\bF-1\b|(?i:international students\s+(are\s+)?(welcome|eligible|encouraged))|(?i:(will|can|able to)\s+sponsor\b)|(?i:sponsorship\s+(is\s+)?available)")
NON_US = re.compile(r"\b(Canada|Ontario|Toronto|Vancouver|Montreal|Quebec|UK|United Kingdom|London|England|Ireland|Dublin|Germany|Berlin|Munich|France|Paris|India|Bangalore|Bengaluru|Hyderabad|China|Shanghai|Beijing|Japan|Tokyo|Singapore|Taiwan|Taipei|Israel|Tel Aviv|Mexico|Brazil|Australia|Sydney|Netherlands|Amsterdam|Spain|Poland|Switzerland|Zurich|Korea|Seoul|Hong Kong)\b")
US_STATE = re.compile(r",\s*(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b")


# ---------------------------------------------------------------- utilities
def now_local():
    return dt.datetime.now().astimezone()


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _write_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def _write_json(path, obj):
    _write_bytes(path, json.dumps(obj, ensure_ascii=False).encode("utf-8"))


def http_get(url, headers=None, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers, r.read()


def strip_html(s):
    s = re.sub(r"(?is)<style.*?</style>", " ", s or "")
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def url_key(u):  # mirrors urlKey() in the page
    u = (u or "").strip()
    if not re.match(r"^https?://\S+$", u, re.I):
        return ""
    return re.sub(r"/+$", "", re.sub(r"#.*$", "", u.lower()))


def norm_text(s):  # mirrors norm() in the page
    s = re.sub(r"\b(summer|fall|winter|spring|internship|intern|co-?op)\b|\b20\d\d\b", "", (s or "").lower())
    return re.sub(r"[^a-z0-9]", "", s)


def listing_key(l):
    return url_key(l.get("url")) or "k:" + norm_text(l.get("company")) + "|" + norm_text(l.get("role"))


# ---------------------------------------------------------------- data sources
def load_feed(log):
    path, meta_path = os.path.join(CACHE, "simplify.json"), os.path.join(CACHE, "simplify.meta.json")
    meta = _read_json(meta_path) or {}
    for url in FEEDS:
        headers = {}
        if meta.get("url") == url and meta.get("etag") and os.path.exists(path):
            headers["If-None-Match"] = meta["etag"]
        try:
            _, h, body = http_get(url, headers, timeout=90)
            data = json.loads(body)
            _write_bytes(path, body)
            _write_json(meta_path, {"url": url, "etag": h.get("ETag"), "at": now_local().isoformat()})
            return data
        except urllib.error.HTTPError as e:
            if e.code == 304:
                return _read_json(path)
            log(f"Feed {url}: HTTP {e.code}")
        except Exception as e:  # network or JSON problems: try the next feed
            log(f"Feed {url}: {e}")
    cached = _read_json(path)
    if cached is not None:
        log("Using the last downloaded feed.")
        return cached
    raise RuntimeError("Could not download the Simplify feed.")


SUFFIX = re.compile(r"\b(INC|INCORPORATED|LLC|L L C|LLP|LP|LTD|LIMITED|CORP|CORPORATION|CO|COMPANY|PLC|THE|HOLDINGS?|GROUP|USA|US|AMERICA|NA|N A|NATIONAL ASSOCIATION|SERVICES|TECHNOLOGIES|TECHNOLOGY)\b")


def norm_company(s):
    s = (s or "").upper().replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    return " ".join(SUFFIX.sub(" ", s).split())


class H1B:
    """Employer -> H-1B approvals (initial + continuing) from the USCIS H-1B Employer Data Hub."""

    def __init__(self, log):
        self.counts = {}
        csv_path, idx_path = os.path.join(CACHE, "h1b_fy2023.csv"), os.path.join(CACHE, "h1b_index.json")
        idx = _read_json(idx_path)
        if idx:
            self.counts = idx
        else:
            try:
                if not os.path.exists(csv_path):
                    _, _, b = http_get(H1B_URL, timeout=120)
                    _write_bytes(csv_path, b)
                with open(csv_path, encoding="utf-8", errors="replace", newline="") as f:
                    for r in csv.DictReader(f):
                        try:
                            n = int(r.get("Initial Approval") or 0) + int(r.get("Continuing Approval") or 0)
                        except ValueError:
                            continue
                        k = norm_company(r.get("Employer"))
                        if k:
                            self.counts[k] = self.counts.get(k, 0) + n
                _write_json(idx_path, self.counts)
            except Exception as e:
                log(f"H-1B data unavailable ({e}); sponsorship falls back to posting text only.")
        self.keys = sorted(self.counts)

    def lookup(self, company):
        k = norm_company(company)
        if not k or not self.counts:
            return None
        found, total = k in self.counts, self.counts.get(k, 0)
        if len(k) >= 3:
            i = bisect.bisect_left(self.keys, k + " ")
            while i < len(self.keys) and self.keys[i].startswith(k + " "):
                total += self.counts[self.keys[i]]
                found = True
                i += 1
        return total if found else None


def posting_text(url):
    """Best-effort plain text of a posting, using ATS JSON APIs where the page is rendered by script."""
    u = urllib.parse.urlparse(url)
    host, parts = u.netloc.lower(), [p for p in u.path.split("/") if p]
    try:
        if host.endswith("myworkdayjobs.com"):
            if parts and re.match(r"^[a-z]{2}-[A-Z]{2}$", parts[0]):
                parts = parts[1:]
            if len(parts) >= 3:
                api = f"https://{u.netloc}/wday/cxs/{host.split('.')[0]}/{'/'.join(parts)}"
                _, _, b = http_get(api, {"Accept": "application/json"}, timeout=15)
                return strip_html((json.loads(b).get("jobPostingInfo") or {}).get("jobDescription", ""))
        if re.match(r"^(job-boards|boards)(\.eu)?\.greenhouse\.io$", host) and len(parts) >= 3 and parts[1] == "jobs":
            _, _, b = http_get(f"https://boards-api.greenhouse.io/v1/boards/{parts[0]}/jobs/{parts[2]}", timeout=15)
            return strip_html(html.unescape(json.loads(b).get("content", "")))
        if host == "jobs.lever.co" and len(parts) >= 2:
            _, _, b = http_get(f"https://api.lever.co/v0/postings/{parts[0]}/{parts[1]}", timeout=15)
            j = json.loads(b)
            return " ".join([j.get("descriptionPlain", ""), *[strip_html(x.get("content", "")) for x in j.get("lists", [])], j.get("additionalPlain", "")])
    except Exception:
        pass
    _, _, b = http_get(url, {"Accept": "text/html"}, timeout=15)
    return strip_html(b.decode("utf-8", "replace"))[:80000]


def analyze_text(url):
    try:
        text = posting_text(url)
    except Exception as e:
        return {"read": False, "error": str(e)[:120]}
    if len(text) < 200:
        return {"read": False, "error": "Posting text not readable"}
    return {
        "read": True,
        "citizen": bool(CITIZEN.search(text)),
        "clearance": bool(CLEARANCE.search(text)),
        "noSponsor": bool(NO_SPONSOR.search(text)),
        "friendly": bool(FRIENDLY.search(text)),
        "skills": sorted(k for k, r in SKILL_RE.items() if r.search(text)),
        "at": now_local().date().isoformat(),
    }


# ---------------------------------------------------------------- classification
def infer_track(title, category=""):
    t = title or ""
    if re.search(r"business intelligence|\bBI\b", t, re.I):
        return "BIE"
    if re.search(r"data engineer|analytics engineer|data platform|\betl\b|data infrastructure", t, re.I):
        return "DE"
    if re.search(r"\bquant(itative)?\b", t, re.I) or category == "Quant":
        return "Quant"
    if re.search(r"product manag|program manag|project manag|product owner|\bdesign(er)?\b|marketing", t, re.I):
        return "Other"
    if re.search(r"hardware|electrical|electronic|mechanical|manufactur|sensor|firmware|asic|fpga|silicon|analog|\bRF\b", t, re.I) and not re.search(r"software|data|machine learning|\bML\b", t, re.I):
        return "Other"
    if re.search(r"financ|accounting|audit|\btax\b|investment|equity research|credit", t, re.I) and not re.search(r"data|analytics", t, re.I):
        return "Other"
    if re.search(r"analyst|analytics|insights", t, re.I):
        return "DA"
    if re.search(r"data scien|machine learning|\bML\b|\bAI\b|artificial intelligence|applied scien|research scien|deep learning|\bNLP\b|computer vision|\bLLM", t, re.I):
        return "DS"
    if re.search(r"hardware|electrical|electronic|mechanical|manufactur|civil|chemical|firmware|\bRF\b|asic|fpga|verification|silicon|analog|power systems|sales|trader|trading|\bUX\b|supply chain|human resources|legal|nurs|clinical|biomedical|process engineer|quality engineer|test engineer", t, re.I):
        return "Other"
    if re.search(r"software|developer|\bSWE\b|back-?end|front-?end|full[- ]?stack|platform|cloud|devops|\bSRE\b|site reliability|mobile|\biOS\b|android|\bweb\b|engineer", t, re.I):
        return "SWE"
    return "Other"


def is_us(locations):
    locs = [l for l in (locations or []) if l]
    if not locs:
        return True
    return any(US_STATE.search(l) or not NON_US.search(l) for l in locs)


def components(item, settings, h1b_n, ana):
    title = item["title"]
    track = infer_track(title, item.get("category", ""))
    targets = settings.get("targets") or ["SWE", "DE", "DA", "DS", "BIE"]
    fit = {"Quant": 0.4, "Other": 0.1}.get(track, 1.0 if track in targets else 0.4)
    if re.search(r"\bph\.?d\b|doctoral|\bsenior\b|\bstaff\b|\bmba\b", title, re.I):
        fit *= 0.5
    found = (ana or {}).get("skills") or []
    matched = [s for s in found if s in MY_SKILLS]
    missing = [s for s in found if s not in MY_SKILLS]
    skills = (len(matched) + 1) / (len(found) + 2) if found else 0.5
    friendly = bool((ana or {}).get("friendly")) or item.get("sponsorship") == "Offers Sponsorship"
    no_sponsor = bool((ana or {}).get("noSponsor")) or item.get("sponsorship") == "Does Not Offer Sponsorship"
    if h1b_n is None:
        sponsor = 0.3
    else:
        sponsor = min(1.0, math.log10(1 + h1b_n) / 3)
    if friendly:
        sponsor = max(sponsor, 0.9)
    if no_sponsor:
        sponsor = 0.0
    degrees = item.get("degrees") or []
    degree = 1.0 if "Master's" in degrees or not degrees else 0.7
    places = [p.lower() for p in settings.get("places") or ["TX", "Remote"]]
    locs = item.get("locations") or []
    loc_hit = any(p and (p in l.lower() or (p == "tx" and "texas" in l.lower())) for l in locs for p in places)
    location = 1.0 if loc_hit else 0.5
    v = {"fit": round(fit, 3), "skills": round(skills, 3), "sponsor": round(sponsor, 3), "degree": degree, "location": location}
    flags = []
    if friendly:
        flags.append("CPT/OPT friendly")
    if no_sponsor:
        flags.append("No sponsorship")
    if ana is not None and not ana.get("read"):
        flags.append("Text not read")
    return track, v, (NO_SPONSOR_PENALTY if no_sponsor else 0), flags, matched, missing, friendly, no_sponsor


def score(listing, weights, today=None):
    """Same formula as scoreParts() in the page."""
    today = today or now_local().date()
    v = dict(listing.get("v") or {})
    try:
        age = max(0, (today - dt.date.fromisoformat(listing.get("posted"))).days)
    except (TypeError, ValueError):
        age = 30
    v["recency"] = 0.5 ** (age / RECENCY_HALF_LIFE)
    w = {k: max(0.0, float(weights.get(k, DEFAULT_WEIGHTS[k]) or 0)) for k in DEFAULT_WEIGHTS}
    tot = sum(w.values())
    s = sum(w[k] * v.get(k, 0) for k in w) / tot * 100 if tot else 0
    return max(0, round(s - (listing.get("penalty") or 0)))


# ---------------------------------------------------------------- refresh
def refresh(state, log=print):
    """Download, gate, read and score. Returns data for apply(); does not touch the state file."""
    settings = (state or {}).get("settings") or {}
    window = int(settings.get("windowDays") or 10)
    feed = load_feed(log)
    h1b = H1B(log)
    now = now_local()
    excluded = {}

    def drop(reason):
        excluded[reason] = excluded.get(reason, 0) + 1

    pre = []
    for it in feed:
        if not it.get("active") or not it.get("is_visible", True):
            continue
        if TERM not in (it.get("terms") or []):
            drop(f"Not {TERM}")
            continue
        posted = dt.datetime.fromtimestamp(it.get("date_posted") or 0).astimezone()
        if (now - posted).days > window:
            continue  # outside the window: not counted as excluded
        if not is_us(it.get("locations")):
            drop("Outside the US")
            continue
        degrees = it.get("degrees") or []
        if degrees and not ({"Bachelor's", "Master's"} & set(degrees)):
            drop("PhD/MBA only")
            continue
        if it.get("sponsorship") == "U.S. Citizenship is Required" or re.search(r"clearance|u\.?s\.? citizen", it.get("title", ""), re.I):
            drop("Citizenship or clearance required")
            continue
        if infer_track(it.get("title", ""), it.get("category", "")) == "Other":
            drop("Not a target field")
            continue
        pre.append((it, posted))

    # The feed lists one entry per location; merge entries with the same company and title.
    groups = {}
    for it, posted in sorted(pre, key=lambda x: x[1], reverse=True):
        k = norm_company(it.get("company_name")) + "|" + norm_text(it.get("title"))
        if k in groups:
            g = groups[k][0]
            g["locations"] = list(dict.fromkeys((g.get("locations") or []) + (it.get("locations") or [])))
        else:
            first = dict(it)
            first["locations"] = list(it.get("locations") or [])
            groups[k] = (first, posted)
    pre = list(groups.values())

    cache_path = os.path.join(CACHE, "postings.json")
    cache = _read_json(cache_path) or {}
    todo = [it for it, _ in pre if it["id"] not in cache][:MAX_TEXT_READS]
    if todo:
        with ThreadPoolExecutor(max_workers=8) as ex:
            for it, res in zip(todo, ex.map(lambda x: analyze_text(x.get("url", "")), todo)):
                cache[it["id"]] = res
    keep_ids = {it["id"] for it, _ in pre}
    cache = {k: v for k, v in cache.items() if k in keep_ids}
    _write_json(cache_path, cache)

    out, read = [], 0
    for it, posted in pre:
        ana = cache.get(it["id"])
        if ana and ana.get("read"):
            read += 1
            if ana.get("citizen") or ana.get("clearance"):
                drop("Citizenship or clearance required")
                continue
        h = h1b.lookup(it.get("company_name"))
        track, v, penalty, flags, matched, missing, friendly, no_sponsor = components(it, settings, h, ana)
        locs = it.get("locations") or []
        out.append({
            "id": "sx-" + it["id"], "sid": it["id"], "source": "simplify",
            "company": it.get("company_name", ""), "role": it.get("title", ""),
            "location": "; ".join(locs[:3]) + (f" +{len(locs) - 3} more" if len(locs) > 3 else ""),
            "url": it.get("url", ""), "posted": posted.date().isoformat(), "term": TERM,
            "degree": "/".join(d.replace("'s", "") for d in (it.get("degrees") or [])) or "Any",
            "track": track, "v": v, "penalty": penalty, "flags": flags,
            "skills": {"matched": matched, "missing": missing},
            "h1b": h, "textRead": bool(ana and ana.get("read")),
            "sponsor": "no" if no_sponsor else ("yes" if friendly else "unknown"),
        })
    info = {"at": now.isoformat(timespec="seconds"), "feed": len(feed), "window": window,
            "excluded": excluded, "textRead": read, "h1b": H1B_LABEL if h1b.counts else None, "error": None}
    return {"listings": out, "fetch": info}


def apply(state, result):
    """Merge fresh listings into the latest state (call while holding the server's state lock)."""
    apps = state.get("apps") or []
    tracked = {url_key(a.get("url")) for a in apps} | {"k:" + norm_text(a.get("company")) + "|" + norm_text(a.get("role")) for a in apps}
    tracked.discard("")
    dismissed = set(state.get("dismissed") or [])
    previous = {l.get("id") for l in state.get("listings") or []}
    manual = [l for l in state.get("listings") or [] if l.get("source") != "simplify" and not l.get("sample")]
    info = dict(result["fetch"])
    excluded = dict(info.get("excluded") or {})
    fresh = []
    for l in result["listings"]:
        k = listing_key(l)
        alt = "k:" + norm_text(l["company"]) + "|" + norm_text(l["role"])
        if k in dismissed or alt in dismissed:
            excluded["Dismissed"] = excluded.get("Dismissed", 0) + 1
            continue
        if k in tracked or alt in tracked:
            excluded["Already tracking"] = excluded.get("Already tracking", 0) + 1
            continue
        l["isNew"] = bool(previous) and l["id"] not in previous
        fresh.append(l)
    info["excluded"] = excluded
    info["matched"] = len(fresh)
    info["new"] = sum(1 for l in fresh if l["isNew"])
    state["listings"] = manual + fresh
    state["fetch"] = info
    return info


if __name__ == "__main__":
    import sys
    state = _read_json(os.path.join(ROOT, "data", "tracker.json")) or {}
    res = refresh(state, log=lambda m: print(m, file=sys.stderr))
    print(json.dumps(res["fetch"], indent=2))
    print("kept:", len(res["listings"]))
    w = DEFAULT_WEIGHTS
    for l in sorted(res["listings"], key=lambda x: -score(x, w))[:25]:
        print(f"{score(l, w):3d}  {l['track']:5s} {l['company'][:22]:22s} {l['role'][:46]:46s} h1b={l['h1b']} fl={','.join(l['flags'])} sk={len(l['skills']['matched'])}/{len(l['skills']['matched'])+len(l['skills']['missing'])}")

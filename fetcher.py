#!/usr/bin/env python3
"""Fetch, filter and describe SimplifyJobs internship listings for the tracker.

Everything here is deterministic Python (standard library only). No AI calls,
so running it every couple of hours costs nothing.

Pipeline
  1. Download the SimplifyJobs listings feed (ETag-cached, so unchanged data is
     not downloaded again).
  2. Gates (a listing is dropped and counted under a reason):
     not Summer 2027, older than the window, outside the US, PhD/MBA-only,
     not a target field, U.S. citizenship or security clearance required,
     posting closed (rechecked daily), deadline passed, already tracked, dismissed.
  3. Read each new posting's text once (Workday, Greenhouse and Lever APIs,
     otherwise the plain page) and cache what it found: the tools it names,
     "no sponsorship" wording, CPT/OPT/F-1-friendly wording and a stated
     application deadline (also Workday's posting end date).
  4. Store the raw facts (track, locations, degrees, H-1B count, skills found).
     The score itself is computed from those facts and your settings by
     core.js in the page, so changing a setting re-ranks listings at once.
     score() below is the same formula for the terminal (jobs.py);
     tests/test_parity.py keeps the two identical.

The refresh writes data/listings.json only. It never writes your applications
(data/tracker.json), so a refresh can never conflict with an edit in the page.
Saved applications whose posting closed are reported in listings.json
("closures") and the page moves them to Closed.
"""
import bisect
import contextlib
import csv
import datetime as dt
import html
import ipaddress
import json
import math
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request

import safeio
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "data", "cache")  # server.py points this at its data folder
FEEDS = [
    "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json",
]
H1B_URL = "https://www.uscis.gov/sites/default/files/document/data/h1b_datahubexport-2023.csv"
H1B_LABEL = "FY2023"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) internship-tracker/1.0 (personal use)"
TERM = "Summer 2027"
# Scoring defaults: the same values as DEFAULTS in core.js (checked by tests/test_parity.py).
DEFAULT_WEIGHTS = {"fit": 30, "skills": 25, "sponsor": 20, "recency": 15, "degree": 5, "location": 5}
DEFAULT_TARGETS = ["SWE", "DE", "DA", "DS", "BIE"]
DEFAULT_PLACES = ["TX", "Remote"]
NO_SPONSOR_PENALTY = 20
RECENCY_HALF_LIFE = 5
MAX_TEXT_READS = 150  # per run; the rest are read on the next run

# Skills you can truthfully claim (from Experience_Details.md). The page lets you edit
# this list in Settings; this is the starting value.
DEFAULT_MY_SKILLS = [
    "Python", "SQL", "pandas", "NumPy", "scikit-learn", "PyTorch", "Machine learning", "Deep learning", "NLP",
    "Regression", "Tableau", "Data visualization", "ETL", "Data modeling", "Databases", "Git", "Java", "C#", "C/C++",
    "JavaScript", "LLMs", "Prompt engineering",
]
SKILLS = {
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
    "Git": r"\bgit\b|github", "Linux": r"\blinux\b|\bunix\b", "Java": r"\bjava\b(?!script)", "C#": r"c#",
    "C/C++": r"c\+\+", "JavaScript": r"javascript", "TypeScript": r"typescript", "React": r"\breact\b",
    "Scala": r"\bscala\b", "Rust": r"\brust\b", "R": r"\bR\b(?![&\-/'])", "LLMs": r"\bllms?\b|large language model|generative ai|genai",
    "Prompt engineering": r"prompt engineering|prompting", "Databases": r"relational database|postgres|mysql|sql server|database",
}
CASE_SENSITIVE = {"R"}
SKILL_RE = {k: re.compile(p) if k in CASE_SENSITIVE else re.compile(p, re.I) for k, p in SKILLS.items()}

CITIZEN = re.compile(r"(must|required to)\s+be\s+(a\s+)?(u\.?s\.?|united states)\s+citizen|(u\.?s\.?|united states)\s+citizenship\s+(is\s+)?(required|needed|mandatory)|only\s+(u\.?s\.?|united states)\s+citizens|requires?\s+(u\.?s\.?|united states)\s+citizenship", re.I)
CLEARANCE = re.compile(r"(active|current|obtain|maintain|eligib\w*\s+(for|to obtain))\W+(\w+\W+){0,3}(security|secret|top secret|ts/sci)\s+clearance|(secret|top secret|ts/sci|security)\s+clearance\s+(is\s+)?required", re.I)
NO_SPONSOR = re.compile(r"(not|unable to|cannot|can't|won't|will not|does not|do not|is not able to)\s+(be able to\s+)?(offer|provide|support|sponsor|consider)\w*[^.]{0,60}(sponsorship|visa)|without\s+(the\s+)?(need\s+for\s+)?(current\s+or\s+future\s+)?(employer\s+|visa\s+)?sponsorship|sponsorship\s+(is|will)\s+not\s+(be\s+)?(available|provided|offered)|\bno\s+(visa\s+)?sponsorship|authorized\s+to\s+work\s+in\s+the\s+(united\s+states|u\.?s\.?a?\.?)[^.]{0,40}\bnow\s+and\s+in\s+the\s+future|(not|never)\s+(now\s+or\s+in\s+the\s+future\s+)?require\s+(employer\s+|visa\s+|immigration\s+)?sponsorship", re.I)
FRIENDLY = re.compile(r"\b(CPT|OPT)\b|\bF-1\b|(?i:international students\s+(are\s+)?(welcome|eligible|encouraged))|(?i:(will|can|able to)\s+sponsor\b)|(?i:sponsorship\s+(is\s+)?available)")
# "Candidates on CPT or OPT are not eligible", "This role does not accept OPT candidates". Mirrors OPT_EXCLUDED in core.js.
OPT_EXCLUDED = re.compile(r"\b(CPT|OPT|F-?1)\b[^.]{0,60}\b(not|ineligible|unable)\b[^.]{0,30}\b(eligible|accept\w*|consider\w*|sponsor\w*|support\w*)|\b(not|cannot|can't|unable to|do(es)? not|will not|won't)\s+(be\s+able\s+to\s+)?(accept|consider|support|hire|employ)\w*[^.]{0,40}\b(CPT|OPT|F-?1)\b|\bineligible\b[^.]{0,40}\b(CPT|OPT|F-?1)\b|\b(CPT|OPT|F-?1)\b[^.]{0,60}\bineligible\b", re.I)
NEGATION = re.compile(r"\b(not|no|never|ineligible|unable|cannot|can't|won't|without)\b", re.I)


def sponsorship_signals(text):
    """Classify work-authorization wording sentence by sentence, so a sentence that mentions CPT/OPT only to exclude
    it is never read as friendly. Returns {noSponsor, optExcluded, friendly}."""
    no_sp = opt_out = friendly = False
    for sent in re.split(r"(?<=[.!?;])\s+|\n+", text or ""):
        if OPT_EXCLUDED.search(sent):
            opt_out = True
            continue
        if NO_SPONSOR.search(sent):
            no_sp = True
            continue
        if FRIENDLY.search(sent) and not NEGATION.search(sent):
            friendly = True
    return {"noSponsor": no_sp or opt_out, "optExcluded": opt_out, "friendly": friendly and not (no_sp or opt_out)}


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
    safeio.write_bytes(path, data)


def _write_json(path, obj):
    safeio.write_json(path, obj)


def http_get(url, headers=None, timeout=20, public_only=False):
    """GET a URL. public_only=True (used for links that come from you or the extension) refuses anything but
    http(s) on a public address, including after redirects, so a link can never read local files or this machine's services."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    if public_only:
        check_public_url(url)
        with _PUBLIC_OPENER.open(req, timeout=timeout) as r:
            return r.status, r.headers, r.read()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers, r.read()


class UnsafeURL(ValueError):
    pass


def check_public_url(url):
    """Allow only http(s) links whose host resolves to public addresses (no file://, localhost, LAN or cloud metadata)."""
    u = urllib.parse.urlsplit(url or "")
    if u.scheme not in ("http", "https") or not u.hostname:
        raise UnsafeURL("only http(s) links can be read")
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise UnsafeURL(f"cannot resolve {u.hostname}") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%", 1)[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise UnsafeURL("the link points to this computer or a private network")
    return url


class _PublicRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_PUBLIC_OPENER = urllib.request.build_opener(_PublicRedirects)


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


def norm_strict(s):
    """Like norm_text but keeps season and year, so "SWE Intern (Summer 2026)" and "(Summer 2027)" stay different jobs."""
    s = re.sub(r"\b(internship|intern|co-?op)\b", "", (s or "").lower())
    return re.sub(r"[^a-z0-9]", "", s)


def strict_key(l):
    return norm_company(l.get("company") or l.get("company_name")) + "|" + norm_strict(l.get("role") or l.get("title"))


_REQ = re.compile(r"(\d{4,}|[a-z]{1,4}-?\d{3,}|[0-9a-f]{8}-[0-9a-f]{4})", re.I)


def same_req(u1, u2):
    """False only when both links are on the same host and name different requisition IDs."""
    a, b = url_key(u1), url_key(u2)
    if not a or not b or a == b:
        return True
    ha, hb = urllib.parse.urlsplit(a), urllib.parse.urlsplit(b)
    ia, ib = set(_REQ.findall(ha.path + "?" + ha.query)), set(_REQ.findall(hb.path + "?" + hb.query))
    return not (ha.netloc == hb.netloc and ia and ib and not (ia & ib))


def listing_key(l):
    return url_key(l.get("url")) or "k:" + norm_text(l.get("company")) + "|" + norm_text(l.get("role"))


# ---------------------------------------------------------------- data sources
FEED_TRIES = (0, 2, 8)  # seconds to wait before each attempt per feed URL
_sleep = time.sleep      # replaced in tests


def load_feed(log, meta_out=None):
    """The SimplifyJobs feed: each URL is tried up to 3 times (network errors and 5xx, with 2 s and 8 s waits),
    then the next URL, then the last downloaded copy. meta_out["usingCache"] tells which one was used."""
    path, meta_path = os.path.join(CACHE, "simplify.json"), os.path.join(CACHE, "simplify.meta.json")
    meta = _read_json(meta_path) or {}
    if meta_out is not None:
        meta_out["usingCache"] = False
    for url in FEEDS:
        headers = {}
        if meta.get("url") == url and meta.get("etag") and os.path.exists(path):
            headers["If-None-Match"] = meta["etag"]
        for wait in FEED_TRIES:
            if wait:
                _sleep(wait)
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
                if e.code < 500:
                    break  # 404 and friends will not get better by retrying: try the next feed
            except ValueError as e:  # not JSON: retrying the same body will not help
                log(f"Feed {url}: {e}")
                break
            except Exception as e:  # network problems: retry, then try the next feed
                log(f"Feed {url}: {e}")
    cached = _read_json(path)
    if cached is not None:
        log("Using the last downloaded feed.")
        if meta_out is not None:
            meta_out["usingCache"] = True
        return cached
    raise RuntimeError("Could not download the Simplify feed, and there is no earlier copy.")


@contextlib.contextmanager
def refresh_lock(data_dir):
    """Cross-process lock for a refresh (yields False when another process holds it). No-op where fcntl is missing."""
    try:
        import fcntl
    except ImportError:
        yield True
        return
    os.makedirs(data_dir, exist_ok=True)
    fd = os.open(os.path.join(data_dir, ".refresh.lock"), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


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


def h1b_meta():
    return _read_json(os.path.join(CACHE, "h1b_meta.json")) or {"label": H1B_LABEL, "source": "USCIS H-1B Employer Data Hub archive"}


def h1b_label():
    return h1b_meta().get("label") or H1B_LABEL


def _xlsx_rows(data):
    """Rows of the first worksheet of an .xlsx file (standard library only)."""
    import io
    import zipfile
    import xml.etree.ElementTree as ET
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(ns + "si"):
            shared.append("".join(t.text or "" for t in si.iter(ns + "t")))
    sheets = sorted(n for n in z.namelist() if re.match(r"^xl/worksheets/sheet\d+\.xml$", n))
    if not sheets:
        raise ValueError("no worksheet in the file")
    col = lambda ref: sum((ord(ch) - 64) * 26 ** i for i, ch in enumerate(reversed(re.sub(r"\d", "", ref)))) - 1
    with z.open(sheets[0]) as f:
        for _, el in ET.iterparse(f):
            if el.tag != ns + "row":
                continue
            row = {}
            for c in el.iter(ns + "c"):
                t, v = c.get("t"), c.find(ns + "v")
                val = shared[int(v.text)] if t == "s" and v is not None else "".join(x.text or "" for x in c.iter(ns + "t")) if t == "inlineStr" else (v.text if v is not None else "")
                row[col(c.get("r", "A1"))] = val
            el.clear()
            if row:
                yield [row.get(i, "") for i in range(max(row) + 1)]


def parse_h1b(rows):
    """Employer -> approvals from any USCIS H-1B Employer Data Hub export (archive CSVs or the current hub's
    Excel/CSV download). Uses the latest fiscal year present. Returns (counts, fiscal_year or None)."""
    rows = iter(rows)
    header = None
    for r in rows:  # skip title rows above the header
        if any(re.search(r"employer", str(x), re.I) for x in r) and any(re.search(r"approv", str(x), re.I) for x in r):
            header = [str(x).strip() for x in r]
            break
    if not header:
        raise ValueError("could not find a header row with Employer and Approval columns")
    low = [h.lower() for h in header]
    emp = next(i for i, h in enumerate(low) if "employer" in h)
    total = [i for i, h in enumerate(low) if "approv" in h and "total" in h]
    appr = total or [i for i, h in enumerate(low) if "approv" in h]
    if not appr:
        raise ValueError("could not find approval columns")
    fy = next((i for i, h in enumerate(low) if h in ("fiscal year", "fiscal_year", "year")), None)
    data = []
    for r in rows:
        if len(r) <= emp:
            continue
        n = 0
        for i in appr:
            try:
                n += int(float(str(r[i] if i < len(r) else 0).replace(",", "") or 0))
            except ValueError:
                pass
        year = None
        if fy is not None and fy < len(r):
            m = re.search(r"(20\d\d)", str(r[fy]))
            year = int(m.group(1)) if m else None
        data.append((r[emp], n, year))
    years = [y for _, _, y in data if y]
    latest = max(years) if years else None
    counts = {}
    for name, n, year in data:
        if latest and year != latest:
            continue
        k = norm_company(name)
        if k:
            counts[k] = counts.get(k, 0) + n
    if len(counts) < 50:
        raise ValueError(f"only {len(counts)} employers found; download the full table (all employers), not a chart")
    return counts, latest


def import_h1b(data, filename=""):
    """Replace the H-1B index with a file downloaded from the USCIS H-1B Employer Data Hub."""
    if data[:2] == b"PK":
        rows = _xlsx_rows(data)
    else:
        text = data.decode("utf-8-sig", "replace")
        if "\t" in text.split("\n", 1)[0]:
            rows = csv.reader(text.splitlines(), delimiter="\t")
        else:
            rows = csv.reader(text.splitlines())
    counts, year = parse_h1b(rows)
    m = re.search(r"(20\d\d)", filename or "")
    year = year or (int(m.group(1)) if m else None)
    label = f"FY{year}" if year else "imported"
    _write_json(os.path.join(CACHE, "h1b_index.json"), counts)
    meta = {"label": label, "source": "USCIS H-1B Employer Data Hub (imported file)", "file": os.path.basename(filename or "")[:120],
            "employers": len(counts), "approvals": sum(counts.values()), "importedAt": now_local().isoformat(timespec="seconds")}
    _write_json(os.path.join(CACHE, "h1b_meta.json"), meta)
    return meta


class PostingClosed(Exception):
    pass


MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
DATE_PAT = (r"(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)[a-z]*,?\s+)?"
            r"(?P<date>(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d\d)?"
            r"|\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*,?(?:\s+20\d\d)?"
            r"|\d{1,2}/\d{1,2}/(?:20)?\d\d|20\d\d-\d{2}-\d{2})")
DEADLINE = re.compile(
    r"(?:application\s+deadline|deadline\s+(?:to|for)\s+(?:apply|applications?|submission)|apply\s+(?:no\s+later\s+than|by|before)"
    r"|applications?\s+(?:will\s+be\s+|are\s+)?(?:accepted|received|open)\s+(?:until|through|thru|till)|accepting\s+applications\s+(?:until|through)"
    r"|(?:closing|posting\s+(?:close|end)|expiration)\s+date|(?:posting|position|job|requisition|role|application\s+window)\s+(?:will\s+)?(?:close|closes|end|ends|expire|expires)(?:\s+on)?"
    r"|(?:must|should)\s+(?:be\s+)?(?:submit\w*|apply|received)\s+(?:by|before|no\s+later\s+than)|deadline)"
    r"\W{0,4}(?:is\s+|on\s+|of\s+|by\s+|at\s+)?(?:11:59\s*(?:pm|p\.m\.)\s*\w*\s*(?:on\s+)?)?" + DATE_PAT, re.I)


def parse_date(s, today):
    """'Nov 15', 'November 15th, 2026', '15 Nov 2026', '11/15/2026', '2026-11-15' -> date (year guessed forward)."""
    s = s.lower().replace(",", " ").replace(".", " ")
    try:
        m = re.match(r"(20\d\d)-(\d{2})-(\d{2})$", s.strip())
        if m:
            return dt.date(int(m[1]), int(m[2]), int(m[3]))
        m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{2,4})$", s.strip())
        if m:
            y = int(m[3])
            return dt.date(y + 2000 if y < 100 else y, int(m[1]), int(m[2]))
        mon = re.search(r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)", s)
        day = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\b", s)
        year = re.search(r"\b(20\d\d)\b", s)
        if not (mon and day):
            return None
        y = int(year[1]) if year else today.year
        d = dt.date(y, MONTHS[mon[1]], int(day[1]))
        if not year and d < today - dt.timedelta(days=60):
            d = d.replace(year=y + 1)  # "Jan 15" read in November means next January
        return d
    except ValueError:
        return None


def find_deadline(text, today=None):
    """Application deadline stated in a posting, as ISO date, or None. Only dates within a sane range count."""
    today = today or now_local().date()
    for m in DEADLINE.finditer(text or ""):
        d = parse_date(m.group("date"), today)
        if d and today - dt.timedelta(days=120) <= d <= today + dt.timedelta(days=400):
            return d.isoformat()
    return None


CLOSED_TEXT = re.compile(r"no longer (available|accepting|open|active)|(position|job|role|requisition) (has been|is|was) (filled|closed|removed)|(job|posting|position) (is )?(closed|expired)|this (job|posting) (has )?(expired|closed)|not (currently )?accepting applications|job not found|position not found|page (you are looking for )?(could not be found|not found|doesn't exist)", re.I)


def _api(url, headers=None):
    """GET an ATS API; a 404/410 means the posting was removed."""
    try:
        return http_get(url, headers, timeout=15)[2]
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            raise PostingClosed(f"HTTP {e.code}")
        raise


def posting_text(url):
    """Best-effort plain text of a posting, using ATS JSON APIs where the page is rendered by script.
    Raises PostingClosed when the posting has clearly been taken down."""
    check_public_url(url)  # raises UnsafeURL for file://, localhost, LAN addresses
    u = urllib.parse.urlparse(url)
    host, parts = u.netloc.lower(), [p for p in u.path.split("/") if p]
    try:
        if host.endswith("myworkdayjobs.com"):
            if parts and re.match(r"^[a-z]{2}-[A-Z]{2}$", parts[0]):
                parts = parts[1:]
            if len(parts) >= 3:
                j = json.loads(_api(f"https://{u.netloc}/wday/cxs/{host.split('.')[0]}/{'/'.join(parts)}", {"Accept": "application/json"}))
                if not j.get("jobPostingInfo"):
                    raise PostingClosed("Workday has no posting")
                info = j["jobPostingInfo"]
                if info.get("canApply") is False or info.get("postingAvailable") is False:
                    raise PostingClosed("Workday says applications are closed")
                text = strip_html(info.get("jobDescription", ""))
                end = (info.get("endDate") or "")[:10]  # Workday's own "posting ends" date, when the employer set one
                return text + (f" Application deadline: {end}." if re.match(r"^20\d\d-\d\d-\d\d$", end) else "")
        if re.match(r"^(job-boards|boards)(\.eu)?\.greenhouse\.io$", host) and len(parts) >= 3 and parts[1] == "jobs":
            b = _api(f"https://boards-api.greenhouse.io/v1/boards/{parts[0]}/jobs/{parts[2]}")
            return strip_html(html.unescape(json.loads(b).get("content", "")))
        if host == "jobs.lever.co" and len(parts) >= 2:
            j = json.loads(_api(f"https://api.lever.co/v0/postings/{parts[0]}/{parts[1]}"))
            return " ".join([j.get("descriptionPlain", ""), *[strip_html(x.get("content", "")) for x in j.get("lists", [])], j.get("additionalPlain", "")])
    except PostingClosed:
        raise
    except Exception:
        pass
    try:
        _, _, b = http_get(url, {"Accept": "text/html"}, timeout=15, public_only=True)
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            raise PostingClosed(f"HTTP {e.code}")
        raise
    text = strip_html(b.decode("utf-8", "replace"))[:80000]
    # Closed-job pages are short; a long page that merely mentions "no longer available" somewhere is not.
    if len(text) < 12000 and CLOSED_TEXT.search(text):
        raise PostingClosed("Page says the job is closed")
    return text


def analyze_text(url):
    today = now_local().date().isoformat()
    try:
        text = posting_text(url)
    except PostingClosed as e:
        return {"read": False, "closed": True, "why": str(e), "at": today}
    except Exception as e:
        return {"read": False, "error": str(e)[:120], "at": today}
    if len(text) < 200:
        return {"read": False, "error": "Posting text not readable", "at": today}
    return {
        "read": True,
        "citizen": bool(CITIZEN.search(text)),
        "clearance": bool(CLEARANCE.search(text)),
        **sponsorship_signals(text),
        "skills": sorted(k for k, r in SKILL_RE.items() if r.search(text)),
        "deadline": find_deadline(text),
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


REGION_WORDS = {
    "canada": r"Canada|Ontario|Toronto|Vancouver|Montreal|Quebec|Waterloo|\bON\b|\bBC\b",
    "europe": r"UK|United Kingdom|London|England|Ireland|Dublin|Germany|Berlin|Munich|France|Paris|Netherlands|Amsterdam|Spain|Madrid|Poland|Warsaw|Switzerland|Zurich|Sweden|Stockholm|Denmark|Copenhagen|Italy|Milan|Europe",
    "japan": r"Japan|Tokyo|Osaka|Kyoto|Yokohama",
    "taiwan": r"Taiwan|Taipei|Hsinchu|Taichung|Kaohsiung",
}


def region_ok(locations, regions):
    """Is any location inside one of your regions (Profile → Regions)? No regions set: the United States."""
    regions = [str(r).lower() for r in (regions or []) if r] or ["united states"]
    locs = [l for l in (locations or []) if l]
    if not locs:
        return True
    if any(r.startswith("united states") or r in ("us", "usa") for r in regions) and is_us(locs):
        return True
    if "remote only" in regions and any(re.search(r"remote", l, re.I) for l in locs):
        return True
    for r in regions:
        pat = REGION_WORDS.get(r)
        if pat and any(re.search(pat, l) for l in locs):
            return True
    return False


def filters_of(settings):
    """The gates the refresh applies, from your settings (the page copies Profile → What you are looking for into them)."""
    settings = settings or {}
    terms = settings.get("terms")
    terms = [t for t in (terms if isinstance(terms, list) else [terms] if isinstance(terms, str) else []) if t] or [TERM]
    levels = settings.get("degreeLevels")
    levels = set(levels) if isinstance(levels, list) and levels else {"Bachelor's", "Master's"}
    return {"terms": terms, "regions": settings.get("regions") or [], "degrees": levels}


def is_us(locations):
    locs = [l for l in (locations or []) if l]
    if not locs:
        return True
    return any(US_STATE.search(l) or not NON_US.search(l) for l in locs)


SENIOR = re.compile(r"\bph\.?d\b|doctoral|\bsenior\b|\bstaff\b|\bmba\b", re.I)
WEIGHT_KEYS = ["fit", "skills", "sponsor", "recency", "degree", "location"]


def _num(x, default):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return default
    return v if math.isfinite(v) else default


def settings_of(s):
    s = s or {}
    w = dict(DEFAULT_WEIGHTS)
    w.update(s.get("weights") or {})
    return {
        "targets": s["targets"] if isinstance(s.get("targets"), list) else DEFAULT_TARGETS,
        "weights": w,
        "places": s["places"] if isinstance(s.get("places"), list) else DEFAULT_PLACES,
        "mySkills": s["mySkills"] if isinstance(s.get("mySkills"), list) else DEFAULT_MY_SKILLS,
        "noSponsorPenalty": max(0.0, _num(s.get("noSponsorPenalty"), NO_SPONSOR_PENALTY)),
        "recencyHalfLife": max(0.5, _num(s.get("recencyHalfLife"), RECENCY_HALF_LIFE)),
    }


def degrees_of(l):
    if isinstance(l.get("degrees"), list):
        return l["degrees"]
    s, out = l.get("degree") or "", []
    if re.search(r"\b(bs|ba|bachelor)", s, re.I):
        out.append("Bachelor's")
    if re.search(r"\b(ms|ma|master)", s, re.I):
        out.append("Master's")
    if re.search(r"\bphd\b|doctor", s, re.I):
        out.append("PhD")
    if re.search(r"\bmba\b", s, re.I):
        out.append("MBA")
    return out


def sponsor_of(l):
    if l.get("noSponsor") or l.get("sponsor") == "no":
        return "no"
    if l.get("friendly") or l.get("sponsor") == "yes":
        return "yes"
    return "unknown"


def components(l, settings=None, today=None):
    """Component values in [0, 1]. Same rules as components() in core.js."""
    s = settings_of(settings)
    today = today or now_local().date()
    track = l.get("track") or infer_track(l.get("role"), l.get("category", ""))
    fit = 0.4 if track == "Quant" else 0.1 if track == "Other" else (1.0 if track in s["targets"] else 0.4)
    if SENIOR.search(l.get("role") or ""):
        fit *= 0.5
    found = l.get("skillsFound") if isinstance(l.get("skillsFound"), list) else []
    mine = set(s["mySkills"])
    matched = [k for k in found if k in mine]
    missing = [k for k in found if k not in mine]
    skills = (len(matched) + 1) / (len(found) + 2) if found else 0.5
    sp = sponsor_of(l)
    h = l.get("h1b")
    sponsor = 0.3 if h is None else min(1.0, math.log10(1 + float(h)) / 3)
    if sp == "yes" or l.get("friendly"):
        sponsor = max(sponsor, 0.9)
    no_sponsor = sp == "no"
    if no_sponsor:
        sponsor = 0.0
    try:
        age = max(0, (today - dt.date.fromisoformat(l.get("posted"))).days)
    except (TypeError, ValueError):
        age = 30
    recency = 0.5 ** (age / s["recencyHalfLife"])
    degs = degrees_of(l)
    degree = 1.0 if (not degs or "Master's" in degs) else 0.7 if "Bachelor's" in degs else 0.0
    places = [str(p).lower().strip() for p in s["places"] if str(p).strip()]
    locs = l.get("locations") if isinstance(l.get("locations"), list) and l.get("locations") else ([l["location"]] if l.get("location") else [])
    locs = [str(x).lower() for x in locs]
    hit = any(p in x or (p == "tx" and "texas" in x) for x in locs for p in places)
    location = 1.0 if hit else 0.5
    return {
        "track": track, "matched": matched, "missing": missing, "noSponsor": no_sponsor,
        "friendly": (not no_sponsor) and (sp == "yes" or bool(l.get("friendly"))),
        "penalty": s["noSponsorPenalty"] if no_sponsor else 0,
        "v": {"fit": fit, "skills": skills, "sponsor": sponsor, "recency": recency, "degree": degree, "location": location},
    }


def score_parts(l, settings=None, today=None):
    """Total and per-component points. Same arithmetic, in the same order, as score() in core.js."""
    s = settings_of(settings)
    c = components(l, s, today)
    tot = 0.0
    for k in WEIGHT_KEYS:
        tot += max(0.0, _num(s["weights"].get(k), 0))
    parts = []
    for k in WEIGHT_KEYS:
        wk = max(0.0, _num(s["weights"].get(k), 0))
        parts.append({"k": k, "v": c["v"][k], "pts": wk * c["v"][k] / tot * 100 if tot else 0, "max": wk / tot * 100 if tot else 0})
    total = 0.0
    for p in parts:
        total += p["pts"]
    c["total"] = max(0, math.floor(total - c["penalty"] + 0.5))  # JavaScript Math.round
    c["parts"] = parts
    return c


def score(l, settings=None, today=None):
    return score_parts(l, settings, today)["total"]


def record(it, posted, ana, h1b_n):
    """The listing as stored in listings.json: raw facts only, scored by core.js."""
    locs = list(it.get("locations") or [])
    friendly = bool((ana or {}).get("friendly")) or it.get("sponsorship") == "Offers Sponsorship"
    no_sponsor = bool((ana or {}).get("noSponsor")) or it.get("sponsorship") == "Does Not Offer Sponsorship"
    return {
        "id": "sx-" + it["id"], "sid": it["id"], "source": "simplify",
        "company": it.get("company_name", ""), "role": it.get("title", ""), "category": it.get("category", ""),
        "track": infer_track(it.get("title", ""), it.get("category", "")),
        "locations": locs, "location": "; ".join(locs[:3]) + (f" +{len(locs) - 3} more" if len(locs) > 3 else ""),
        "url": it.get("url", ""), "altUrls": list(it.get("altUrls") or []), "posted": posted.date().isoformat(),
        "term": next((t for t in (it.get("terms") or []) if t), TERM),
        "degrees": list(it.get("degrees") or []),
        "degree": "/".join(d.replace("'s", "") for d in (it.get("degrees") or [])) or "Any",
        "h1b": h1b_n, "friendly": friendly and not no_sponsor, "noSponsor": no_sponsor,
        "optExcluded": bool((ana or {}).get("optExcluded")),
        "textRead": bool(ana and ana.get("read")),
        "skillsFound": list((ana or {}).get("skills") or []),
        "deadline": (ana or {}).get("deadline") or "",
    }


def upgrade_listing(l):
    """Convert a listing stored by an older version (pre-computed v, flags, skills) to raw facts."""
    if "skillsFound" in l:
        return l
    l = dict(l)
    sk = l.pop("skills", None) or {}
    l["skillsFound"] = list(sk.get("matched") or []) + list(sk.get("missing") or [])
    flags = l.pop("flags", None) or []
    l["noSponsor"] = "No sponsorship" in flags or l.get("sponsor") == "no"
    l["friendly"] = ("CPT/OPT friendly" in flags or l.get("sponsor") == "yes") and not l["noSponsor"]
    if not l.get("locations"):
        l["locations"] = [x for x in re.split(r";\s*", re.sub(r"\s*\+\d+ more$", "", l.get("location") or "")) if x]
    if "degrees" not in l:
        l["degrees"] = degrees_of(l)
    for k in ("v", "penalty"):
        l.pop(k, None)
    return l


# ---------------------------------------------------------------- refresh
def refresh(user, listings_state=None, log=print, progress=None):
    """Download, gate, read and describe listings. Reads your data but never changes it.
    Returns data for apply()."""
    user = user or {}
    listings_state = listings_state or {}
    settings = user.get("settings") or {}
    window = int(_num(settings.get("windowDays"), 10) or 10)
    progress = progress or (lambda step, done=0, total=0: None)
    progress("Downloading the feed")
    feed_meta = {}
    feed = load_feed(log, feed_meta)
    progress("Filtering listings")
    h1b = H1B(log)
    now = now_local()
    excluded = {}

    def drop(reason):
        excluded[reason] = excluded.get(reason, 0) + 1

    flt = filters_of(settings)
    pre = []
    for it in feed:
        if not it.get("active") or not it.get("is_visible", True):
            continue
        if not set(flt["terms"]) & set(it.get("terms") or []):
            drop("Not " + " / ".join(flt["terms"]))
            continue
        posted = dt.datetime.fromtimestamp(it.get("date_posted") or 0).astimezone()
        if (now - posted).days > window:
            continue  # outside the window: not counted as excluded
        if not region_ok(it.get("locations"), flt["regions"]):
            drop("Outside the US" if not flt["regions"] else "Outside your regions")
            continue
        degrees = it.get("degrees") or []
        if degrees and not (flt["degrees"] & set(degrees)):
            drop("PhD/MBA only" if flt["degrees"] == {"Bachelor's", "Master's"} else "Degree level not yours")
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
        k = norm_company(it.get("company_name")) + "|" + norm_strict(it.get("title"))
        if k in groups and not same_req(groups[k][0].get("url"), it.get("url")):
            k = k + "|" + it["id"]  # same title, different requisition: keep both
        if k in groups:
            g = groups[k][0]
            g["locations"] = list(dict.fromkeys((g.get("locations") or []) + (it.get("locations") or [])))
            if it.get("url") and url_key(it.get("url")) != url_key(g.get("url")):
                g["altUrls"] = list(dict.fromkeys((g.get("altUrls") or []) + [it["url"]]))
        else:
            first = dict(it)
            first["locations"] = list(it.get("locations") or [])
            groups[k] = (first, posted)
    pre = list(groups.values())

    cache_path = os.path.join(CACHE, "postings.json")
    cache = _read_json(cache_path) or {}
    today = now.date().isoformat()
    # New postings first, then a once-a-day recheck so closed postings drop out.
    new = [it for it, _ in pre if it["id"] not in cache]
    stale = [it for it, _ in pre if it["id"] in cache and (cache[it["id"]].get("at") or "") < today]
    todo = (new + stale)[:MAX_TEXT_READS]
    if todo:
        progress("Reading postings", 0, len(todo))
        with ThreadPoolExecutor(max_workers=8) as ex:
            for n, (it, res) in enumerate(zip(todo, ex.map(lambda x: analyze_text(x.get("url", "")), todo)), 1):
                progress("Reading postings", n, len(todo))
                old = cache.get(it["id"])
                # Keep what an earlier read learned if today's recheck could not read the page.
                if old and old.get("read") and not res.get("read") and not res.get("closed"):
                    old["at"] = res["at"]
                    res = old
                cache[it["id"]] = res
    keep_ids = {it["id"] for it, _ in pre}
    cache = {k: v for k, v in cache.items() if k in keep_ids}
    _write_json(cache_path, cache)

    out, read = [], 0
    for it, posted in pre:
        ana = cache.get(it["id"])
        if ana and ana.get("closed"):
            drop("Posting closed")
            continue
        if ana and ana.get("deadline") and ana["deadline"] < today:
            drop("Deadline passed")
            continue
        if ana and ana.get("read"):
            read += 1
            if ana.get("citizen") or ana.get("clearance"):
                drop("Citizenship or clearance required")
                continue
        out.append(record(it, posted, ana, h1b.lookup(it.get("company_name"))))

    # Saved (not yet applied) applications: is the posting still open? Checked once a day.
    inactive = {url_key(it.get("url")) for it in feed if not it.get("active")} - {""}
    active = {url_key(it.get("url")) for it in feed if it.get("active")} - {""}
    live = dict(listings_state.get("liveChecked") or {})
    saved = [a for a in user.get("apps") or [] if a.get("status") == "saved" and url_key(a.get("url")) and not a.get("keepOpen")]
    closures, to_check = [], []
    for a in saved:
        k = url_key(a["url"])
        if k in inactive and k not in active:
            closures.append({"id": a["id"], "company": a.get("company", ""), "why": "Marked closed on SimplifyJobs", "day": today})
        elif (live.get(a["id"]) or "") < today:
            to_check.append(a)
    deadlines = dict(listings_state.get("savedDeadlines") or {})
    if to_check:
        progress("Checking saved applications", 0, len(to_check))
        with ThreadPoolExecutor(max_workers=8) as ex:
            for a, res in zip(to_check, ex.map(lambda x: analyze_text(x["url"]), to_check)):
                live[a["id"]] = today
                if res.get("closed"):
                    closures.append({"id": a["id"], "company": a.get("company", ""), "why": res.get("why") or "Posting closed", "day": today})
                elif res.get("deadline"):
                    deadlines[a["id"]] = res["deadline"]
    for a in saved:  # a saved application whose deadline (found in the posting or entered by you) has passed
        d = a.get("deadline") or deadlines.get(a["id"]) or ""
        if d and d < today and not any(c["id"] == a["id"] for c in closures):
            closures.append({"id": a["id"], "company": a.get("company", ""), "why": f"deadline {d} passed", "day": today})
    app_ids = {a.get("id") for a in user.get("apps") or []}
    live = {k: v for k, v in live.items() if k in app_ids}
    deadlines = {k: v for k, v in deadlines.items() if k in app_ids}

    info = {"at": now.isoformat(timespec="seconds"), "feed": len(feed), "window": window,
            "excluded": excluded, "textRead": read, "h1b": h1b_label() if h1b.counts else None, "error": None,
            "usingCache": bool(feed_meta.get("usingCache"))}
    info["deadlines"] = sum(1 for l in out if l["deadline"])
    return {"listings": out, "fetch": info, "closures": closures, "liveChecked": live, "savedDeadlines": deadlines}


def tracked_keys(user):
    """Links of tracked applications, plus strict company|title keys (season and year kept)."""
    apps = (user or {}).get("apps") or []
    keys = {url_key(a.get("url")) for a in apps} | {"s:" + strict_key(a) for a in apps}
    keys.discard("")
    return keys


def _tracked_by_title_only(user):
    return {"s:" + strict_key(a) for a in (user or {}).get("apps") or [] if not url_key(a.get("url"))}


def apply(user, listings_state, result):
    """Build the new listings.json content from a refresh result. Does not modify `user`."""
    listings_state = listings_state or {}
    tracked = tracked_keys(user)
    title_only = _tracked_by_title_only(user)
    dismissed = set((user or {}).get("dismissed") or [])
    previous = {l.get("id") for l in listings_state.get("listings") or []}
    info = dict(result["fetch"])
    excluded = dict(info.get("excluded") or {})
    fresh = []
    for l in result["listings"]:
        k = listing_key(l)
        has_url = bool(url_key(l.get("url")))
        alt = "k:" + norm_text(l["company"]) + "|" + norm_text(l["role"])
        strict = "s:" + strict_key(l)
        if k in dismissed or (not has_url and alt in dismissed):
            excluded["Dismissed"] = excluded.get("Dismissed", 0) + 1
            continue
        # A link match, or the same title (season and year included) when one side has no link to compare.
        if k in tracked or strict in title_only or (not has_url and strict in tracked):
            excluded["Already tracking"] = excluded.get("Already tracking", 0) + 1
            continue
        l["isNew"] = bool(previous) and l["id"] not in previous
        fresh.append(l)
    fresh_ids = {l["id"] for l in fresh}
    info["removed"] = sum(1 for l in listings_state.get("listings") or [] if l.get("id") not in fresh_ids
                          and listing_key(l) not in tracked and listing_key(l) not in dismissed)
    info["excluded"] = excluded
    info["matched"] = len(fresh)
    info["new"] = sum(1 for l in fresh if l["isNew"])
    info["savedClosed"] = [c["company"] for c in result.get("closures") or []]
    return {
        "lrev": int(listings_state.get("lrev", 0) or 0) + 1,
        "listings": fresh,
        "fetch": info,
        "closures": result.get("closures") or [],
        "liveChecked": result.get("liveChecked") or {},
        # Deadlines found in the postings of saved applications; the page fills an empty deadline, never overwrites yours.
        "savedDeadlines": result.get("savedDeadlines") or {},
    }


def failed(listings_state, error):
    """listings.json content after a refresh that failed: keep the listings, record the error."""
    out = dict(listings_state or {})
    info = dict(out.get("fetch") or {})
    info.update({"error": str(error)[:300], "at": now_local().isoformat(timespec="seconds")})
    out["fetch"] = info
    out["closures"] = []
    out["lrev"] = int(out.get("lrev", 0) or 0) + 1
    return out


if __name__ == "__main__":
    import sys
    data = os.path.join(ROOT, "data")
    user = _read_json(os.path.join(data, "tracker.json")) or {}
    with refresh_lock(data) as got:
        if not got:
            sys.exit("A refresh is already running (the tracker server is refreshing). Try again in a minute.")
        res = refresh(user, _read_json(os.path.join(data, "listings.json")) or {}, log=lambda m: print(m, file=sys.stderr))
    print(json.dumps(res["fetch"], indent=2))
    print("kept:", len(res["listings"]))
    st = user.get("settings") or {}
    for l in sorted(res["listings"], key=lambda x: -score(x, st))[:25]:
        c = score_parts(l, st)
        print(f"{c['total']:3d}  {c['track']:5s} {l['company'][:22]:22s} {l['role'][:46]:46s} h1b={l['h1b']} sk={len(c['matched'])}/{len(l['skillsFound'])}")

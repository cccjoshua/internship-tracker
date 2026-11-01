"""Jobs sent from the Chrome extension ("clips").

The extension posts a job it read from the page you are on (LinkedIn, Handshake, company career sites,
job boards in Japan or Europe...). The server keeps it in data/clips.json and stores the posting text for
Claude analysis; the open tracker page then adds it to your applications (with Undo) and acknowledges it.
The server never edits tracker.json itself, so your edits and the clip can never overwrite each other.
"""
import json
import os
import re
import secrets
import threading
import datetime as dt
import urllib.parse

import fetcher

LOCK = threading.Lock()
PATH = ""
FIELDS = ("company", "role", "location", "url", "posted", "deadline", "source", "track", "status", "notes", "pay", "workMode")
TRACKING = re.compile(r"^(utm_|trk|tracking|ref|refid|src|source|gh_src|lever-|ccuid|cmp|campaign|fbclid|gclid|mc_|_hs|si$|position$|pagenum$|from$)", re.I)


def configure(data_dir):
    global PATH
    PATH = os.path.join(data_dir, "clips.json")


# ---- keys: the same rules as app.js (norm, urlKey, listingKey), so duplicates match across both
def norm(s):
    s = (s or "").lower()
    s = re.sub(r"\b(summer|fall|winter|spring|internship|intern|co-?op)\b|\b20\d\d\b", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


def safe_url(u):
    u = (u or "").strip()
    if u and not re.match(r"^[a-z][a-z0-9+.-]*:", u, re.I) and re.match(r"^[\w-]+(\.[\w-]+)+(/|$)", u):
        u = "https://" + u
    return u if re.match(r"^https?://[^\s\"'<>]+$", u, re.I) else ""


def url_key(u):
    u = safe_url(u).lower()
    return re.sub(r"/+$", "", re.sub(r"#.*$", "", u))


def listing_key(url, company, role):
    return url_key(url) or ("k:" + norm(company) + "|" + norm(role))


def canonical_url(u):
    """Strip tracking parameters; LinkedIn and Handshake links collapse to the job's own address."""
    u = safe_url(u)
    if not u:
        return ""
    p = urllib.parse.urlsplit(u)
    host = p.netloc.lower()
    if "linkedin.com" in host:
        q = urllib.parse.parse_qs(p.query)
        m = re.search(r"/jobs/view/(?:[^/]*?-)?(\d{6,})", p.path) or (re.match(r"(\d{6,})", (q.get("currentJobId") or [""])[0]))
        if m:
            return f"https://www.linkedin.com/jobs/view/{m.group(1)}/"
    if "joinhandshake.com" in host:
        m = re.search(r"/(?:jobs|job-search|stu/postings)/(\d+)", p.path) or re.search(r"(\d{5,})", urllib.parse.parse_qs(p.query).get("jobId", [""])[0])
        if m:
            return f"https://app.joinhandshake.com/jobs/{m.group(1)}"
    q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True) if not TRACKING.match(k)]
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, urllib.parse.urlencode(q), ""))


# ---- storage
def _read():
    try:
        with open(PATH, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) and isinstance(d.get("pending"), list) else {"pending": []}
    except (OSError, ValueError):
        return {"pending": []}


def _write(d):
    tmp = PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, PATH)


def pending():
    with LOCK:
        return _read()["pending"]


def ack(ids, saved_ids=None):
    """Remove clips from the queue. With saved_ids (the application ids in tracker.json), a clip the page says it
    added is removed only once it is really saved there; duplicates the page skipped are passed in ids too."""
    ids = set(ids or [])
    if saved_ids is not None:
        ids = {i for i in ids if i in saved_ids}
    with LOCK:
        d = _read()
        before = len(d["pending"])
        d["pending"] = [c for c in d["pending"] if c.get("id") not in ids]
        if len(d["pending"]) != before:
            _write(d)
        return before - len(d["pending"])


# ---- what the extension asks
def find(state, url, company, role):
    """An application you already track, or a clip still waiting for the page, that matches this job."""
    u, k = url_key(canonical_url(url) or url), norm(company) + "|" + norm(role)
    for a in (state or {}).get("apps") or []:
        if (u and url_key(a.get("url")) == u) or (norm(a.get("company")) + "|" + norm(a.get("role")) == k and norm(company)):
            hist = a.get("history") or []
            applied = next((h.get("d") for h in hist if h.get("s") == "applied"), "") or a.get("applied") or ""
            return {"id": a.get("id"), "status": a.get("status"), "company": a.get("company"), "role": a.get("role"), "applied": applied, "pending": False}
    for c in pending():
        if (u and url_key(c.get("url")) == u) or (norm(c.get("company")) + "|" + norm(c.get("role")) == k and norm(company)):
            return {"id": c["id"], "status": c.get("status", "saved"), "company": c.get("company"), "role": c.get("role"), "applied": "", "pending": True}
    return None


def sponsor_of(text):
    sig = fetcher.sponsorship_signals(text or "")
    return "no" if sig["noSponsor"] else "yes" if sig["friendly"] else "unknown"


def _date(s):
    s = (s or "").strip()[:10]
    return s if re.match(r"^\d{4}-\d{2}-\d{2}$", s) else ""


def add(body, state):
    """Validate a clip and queue it. Returns (clip, duplicate-or-None)."""
    c = {k: str(body.get(k) or "").strip()[:2000] for k in FIELDS}
    c["company"], c["role"] = c["company"][:120], c["role"][:200]
    if not c["company"] or not c["role"]:
        raise ValueError("Company and role are required.")
    c["url"] = canonical_url(c["url"])
    c["posted"], c["deadline"] = _date(c["posted"]), _date(c["deadline"])
    c["status"] = "applied" if c["status"] == "applied" else "saved"
    desc = str(body.get("description") or "")[:60000]
    c["sponsor"] = sponsor_of(desc)
    c["track"] = c["track"] if c["track"] in ("SWE", "DE", "DA", "DS", "BIE") else (fetcher.infer_track(c["role"]) if fetcher.infer_track(c["role"]) in ("SWE", "DE", "DA", "DS", "BIE") else "")
    dup = find(state, c["url"], c["company"], c["role"])
    if dup:
        return None, dup
    c["id"] = secrets.token_hex(6)
    c["key"] = listing_key(c["url"], c["company"], c["role"])
    c["at"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    c["hasText"] = len(desc.strip()) >= 200
    with LOCK:
        d = _read()
        d["pending"].append(c)
        _write(d)
    return c, None

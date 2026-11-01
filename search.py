"""Server-side search for the ⌘K palette: listings that your filters hide.

The page searches its own data (applications, visible listings, documents, settings) locally with search.js.
Hidden listings are thousands of feed entries the page never downloads, so they are searched here.

- norm() mirrors norm() in search.js (lowercase, accents folded, spaces collapsed); tests/test_search.py checks parity.
- The index is built from the cached feed and rebuilt only when the cache file or the filters change
  (that is, after a listing refresh or a settings change), never per request.
- Read-only: it never writes your data, and it sends nothing anywhere.
"""
import datetime as dt
import json
import os
import re
import threading
import unicodedata

import fetcher

_SPLIT = re.compile(r"[\s,./·|()\-–—:+]+")


def norm(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if not ("̀" <= c <= "ͯ")).lower()
    return re.sub(r"\s+", " ", s).strip()


def tokens(s):
    return [t for t in _SPLIT.split(norm(s)) if t]


def _osa(a, b, cap):
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    p2, p1 = None, list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i]
        for j in range(1, len(b) + 1):
            v = min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + (a[i - 1] != b[j - 1]))
            if p2 is not None and i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                v = min(v, p2[j - 2] + 1)
            cur.append(v)
        if min(cur) > cap:
            return cap + 1
        p2, p1 = p1, cur
    return p1[-1]


def _cap(n):
    return 0 if n < 4 else 1 if n < 8 else 2


def _match(tok, text, words, whole=None):
    """Same tiers as search.js: exact 100 > prefix 80 > word start 60 > substring 40 > one typo 20."""
    if not text:
        return 0
    if whole and text == whole:
        return 100
    if text.startswith(tok):
        return 80
    if any(w.startswith(tok) for w in words):
        return 60
    if tok in text:
        return 40
    cap = _cap(len(tok))
    if cap:
        for w in words:
            for L in (len(tok), len(tok) - 1, len(tok) + 1):
                if 3 <= L <= len(w) and _osa(tok, w[:L], cap) <= cap:
                    return 20
    return 0


def hidden_reason(it, flt, window, now, visible):
    """Why the refresh leaves this feed entry out, in the order fetcher.refresh() checks.
    None means it is not hidden (inactive, too old to count, or shown in New listings)."""
    if not it.get("active") or not it.get("is_visible", True):
        return None
    if not set(flt["terms"]) & set(it.get("terms") or []):
        return "Not " + " / ".join(flt["terms"])
    posted = dt.datetime.fromtimestamp(it.get("date_posted") or 0).astimezone()
    if (now - posted).days > window:
        return None
    if not fetcher.region_ok(it.get("locations"), flt["regions"]):
        return "Outside the US" if not flt["regions"] else "Outside your regions"
    degrees = it.get("degrees") or []
    if degrees and not (flt["degrees"] & set(degrees)):
        return "PhD/MBA only" if flt["degrees"] == {"Bachelor's", "Master's"} else "Degree level not yours"
    if it.get("sponsorship") == "U.S. Citizenship is Required" or re.search(r"clearance|u\.?s\.? citizen", it.get("title", ""), re.I):
        return "Citizenship or clearance required"
    if fetcher.infer_track(it.get("title", ""), it.get("category", "")) == "Other":
        return "Not a target field"
    if fetcher.url_key(it.get("url")) in visible:
        return None
    return "Deadline passed, dismissed or already tracking"


class HiddenIndex:
    """Hidden feed entries, normalized once. Thread-safe; rebuilt when the feed cache or the filters change."""

    def __init__(self):
        self._lock = threading.Lock()
        self._key = None
        self._rows = []

    def _build(self, feed, listings, settings):
        flt = fetcher.filters_of(settings)
        window = int(fetcher._num(settings.get("windowDays"), 10) or 10)
        now = fetcher.now_local()
        visible = set()
        for l in listings:
            for u in [l.get("url")] + list(l.get("altUrls") or []):
                if u:
                    visible.add(fetcher.url_key(u))
        rows, seen = [], set()
        for it in feed:
            reason = hidden_reason(it, flt, window, now, visible)
            if not reason:
                continue
            co, role = it.get("company_name") or "", it.get("title") or ""
            k = norm(co) + "|" + norm(role)
            if k in seen:  # the feed repeats an entry per location
                continue
            seen.add(k)
            nco, nrole = norm(co), norm(role)
            rows.append({"id": it.get("id") or k, "company": co, "role": role, "reason": reason, "url": it.get("url") or "",
                         "posted": it.get("date_posted") or 0, "_c": nco, "_r": nrole, "_cw": tokens(co), "_rw": tokens(role)})
        rows.sort(key=lambda r: r["posted"], reverse=True)
        return rows

    def rows(self, feed_path, listings_path, settings, load):
        try:
            key = (os.path.getmtime(feed_path), os.path.getmtime(listings_path) if os.path.exists(listings_path) else 0,
                   json.dumps(fetcher.filters_of(settings), sort_keys=True, default=sorted), settings.get("windowDays"))
        except OSError:
            return []
        with self._lock:
            if key != self._key:
                feed, listings = load()
                self._rows = self._build(feed or [], listings or [], settings or {})
                self._key = key
            return self._rows

    @staticmethod
    def search(rows, q, limit=30):
        toks, whole = tokens(q), norm(q)
        if not toks:
            return []
        out = []
        for r in rows:
            total = 0
            for t in toks:
                s = max(_match(t, r["_c"], r["_cw"], whole if len(toks) == 1 else None), _match(t, r["_r"], r["_rw"]) * 0.75)
                if not s:
                    break
                total += s
            else:
                out.append((total / len(toks), r))
        out.sort(key=lambda x: (-x[0], -x[1]["posted"]))
        return [{k: v for k, v in r.items() if not k.startswith("_")} for _, r in out[:limit]]


HIDDEN = HiddenIndex()

/* Internship Tracker search: normalizing, indexing and ranking for the ⌘K palette.
   Loaded by the page (window.IATSearch) and by Node for tests (module.exports). No DOM access.
   search.py mirrors norm() for the server's hidden-listings search; tests/test_search.py keeps them identical.

   Ranking, per query token and field:  exact (whole field) > prefix > word start > substring > fuzzy (one typo).
   Every token must match some field. Recent and active items get a boost; closed items a penalty. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IATSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TIER = { exact: 100, prefix: 80, word: 60, sub: 40, fuzzy: 20 };
  const FOLD = /[̀-ͯ]/g;

  /* Lowercase, accent-folded text with a map back to the original character positions (for highlighting). */
  function fold(s) {
    s = String(s == null ? '' : s);
    let out = ''; const map = [];
    for (let i = 0; i < s.length; i++) {
      const f = s[i].normalize('NFD').replace(FOLD, '').toLowerCase();
      for (let j = 0; j < f.length; j++) { out += f[j]; map.push(i); }
    }
    return { s: out, map };
  }
  const norm = (s) => fold(s).s.replace(/\s+/g, ' ').trim();
  const tokens = (s) => norm(s).split(/[\s,./·|()\-–—:+]+/).filter(Boolean);

  /* Start positions of the words in a folded string. */
  function wordStarts(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) if (/[a-z0-9぀-ヿ一-鿿#+]/.test(s[i]) && (i === 0 || !/[a-z0-9#+]/.test(s[i - 1]))) out.push(i);
    return out;
  }

  /* Optimal string alignment distance, capped: returns cap + 1 as soon as the distance must exceed it. */
  function osa(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    let p2 = null, p1 = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
        cur.push(v); if (v < best) best = v;
      }
      if (best > cap) return cap + 1;
      p2 = p1; p1 = cur;
    }
    return p1[b.length];
  }
  const WORD = /^[^\s,./·|()\-–—:+]+/;
  const typoCap = (n) => (n < 4 ? 0 : n < 8 ? 1 : 2);

  /* Prepare one field for matching. */
  function field(text, weight) {
    const f = fold(text), starts = wordStarts(f.s);
    const words = starts.map((st) => { const m = WORD.exec(f.s.slice(st)); return m ? m[0] : ''; });
    return { text: String(text == null ? '' : text), s: f.s, map: f.map, starts, words, w: weight };
  }

  /* Best match of one token in one field: { score, at, len } or null. */
  function matchToken(tok, fl, whole, fuzzy) {
    const s = fl.s; if (!s) return null;
    if (whole && s === whole) return { score: TIER.exact, at: 0, len: s.length };
    if (s.startsWith(tok)) return { score: TIER.prefix, at: 0, len: tok.length };
    for (const i of fl.starts) if (s.startsWith(tok, i)) return { score: TIER.word, at: i, len: tok.length };
    const i = s.indexOf(tok);
    if (i >= 0) return { score: TIER.sub, at: i, len: tok.length };
    if (fuzzy) {
      const near = fuzzy.get(tok);
      if (near) for (let k = 0; k < fl.starts.length; k++) if (near.has(fl.words[k])) return { score: TIER.fuzzy, at: fl.starts[k], len: Math.min(fl.words[k].length, tok.length + 1) };
    }
    return null;
  }

  /* doc: { id, group, title, sub?, extra?, boost? (number), ... any payload }.
     Fields: title (weight 1), sub (0.75), extra (0.5, never highlighted). */
  function buildIndex(docs) {
    const ix = docs.map((d) => ({ doc: d, f: [field(d.title, 1), field(d.sub, 0.75), field(d.extra, 0.5)] }));
    /* Vocabulary: each distinct word → the entries that contain it. Typo matching scans words, not documents. */
    const vocab = new Map();
    ix.forEach((e, n) => {
      for (const fl of e.f) for (const w of fl.words) {
        if (w.length < 3) continue;
        let set = vocab.get(w); if (!set) vocab.set(w, (set = new Set())); set.add(n);
      }
    });
    ix.vocab = vocab;
    return ix;
  }
  /* Words within the typo budget of each token (token → Set of words), and the entries that hold any of them. */
  function typoWords(ix, toks) {
    const near = new Map(), cand = new Set();
    for (const t of toks) {
      const cap = typoCap(t.length); if (!cap || near.has(t)) continue;
      const set = new Set(); near.set(t, set);
      for (const [w, ents] of ix.vocab || []) {
        if (w[0] !== t[0] && w[0] !== t[1] && w[1] !== t[0]) continue; // a typo in the first two letters at once is rare
        for (const L of [t.length, t.length - 1, t.length + 1]) {
          if (L < 3 || L > w.length) continue;
          if (osa(t, w.slice(0, L), cap) <= cap) { set.add(w); for (const n of ents) cand.add(n); break; }
        }
      }
    }
    return { near, cand };
  }

  function scoreEntry(e, toks, whole, fuzzy) {
    let total = 0; const hits = [[], []];
    for (const t of toks) {
      let best = null, bi = -1;
      for (let k = 0; k < 3; k++) {
        const m = matchToken(t, e.f[k], toks.length === 1 ? whole : null, fuzzy);
        if (m && (!best || m.score * e.f[k].w > best.score * e.f[best.k].w)) { best = Object.assign(m, { k }); bi = k; }
      }
      if (!best) return null;
      total += best.score * e.f[bi].w;
      if (bi < 2) hits[bi].push([best.at, best.len]);
    }
    if (toks.length > 1 && e.f[0].s === whole) total += TIER.exact; // whole multi-word title typed
    else if (toks.length > 1 && e.f[0].s.startsWith(whole)) total += TIER.prefix / 2;
    total = total / toks.length + (+e.doc.boost || 0);
    return { score: total, hits };
  }

  /* Ranked results: [{ doc, score, title: [[start,end],...], sub: [[start,end],...] }], best first.
     Highlight ranges are in original-string positions. */
  function search(index, query, opt) {
    opt = opt || {};
    const whole = norm(query), toks = tokens(query);
    if (!toks.length) return [];
    /* Pass 1 without typo tolerance; pass 2 tries typos only when pass 1 found few results (keeps keystrokes fast). */
    const out = [], miss = [];
    index.forEach((e, n) => {
      if (opt.filter && !opt.filter(e.doc)) return;
      const r = scoreEntry(e, toks, whole, false);
      if (r) out.push({ doc: e.doc, score: r.score, e, hits: r.hits });
      else miss.push(n);
    });
    if (out.length < (opt.fuzzyBelow || 10) && toks.some((t) => typoCap(t.length))) {
      const { near, cand } = typoWords(index, toks);
      for (const n of miss) {
        if (!cand.has(n)) continue;
        const e = index[n];
        const r = scoreEntry(e, toks, whole, near);
        if (r) out.push({ doc: e.doc, score: r.score, e, hits: r.hits });
      }
    }
    out.sort((a, b) => b.score - a.score || (a.doc.title < b.doc.title ? -1 : a.doc.title > b.doc.title ? 1 : 0));
    const top = opt.limit ? out.slice(0, opt.limit) : out;
    return top.map((r) => ({ doc: r.doc, score: r.score, title: ranges(r.e.f[0], r.hits[0]), sub: ranges(r.e.f[1], r.hits[1]) }));
  }

  /* Map folded [at,len] hits to merged [start,end) ranges in the original text. */
  function ranges(fl, hits) {
    const r = hits.filter((h) => h[1] > 0).map(([at, len]) => [fl.map[at], fl.map[Math.min(at + len, fl.map.length) - 1] + 1]).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const x of r) { const last = out[out.length - 1]; if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else out.push(x.slice()); }
    return out;
  }

  /* Escape HTML and wrap ranges in <mark>. */
  function highlight(text, rs, esc) {
    text = String(text == null ? '' : text);
    let out = '', i = 0;
    for (const [a, b] of rs || []) { out += esc(text.slice(i, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; i = b; }
    return out + esc(text.slice(i));
  }

  /* Group ranked results under fixed headers. Groups are ordered by their best hit; each keeps at most `per` rows
     (or `per[group]`), and at most `max` rows overall. */
  function group(results, order, per, max) {
    const by = new Map();
    for (const r of results) { const g = r.doc.group; if (!by.has(g)) by.set(g, []); by.get(g).push(r); }
    const groups = [...by.entries()].filter(([g]) => order.includes(g))
      .sort((a, b) => b[1][0].score - a[1][0].score || order.indexOf(a[0]) - order.indexOf(b[0]));
    let left = max || 50; const out = [];
    for (const [g, rs] of groups) {
      if (left <= 0) break;
      const cap = Math.min(left, typeof per === 'object' ? (per[g] || 8) : (per || 8));
      out.push({ group: g, items: rs.slice(0, cap), more: Math.max(0, rs.length - cap) }); left -= Math.min(cap, rs.length);
    }
    return out;
  }

  return { norm, tokens, fold, osa, buildIndex, search, group, highlight, matchToken: (t, text) => { const ix = buildIndex([{ title: text }]); return matchToken(norm(t), ix[0].f[0], norm(t), typoWords(ix, [norm(t)]).near); }, TIER };
});

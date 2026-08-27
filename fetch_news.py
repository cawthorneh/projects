#!/usr/bin/env python3
"""
Water-news aggregator for the Dripping Rainwater dashboard.

Pulls every feed in `news_sources.py`, scores each entry for relevance,
drops the noise and the duplicates, and writes a static `docs/news.json`
that `docs/news.html` renders. Standard library only — no pip install, so
it runs anywhere (GitHub Actions, a Mac, iSH on a phone).

Usage
-----
    python3 fetch_news.py                    # write docs/news.json
    python3 fetch_news.py --check            # feed health report, no write
    python3 fetch_news.py --verbose          # show per-item scoring
    python3 fetch_news.py --out somewhere.json
    python3 fetch_news.py --only local,policy

Exit codes: 0 ok, 1 nothing usable was fetched.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sys
import time
import unicodedata
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

import news_sources as cfg

# Sentinel scores, well below any real MIN_SCORE.
BLOCKED = -999.0
OFF_TOPIC = -998.0

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 "
    "DrippingRainwaterNewsBot/1.0 (+https://drippingrainwater.com)"
)
TIMEOUT = 25
RETRIES = 2

# Namespaces that show up in the wild.
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
    "dc": "http://purl.org/dc/elements/1.1/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rss1": "http://purl.org/rss/1.0/",
}

# Tracking junk stripped from URLs before de-duplication.
TRACKING_PARAMS = re.compile(
    r"^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ito$|ref$|source$|amp$|s_cid$|cmpid$)",
    re.I,
)


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def http_get(url: str) -> tuple[bytes, int]:
    """Fetch a URL, transparently decoding gzip/deflate. Raises on failure."""
    last_exc: Exception | None = None
    for attempt in range(RETRIES + 1):
        try:
            req = Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/rss+xml, application/atom+xml, "
                              "application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate",
                },
            )
            with urlopen(req, timeout=TIMEOUT) as resp:
                raw = resp.read()
                enc = (resp.headers.get("Content-Encoding") or "").lower()
                if "gzip" in enc:
                    raw = gzip.decompress(raw)
                elif "deflate" in enc:
                    raw = zlib.decompress(raw, -zlib.MAX_WBITS)
                return raw, resp.status
        except Exception as exc:              # noqa: BLE001 — report, don't crash
            last_exc = exc
            if attempt < RETRIES:
                time.sleep(1.5 * (attempt + 1))
    raise last_exc                            # type: ignore[misc]


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------
class NotAFeed(Exception):
    """The URL returned something well-formed that isn't a feed (usually HTML)."""


def _text(el) -> str:
    return "".join(el.itertext()).strip() if el is not None else ""


def _strip_html(s: str) -> str:
    s = re.sub(r"(?is)<(script|style).*?</\1>", " ", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    s = unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def _parse_date(raw: str) -> datetime | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:                                       # RFC 822 (RSS)
        dt = parsedate_to_datetime(raw)
        if dt is not None:
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:                          # noqa: BLE001
        pass
    iso = raw.replace("Z", "+00:00")
    for candidate in (iso, iso[:19], iso[:10]):
        try:                                   # ISO 8601 (Atom)
            dt = datetime.fromisoformat(candidate)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _find_image(entry) -> str:
    """Pull a usable thumbnail out of whichever element the feed used."""
    for el in entry.iter():
        if el.tag.split("}")[-1] not in ("content", "thumbnail", "enclosure", "image"):
            continue
        url = el.get("url") or el.get("href") or ""
        typ = (el.get("type") or "").lower()
        if url and (typ.startswith("image")
                    or re.search(r"\.(jpe?g|png|webp|gif)(\?|$)", url, re.I)):
            return url
    # Fall back to the first <img> inside the description/content HTML.
    for el in entry.iter():
        if el.tag.split("}")[-1] in ("description", "encoded", "summary", "content"):
            m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', el.text or "", re.I)
            if m:
                return m.group(1)
    return ""


def stable_id(text: str) -> str:
    """Content-addressed id so re-runs produce identical JSON for identical news."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]


def parse_feed(raw: bytes) -> list[dict]:
    """Parse RSS 2.0, RSS 1.0/RDF, or Atom into a list of raw entry dicts."""
    # Some publishers ship a stray BOM or leading whitespace before <?xml.
    raw = raw.lstrip(b"\xef\xbb\xbf \r\n\t")
    root = ET.fromstring(raw)

    root_tag = root.tag.split("}")[-1].lower()
    if root_tag not in ("rss", "feed", "rdf", "channel"):
        # A well-formed HTML error page parses fine and yields zero items,
        # which would otherwise be reported as a merely "empty" feed.
        raise NotAFeed(f"root element is <{root_tag}>, not an RSS or Atom feed")

    entries = (
        root.findall(".//item")
        + root.findall(f".//{{{NS['rss1']}}}item")
        + root.findall(f".//{{{NS['atom']}}}entry")
    )

    out = []
    for e in entries:
        def first(*paths):
            for p in paths:
                el = e.find(p)
                if el is not None:
                    return el
            return None

        title = _text(first("title", f"{{{NS['atom']}}}title", f"{{{NS['rss1']}}}title"))

        # Atom puts the URL in <link href>; RSS in the element text.
        link = ""
        link_el = first("link", f"{{{NS['atom']}}}link", f"{{{NS['rss1']}}}link")
        if link_el is not None:
            link = (link_el.get("href") or link_el.text or "").strip()
        if not link:
            for cand in e.findall(f"{{{NS['atom']}}}link"):
                if cand.get("rel", "alternate") == "alternate" and cand.get("href"):
                    link = cand.get("href", "").strip()
                    break
        if not link:
            link = _text(first("guid")) if _text(first("guid")).startswith("http") else ""

        summary = _text(first(
            "description",
            f"{{{NS['content']}}}encoded",
            f"{{{NS['atom']}}}summary",
            f"{{{NS['atom']}}}content",
            f"{{{NS['rss1']}}}description",
        ))

        published = _text(first(
            "pubDate",
            f"{{{NS['dc']}}}date",
            f"{{{NS['atom']}}}published",
            f"{{{NS['atom']}}}updated",
            "date",
        ))

        author = _text(first("author", f"{{{NS['dc']}}}creator")) or ""
        if not author:
            a = e.find(f"{{{NS['atom']}}}author")
            if a is not None:
                author = _text(a.find(f"{{{NS['atom']}}}name"))

        if title and link:
            out.append({
                "title": _strip_html(title),
                "link": link,
                "summary": _strip_html(summary),
                "published_raw": published,
                "author": _strip_html(author),
                "image": _find_image(e),
            })
    return out


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------
def canonical_url(url: str) -> str:
    """Drop tracking params and trailing slashes so duplicates collapse."""
    try:
        p = urlparse(url)
    except ValueError:
        return url
    q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
         if not TRACKING_PARAMS.match(k)]
    path = p.path.rstrip("/") or "/"
    return urlunparse((p.scheme.lower(), p.netloc.lower(), path, "", urlencode(q), ""))


_STOPWORDS = {
    "the", "a", "an", "of", "in", "on", "to", "for", "and", "is", "at", "as",
    "by", "with", "from", "that", "this", "it", "its", "be", "are", "was",
    "were", "will", "would", "has", "have", "had", "new", "after", "over",
    "into", "amid", "says", "said", "than", "then", "but", "not", "you",
}


def _stem(word: str) -> str:
    """Crude suffix stripping, enough that 'repairs'/'repair' and
    'begin'/'beginning' compare equal. Two outlets rewriting the same story
    almost always differ by exactly this much."""
    for suffix in ("ing", "ed", "es", "s"):
        if len(word) - len(suffix) >= 4 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def title_tokens(title: str) -> frozenset[str]:
    """Significant word stems in a headline, for near-duplicate comparison."""
    s = unicodedata.normalize("NFKD", title.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return frozenset(_stem(w) for w in s.split()
                     if w not in _STOPWORDS and len(w) > 2)


# How much two headlines must overlap to count as the same story. The first
# live run published four separate write-ups of one Barton Springs repair and
# two of one Delhi ruling, because an exact-prefix key only catches syndicated
# copies that kept the original wording — staff rewrites sail straight past it.
#
# The measure is the overlap coefficient (shared / smaller set) rather than
# Jaccard, because headline lengths vary a lot for the same story: a wire
# one-liner and a 14-word local rewrite score badly on Jaccard no matter how
# completely the short one is contained in the long one.
DUPLICATE_OVERLAP = 0.6
MIN_SHARED_TOKENS = 4


def is_near_duplicate(tokens: frozenset[str], seen: list[frozenset[str]]) -> bool:
    if len(tokens) < MIN_SHARED_TOKENS:
        return False
    for other in seen:
        shared = len(tokens & other)
        if shared < MIN_SHARED_TOKENS:
            continue
        smaller = min(len(tokens), len(other))
        if smaller and shared / smaller >= DUPLICATE_OVERLAP:
            return True
    return False


def split_google_title(title: str) -> tuple[str, str]:
    """Google News appends ' - Publisher'. Recover the real publisher name.

    The first group is greedy so the split happens at the LAST ' - ', which is
    what makes hyphenated mastheads work: "Austin American-Statesman" and
    "San Antonio Express-News" both used to fall through to the bare hostname.
    """
    m = re.match(r"^(.*)\s+-\s+(.{2,60})$", title.strip())
    if m and not m.group(2).endswith((".", "?", "!")):
        return m.group(1).strip(), m.group(2).strip()
    return title.strip(), ""


def publisher_from_url(url: str) -> str:
    host = urlparse(url).netloc.lower().removeprefix("www.")
    return host.split(":")[0]


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
# Substring matching is a trap here: "law" fires on "lawn", "bill" on "billion",
# "well" on "dwelling". Every term list is compiled to a word-boundary regex
# instead. A trailing "*" marks a deliberate stem ("regenerat*" -> regenerated,
# regeneration, regenerative).
_TERM_RE_CACHE: dict[int, list[tuple[str, "re.Pattern[str]"]]] = {}


def _compiled(terms) -> list[tuple[str, "re.Pattern[str]"]]:
    key = id(terms)
    cached = _TERM_RE_CACHE.get(key)
    if cached is None:
        cached = []
        for term in terms:
            stem = term.endswith("*")
            body = re.escape(term[:-1] if stem else term)
            pattern = r"\b" + body + ("" if stem else r"\b")
            cached.append((term.rstrip("*"), re.compile(pattern, re.I)))
        _TERM_RE_CACHE[key] = cached
    return cached


def _hits(haystack: str, terms) -> tuple[int, list[str]]:
    found = [label for label, rx in _compiled(terms) if rx.search(haystack)]
    return len(found), found


def score_item(item: dict, feed: dict) -> tuple[float, dict]:
    """Return (score, detail). Detail is kept for --verbose and for tags."""
    title = item["title"].lower()
    body = item["summary"].lower()
    both = f"{title} {body}"
    cat = feed["category"]
    W = cfg.WEIGHTS
    TM = cfg.TITLE_MULTIPLIER

    # Hard block first — cheapest exit.
    n_blocked, blocked = _hits(both, cfg.BLOCK_TERMS)
    if n_blocked:
        return BLOCKED, {"blocked": blocked}

    # Topic gate: is this about our subject at all? A curated feed still runs
    # plenty of stories we have no business republishing.
    if not any(_hits(both, getattr(cfg, table))[0]
               for table in cfg.TOPIC_GATE[cat]):
        return OFF_TOPIC, {"off_topic": True}

    # Second gate for buckets where on-topic is not sufficient — policy must
    # be in a jurisdiction that applies here, research must actually be research.
    extra = cfg.EXTRA_GATE.get(cat)
    if extra and not any(_hits(both, getattr(cfg, table))[0] for table in extra):
        return OFF_TOPIC, {"off_topic": True, "failed_gate": cat}

    def tiered(terms, weight):
        t_n, t_found = _hits(title, terms)
        b_n, b_found = _hits(body, terms)
        return weight * (t_n * TM + b_n), sorted(set(t_found + b_found))

    s_rain, rain_terms = tiered(cfg.RAINWATER_TERMS, W["rainwater"])
    s_water, water_terms = tiered(cfg.WATER_TERMS, W["water"])
    s_policy, policy_terms = tiered(cfg.POLICY_TERMS, W["policy"])
    s_research, research_terms = tiered(cfg.RESEARCH_TERMS, W["research"])
    s_positive, positive_terms = tiered(cfg.POSITIVE_TERMS, W["positive"])
    s_local, local_terms = tiered(cfg.LOCAL_PLACES, W["local_place"])
    s_region, region_terms = tiered(cfg.REGION_TERMS, W["region"])

    # Diminishing returns. The term lists overlap on purpose ("rainwater",
    # "rainwater harvesting", "rainwater catchment" all fire on one headline),
    # so without caps a single very on-topic phrase would swamp everything else
    # and term-list overlap alone would decide the ranking.
    s_rain = min(s_rain, 24.0)
    s_water = min(s_water, 12.0)
    s_local = min(s_local, 12.0)
    s_policy = min(s_policy, 8.0)
    s_research = min(s_research, 8.0)
    s_positive = min(s_positive, 10.0)
    s_region = min(s_region, 4.0)

    score = s_rain + s_water + feed["weight"]

    if cat == "policy":
        score += s_policy
    elif cat == "research":
        score += s_research
    elif cat == "positive":
        score += s_positive
        n_neg, _ = _hits(both, cfg.NEGATIVE_TERMS)
        score += W["negative"] * min(n_neg, 4)
        # Good news that is only bad news wearing a hat doesn't belong here.
        if n_neg and not positive_terms:
            score -= 6.0
    else:  # local
        score += 0.5 * (s_policy + s_research)

    score += s_local + s_region

    # Knock back coverage from jurisdictions that don't apply here. A penalty
    # rather than a block, so a genuinely notable story can still surface.
    n_foreign, foreign_terms = _hits(both, cfg.NON_US_MARKERS)
    if n_foreign and not local_terms:
        score += W["non_us"] * min(n_foreign, 3)

    if feed["curated"]:
        score += cfg.CURATED_BONUS

    detail = {
        "rainwater": rain_terms,
        "water": water_terms,
        "policy": policy_terms,
        "research": research_terms,
        "positive": positive_terms,
        "local": local_terms,
        "region": region_terms,
        "non_us": foreign_terms,
        "base": round(score, 2),
    }
    return score, detail


def recency_factor(published: datetime | None, now: datetime) -> float:
    if published is None:
        return 0.6                     # undated: usable but never leads
    age_days = max((now - published).total_seconds() / 86400.0, 0.0)
    return 0.5 ** (age_days / cfg.HALF_LIFE_DAYS)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------
def collect_feed(feed: dict) -> dict:
    """Fetch and parse one feed. Never raises — failures come back as status."""
    started = time.time()
    result = {
        "id": feed["id"], "name": feed["name"], "url": feed["url"],
        "site": feed["site"], "category": feed["category"], "scope": feed["scope"],
        "status": "ok", "http_status": None, "item_count": 0,
        "error": None, "ms": 0, "entries": [],
    }
    try:
        raw, status = http_get(feed["url"])
        result["http_status"] = status
        entries = parse_feed(raw)
        result["entries"] = entries
        result["item_count"] = len(entries)
        if not entries:
            result["status"] = "empty"
            result["error"] = "feed parsed but contained no entries"
    except ET.ParseError as exc:
        result["status"] = "error"
        result["error"] = f"not valid XML: {exc}"
    except NotAFeed as exc:
        result["status"] = "error"
        result["error"] = str(exc)
    except Exception as exc:                   # noqa: BLE001
        result["status"] = "error"
        result["error"] = f"{type(exc).__name__}: {exc}"
    result["ms"] = int((time.time() - started) * 1000)
    return result


def build(feeds: list[dict], window_days: int, verbose: bool = False) -> dict:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=window_days)

    with ThreadPoolExecutor(max_workers=8) as pool:
        fetched = list(pool.map(collect_feed, feeds))

    by_id = {f["id"]: f for f in feeds}
    candidates: list[dict] = []
    rejected = {"score": 0, "stale": 0, "blocked": 0, "off_topic": 0}

    for res in fetched:
        feed = by_id[res["id"]]
        for entry in res["entries"]:
            published = _parse_date(entry["published_raw"])
            if published and published > now + timedelta(days=2):
                published = now              # clock-skewed feeds
            if published and published < cutoff:
                rejected["stale"] += 1
                continue

            raw_score, detail = score_item(entry, feed)
            if raw_score == BLOCKED:
                rejected["blocked"] += 1
                continue
            if raw_score == OFF_TOPIC:
                rejected["off_topic"] += 1
                continue
            if raw_score < cfg.MIN_SCORE[feed["category"]]:
                rejected["score"] += 1
                if verbose:
                    print(f"  drop {raw_score:6.1f}  {entry['title'][:78]}")
                continue

            title, gnews_publisher = split_google_title(entry["title"])
            source_name = gnews_publisher or feed["name"]
            if not gnews_publisher and feed["site"].startswith("https://news.google"):
                source_name = publisher_from_url(entry["link"])

            summary = entry["summary"]
            # Google News summaries are just a nest of links to the same story.
            if "news.google.com" in entry["link"] and len(summary) < 120:
                summary = ""
            if len(summary) > 340:
                summary = summary[:337].rsplit(" ", 1)[0] + "…"

            # Recency reorders what already qualified — it is deliberately not
            # part of the MIN_SCORE gate, so a strong story stays publishable
            # for the whole window instead of decaying out of it.
            final = raw_score * recency_factor(published, now)
            is_local = bool(detail["local"]) or feed["scope"] == "local"

            tags = []
            if detail["rainwater"]:
                tags.append("rainwater")
            if is_local:
                tags.append("hill-country")
            if detail["policy"] and feed["category"] != "policy":
                tags.append("policy")
            if detail["research"] and feed["category"] != "research":
                tags.append("research")

            candidates.append({
                "id": f"{feed['id']}:{stable_id(canonical_url(entry['link']))}",
                "title": title,
                "url": entry["link"],
                "canonical": canonical_url(entry["link"]),
                "source": source_name,
                "source_id": feed["id"],
                "source_site": feed["site"],
                "category": feed["category"],
                "scope": feed["scope"],
                "summary": summary,
                "author": entry["author"],
                "image": entry["image"],
                "published": published.isoformat() if published else None,
                "published_ts": int(published.timestamp()) if published else None,
                "local": is_local,
                "tags": tags,
                "score": round(final, 2),
                "raw_score": round(raw_score, 2),
                "matched": {k: v for k, v in detail.items() if k != "base" and v},
            })

    # ── De-duplicate: same URL, or near-identical headline ─────────────────
    candidates.sort(key=lambda i: i["score"], reverse=True)
    seen_urls: set[str] = set()
    seen_titles: list[frozenset[str]] = []
    deduped: list[dict] = []
    for item in candidates:
        if item["canonical"] in seen_urls:
            continue
        tokens = title_tokens(item["title"])
        if is_near_duplicate(tokens, seen_titles):
            continue
        seen_urls.add(item["canonical"])
        seen_titles.append(tokens)
        deduped.append(item)

    # ── Caps: per source, then per category ────────────────────────────────
    per_source: dict[str, int] = {}
    per_cat: dict[str, int] = {}
    published_items: list[dict] = []
    for item in deduped:
        sid, cat = item["source_id"], item["category"]
        if per_source.get(sid, 0) >= cfg.MAX_ITEMS_PER_SOURCE:
            continue
        if per_cat.get(cat, 0) >= cfg.MAX_ITEMS_PER_CATEGORY:
            continue
        per_source[sid] = per_source.get(sid, 0) + 1
        per_cat[cat] = per_cat.get(cat, 0) + 1
        published_items.append(item)
        if len(published_items) >= cfg.MAX_ITEMS_TOTAL:
            break

    counts = {c: sum(1 for i in published_items if i["category"] == c)
              for c in cfg.CATEGORY_IDS}
    categories = [dict(c, count=counts.get(c["id"], 0)) for c in cfg.CATEGORIES]
    sources = [{k: v for k, v in r.items() if k != "entries"} for r in fetched]
    healthy = sum(1 for s in sources if s["status"] == "ok")

    return {
        "generated_at": now.replace(microsecond=0).isoformat(),
        "window_days": window_days,
        "categories": categories,
        "counts": counts,
        "items": published_items,
        "sources": sources,
        "stats": {
            "feeds_total": len(sources),
            "feeds_ok": healthy,
            "feeds_failed": len(sources) - healthy,
            "entries_seen": sum(s["item_count"] for s in sources),
            "candidates": len(candidates),
            "after_dedupe": len(deduped),
            "published": len(published_items),
            "rejected": rejected,
        },
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def print_report(payload: dict) -> None:
    st = payload["stats"]
    print(f"\nGenerated {payload['generated_at']}  "
          f"({st['feeds_ok']}/{st['feeds_total']} feeds healthy)\n")
    if not payload["sources"]:
        print("  (no feeds selected)\n")
        return
    width = max(len(s["name"]) for s in payload["sources"]) + 2
    for s in sorted(payload["sources"], key=lambda x: (x["category"], x["name"])):
        mark = {"ok": "ok  ", "empty": "EMPTY", "error": "FAIL"}[s["status"]]
        line = (f"  [{mark:5}] {s['name']:<{width}} {s['category']:<9} "
                f"{s['item_count']:>3} entries  {s['ms']:>5}ms")
        if s["error"]:
            line += f"\n           -> {s['error']}"
        print(line)
    print(f"\n  entries seen {st['entries_seen']} -> candidates {st['candidates']} "
          f"-> deduped {st['after_dedupe']} -> published {st['published']}")
    print(f"  rejected: {st['rejected']}")
    print("  by category: " + ", ".join(
        f"{k}={v}" for k, v in payload["counts"].items()) + "\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="docs/news.json", help="output path")
    ap.add_argument("--check", action="store_true",
                    help="report feed health and exit without writing")
    ap.add_argument("--fail-on-unhealthy", action="store_true",
                    help="with --check, exit non-zero if any feed is unhealthy")
    ap.add_argument("--only", default="",
                    help="comma-separated categories to include")
    ap.add_argument("--window-days", type=int, default=cfg.WINDOW_DAYS)
    ap.add_argument("--verbose", action="store_true",
                    help="print items rejected on score")
    args = ap.parse_args(argv)

    feeds = cfg.FEEDS
    if args.only:
        wanted = {c.strip() for c in args.only.split(",") if c.strip()}
        unknown = wanted - set(cfg.CATEGORY_IDS)
        if unknown:
            ap.error(f"unknown category: {', '.join(sorted(unknown))}")
        feeds = [f for f in feeds if f["category"] in wanted]

    payload = build(feeds, args.window_days, verbose=args.verbose)
    print_report(payload)

    if args.check:
        if args.fail_on_unhealthy and payload["stats"]["feeds_failed"]:
            print(f"{payload['stats']['feeds_failed']} feed(s) unhealthy",
                  file=sys.stderr)
            return 1
        return 0 if payload["stats"]["feeds_ok"] else 1

    if not payload["items"]:
        # Refuse to overwrite a good file with an empty one — a transient
        # network problem shouldn't blank the dashboard on the live site.
        print("No items passed the filters; leaving the existing file in place.",
              file=sys.stderr)
        return 1

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                   encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size / 1024:.1f} KB, "
          f"{len(payload['items'])} stories)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

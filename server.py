#!/usr/bin/env python3
"""
stdlib-only LCRA Rainfall Dashboard server.
No pip required — uses only urllib, csv, http.server, json.

iSH / Alpine setup:
    apk add python3
    python3 server.py
Then open Safari and go to http://localhost:8000
"""

import csv
import json
import ssl
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import StringIO
from pathlib import Path

# ---------------------------------------------------------------------------
# Locations — edit here to add / remove places
# ---------------------------------------------------------------------------
LOCATIONS = [
    {"id": "dripping_springs", "label": "Dripping Springs", "search": "dripping springs"},
    {"id": "johnson_city",     "label": "Johnson City",     "search": "johnson city"},
    {"id": "fredericksburg",   "label": "Fredericksburg",   "search": "fredericksburg"},
    {"id": "canyon_lake",      "label": "Canyon Lake",      "search": "canyon lake"},
    {"id": "austin",           "label": "Austin",           "search": "austin"},
]

# ---------------------------------------------------------------------------
# LCRA CSV URLs
# ---------------------------------------------------------------------------
LCRA_URLS = {
    "rainfall":   "https://hydromet.lcra.org/media/Rainfall.csv",
    "five_day":   "https://hydromet.lcra.org/media/Rain5Day.csv",
    "month_year": "https://hydromet.lcra.org/media/RainMonthYear.csv",
}

# Column name variants (all lowercase) confirmed from LCRA CSV format
INTRADAY_COLS = {
    "Previous 1 hour":   ["previous 1 hour",   "prev 1 hour",   "1 hour"],
    "Previous 3 hours":  ["previous 3 hours",  "prev 3 hours",  "3 hours"],
    "Previous 6 hours":  ["previous 6 hours",  "prev 6 hours",  "6 hours"],
    "Previous 24 hours": ["previous 24 hours", "prev 24 hours", "24 hours"],
    "Since midnight":    ["since midnight",    "midnight"],
}
FIVE_DAY_COLS = {
    "Today":       ["today"],
    "Yesterday":   ["1 day ago",  "last24"],
    "2 Days Ago":  ["2 days ago"],
    "3 Days Ago":  ["3 days ago"],
    "4 Days Ago":  ["4 days ago"],
    "5-Day Total": ["5 day total"],
}
MONTHLY_COLS = {
    "This Month":   ["this month"],
    "30-Day Total": ["30 day total"],
    "This Year":    ["this year"],
    "Last Year":    ["last year"],
}

# ---------------------------------------------------------------------------
# Cache: {"rainfall": (rows, timestamp), ...}
# ---------------------------------------------------------------------------
_CACHE: dict = {}
CACHE_TTL = 600  # seconds

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    ),
    "Accept": "text/html,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://hydromet.lcra.org/",
}


def _fetch_csv(key: str) -> list[dict]:
    """Fetch a LCRA CSV and return rows as list of dicts (keys lowercased)."""
    now = time.time()
    if key in _CACHE and now - _CACHE[key][1] < CACHE_TTL:
        return _CACHE[key][0]

    url = LCRA_URLS[key]
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, context=_SSL_CTX, timeout=30) as resp:
        text = resp.read().decode("utf-8", errors="replace")

    reader = csv.DictReader(StringIO(text))
    rows = [{k.strip().lower(): v.strip() for k, v in row.items()} for row in reader]
    _CACHE[key] = (rows, now)
    print(f"[LCRA] fetched '{key}': {len(rows)} rows")
    return rows


def _loc_col(row: dict) -> str | None:
    for c in ("location", "site name", "sitename", "name", "station"):
        if c in row:
            return c
    return None


def _filter(rows: list[dict], search: str) -> list[dict]:
    if not rows:
        return []
    col = _loc_col(rows[0])
    if col is None:
        return []
    s = search.lower()
    return [r for r in rows if s in r.get(col, "").lower()]


def _mean(rows: list[dict], candidates: list[str]):
    """Average numeric value across rows for the first matching column."""
    for c in candidates:
        vals = []
        for r in rows:
            v = r.get(c, "")
            try:
                vals.append(float(v))
            except (ValueError, TypeError):
                pass
        if vals:
            return round(sum(vals) / len(vals), 2)
    return None


def _extract(rows: list[dict], spec: dict) -> dict:
    result = {}
    for label, candidates in spec.items():
        v = _mean(rows, candidates)
        if v is not None:
            result[label] = v
    return result


def _build_payload() -> dict:
    rain  = _fetch_csv("rainfall")
    fday  = _fetch_csv("five_day")
    month = _fetch_csv("month_year")

    results = []
    for loc in LOCATIONS:
        s = loc["search"]
        r_rain  = _filter(rain,  s)
        r_fday  = _filter(fday,  s)
        r_month = _filter(month, s)
        results.append({
            "id":       loc["id"],
            "label":    loc["label"],
            "stations": max(len(r_rain), len(r_fday), len(r_month)),
            "current":  _extract(r_rain,  INTRADAY_COLS),
            "five_day": _extract(r_fday,  FIVE_DAY_COLS),
            "monthly":  _extract(r_month, MONTHLY_COLS),
        })

    return {
        "locations":    results,
        "last_updated": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "cache_ttl_s":  CACHE_TTL,
    }


# ---------------------------------------------------------------------------
# HTTP request handler
# ---------------------------------------------------------------------------
STATIC_DIR = Path(__file__).parent / "docs"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} - {fmt % args}")

    def _send(self, code: int, content_type: str, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")

        # ── API: rainfall data ──────────────────────────────────────────────
        if path == "/api/rainfall":
            try:
                payload = _build_payload()
                body = json.dumps(payload).encode()
                self._send(200, "application/json", body)
            except urllib.error.HTTPError as e:
                msg = (
                    f"LCRA returned HTTP {e.code}. "
                    "The server blocks cloud IPs — run this on your home/office WiFi."
                    if e.code == 403 else str(e)
                )
                body = json.dumps({"detail": msg}).encode()
                self._send(502, "application/json", body)
            except Exception as e:
                body = json.dumps({"detail": str(e)}).encode()
                self._send(500, "application/json", body)
            return

        # ── API: locations list ─────────────────────────────────────────────
        if path == "/api/locations":
            body = json.dumps({"locations": LOCATIONS}).encode()
            self._send(200, "application/json", body)
            return

        # ── Static files ────────────────────────────────────────────────────
        if path == "" or path == "/":
            file_path = STATIC_DIR / "index.html"
        else:
            file_path = STATIC_DIR / path.lstrip("/")

        if file_path.exists() and file_path.is_file():
            ext = file_path.suffix.lower()
            ct_map = {".html": "text/html", ".css": "text/css",
                      ".js": "application/javascript", ".json": "application/json"}
            ct = ct_map.get(ext, "application/octet-stream")
            self._send(200, ct, file_path.read_bytes())
        else:
            self._send(404, "text/plain", b"Not found")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    PORT = 8000
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"""
╔══════════════════════════════════════════════╗
║   LCRA Rainfall Dashboard                    ║
║   Open Safari → http://localhost:{PORT}        ║
╚══════════════════════════════════════════════╝
Press Ctrl-C to stop.
""")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")

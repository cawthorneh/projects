"""
LCRA Rainfall Dashboard backend.

Fetches three CSV files from LCRA HydroMet and serves filtered data
for configured Texas locations.

Run:
    uvicorn app:app --reload

NOTE: LCRA's server blocks cloud provider IPs (Cloudflare protection).
Run this locally (residential / office IP) for live data.
"""

import asyncio
import logging
import time
import warnings
from io import StringIO

import httpx
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from locations import LOCATIONS

warnings.filterwarnings("ignore", message="Unverified HTTPS request")
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="LCRA Rainfall Dashboard")

# ---------------------------------------------------------------------------
# LCRA CSV endpoints
# ---------------------------------------------------------------------------
LCRA_URLS = {
    "rainfall":   "https://hydromet.lcra.org/media/Rainfall.csv",
    "five_day":   "https://hydromet.lcra.org/media/Rain5Day.csv",
    "month_year": "https://hydromet.lcra.org/media/RainMonthYear.csv",
}

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Referer": "https://hydromet.lcra.org/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
}

# Cache per CSV key: (DataFrame, timestamp)
_CACHE: dict[str, tuple[pd.DataFrame, float]] = {}
CACHE_TTL = 600  # 10 minutes

# ---------------------------------------------------------------------------
# Known column names from LCRA CSVs (confirmed via koverholt/rainfall-data)
# Primary key column is "location"; site numeric ID is "site".
# ---------------------------------------------------------------------------
# Rainfall.csv columns (one-day / intraday):
INTRADAY_COLS = {
    "Previous 1 hour":   ["previous 1 hour",   "prev 1 hour",   "1 hour",   "1hr"],
    "Previous 3 hours":  ["previous 3 hours",  "prev 3 hours",  "3 hours",  "3hr"],
    "Previous 6 hours":  ["previous 6 hours",  "prev 6 hours",  "6 hours",  "6hr"],
    "Previous 24 hours": ["previous 24 hours", "prev 24 hours", "24 hours", "24hr"],
    "Since midnight":    ["since midnight",    "midnight",      "since_midnight"],
}

# Rain5Day.csv columns:
FIVE_DAY_COLS = {
    "Today":       ["today"],
    "Yesterday":   ["1 day ago",  "last24"],
    "2 Days Ago":  ["2 days ago", "2_days_ago"],
    "3 Days Ago":  ["3 days ago", "3_days_ago"],
    "4 Days Ago":  ["4 days ago", "4_days_ago"],
    "5-Day Total": ["5 day total", "5_day_total"],
}

# RainMonthYear.csv columns:
MONTHLY_COLS = {
    "This Month":   ["this month",   "this_month"],
    "30-Day Total": ["30 day total", "30_day_total"],
    "This Year":    ["this year",    "this_year"],
    "Last Year":    ["last year",    "last_year"],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalise(df: pd.DataFrame) -> pd.DataFrame:
    """Lowercase and strip column names; leave values untouched."""
    df.columns = [str(c).strip().lower() for c in df.columns]
    return df


async def _fetch_csv(key: str) -> pd.DataFrame:
    now = time.time()
    if key in _CACHE and now - _CACHE[key][1] < CACHE_TTL:
        return _CACHE[key][0]

    url = LCRA_URLS[key]
    async with httpx.AsyncClient(verify=False, headers=_HEADERS, timeout=30, follow_redirects=True) as c:
        resp = await c.get(url)
        resp.raise_for_status()

    df = _normalise(pd.read_csv(StringIO(resp.text)))
    _CACHE[key] = (df, now)
    logger.info("Fetched '%s' — %d rows, columns: %s", key, len(df), list(df.columns))
    return df


def _location_col(df: pd.DataFrame) -> str | None:
    for name in ("location", "site name", "sitename", "name", "station"):
        if name in df.columns:
            return name
    return None


def _find_rows(df: pd.DataFrame, search: str) -> pd.DataFrame:
    col = _location_col(df)
    if col is None:
        return pd.DataFrame()
    return df[df[col].str.contains(search, case=False, na=False)]


def _best_value(rows: pd.DataFrame, candidates: list[str]):
    """Return mean of the first matching column that has numeric data, or None."""
    for c in candidates:
        if c in rows.columns:
            vals = pd.to_numeric(rows[c], errors="coerce").dropna()
            if not vals.empty:
                return round(float(vals.mean()), 2)
    return None


def _extract(rows: pd.DataFrame, spec: dict[str, list[str]]) -> dict:
    result = {}
    for label, candidates in spec.items():
        v = _best_value(rows, candidates)
        if v is not None:
            result[label] = v
    return result


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/rainfall")
async def get_rainfall():
    """
    Return rainfall inches for each configured location across three views:
    - current:  intraday periods (1h / 3h / 6h / 24h / since midnight)
    - five_day: today + last 4 days
    - monthly:  month-to-date, 30-day total, YTD
    """
    try:
        df_rain, df_5day, df_month = await asyncio.gather(
            _fetch_csv("rainfall"),
            _fetch_csv("five_day"),
            _fetch_csv("month_year"),
        )
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status == 403:
            raise HTTPException(
                status_code=502,
                detail=(
                    "LCRA returned 403 Forbidden. "
                    "The LCRA HydroMet server blocks requests from cloud/server IP ranges. "
                    "Run this app on a local machine (residential or office network) for live data."
                ),
            )
        raise HTTPException(status_code=502, detail=f"LCRA HTTP error {status}")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Network error fetching LCRA data: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    results = []
    for loc in LOCATIONS:
        search = loc["search"]
        rows_rain  = _find_rows(df_rain,  search)
        rows_5day  = _find_rows(df_5day,  search)
        rows_month = _find_rows(df_month, search)

        results.append({
            "id":       loc["id"],
            "label":    loc["label"],
            "stations": int(max(len(rows_rain), len(rows_5day), len(rows_month))),
            "current":  _extract(rows_rain,  INTRADAY_COLS),
            "five_day": _extract(rows_5day,  FIVE_DAY_COLS),
            "monthly":  _extract(rows_month, MONTHLY_COLS),
        })

    return {
        "locations":    results,
        "last_updated": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "cache_ttl_s":  CACHE_TTL,
    }


@app.get("/api/debug/columns")
async def debug_columns():
    """Inspect raw CSV column names — use this when adding new locations or debugging."""
    try:
        df_rain, df_5day, df_month = await asyncio.gather(
            _fetch_csv("rainfall"),
            _fetch_csv("five_day"),
            _fetch_csv("month_year"),
        )
        return {
            "rainfall_columns":   list(df_rain.columns),
            "five_day_columns":   list(df_5day.columns),
            "month_year_columns": list(df_month.columns),
            "rainfall_sample":    df_rain.head(5).to_dict(orient="records"),
            "five_day_sample":    df_5day.head(5).to_dict(orient="records"),
            "month_year_sample":  df_month.head(5).to_dict(orient="records"),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/locations")
async def list_locations():
    """Return the configured location list — useful for verifying station setup."""
    return {"locations": LOCATIONS}


# Serve the static dashboard (must be last so API routes take precedence)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

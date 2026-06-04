# LCRA Rainfall Dashboard

Real-time rainfall dashboard for Texas Hill Country locations, pulling data from [LCRA HydroMet](https://hydromet.lcra.org/).

## Locations tracked

| Location | LCRA search pattern |
|---|---|
| Dripping Springs | `dripping springs` |
| Johnson City | `johnson city` |
| Fredericksburg | `fredericksburg` |
| Canyon Lake | `canyon lake` |
| Austin | `austin` |

Data is averaged across all matching LCRA gauges in each area.

## Views

| Tab | Data source | What it shows |
|---|---|---|
| **3 Most Recent Days** | `Rain5Day.csv` | Today · Yesterday · 2 Days Ago |
| **Intraday Periods** | `Rainfall.csv` | Prev 1h · 3h · 6h · 24h · Since midnight |
| **Monthly / YTD** | `RainMonthYear.csv` | This month · 30-day total · Year to date |

The summary strip at the bottom of each card always shows Today · 5-Day · Month.

## Setup

```bash
pip install -r requirements.txt
uvicorn app:app --reload
```

Then open **http://localhost:8000**.

> **Note:** LCRA HydroMet uses Cloudflare protection that blocks cloud-provider IP ranges.
> The app must run from a **residential or office network** to fetch live data.
> Running locally (your laptop) works fine.

## Adding locations

Edit `locations.py` and add an entry to `LOCATIONS`:

```python
{"id": "marble_falls", "label": "Marble Falls", "search": "marble falls"},
```

The `search` string is a case-insensitive substring matched against LCRA station names.
Use `/api/debug/columns` to inspect raw CSV data and verify column names.

## API endpoints

| Endpoint | Description |
|---|---|
| `GET /api/rainfall` | Filtered rainfall data for all configured locations |
| `GET /api/locations` | List of configured locations |
| `GET /api/debug/columns` | Raw CSV column names + sample rows (for debugging) |

Data is cached for 10 minutes to avoid hammering LCRA's servers.

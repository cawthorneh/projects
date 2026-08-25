# Rainfall Watch — Dripping Rainwater

48-hour rainfall totals for the Texas Hill Country, pulled live from
[LCRA Hydromet](https://hydromet.lcra.org/) and branded for
[Dripping Rainwater](https://www.drippingrainwater.com).

## Locations

| Location | County | Gauge match pattern |
|---|---|---|
| Dripping Springs | Hays | `dripping springs`, `dripping spr` |
| Austin | Travis | `austin` |
| Fredericksburg | Gillespie | `fredericksburg` |
| Johnson City | Blanco | `johnson city` |
| Blanco | Blanco | `blanco` (excluding `johnson city`) |

Patterns are case-insensitive substrings tested against the LCRA gauge name.
Every matching gauge is averaged, and each card lists the gauges it used so a
bad pattern shows up on screen instead of silently skewing a number.

## Branding

Colors are sampled directly from drippingrainwater.com: blue `#3066AB`, gold
`#D8B046`, sky `#6DABE1`, ground `#F4F7FA`. Type is
[Figtree](https://fonts.google.com/specimen/Figtree), a close match to the
site's headings; swap `--font` in `docs/index.html` if the real family differs.

The header carries the real heron logo, embedded as a base64 PNG data URI so
the page stays a single self-contained file. It is quantised to 64 colors at
600px wide (~16KB, visually identical to the source at display size); the
favicon is the droplet mark cropped from the same asset. To swap in a new
logo, replace the `src` on `img.logo` and the `href` on `link[rel=icon]`.

## What the 48-hour number means

LCRA publishes no rolling 48-hour field. The closest two-day window available
is **yesterday's full-day total plus today's rain since midnight**, taken from
`Rain5Day.csv` — so the figure covers between 24 and 48 hours depending on the
time of day. Each card also shows the rolling **last 24 hours** and **last
hour** from `Rainfall.csv` for finer resolution.

The gallons estimate assumes 0.6233 gal per ft² per inch at 85% collection
efficiency, which allows for first-flush diversion, splash and evaporation.

## Running it

The dashboard is a single self-contained file, `docs/index.html`. It needs no
backend — open it directly, or serve the folder:

```bash
python3 -m http.server -d docs 8000
```

It is also deployed to GitHub Pages from `docs/` on every push to `main`
(see `.github/workflows/pages.yml`).

### Optional Python backend

`app.py` (FastAPI) and `server.py` (stdlib only, for iSH and other no-pip
environments) serve the same page plus a JSON API:

```bash
pip install -r requirements.txt
uvicorn app:app --reload      # or: python3 server.py
```

| Endpoint | Description |
|---|---|
| `GET /api/rainfall` | All locations: `last_48h`, intraday, 5-day and monthly views |
| `GET /api/locations` | The configured location list |
| `GET /api/debug/columns` | Raw CSV column names and sample rows |

Responses are cached for 10 minutes.

## Network note

LCRA sits behind Cloudflare and blocks both cloud-provider IP ranges and
direct cross-origin browser requests:

- **The static page** relays through public CORS proxies, falling back through
  several in turn. If they are all down the page says so rather than showing
  stale or zeroed numbers.
- **The Python backend** must run from a residential or office network. From a
  cloud host, LCRA returns `403` and the API reports that plainly.

## Adding a location

Add an entry to `LOCATIONS` in **both** `locations.py` (backend) and the
`LOCATIONS` array in `docs/index.html` (page):

```python
{"id": "wimberley", "label": "Wimberley", "county": "Hays Co.",
 "match": ["wimberley"]},
```

Use `/api/debug/columns`, or LCRA's
[gauge list](https://hydromet.lcra.org/Home/GaugeDataList), to confirm gauge
names.

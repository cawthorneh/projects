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
`#D8B046`, sky `#6DABE1`. The page is light-only, like the site: cards sit on
a white ground and separate by border and shadow, with `#F4F7FA` tinting the
chips inside them. `color-scheme: light` stops browsers auto-darkening it.
Type is
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

## Embeddable components

`docs/rainfall-bar.js` is a standalone panel of the same 48-hour totals, built
in the site's own visual language: a white card with a gold eyebrow over a heavy
headline, readings in the stat grid the site uses elsewhere, and the gold
call-to-action with its arrow nested in a blue box. It reflows 5 → 3 → 2 columns
so every location stays visible without scrolling. It shares no code with the
dashboard, so a browser test asserts the two produce identical numbers from the
same fixture — if one drifts, that test fails.

```html
<div id="drw-rainfall-bar" data-dashboard="/rainfall"></div>
<script src="https://cawthorneh.github.io/projects/rainfall-bar.js"></script>
```

`data-dashboard` is the page the strip's **Full dashboard** button opens — put
the dashboard component on that page and the two are tied together. It defaults
to a site-relative `/rainfall` so the link works on whatever domain the paste
lands on; delete the attribute to hide the button.

Paste into a Webflow **Embed** element or any raw-HTML block. No libraries, no
build step. `data-dashboard` is optional and links the label to the full
dashboard. The file can also be pasted inline inside a `<script>` tag, in which
case it renders at that position and depends on nothing hosted.

`docs/rainfall-dashboard.js` is the full card dashboard as a component — the
same cards as the standalone page, without its logo bar and footer, which would
duplicate the site's own. Add `data-heading="off"` to the mount when the
surrounding section supplies its own heading.

```html
<div id="drw-rainfall-dashboard"></div>
<script src="https://cawthorneh.github.io/projects/rainfall-dashboard.js"></script>
```

`docs/webflow-embed.txt` and `docs/webflow-embed-dashboard.txt` wrap each
component as a single paste-ready block for a Webflow **Embed** element, with no
hosted file needed. Both are generated from the component sources, with the
`</script>` in each file's own usage comment escaped so it can't close the host
tag early — regenerate them whenever a component changes.

Open `docs/bar-demo.html` to preview the strip against the site's blue.

### Tank sizing calculator

`docs/tank-calculator.js` sizes a tank from roof area and household demand;
`docs/webflow-embed-calculator.txt` is the paste-ready block, and
`docs/calculator-demo.html` previews it. `data-cta="URL"` adds a contact button,
`data-heading="off"` drops the built-in heading.

Every assumption is a named constant at the top of the file — `RAIN_IN`,
`COLLECTION_EFFICIENCY`, `IRRIGATION_IN`, `POOL_IN`, `GPD`, `TANKS`,
`RESERVE_DAYS` — so the numbers can be tuned from field experience without
touching the logic.

**`RESERVE_DAYS` governs most recommendations, and has to.** A monthly balance
run on *average* rainfall gives every month some rain, so the tank never draws
down — that model sized a three-person home at 923 gallons. Averages smooth away
the drought the tank exists to cover. The tank is therefore sized to hold 90 days
of peak-season use with no inflow, and the monthly balance is kept as a second
constraint for demand that outruns supply seasonally.

The tank ladder has a gap between DR-1 (ends at 16,000) and DR-2 (starts at
20,000). A requirement landing in it rounds **up** to DR-2.

### Keeping the three in step

The page, the strip and the dashboard component each carry their own copy of the
data layer, because each has to stay independently pasteable. A browser test
asserts all three produce identical totals *and* identical breakdowns from the
same fixture, so drift fails the build rather than reaching the site. If that
becomes tiresome, the fix is a small build step composing the components from a
shared source — the outputs must stay self-contained either way.

A gauge with no reading renders a dash, never `0.00"` — zero means it did not
rain, which is a different claim from having no data.

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

## How the readings get here

LCRA doesn't allow cross-origin browser reads, so the browser can't fetch it
directly. This used to relay through public CORS proxies. All three are now
dead — corsproxy.io refuses keyless legacy URLs, allorigins returns 522, and
r.jina.ai sits behind a Cloudflare challenge — which is what put dashes on the
live site.

LCRA answers a *server* fine: a GitHub runner on an Azure IP gets HTTP 200. (An
earlier note in this repo claimed LCRA blocks cloud IPs. It does not; the probe
in `.github/workflows/lcra-probe.yml` disproves it.) So the fetch happens
server-side:

```
LCRA CSVs → Actions, every 30 min → scripts/build-rainfall-json.mjs
          → docs/data/rainfall.json → the components read that
```

Every component reads the snapshot over `data-source` (default:
`raw.githubusercontent.com/.../docs/data/rainfall.json`). No relays, no
third-party proxy on the critical path.

**Scheduled workflows only run on the default branch**, so the cache job only
fires once this is merged to `main`.

### Column discovery

LCRA's real headers are not what you'd guess, and one of them changes daily:

| File | Header |
|---|---|
| `Rain5Day.csv` | `Site,Location,Basin,Today,Last24,08/24/2026,08/23/2026,…,Since 08/21/2026` |
| `Rainfall.csv` | `Site,Location,Date Time,1 Hour,3 Hour,6 Hour,24 Hour,Since Midnight` |

Yesterday is the **most recent dated column**, found at parse time. It is *not*
`Last24`, which is a rolling window overlapping `Today` — mapping it that way
double-counted and under-reported a 1.60in two-day total as 1.27in. Note also
`24 Hour` singular, where earlier code looked for `24 hours` and silently got
nothing. `scripts/parse.test.mjs` pins all of this against the real header row.

The published JSON carries the headers it saw under `debug`, so a future LCRA
rename is diagnosable from the file rather than from a silently empty dashboard.

### Staleness

Each component compares `generated` against the clock and says plainly when a
snapshot is more than three hours old, rather than presenting old readings as
current. A gauge with no reading renders a dash, never `0.00`.

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

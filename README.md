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
<div id="drw-rainfall-bar"
     data-dashboard="https://cawthorneh.github.io/vibe-coding/"></div>
<script src="https://cawthorneh.github.io/vibe-coding/rainfall-bar.js"></script>
```

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
<script src="https://cawthorneh.github.io/vibe-coding/rainfall-dashboard.js"></script>
```

`docs/webflow-embed.txt` and `docs/webflow-embed-dashboard.txt` wrap each
component as a single paste-ready block for a Webflow **Embed** element, with no
hosted file needed. Both are generated from the component sources, with the
`</script>` in each file's own usage comment escaped so it can't close the host
tag early — regenerate them whenever a component changes.

Open `docs/bar-demo.html` to preview the strip against the site's blue.

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

"""
Curated source catalog for the Dripping Rainwater water-news dashboard.

Four editorial buckets:

  local     — Central Texas / Hill Country water news
  research  — rainwater harvesting + water science research
  policy    — rainwater / water law, codes, rebates, regulation
  positive  — constructive climate & environment news

Editing this file is the whole curation surface. `fetch_news.py` reads it,
pulls each feed, scores every entry against the keyword tables below, and
writes `docs/news.json`. Nothing else needs to change to add a source.

Feed fields
-----------
id        stable slug (used in news.json, so keep it stable)
name      publisher name shown on the card
url       RSS or Atom URL
category  one of CATEGORIES
scope     "local" | "state" | "national" | "global"  (drives the local badge)
weight    editorial trust / prominence, roughly 0.5–2.0
curated   True  = feed is already on-topic, keyword gate is relaxed
          False = broad feed, entries must earn their place on keywords
site      publisher homepage (used for the source link)
"""

# ---------------------------------------------------------------------------
# Categories (order here is the order of the filter pills in the dashboard)
# ---------------------------------------------------------------------------
CATEGORIES = [
    {
        "id": "local",
        "label": "Local Water News",
        "short": "Local",
        "blurb": "Aquifers, drought status, and water supply across the Texas Hill Country.",
    },
    {
        "id": "research",
        "label": "Research",
        "short": "Research",
        "blurb": "New science on rainwater harvesting, water quality, and catchment.",
    },
    {
        "id": "policy",
        "label": "Policy & Codes",
        "short": "Policy",
        "blurb": "Rainwater law, plumbing codes, rebates, and water regulation.",
    },
    {
        "id": "positive",
        "label": "Good Climate News",
        "short": "Good News",
        "blurb": "Restoration, breakthroughs, and progress worth reading about.",
    },
]

CATEGORY_IDS = [c["id"] for c in CATEGORIES]


# ---------------------------------------------------------------------------
# Google News RSS helper
#
# Google News exposes a stable RSS endpoint for any search query. It is the
# most reliable way to keep a *topic* covered as local outlets add, drop, and
# rename their own feeds, so the local/policy buckets lean on it.
# ---------------------------------------------------------------------------
def google_news(query: str) -> str:
    from urllib.parse import quote_plus

    return (
        "https://news.google.com/rss/search?q="
        + quote_plus(query)
        + "&hl=en-US&gl=US&ceid=US%3Aen"
    )


# ---------------------------------------------------------------------------
# The catalog
# ---------------------------------------------------------------------------
FEEDS = [
    # ── Local: Hill Country water ──────────────────────────────────────────
    {
        "id": "gn_hill_country_water",
        "name": "Hill Country Water Watch",
        "url": google_news(
            '"Hill Country" Texas (water OR aquifer OR drought OR rainwater OR well) when:45d'
        ),
        "category": "local",
        "scope": "local",
        "weight": 1.8,
        "curated": True,
        "site": "https://news.google.com/",
    },
    {
        "id": "gn_hays_blanco",
        "name": "Hays & Blanco County Water",
        "url": google_news(
            '("Dripping Springs" OR "Hays County" OR "Blanco County" OR Wimberley OR Driftwood) '
            "(water OR well OR aquifer OR drought OR rainwater) when:45d"
        ),
        "category": "local",
        "scope": "local",
        "weight": 1.9,
        "curated": True,
        "site": "https://news.google.com/",
    },
    {
        "id": "gn_aquifers",
        "name": "Central Texas Aquifers",
        "url": google_news(
            '("Trinity Aquifer" OR "Edwards Aquifer" OR "Barton Springs" OR '
            '"groundwater conservation district" Texas) when:45d'
        ),
        "category": "local",
        "scope": "local",
        "weight": 1.7,
        "curated": True,
        "site": "https://news.google.com/",
    },
    {
        "id": "gn_ctx_drought",
        "name": "Central Texas Drought & Supply",
        "url": google_news(
            '"Central Texas" (drought OR "water restrictions" OR "water supply" OR '
            "reservoir OR LCRA OR \"Lake Travis\") when:45d"
        ),
        "category": "local",
        "scope": "local",
        "weight": 1.6,
        "curated": True,
        "site": "https://news.google.com/",
    },
    {
        "id": "texas_tribune_water",
        "name": "The Texas Tribune",
        "url": "https://www.texastribune.org/feeds/topics/water/",
        "category": "local",
        "scope": "state",
        "weight": 1.8,
        "curated": True,
        "site": "https://www.texastribune.org/",
    },
    {
        "id": "austin_monitor",
        "name": "Austin Monitor",
        "url": "https://www.austinmonitor.com/feed/",
        "category": "local",
        "scope": "local",
        "weight": 1.2,
        "curated": False,
        "site": "https://www.austinmonitor.com/",
    },
    {
        "id": "san_antonio_report",
        "name": "San Antonio Report",
        "url": "https://sanantonioreport.org/feed/",
        "category": "local",
        "scope": "local",
        "weight": 1.1,
        "curated": False,
        "site": "https://sanantonioreport.org/",
    },
    {
        "id": "community_impact",
        "name": "Community Impact",
        "url": "https://communityimpact.com/feed/",
        "category": "local",
        "scope": "local",
        "weight": 1.0,
        "curated": False,
        "site": "https://communityimpact.com/",
    },

    # ── Research ───────────────────────────────────────────────────────────
    {
        "id": "gn_rainwater_research",
        "name": "Rainwater Harvesting Research",
        "url": google_news(
            '"rainwater harvesting" (study OR research OR university OR journal OR '
            "findings) when:60d"
        ),
        "category": "research",
        "scope": "global",
        "weight": 1.9,
        "curated": True,
        "site": "https://news.google.com/",
    },
    {
        "id": "gn_water_quality_research",
        "name": "Water Quality Science",
        "url": google_news(
            '(groundwater OR "water quality" OR "stormwater") (study OR research OR '
            '"peer-reviewed" OR university) when:45d'
        ),
        "category": "research",
        "scope": "global",
        "weight": 1.4,
        "curated": True,
        "site": "https://news.google.com/",
    },
    {
        "id": "sciencedaily_water",
        "name": "ScienceDaily",
        "url": "https://www.sciencedaily.com/rss/earth_climate/water.xml",
        "category": "research",
        "scope": "global",
        "weight": 1.5,
        "curated": True,
        "site": "https://www.sciencedaily.com/",
    },
    {
        "id": "sciencedaily_drought",
        "name": "ScienceDaily",
        "url": "https://www.sciencedaily.com/rss/earth_climate/drought.xml",
        "category": "research",
        "scope": "global",
        "weight": 1.4,
        "curated": True,
        "site": "https://www.sciencedaily.com/",
    },
    {
        "id": "phys_org_environment",
        "name": "Phys.org",
        "url": "https://phys.org/rss-feed/earth-news/environment/",
        "category": "research",
        "scope": "global",
        "weight": 1.2,
        "curated": False,
        "site": "https://phys.org/",
    },
    {
        "id": "mdpi_water",
        "name": "Water (MDPI)",
        "url": "https://www.mdpi.com/rss/journal/water",
        "category": "research",
        "scope": "global",
        "weight": 1.0,
        "curated": True,
        "site": "https://www.mdpi.com/journal/water",
    },
    {
        "id": "eurekalert_earth",
        "name": "EurekAlert!",
        "url": "https://www.eurekalert.org/rss/earth_science.xml",
        "category": "research",
        "scope": "global",
        "weight": 1.1,
        "curated": False,
        "site": "https://www.eurekalert.org/",
    },

    # ── Policy ─────────────────────────────────────────────────────────────
    {
        "id": "gn_rainwater_policy",
        "name": "Rainwater Policy Tracker",
        "url": google_news(
            '"rainwater harvesting" (law OR ordinance OR rebate OR incentive OR code OR '
            "permit OR tax OR legal) when:60d"
        ),
        "category": "policy",
        "scope": "national",
        "weight": 2.0,
        "curated": True,
        "site": "https://news.google.com/",
    },
    {
        "id": "gn_texas_water_policy",
        "name": "Texas Water Policy",
        "url": google_news(
            'Texas water (legislature OR TCEQ OR "water rights" OR rulemaking OR '
            '"Texas Water Development Board" OR permit) when:45d'
        ),
        "category": "policy",
        "scope": "state",
        "weight": 1.8,
        "curated": True,
        "site": "https://news.google.com/",
    },
    {
        "id": "gn_water_rebates",
        "name": "Water Rebates & Incentives",
        "url": google_news(
            '("rain barrel" OR cistern OR "graywater" OR "greywater" OR "water reuse") '
            "(rebate OR incentive OR program OR ordinance) when:60d"
        ),
        "category": "policy",
        "scope": "national",
        "weight": 1.5,
        "curated": True,
        "site": "https://news.google.com/",
    },
    {
        "id": "epa_water_releases",
        "name": "US EPA",
        "url": "https://www.epa.gov/newsreleases/search/rss/field-press-office/water",
        "category": "policy",
        "scope": "national",
        "weight": 1.3,
        "curated": True,
        "site": "https://www.epa.gov/newsreleases",
    },
    {
        "id": "circle_of_blue",
        "name": "Circle of Blue",
        "url": "https://www.circleofblue.org/feed/",
        "category": "policy",
        "scope": "global",
        "weight": 1.4,
        "curated": True,
        "site": "https://www.circleofblue.org/",
    },

    # ── Positive climate ───────────────────────────────────────────────────
    {
        "id": "good_news_network_earth",
        "name": "Good News Network",
        "url": "https://www.goodnewsnetwork.org/category/earth/feed/",
        "category": "positive",
        "scope": "global",
        "weight": 1.5,
        "curated": True,
        "site": "https://www.goodnewsnetwork.org/",
    },
    {
        "id": "reasons_to_be_cheerful",
        "name": "Reasons to be Cheerful",
        "url": "https://reasonstobecheerful.world/feed/",
        "category": "positive",
        "scope": "global",
        "weight": 1.5,
        "curated": False,
        "site": "https://reasonstobecheerful.world/",
    },
    {
        "id": "positive_news_environment",
        "name": "Positive News",
        "url": "https://www.positive.news/environment/feed/",
        "category": "positive",
        "scope": "global",
        "weight": 1.4,
        "curated": True,
        "site": "https://www.positive.news/",
    },
    {
        "id": "anthropocene",
        "name": "Anthropocene Magazine",
        "url": "https://www.anthropocenemagazine.org/feed/",
        "category": "positive",
        "scope": "global",
        "weight": 1.3,
        "curated": False,
        "site": "https://www.anthropocenemagazine.org/",
    },
    {
        "id": "yale_e360",
        "name": "Yale Environment 360",
        "url": "https://e360.yale.edu/feed.xml",
        "category": "positive",
        "scope": "global",
        "weight": 1.2,
        "curated": False,
        "site": "https://e360.yale.edu/",
    },
    {
        "id": "grist",
        "name": "Grist",
        "url": "https://grist.org/feed/",
        "category": "positive",
        "scope": "national",
        "weight": 1.1,
        "curated": False,
        "site": "https://grist.org/",
    },
]


# ---------------------------------------------------------------------------
# Keyword tables
#
# Scoring is deliberately simple and readable: a title hit is worth 3x a
# summary hit, and the tiers below set the per-hit value. Tune the numbers
# here rather than editing fetch_news.py.
# ---------------------------------------------------------------------------

# Core subject matter — an article about our actual trade.
RAINWATER_TERMS = [
    "rainwater harvesting", "rainwater collection", "rainwater catchment",
    "rainwater system", "rainwater tank", "rain barrel", "rain barrels",
    "rainwater", "cistern", "cisterns", "first flush", "first-flush",
    "roof runoff", "catchment", "water catchment", "harvested rain",
    "atmospheric water", "arcsa", "potable rainwater", "rain harvesting",
]

# Adjacent water subject matter.
WATER_TERMS = [
    "aquifer", "groundwater", "well water", "water well", "drought",
    "water supply", "water restriction", "water conservation", "watershed",
    "water quality", "water table", "water utility", "water district",
    "stormwater", "graywater", "greywater", "wastewater", "reclaimed water",
    "water reuse", "desalination", "reservoir", "springs", "spring flow",
    "rainfall", "precipitation", "hydrology", "hydromet", "runoff",
    "filtration", "uv disinfection", "potable water", "drinking water",
    "water rate", "water main", "irrigation", "wet weather", "flooding",
    "water scarcity", "water crisis", "water infrastructure", "raincatcher",
]

# Regulatory language.
POLICY_TERMS = [
    "ordinance", "legislation", "legislature", "bill", "statute", "law",
    "rulemaking", "regulation", "permit", "permitting", "plumbing code",
    "building code", "rebate", "incentive", "tax credit", "tax exemption",
    "water rights", "lawsuit", "ruling", "compliance", "standard", "epa",
    "tceq", "commissioners court", "city council", "zoning", "variance",
    "moratorium", "conservation district", "utility commission",
]

# Research language.
RESEARCH_TERMS = [
    "study", "research", "researchers", "scientists", "university",
    "peer-reviewed", "journal", "findings", "analysis", "trial", "experiment",
    "data show", "published in", "modeling", "model predicts", "survey",
    "pilot project", "prototype", "engineers", "professor", "phd",
]

# Constructive framing for the good-news bucket.
POSITIVE_TERMS = [
    "restored", "restoration", "rewild", "reforest", "regenerat*", "recovery",
    "rebound", "revival", "comeback", "thriving", "breakthrough", "milestone",
    "first-ever", "record high", "success", "succeeds", "wins", "victory",
    "progress", "solution", "solutions", "hope", "hopeful", "cleanup",
    "cleaned up", "replenish", "recharge", "protected", "preserved",
    "innovation", "innovative", "boost", "surge", "saved", "rescue",
    "improves", "improvement", "cheaper", "affordable", "opens", "launches",
]

# Doom framing — disqualifies an item from the good-news bucket only.
# These are perfectly fine (and often important) in local/policy/research.
NEGATIVE_TERMS = [
    "dies", "died", "death", "deaths", "killed", "kills", "fatal", "victim",
    "catastroph*", "disaster", "devastating", "collapse",
    "crisis deepens", "worsens", "worst", "grim", "doom", "dire", "bleak",
    "shooting", "murder", "indicted", "arrested", "convicted", "scandal",
    "outbreak", "contaminated", "toxic spill", "lawsuit filed", "sues",
    "warns", "warning", "threat", "danger", "risk of", "fails", "failure",
]

# Climate & environment vocabulary. Only the good-news bucket accepts an item
# on these alone; the water buckets still require water terms.
CLIMATE_TERMS = [
    "climate", "emissions", "carbon", "greenhouse gas", "renewable", "solar",
    "wind power", "wind farm", "clean energy", "grid", "battery storage",
    "biodiversity", "ecosystem", "wetland", "wetlands", "habitat", "wildlife",
    "forest", "reforestation", "conservation", "sustainab*", "regenerative",
    "pollution", "recycling", "circular economy", "electric vehicle",
    "heat pump", "energy efficiency", "net zero", "decarboniz*", "rewilding",
    "native plants", "pollinator", "soil health", "environment",
]

# Never surface these, in any bucket.
BLOCK_TERMS = [
    "obituary", "obituaries", "police blotter", "arrest report", "mugshot",
    "horoscope", "sponsored content", "advertisement", "paid post",
    "sports roundup", "high school football", "box score", "recruiting",
    "best deals", "coupon", "discount code", "black friday", "gift guide",
    "casino", "sportsbook", "betting odds", "crossword", "sudoku",
]

# Hill Country place names. A hit here flags the story "Hill Country" on the
# card, so this list stays tight — the badge is customer-facing and a Houston
# story wearing it would be a lie.
LOCAL_PLACES = [
    "dripping springs", "hays county", "blanco county", "wimberley",
    "driftwood", "bee cave", "lakeway", "spicewood", "johnson city",
    "fredericksburg", "marble falls", "kerrville", "boerne", "bandera",
    "new braunfels", "san marcos", "comal county", "canyon lake", "buda",
    "kyle", "travis county", "williamson county", "burnet county", "llano",
    "hill country", "edwards aquifer", "trinity aquifer", "barton springs",
    "jacob's well", "jacobs well", "lcra", "lower colorado river",
    "pedernales", "blanco river", "guadalupe river", "lake travis",
    "lake buchanan", "austin", "san antonio",
]

# Wider Texas relevance. Worth a nudge in the ranking, but not the badge —
# "texas" alone appears in far too much to mean Hill Country.
REGION_TERMS = [
    "texas", "central texas", "south texas", "texas hill country",
    "colorado river", "highland lakes", "tceq",
    "texas water development board", "groundwater conservation district",
]

# Scoring weights (per hit; title hits are multiplied by TITLE_MULTIPLIER).
WEIGHTS = {
    "rainwater": 6.0,
    "water": 2.0,
    "policy": 1.5,
    "research": 1.5,
    "positive": 2.0,
    "local_place": 3.0,
    "region": 1.0,
    "negative": -2.5,     # applied in the positive bucket only
}

TITLE_MULTIPLIER = 3.0

# An item must clear its category's bar to be published. Curated feeds get
# CURATED_BONUS added first, which is what lets an on-topic feed through even
# when a headline is written without any of our keywords in it.
MIN_SCORE = {
    "local": 4.0,
    "research": 4.0,
    "policy": 4.0,
    "positive": 3.0,
}

CURATED_BONUS = 4.0

# Topic gate: before any scoring, an item must actually be about something we
# cover. Without this, CURATED_BONUS alone clears MIN_SCORE and a trusted feed's
# every off-topic story (city council parking, fundraisers) lands on the page.
# Keyed by category; values name the keyword tables that satisfy the gate.
TOPIC_GATE = {
    "local":    ["RAINWATER_TERMS", "WATER_TERMS"],
    "research": ["RAINWATER_TERMS", "WATER_TERMS"],
    "policy":   ["RAINWATER_TERMS", "WATER_TERMS"],
    "positive": ["RAINWATER_TERMS", "WATER_TERMS", "CLIMATE_TERMS"],
}

# Freshness: how far back to look, and how quickly older items sink.
WINDOW_DAYS = 45
HALF_LIFE_DAYS = 10.0     # score is multiplied by 0.5 every N days of age

# Publication caps.
MAX_ITEMS_TOTAL = 120
MAX_ITEMS_PER_CATEGORY = 40
MAX_ITEMS_PER_SOURCE = 6

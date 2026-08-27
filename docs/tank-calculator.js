/*!
 * Dripping Rainwater — Tank Sizing Calculator
 *
 * Sizes a rainwater tank from roof area and household demand using a monthly
 * water balance, the method in the TWDB Rainwater Harvesting Manual: each
 * month's catch is set against each month's use and the tank level tracked
 * through the year, so the recommendation is driven by surviving the summer
 * dry stretch rather than by an annual average that hides it.
 *
 *   <div id="drw-tank-calculator"></div>
 *   <script src="https://cawthorneh.github.io/projects/tank-calculator.js"><\/script>
 *
 * Or paste this whole file inline inside a script tag — it needs no other
 * files, no build step and no external libraries.
 *
 * Every assumption is a named constant in the CONFIG block below, so the
 * numbers can be tuned from field experience without touching the logic.
 */
(function () {
  "use strict";

  // Captured now: document.currentScript is null by the time DOMContentLoaded
  // fires, so an inline paste could not find where it was pasted.
  var SELF = document.currentScript;

  var MOUNT_ID = "drw-tank-calculator";
  var STYLE_ID = "drw-tank-calculator-css";

  /* ── CONFIG — every assumption, in one place ────────────────────────── */

  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var DAYS   = [31,28,31,30,31,30,31,31,30,31,30,31];

  // Central Texas Hill Country monthly rainfall, inches. Sums to 33 in/yr.
  // The shape matters more than the total: a May peak, a second peak in
  // October, and the July–August gap the tank has to bridge.
  var RAIN_IN = [2.2,2.1,2.6,2.4,4.6,3.6,1.9,2.2,3.1,3.6,2.5,2.2];

  // One inch of rain on one square foot of roof is 0.6233 gallons.
  var GAL_PER_SQFT_IN = 0.6233;
  // Losses to first-flush diversion, splash, wind and evaporation.
  var COLLECTION_EFFICIENCY = 0.85;

  // Supplemental landscape irrigation, inches applied per month (~18 in/yr).
  var IRRIGATION_IN = [0,0,0.5,1.5,1.5,3.0,4.0,4.0,2.5,1.0,0,0];

  // Pool top-off: net evaporation after rainfall, inches per month (~38.5 in/yr).
  var POOL_IN = [1.5,1.8,2.5,3.2,3.5,4.5,5.5,5.5,4.0,3.0,2.0,1.5];
  var POOL_SQFT = { none: 0, small: 300, large: 600 };

  var GPD = { low: 40, medium: 50, high: 75 };

  // Days of demand the tank must hold with no inflow at all.
  //
  // This floor is what actually governs most recommendations, and it has to.
  // A monthly balance run on AVERAGE rainfall gives every month some rain, so
  // the tank never draws far down — that model sized a family home at under a
  // thousand gallons. Averages smooth away the drought the tank exists to
  // cover. A Hill Country summer can run 8–12 weeks with essentially nothing,
  // so the tank is sized to carry the property through a dry spell, and the
  // monthly balance is kept as a second constraint for demand that outruns
  // supply seasonally.
  var RESERVE_DAYS = 90;

  // Tank ladder. `min` is the band floor; a requirement between two bands
  // rounds up to the larger, never down.
  var TANKS = [
    { id: "DR-1", label: "DR-1", range: "5,000 – 16,000 gal",  min: 5000,  max: 16000 },
    { id: "DR-2", label: "DR-2", range: "20,000 – 29,000 gal", min: 20000, max: 29000 },
    { id: "DR-3", label: "DR-3", range: "30,000 – 39,000 gal", min: 30000, max: 39000 },
    { id: "DR-4", label: "DR-4", range: "40,000 – 49,000 gal", min: 40000, max: 49000 },
    { id: "DR-5", label: "DR-5", range: "50,000 – 65,000 gal", min: 50000, max: 65000 },
    { id: "DR-6", label: "DR-6", range: "66,000+ gal",         min: 66000, max: Infinity }
  ];

  var DEFAULTS = { use:"potable", level:"low", people:3, roof:3000, irrigation:1000,
                   pool:"none", supply:"well" };

  // Chart series colours: brand blue against a deeper brand gold. Validated
  // for colour-vision separation and for contrast against a white surface —
  // the lighter brand gold fails both as a chart mark.
  var C_SUPPLY = "#3066AB";
  var C_DEMAND = "#A07E22";

  /* ── Model ──────────────────────────────────────────────────────────── */

  function monthlySupply(roofSqft) {
    return RAIN_IN.map(function (inches) {
      return roofSqft * inches * GAL_PER_SQFT_IN * COLLECTION_EFFICIENCY;
    });
  }

  function monthlyDemand(input) {
    var wantsPotable = input.use === "potable" || input.use === "both";
    var wantsOutdoor = input.use === "nonpotable" || input.use === "both";
    var poolSqft = wantsOutdoor ? (POOL_SQFT[input.pool] || 0) : 0;
    var irrigSqft = wantsOutdoor ? input.irrigation : 0;
    var gpd = GPD[input.level];

    var potable = [], irrigation = [], pool = [], total = [];
    for (var m = 0; m < 12; m++) {
      var p = wantsPotable ? input.people * gpd * DAYS[m] : 0;
      var i = irrigSqft * IRRIGATION_IN[m] * GAL_PER_SQFT_IN;
      var o = poolSqft * POOL_IN[m] * GAL_PER_SQFT_IN;
      potable.push(p); irrigation.push(i); pool.push(o); total.push(p + i + o);
    }
    return { potable: potable, irrigation: irrigation, pool: pool, total: total };
  }

  // Simulate three years so the tank's starting level washes out and the
  // answer reflects a repeating year rather than a lucky first one.
  function survives(capacity, supply, demand) {
    var level = capacity;
    for (var year = 0; year < 3; year++) {
      for (var m = 0; m < 12; m++) {
        level += supply[m] - demand[m];
        if (level > capacity) level = capacity;   // overflow to the ground
        if (level < 0) return false;
      }
    }
    return true;
  }

  // Reserve is set against the heaviest stretch of the year, not the average:
  // dry spells arrive in July and August, exactly when irrigation and pool
  // top-off peak.
  function reserveFloor(demandMonthly) {
    var peakDaily = 0;
    for (var m = 0; m < 12; m++) {
      peakDaily = Math.max(peakDaily, demandMonthly[m] / DAYS[m]);
    }
    return peakDaily * RESERVE_DAYS;
  }

  function requiredCapacity(supply, demand) {
    var annualSupply = supply.reduce(function (a, b) { return a + b; }, 0);
    var annualDemand = demand.reduce(function (a, b) { return a + b; }, 0);
    // When a year's use exceeds a year's catch, no tank ever refills enough:
    // storage is not the constraint, catchment is.
    if (annualDemand > annualSupply) return null;

    var lo = 0, hi = 1;
    while (!survives(hi, supply, demand) && hi < 1e7) hi *= 2;
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (survives(mid, supply, demand)) hi = mid; else lo = mid;
    }
    return hi;
  }

  function recommendTank(gallons) {
    for (var i = 0; i < TANKS.length; i++) {
      if (gallons <= TANKS[i].max) return TANKS[i];
    }
    return TANKS[TANKS.length - 1];
  }

  function calculate(input) {
    var supply = monthlySupply(input.roof);
    var demand = monthlyDemand(input);
    var annualSupply = supply.reduce(function (a, b) { return a + b; }, 0);
    var annualDemand = demand.total.reduce(function (a, b) { return a + b; }, 0);
    var balanceNeed = requiredCapacity(supply, demand.total);
    var reserve = reserveFloor(demand.total);
    var required = balanceNeed === null ? null : Math.max(balanceNeed, reserve);
    return {
      supply: supply, demand: demand,
      annualSupply: annualSupply, annualDemand: annualDemand,
      balance: annualSupply - annualDemand,
      balanceNeed: balanceNeed, reserve: reserve, reserveDays: RESERVE_DAYS,
      required: required,
      governedBy: balanceNeed === null ? "catchment"
                  : (reserve >= balanceNeed ? "reserve" : "balance"),
      tank: required === null ? null : recommendTank(required)
    };
  }

  /* ── Styles ─────────────────────────────────────────────────────────── */

  var CSS = [
    '.drwt,.drwt *{box-sizing:border-box}',
    '.drwt{font-family:inherit;color:#121D23;max-width:100%}',
    '.drwt-eyebrow{color:#B8912F;font-size:.72rem;font-weight:800;letter-spacing:.16em;',
      'text-transform:uppercase;line-height:1.2}',
    '.drwt-h{font-size:1.6rem;font-weight:800;letter-spacing:-.028em;line-height:1.12;margin:.35rem 0 0}',
    '.drwt-lead{color:#5E6A72;font-size:.92rem;line-height:1.55;margin:.5rem 0 0;max-width:62ch}',

    '.drwt-cols{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);',
      'gap:1.15rem;align-items:start;margin-top:1.15rem}',

    '.drwt-panel{background:#fff;border:1px solid #DFE7F0;border-radius:16px;padding:1.25rem;',
      'box-shadow:0 1px 2px rgba(18,29,35,.05),0 10px 28px rgba(48,102,171,.10)}',
    '.drwt-legend{font-size:.72rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;',
      'color:#5E6A72;margin-bottom:.9rem}',

    '.drwt-field{margin-bottom:.95rem}',
    '.drwt-field:last-child{margin-bottom:0}',
    '.drwt-field label{display:block;font-size:.82rem;font-weight:700;margin-bottom:.35rem}',
    '.drwt-hint{font-size:.72rem;color:#5E6A72;font-weight:500;margin-top:.28rem;line-height:1.4}',
    '.drwt-field select,.drwt-field input{width:100%;font:inherit;font-size:.9rem;',
      'padding:.55rem .7rem;border:1px solid #DFE7F0;border-radius:10px;background:#fff;',
      'color:#121D23;-webkit-appearance:none;appearance:none}',
    '.drwt-field select{background-image:url("data:image/svg+xml;charset=utf8,',
      '%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' ',
      'stroke=\'%235E6A72\' stroke-width=\'1.8\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E");',
      'background-repeat:no-repeat;background-position:right .7rem center;background-size:12px;',
      'padding-right:2rem}',
    '.drwt-field input:focus,.drwt-field select:focus{outline:3px solid #D8B046;outline-offset:1px;',
      'border-color:#3066AB}',
    '.drwt-field.is-off{display:none}',

    // Headline result: the number the visitor came for.
    '.drwt-rec{background:#3066AB;color:#fff;border-radius:16px;padding:1.4rem 1.5rem;',
      'margin-top:1.3rem;display:grid;grid-template-columns:auto minmax(0,1fr);',
      'gap:.4rem 2rem;align-items:center;box-shadow:0 10px 28px rgba(48,102,171,.18)}',
    '.drwt-rec-main{display:flex;flex-direction:column}',
    // A brief lift when the answer changes, so an adjustment upstairs is
    // visibly answered rather than silently repainted.
    '.drwt-rec.is-new{animation:drwt-pop .45s ease}',
    '@keyframes drwt-pop{0%{transform:scale(.985);box-shadow:0 4px 12px rgba(48,102,171,.14)}',
      '55%{transform:scale(1.006)}100%{transform:scale(1)}}',
    '@media (prefers-reduced-motion:reduce){.drwt-rec.is-new{animation:none}}',
    '.drwt-rec.is-idle{background:#5E6A72}',
    '.drwt-rec-lab{color:#F0DFAE;font-size:.72rem;font-weight:800;letter-spacing:.14em;',
      'text-transform:uppercase}',
    '.drwt-rec-id{font-size:3.1rem;font-weight:800;letter-spacing:-.04em;line-height:1;margin-top:.4rem}',
    '.drwt-rec-range{font-size:1rem;font-weight:700;color:#D8B046;margin-top:.25rem}',
    '.drwt-rec-note{font-size:.88rem;color:#D6E4F2;line-height:1.55;max-width:56ch}',
    '.drwt-rec.is-short{background:#8A5A12}',
    '.drwt-rec.is-short .drwt-rec-range{color:#F7DE7F}',
    '.drwt-rec.is-short .drwt-rec-note{color:#F5E6C8}',
    '.drwt-rec-id.is-small{font-size:1.5rem;letter-spacing:-.02em;line-height:1.15}',

    '.drwt-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#DFE7F0;',
      'border:1px solid #DFE7F0;border-radius:14px;overflow:hidden;margin-top:1.15rem}',
    '.drwt-stat{background:#fff;padding:.95rem 1rem}',
    '.drwt-stat dt{font-size:.66rem;color:#5E6A72;text-transform:uppercase;letter-spacing:.09em;',
      'font-weight:700;margin:0}',
    '.drwt-stat dd{font-size:1.45rem;font-weight:800;letter-spacing:-.03em;margin:.25rem 0 0;',
      'font-variant-numeric:tabular-nums;color:#3066AB}',
    '.drwt-stat dd small{font-size:.7rem;font-weight:700;color:#5E6A72;letter-spacing:0}',
    '.drwt-stat dd.is-neg{color:#A0522D}',

    '.drwt-chart{margin-top:1.15rem}',
    '.drwt-chart-head{display:flex;align-items:baseline;justify-content:space-between;',
      'gap:.75rem;flex-wrap:wrap;margin-bottom:.6rem}',
    '.drwt-chart-t{font-size:.95rem;font-weight:800;letter-spacing:-.015em}',
    '.drwt-key{display:flex;gap:.9rem;font-size:.74rem;color:#5E6A72;font-weight:600}',
    '.drwt-key i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:.32rem;',
      'vertical-align:-1px}',
    '.drwt-svg{display:block;width:100%;height:auto;overflow:visible}',
    '.drwt-tip{position:absolute;pointer-events:none;background:#0E2233;color:#fff;',
      'border-radius:9px;padding:.5rem .65rem;font-size:.75rem;line-height:1.45;opacity:0;',
      'transition:opacity .12s;white-space:nowrap;z-index:5;box-shadow:0 6px 18px rgba(0,0,0,.22)}',
    '.drwt-tip b{font-weight:800}',
    '.drwt-plot{position:relative}',

    '.drwt-toggle{margin-top:.75rem;font:inherit;font-size:.78rem;font-weight:700;color:#3066AB;',
      'background:none;border:0;padding:0;cursor:pointer;text-decoration:underline;',
      'text-underline-offset:3px}',
    '.drwt-table{width:100%;border-collapse:collapse;font-size:.78rem;margin-top:.7rem}',
    '.drwt-table th,.drwt-table td{text-align:right;padding:.35rem .5rem;border-bottom:1px solid #DFE7F0;',
      'font-variant-numeric:tabular-nums}',
    '.drwt-table th:first-child,.drwt-table td:first-child{text-align:left}',
    '.drwt-table th{font-size:.66rem;text-transform:uppercase;letter-spacing:.07em;color:#5E6A72}',
    '.drwt-tablewrap{overflow-x:auto}',
    '.drwt-tablewrap[hidden]{display:none}',

    '.drwt-fine{margin-top:1.15rem;color:#5E6A72;font-size:.76rem;line-height:1.55}',
    '.drwt-fine b{color:#121D23;font-weight:700}',

    '.drwt-cta{display:inline-flex;align-items:center;gap:.7rem;text-decoration:none;',
      'background:#D8B046;color:#3066AB;font-size:.85rem;font-weight:800;border-radius:10px;',
      'padding:.55rem .55rem .55rem 1rem;margin-top:1.15rem;transition:background .15s}',
    '.drwt-cta:hover{background:#C9A23C}',
    '.drwt-cta span{display:inline-flex;align-items:center;justify-content:center;width:27px;',
      'height:27px;border-radius:7px;background:#3066AB;color:#fff}',

    '@media (max-width:820px){',
      '.drwt-cols{grid-template-columns:1fr}',
      '.drwt-h{font-size:1.35rem}',
      '.drwt-stats{grid-template-columns:1fr}',
      '.drwt-rec{grid-template-columns:1fr;gap:.7rem;padding:1.2rem 1.25rem}',
      '.drwt-rec-id{font-size:2.6rem}}'
  ].join("");

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.appendChild(document.createTextNode(CSS));
    document.head.appendChild(el);
  }

  /* ── View ───────────────────────────────────────────────────────────── */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c];
    });
  }
  function gal(n) { return Math.round(n).toLocaleString(); }

  function form(v) {
    var outdoor = v.use === "nonpotable" || v.use === "both";
    return '<form class="drwt-panel" id="drwt-form">' +
      '<div class="drwt-legend">Your property</div>' +

      '<div class="drwt-field"><label for="drwt-use">What will the rainwater supply?</label>' +
      '<select id="drwt-use" name="use">' +
        opt("potable", "Potable — drinking water", v.use) +
        opt("nonpotable", "Non-potable — irrigation, pool", v.use) +
        opt("both", "Both potable and outdoor", v.use) +
      "</select></div>" +

      '<div class="drwt-field' + (v.use === "nonpotable" ? " is-off" : "") + '" data-when="potable">' +
      '<label for="drwt-level">Household water use</label>' +
      '<select id="drwt-level" name="level">' +
        opt("low", "Low — 40 gal per person per day", v.level) +
        opt("medium", "Medium — 50 gal per person per day", v.level) +
        opt("high", "High — 75 gal per person per day", v.level) +
      "</select>" +
      '<div class="drwt-hint">Low suits a careful household with efficient fixtures; high covers ' +
      "long showers, frequent laundry and guests.</div></div>" +

      '<div class="drwt-field' + (v.use === "nonpotable" ? " is-off" : "") + '" data-when="potable">' +
      '<label for="drwt-people">People in the household</label>' +
      '<input id="drwt-people" name="people" type="number" min="1" max="20" step="1" value="' +
        v.people + '"></div>' +

      '<div class="drwt-field"><label for="drwt-roof">Roof catchment area (sq ft)</label>' +
      '<input id="drwt-roof" name="roof" type="number" min="200" max="40000" step="50" value="' +
        v.roof + '">' +
      '<div class="drwt-hint">The roof footprint, measured flat — pitch doesn\'t change how much ' +
      "rain lands on it.</div></div>" +

      '<div class="drwt-field' + (outdoor ? "" : " is-off") + '" data-when="outdoor">' +
      '<label for="drwt-irrigation">Irrigated area (sq ft)</label>' +
      '<input id="drwt-irrigation" name="irrigation" type="number" min="0" max="200000" step="100" value="' +
        v.irrigation + '"></div>' +

      '<div class="drwt-field' + (outdoor ? "" : " is-off") + '" data-when="outdoor">' +
      '<label for="drwt-pool">Pool</label>' +
      '<select id="drwt-pool" name="pool">' +
        opt("none", "No pool", v.pool) +
        opt("small", "Small — about 300 sq ft", v.pool) +
        opt("large", "Large — about 600 sq ft", v.pool) +
      "</select></div>" +

      '<div class="drwt-field"><label for="drwt-supply">Existing water supply</label>' +
      '<select id="drwt-supply" name="supply">' +
        opt("well", "Well", v.supply) +
        opt("municipal", "Municipal", v.supply) +
      "</select>" +
      '<div class="drwt-hint">Doesn\'t change the sizing below — it tells us what we\'d be ' +
      "tying into.</div></div>" +
    "</form>";
  }

  function opt(value, label, current) {
    return '<option value="' + value + '"' + (value === current ? " selected" : "") + ">" +
           esc(label) + "</option>";
  }

  // The recommendation is the answer the visitor came for, so it sits above
  // the inputs rather than below them.
  function recommendation(r) {
    if (r.annualDemand <= 0) {
      return '<div class="drwt-rec is-idle"><div class="drwt-rec-main">' +
        '<div class="drwt-rec-lab">Nothing to size yet</div>' +
        '<div class="drwt-rec-id is-small">Tell us what the water is for</div></div>' +
        '<div class="drwt-rec-note">With no household use, no irrigated area and no pool, ' +
        "there's no demand to size a tank against. Add an irrigated area or a pool, " +
        "or switch to potable use.</div></div>";
    }
    var short = r.required === null;
    var rec = short
      ? '<div class="drwt-rec is-short"><div class="drwt-rec-main">' +
          '<div class="drwt-rec-lab">Catchment is the limit</div>' +
          '<div class="drwt-rec-id is-small">More roof needed</div>' +
          '<div class="drwt-rec-range">' + gal(-r.balance) + " gal short each year</div></div>" +
          '<div class="drwt-rec-note">This roof catches less in a year than this property uses, ' +
          "so no tank size can carry it alone — a bigger tank would simply sit empty for longer. " +
          "Adding catchment, trimming irrigation, or planning to draw on your existing supply " +
          "through the dry months all close the gap. Worth a conversation.</div></div>"
      : '<div class="drwt-rec"><div class="drwt-rec-main">' +
          '<div class="drwt-rec-lab">Recommended tank</div>' +
          '<div class="drwt-rec-id">' + r.tank.label + "</div>" +
          '<div class="drwt-rec-range">' + r.tank.range + "</div></div>" +
          '<div class="drwt-rec-note">This property needs about <b>' + gal(r.required) +
          " gal</b> of storage &mdash; " +
          (r.governedBy === "reserve"
            ? "enough to carry " + r.reserveDays + " days at peak use with no rain at all"
            : "enough to bridge the seasonal gap between what you catch and what you use") +
          ". The " + r.tank.label + " covers that.</div></div>";
    return rec;
  }

  function detail(r, v) {
    var balClass = r.balance < 0 ? " class=\"is-neg\"" : "";
    var stats = '<dl class="drwt-stats">' +
      '<div class="drwt-stat"><dt>Rainwater caught / year</dt><dd>' + gal(r.annualSupply) +
        " <small>gal</small></dd></div>" +
      '<div class="drwt-stat"><dt>Water used / year</dt><dd>' + gal(r.annualDemand) +
        " <small>gal</small></dd></div>" +
      '<div class="drwt-stat"><dt>' + (r.balance < 0 ? "Annual shortfall" : "Annual surplus") +
        "</dt><dd" + balClass + ">" + gal(Math.abs(r.balance)) + " <small>gal</small></dd></div>" +
    "</dl>";

    return stats + chart(r) + fine(v);
  }

  function fine(v) {
    var outdoor = v.use === "nonpotable" || v.use === "both";
    return '<div class="drwt-fine"><b>How this is worked out.</b> ' +
      "Rainfall is the Central Texas Hill Country average of <b>33 in a year</b>, spread across " +
      "the months as it actually falls — a wet May, a dry July and August. Catch is roof area " +
      "&times; rainfall &times; 0.6233 gal per sq ft per inch, at <b>85% collection efficiency</b> " +
      "after first-flush and splash losses. " +
      (outdoor ? "Irrigation assumes about 18 in applied per year across the growing season, and " +
                 "pool top-off follows net evaporation of roughly 38 in a year. " : "") +
      "The tank is sized to hold <b>" + RESERVE_DAYS + " days of peak-season use with no rain " +
      "at all</b>, and separately checked against the month-by-month balance below. A yearly " +
      "surplus is not enough on its own &mdash; it can still leave you empty in August. " +
      "Treat it as a starting point: a site visit accounts for your actual roof, gutters and slope.</div>";
  }

  /* ── Chart: monthly catch against monthly use ───────────────────────── */

  function chart(r) {
    var W = 640, H = 220, padL = 52, padR = 8, padT = 8, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var maxV = 0;
    for (var m = 0; m < 12; m++) {
      maxV = Math.max(maxV, r.supply[m], r.demand.total[m]);
    }
    if (maxV <= 0) maxV = 1;
    // Round the axis top to something legible.
    var step = Math.pow(10, Math.floor(Math.log(maxV) / Math.LN10)) / 2;
    var top = Math.ceil(maxV / step) * step;

    var slot = plotW / 12, barW = Math.min(13, slot / 2 - 3);
    var bars = "", ticks = "", hits = "";
    for (var i = 0; i < 4; i++) {
      var val = top * i / 3, y = padT + plotH - (val / top) * plotH;
      ticks += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y +
               '" stroke="#EDF2F7" stroke-width="1"/>' +
               '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" ' +
               'font-size="10" fill="#5E6A72">' + Math.round(val / 1000) + "k</text>";
    }
    for (m = 0; m < 12; m++) {
      var cx = padL + slot * m + slot / 2;
      var sH = (r.supply[m] / top) * plotH, dH = (r.demand.total[m] / top) * plotH;
      // 2px gap between the paired bars keeps them from reading as one mark.
      bars += '<rect x="' + (cx - barW - 1) + '" y="' + (padT + plotH - sH) + '" width="' + barW +
              '" height="' + Math.max(0, sH) + '" rx="3" fill="' + C_SUPPLY + '"/>' +
              '<rect x="' + (cx + 1) + '" y="' + (padT + plotH - dH) + '" width="' + barW +
              '" height="' + Math.max(0, dH) + '" rx="3" fill="' + C_DEMAND + '"/>' +
              '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" ' +
              'fill="#5E6A72">' + MONTHS[m] + "</text>";
      hits += '<rect class="drwt-hit" data-m="' + m + '" x="' + (padL + slot * m) + '" y="' + padT +
              '" width="' + slot + '" height="' + plotH + '" fill="transparent"/>';
    }

    var rows = "";
    for (m = 0; m < 12; m++) {
      rows += "<tr><th scope=\"row\">" + MONTHS[m] + "</th><td>" + gal(r.supply[m]) +
              "</td><td>" + gal(r.demand.total[m]) + "</td></tr>";
    }

    return '<div class="drwt-chart">' +
      '<div class="drwt-chart-head"><div class="drwt-chart-t">Month by month, gallons</div>' +
      '<div class="drwt-key"><span><i style="background:' + C_SUPPLY + '"></i>Caught</span>' +
      '<span><i style="background:' + C_DEMAND + '"></i>Used</span></div></div>' +
      '<div class="drwt-plot">' +
      '<svg class="drwt-svg" viewBox="0 0 ' + W + " " + H + '" role="img" ' +
        'aria-label="Monthly rainwater caught compared with water used">' +
        ticks + bars + hits +
      "</svg>" +
      '<div class="drwt-tip" id="drwt-tip"></div></div>' +
      '<button type="button" class="drwt-toggle" id="drwt-tabtoggle" aria-expanded="false" ' +
        'aria-controls="drwt-tablewrap">Show the monthly figures</button>' +
      '<div class="drwt-tablewrap" id="drwt-tablewrap" hidden><table class="drwt-table">' +
      "<thead><tr><th>Month</th><th>Caught</th><th>Used</th></tr></thead><tbody>" + rows +
      "</tbody></table></div></div>";
  }

  /* ── Wiring ─────────────────────────────────────────────────────────── */

  function readForm(root, fallback) {
    var f = root.querySelector("#drwt-form");
    if (!f) return fallback;
    function num(name, dflt, min, max) {
      var el = f.elements[name];
      var n = el ? parseFloat(el.value) : NaN;
      if (!isFinite(n)) return dflt;
      return Math.min(max, Math.max(min, n));
    }
    return {
      use: f.elements.use.value,
      level: f.elements.level.value,
      people: num("people", DEFAULTS.people, 1, 20),
      roof: num("roof", DEFAULTS.roof, 200, 40000),
      irrigation: num("irrigation", DEFAULTS.irrigation, 0, 200000),
      pool: f.elements.pool.value,
      supply: f.elements.supply.value
    };
  }

  var lastRec = null;

  function paint(root, v) {
    var r = calculate(v);
    var out = root.querySelector("#drwt-out");
    var recBox = root.querySelector("#drwt-rec");

    // Identity of the answer, including the figures quoted in it, so the card
    // is rebuilt when its content changes and left alone when it doesn't.
    var key = r.annualDemand <= 0 ? "idle"
            : r.required === null ? "short|" + Math.round(r.balance)
            : r.tank.label + "|" + Math.round(r.required);

    // Only rebuild on a real change. A <select> fires input *and* change, so
    // repainting unconditionally would run twice and the second pass would
    // discard the element the highlight had just been applied to.
    if (key !== lastRec) {
      var first = lastRec === null;
      recBox.innerHTML = recommendation(r);
      var card = recBox.firstChild;
      if (!first && card && card.classList) card.classList.add("is-new");
      lastRec = key;
    }

    out.__data = r;
    out.innerHTML = detail(r, v);
    wireChart(out);
    // Show or hide the conditional fields without rebuilding the form, so
    // focus and caret position survive a keystroke.
    var outdoor = v.use === "nonpotable" || v.use === "both";
    var potable = v.use === "potable" || v.use === "both";
    root.querySelectorAll('[data-when="outdoor"]').forEach(function (el) {
      el.classList.toggle("is-off", !outdoor);
    });
    root.querySelectorAll('[data-when="potable"]').forEach(function (el) {
      el.classList.toggle("is-off", !potable);
    });
  }

  function wireChart(out) {
    var tip = out.querySelector("#drwt-tip");
    var plot = out.querySelector(".drwt-plot");
    var data = out.__data;
    out.querySelectorAll(".drwt-hit").forEach(function (hit) {
      hit.addEventListener("mouseenter", function () {
        var m = +hit.getAttribute("data-m");
        tip.innerHTML = "<b>" + MONTHS[m] + "</b><br>Caught " + gal(data.supply[m]) +
                        " gal<br>Used " + gal(data.demand.total[m]) + " gal";
        tip.style.opacity = "1";
      });
      hit.addEventListener("mousemove", function (e) {
        var box = plot.getBoundingClientRect();
        var x = e.clientX - box.left, y = e.clientY - box.top;
        tip.style.left = Math.min(box.width - tip.offsetWidth - 4, Math.max(0, x + 12)) + "px";
        tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + "px";
      });
      hit.addEventListener("mouseleave", function () { tip.style.opacity = "0"; });
    });
    var toggle = out.querySelector("#drwt-tabtoggle");
    var wrap = out.querySelector("#drwt-tablewrap");
    if (toggle && wrap) {
      toggle.addEventListener("click", function () {
        var open = !wrap.hasAttribute("hidden");
        if (open) { wrap.setAttribute("hidden", ""); } else { wrap.removeAttribute("hidden"); }
        toggle.setAttribute("aria-expanded", String(!open));
        toggle.textContent = open ? "Show the monthly figures" : "Hide the monthly figures";
      });
    }
  }

  function start() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) {
      if (!SELF || !SELF.parentNode) return;
      mount = document.createElement("div");
      mount.id = MOUNT_ID;
      SELF.parentNode.insertBefore(mount, SELF);
    }
    injectCSS();

    var v = DEFAULTS;
    var head = mount.getAttribute("data-heading") === "off" ? "" :
      '<div class="drwt-eyebrow">Tank Sizing</div>' +
      '<div class="drwt-h">How big a tank does your place need?</div>' +
      '<p class="drwt-lead">Answer a few questions about the property and we\'ll size it the way ' +
      "we would on a site visit — month by month, so the tank is built to carry you through a " +
      "Hill Country summer rather than an average year.</p>";

    var cta = mount.getAttribute("data-cta");
    var ctaHtml = cta ? '<a class="drwt-cta" href="' + esc(cta) + '">Talk to us about your site ' +
                        "<span>&rarr;</span></a>" : "";

    mount.innerHTML = '<section class="drwt">' + head +
      '<div id="drwt-rec" aria-live="polite"></div>' +
      '<div class="drwt-cols"><div id="drwt-formwrap"></div>' +
      '<div id="drwt-out"></div></div>' + ctaHtml + "</section>";
    mount.querySelector("#drwt-formwrap").innerHTML = form(v);

    var out = mount.querySelector("#drwt-out");
    function refresh() {
      var next = readForm(mount, v);
      v = next;
      out.__data = calculate(v);
      paint(mount, v);
    }
    mount.addEventListener("input", refresh);
    mount.addEventListener("change", refresh);
    refresh();
  }

  // Exposed so the calculation can be exercised directly by tests.
  window.DRW_TANK = { calculate: calculate, recommendTank: recommendTank, TANKS: TANKS,
                      CONFIG: { RAIN_IN: RAIN_IN, GAL_PER_SQFT_IN: GAL_PER_SQFT_IN,
                                COLLECTION_EFFICIENCY: COLLECTION_EFFICIENCY,
                                IRRIGATION_IN: IRRIGATION_IN, POOL_IN: POOL_IN,
                                POOL_SQFT: POOL_SQFT, GPD: GPD, DAYS: DAYS,
                                RESERVE_DAYS: RESERVE_DAYS } };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

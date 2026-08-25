/*!
 * Dripping Rainwater — Rainfall Dashboard (embeddable)
 *
 * The full card dashboard as a component you can drop into a page, without
 * the standalone page's logo bar or footer — those would duplicate the ones
 * the site already has.
 *
 *   <div id="drw-rainfall-dashboard"></div>
 *   <script src="https://cawthorneh.github.io/vibe-coding/rainfall-dashboard.js"><\/script>
 *
 * Or paste this whole file inline inside a script tag — it needs no other
 * files, no build step and no external libraries.
 *
 * Options, set on the mount element:
 *   data-heading="off"   hide the built-in eyebrow and headline, when the
 *                        surrounding section already provides them
 *
 * Numbers come from the same gauges and the same 48-hour definition as the
 * standalone dashboard and the header strip: yesterday's full-day total plus
 * today's rain since midnight.
 */
(function () {
  "use strict";

  // Captured now: document.currentScript is null by the time DOMContentLoaded
  // fires, so an inline paste could not find where it was pasted.
  var SELF = document.currentScript;

  var MOUNT_ID = "drw-rainfall-dashboard";
  var STYLE_ID = "drw-rainfall-dashboard-css";
  var REFRESH_MS = 10 * 60 * 1000;

  /* ── Config ─────────────────────────────────────────────────────────── */

  var LOCATIONS = [
    { label: "Dripping Springs", county: "Hays Co.",      match: ["dripping springs", "dripping spr"] },
    { label: "Austin",           county: "Travis Co.",    match: ["austin"] },
    { label: "Fredericksburg",   county: "Gillespie Co.", match: ["fredericksburg"] },
    { label: "Johnson City",     county: "Blanco Co.",    match: ["johnson city"] },
    { label: "Blanco",           county: "Blanco Co.",    match: ["blanco"], exclude: ["johnson city"] }
  ];

  var LCRA_BASE = "https://hydromet.lcra.org/media/";
  var FIVE_DAY  = "Rain5Day.csv";
  var INTRADAY  = "Rainfall.csv";

  // LCRA blocks cross-origin browser reads, so fall back through public CORS
  // relays. Direct is tried first in case the policy ever loosens.
  var PROXIES = [
    function (u) { return u; },
    function (u) { return "https://corsproxy.io/?" + encodeURIComponent(u); },
    function (u) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(u); },
    function (u) { return "https://r.jina.ai/" + u; }
  ];

  var COL = {
    today:     ["today"],
    yesterday: ["1 day ago", "yesterday", "last24"],
    h24:       ["previous 24 hours", "prev 24 hours", "24 hours", "last 24 hours"],
    h1:        ["previous 1 hour", "prev 1 hour", "1 hour"]
  };

  // 1 inch of rain on 1 ft² of roof = 0.6233 gal; 0.85 accounts for
  // first-flush diversion, splash and evaporation losses on a real system.
  var GAL_PER_INCH_PER_1000SQFT = 0.6233 * 1000 * 0.85;

  /* ── Styles ─────────────────────────────────────────────────────────── */
  // Brand values sampled from drippingrainwater.com, and identical to the
  // standalone dashboard's cards. Every class is prefixed and every property
  // set explicitly, so the host page's stylesheet can't bleed in and this
  // can't leak out.

  var CSS = [
    '.drwd,.drwd *{box-sizing:border-box}',
    '.drwd{font-family:inherit;color:#121D23;max-width:100%}',

    '.drwd-top{margin-bottom:1.15rem}',
    '.drwd-eyebrow{color:#B8912F;font-size:.72rem;font-weight:800;letter-spacing:.16em;',
      'text-transform:uppercase;line-height:1.2}',
    '.drwd-h{color:#121D23;font-size:1.6rem;font-weight:800;letter-spacing:-.028em;',
      'line-height:1.12;margin:.35rem 0 0}',
    '.drwd-lead{color:#5E6A72;font-size:.92rem;line-height:1.55;margin:.5rem 0 0;max-width:64ch}',
    '.drwd-lead b{color:#121D23;font-weight:700}',

    '.drwd-grid{display:grid;gap:1.05rem;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}',
    '.drwd-card{background:#fff;border:1px solid #DFE7F0;border-radius:16px;padding:1.25rem;',
      'display:flex;flex-direction:column;gap:.95rem;position:relative;overflow:hidden;',
      'box-shadow:0 1px 2px rgba(18,29,35,.05),0 10px 28px rgba(48,102,171,.10)}',
    '.drwd-card.is-top{border-color:#D8B046}',
    '.drwd-card.is-top::before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:#D8B046}',

    '.drwd-cardhead{display:flex;align-items:baseline;justify-content:space-between;gap:.6rem}',
    '.drwd-loc{font-size:1.06rem;font-weight:800;letter-spacing:-.018em}',
    '.drwd-county{font-size:.72rem;color:#5E6A72;font-weight:600;white-space:nowrap}',

    '.drwd-readout{display:flex;align-items:baseline;gap:.45rem}',
    '.drwd-val{font-size:3rem;font-weight:800;letter-spacing:-.04em;line-height:1;',
      'font-variant-numeric:tabular-nums;color:#3066AB}',
    '.drwd-val.is-dry{color:#A7B4BF}',
    '.drwd-card.is-top .drwd-val{color:#B8912F}',
    '.drwd-unit{font-size:.86rem;color:#5E6A72;font-weight:700}',

    '.drwd-meter{height:8px;border-radius:99px;background:#F4F7FA;border:1px solid #DFE7F0;overflow:hidden}',
    '.drwd-meter span{display:block;height:100%;border-radius:99px;background:#6DABE1;transition:width .5s ease}',
    '.drwd-card.is-top .drwd-meter span{background:#D8B046}',

    '.drwd-gal{font-size:.82rem;color:#5E6A72;background:#F4F7FA;border:1px solid #DFE7F0;',
      'border-radius:10px;padding:.55rem .7rem}',
    '.drwd-gal b{color:#121D23;font-weight:800;font-variant-numeric:tabular-nums}',

    '.drwd-breaks{display:grid;grid-template-columns:repeat(2,1fr);gap:.45rem;margin:0}',
    '.drwd-brk{background:#F4F7FA;border:1px solid #DFE7F0;border-radius:10px;padding:.5rem .6rem}',
    '.drwd-brk dt{font-size:.65rem;color:#5E6A72;text-transform:uppercase;',
      'letter-spacing:.09em;font-weight:700;margin:0}',
    '.drwd-brk dd{font-size:.98rem;font-weight:700;font-variant-numeric:tabular-nums;margin:.12rem 0 0}',

    '.drwd-gauges{font-size:.75rem;color:#5E6A72;border-top:1px solid #DFE7F0;padding-top:.65rem}',
    '.drwd-gauges summary{cursor:pointer;list-style:none;font-weight:600}',
    '.drwd-gauges summary::-webkit-details-marker{display:none}',
    '.drwd-gauges summary::before{content:"\\25B8 ";color:#4CA1E1}',
    '.drwd-gauges[open] summary::before{content:"\\25BE "}',
    '.drwd-gauges ul{margin:.5rem 0 0 .85rem;padding:0;display:flex;flex-direction:column;gap:.2rem}',
    '.drwd-gauges li{list-style:none;font-variant-numeric:tabular-nums}',
    '.drwd-gauges li b{color:#121D23;font-weight:700}',

    '.drwd-nodata{font-size:.83rem;color:#5E6A72;background:#F4F7FA;border:1px dashed #DFE7F0;',
      'border-radius:10px;padding:.75rem}',
    '.drwd-nodata a{color:#3066AB}',

    '.drwd-foot{margin-top:1.1rem;color:#5E6A72;font-size:.78rem;line-height:1.5}',
    '.drwd-foot b{color:#121D23;font-weight:700}',
    '.drwd-foot a{color:#3066AB}',

    '@media (max-width:560px){',
      '.drwd-h{font-size:1.35rem}',
      '.drwd-grid{grid-template-columns:1fr}',
      '.drwd-val{font-size:2.6rem}}'
  ].join("");

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.appendChild(document.createTextNode(CSS));
    document.head.appendChild(el);
  }

  /* ── CSV ────────────────────────────────────────────────────────────── */

  function parseCSV(text) {
    var lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    function split(line) {
      var out = [], cur = "", q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (ch === '"') {
          if (q && line[i + 1] === '"') { cur += '"'; i++; } else { q = !q; }
          continue;
        }
        if (ch === "," && !q) { out.push(cur.trim()); cur = ""; continue; }
        cur += ch;
      }
      out.push(cur.trim());
      return out;
    }
    var hdrs = split(lines[0]).map(function (h) { return h.toLowerCase(); });
    return lines.slice(1).filter(function (l) { return l.trim(); }).map(function (l) {
      var v = split(l), row = {};
      hdrs.forEach(function (h, i) { row[h] = v[i] == null ? "" : v[i]; });
      return row;
    });
  }

  function locCol(rows) {
    if (!rows.length) return null;
    var names = ["location", "site name", "sitename", "name", "station", "gauge"];
    for (var i = 0; i < names.length; i++) if (names[i] in rows[0]) return names[i];
    return null;
  }

  function fetchCSV(file) {
    var url = LCRA_BASE + file, i = 0;
    function attempt() {
      if (i >= PROXIES.length) return Promise.reject(new Error("all sources failed"));
      var proxy = PROXIES[i++];
      return fetch(proxy(url), { cache: "no-store" })
        .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status)); })
        .then(function (t) {
          var rows = parseCSV(t);
          if (!rows.length || !locCol(rows)) throw new Error("unrecognised response");
          return rows;
        })
        .catch(attempt);
    }
    return attempt();
  }

  /* ── Extraction ─────────────────────────────────────────────────────── */

  function matchRows(rows, loc) {
    var col = locCol(rows);
    if (!col) return [];
    return rows.filter(function (r) {
      var name = String(r[col] || "").toLowerCase();
      var hit = loc.match.some(function (m) { return name.indexOf(m) !== -1; });
      if (!hit) return false;
      if (loc.exclude && loc.exclude.some(function (x) { return name.indexOf(x) !== -1; })) return false;
      return true;
    }).map(function (r) {
      var copy = {};
      for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) copy[k] = r[k];
      copy.__name = r[col];
      return copy;
    });
  }

  // Mean of the first candidate column that carries numeric data.
  function mean(rows, candidates) {
    for (var c = 0; c < candidates.length; c++) {
      var vals = rows.map(function (r) { return parseFloat(r[candidates[c]]); })
                     .filter(function (v) { return isFinite(v); });
      if (vals.length) {
        return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      }
    }
    return null;
  }

  function perGauge(rows, candidates) {
    for (var c = 0; c < candidates.length; c++) {
      var hits = rows.map(function (r) { return { name: r.__name, v: parseFloat(r[candidates[c]]) }; })
                     .filter(function (x) { return isFinite(x.v); });
      if (hits.length) return hits;
    }
    return rows.map(function (r) { return { name: r.__name, v: null }; });
  }

  function build(fiveDay, intraday) {
    return LOCATIONS.map(function (loc) {
      var d = matchRows(fiveDay, loc);
      var i = matchRows(intraday, loc);
      var today = mean(d, COL.today);
      var yesterday = mean(d, COL.yesterday);
      // LCRA publishes no rolling 48-hour figure, so the closest available
      // two-day window is yesterday's full day plus today since midnight.
      var total = (today === null && yesterday === null) ? null : (today || 0) + (yesterday || 0);
      return {
        label: loc.label, county: loc.county, match: loc.match,
        total: total, today: today, yesterday: yesterday,
        h24: mean(i, COL.h24), h1: mean(i, COL.h1),
        gauges: perGauge(d, COL.today),
        matched: Math.max(d.length, i.length)
      };
    });
  }

  /* ── Render ─────────────────────────────────────────────────────────── */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // A gauge with no reading shows a dash. Printing 0.00 there would claim it
  // did not rain, which is a different statement from "we don't know".
  function fmt(v) { return v === null ? "&ndash;" : v.toFixed(2); }

  function card(d, peak) {
    // Waiting on data is not the same as a gauge that didn't match: blaming a
    // rename when the network is down sends you looking in the wrong place.
    if (d.pending) {
      return '<article class="drwd-card">' +
        '<div class="drwd-cardhead"><span class="drwd-loc">' + esc(d.label) + "</span>" +
        '<span class="drwd-county">' + esc(d.county) + "</span></div>" +
        '<div class="drwd-readout"><span class="drwd-val is-dry">&ndash;</span>' +
        '<span class="drwd-unit">in / 48 hr</span></div>' +
        '<div class="drwd-meter"><span style="width:0"></span></div>' +
        '<dl class="drwd-breaks">' +
          '<div class="drwd-brk"><dt>Today</dt><dd>&ndash;</dd></div>' +
          '<div class="drwd-brk"><dt>Yesterday</dt><dd>&ndash;</dd></div>' +
          '<div class="drwd-brk"><dt>Last 24 hr</dt><dd>&ndash;</dd></div>' +
          '<div class="drwd-brk"><dt>Last hour</dt><dd>&ndash;</dd></div>' +
        "</dl></article>";
    }
    if (d.total === null) {
      return '<article class="drwd-card">' +
        '<div class="drwd-cardhead"><span class="drwd-loc">' + esc(d.label) + "</span>" +
        '<span class="drwd-county">' + esc(d.county) + "</span></div>" +
        '<div class="drwd-nodata">No LCRA gauge matched <b>' + esc(d.match.join(", ")) + "</b>. " +
        'The gauge may be offline or renamed &mdash; check the ' +
        '<a href="https://hydromet.lcra.org/Home/GaugeDataList" target="_blank" rel="noopener">' +
        "gauge list</a>.</div></article>";
    }
    var top = peak !== null && d.total === peak;
    var gal = Math.round(d.total * GAL_PER_INCH_PER_1000SQFT);
    var scale = Math.max(1, peak === null ? 1 : peak);

    return '<article class="drwd-card' + (top ? " is-top" : "") + '">' +
      '<div class="drwd-cardhead"><span class="drwd-loc">' + esc(d.label) + "</span>" +
        '<span class="drwd-county">' + esc(d.county) + "</span></div>" +
      '<div class="drwd-readout"><span class="drwd-val' + (d.total > 0 ? "" : " is-dry") + '">' +
        fmt(d.total) + '</span><span class="drwd-unit">in / 48 hr</span></div>' +
      '<div class="drwd-meter"><span style="width:' +
        Math.min(100, (d.total / scale) * 100) + '%"></span></div>' +
      '<div class="drwd-gal">&asymp; <b>' + gal.toLocaleString() +
        " gal</b> off a 1,000 ft&sup2; roof</div>" +
      '<dl class="drwd-breaks">' +
        '<div class="drwd-brk"><dt>Today</dt><dd>' + fmt(d.today) + '"</dd></div>' +
        '<div class="drwd-brk"><dt>Yesterday</dt><dd>' + fmt(d.yesterday) + '"</dd></div>' +
        '<div class="drwd-brk"><dt>Last 24 hr</dt><dd>' + fmt(d.h24) + '"</dd></div>' +
        '<div class="drwd-brk"><dt>Last hour</dt><dd>' + fmt(d.h1) + '"</dd></div>' +
      "</dl>" +
      '<details class="drwd-gauges"><summary>' + d.matched + " gauge" +
        (d.matched === 1 ? "" : "s") + " averaged</summary><ul>" +
        d.gauges.map(function (g) {
          return "<li>" + esc(g.name) + " &mdash; <b>" +
                 (g.v === null ? "&ndash;" : g.v.toFixed(2) + '"') + "</b></li>";
        }).join("") +
      "</ul></details></article>";
  }

  function render(mount, rows, foot) {
    // Gold marks the wettest location, but only when it actually rained —
    // highlighting a five-way tie at zero would be noise.
    var vals = rows.map(function (r) { return r.total; })
                   .filter(function (v) { return v !== null; });
    var peak = vals.length ? Math.max.apply(null, vals) : null;
    if (peak !== null && peak <= 0) peak = null;

    var head = mount.getAttribute("data-heading") === "off" ? "" :
      '<div class="drwd-top">' +
        '<div class="drwd-eyebrow">Rainfall Watch</div>' +
        '<div class="drwd-h">Rainfall, last 48 hours</div>' +
        '<p class="drwd-lead">Totals in inches from LCRA Hydromet gauges, averaged across ' +
        'every gauge in each area. The 48-hour figure is <b>yesterday\'s full-day total plus ' +
        "today's rain since midnight</b> &mdash; the closest two-day window LCRA publishes.</p>" +
      "</div>";

    mount.innerHTML =
      '<section class="drwd" aria-label="Rainfall, last 48 hours">' + head +
        '<div class="drwd-grid">' + rows.map(function (d) { return card(d, peak); }).join("") + "</div>" +
        '<div class="drwd-foot">' + foot + "</div>" +
      "</section>";
  }

  /* ── Load ───────────────────────────────────────────────────────────── */

  function footLive() {
    var t = "";
    try {
      t = " &middot; updated " +
          new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) {}
    return 'Source: <a href="https://hydromet.lcra.org/" target="_blank" rel="noopener">' +
           "LCRA Hydromet</a>" + t + ". Readings are provisional and unverified &mdash; " +
           'not for flood-safety decisions, see <a href="https://www.weather.gov/" ' +
           'target="_blank" rel="noopener">NWS</a> for warnings.';
  }

  function footDown() {
    return "<b>Live readings unavailable.</b> LCRA Hydromet can't be reached right now &mdash; " +
           "these will fill in automatically once it responds.";
  }

  function placeholder() {
    return LOCATIONS.map(function (l) {
      return { label: l.label, county: l.county, match: l.match, pending: true,
               total: null, today: null, yesterday: null, h24: null, h1: null,
               gauges: [], matched: 0 };
    });
  }

  function load(mount) {
    Promise.all([fetchCSV(FIVE_DAY), fetchCSV(INTRADAY)]).then(function (r) {
      render(mount, build(r[0], r[1]), footLive());
    }).catch(function () {
      render(mount, placeholder(), footDown());
    });
  }

  function start() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) {
      // Fall back to the script tag's own position when there's no container,
      // so an inline paste still renders where it was pasted.
      if (!SELF || !SELF.parentNode) return;
      mount = document.createElement("div");
      mount.id = MOUNT_ID;
      SELF.parentNode.insertBefore(mount, SELF);
    }
    injectCSS();
    render(mount, placeholder(), "Loading readings from LCRA Hydromet&hellip;");
    load(mount);
    setInterval(function () { load(mount); }, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

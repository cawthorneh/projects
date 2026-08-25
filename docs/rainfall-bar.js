/*!
 * Dripping Rainwater — Rainfall Monitor bar
 *
 * A self-contained embeddable strip of 48-hour rainfall totals from LCRA
 * Hydromet. Drop it anywhere on the site:
 *
 *   <div id="drw-rainfall-bar"></div>
 *   <script src="https://cawthorneh.github.io/vibe-coding/rainfall-bar.js"></script>
 *
 * Or paste this whole file inline inside a <script> tag — it needs no other
 * files, no build step and no external libraries.
 *
 * Options, set on the mount element:
 *   data-dashboard="https://…"   link the header cell to the full dashboard
 *
 * Numbers come from the same gauges and the same 48-hour definition as the
 * dashboard: yesterday's full-day total plus today's rain since midnight.
 */
(function () {
  "use strict";

  // Captured now: document.currentScript is null by the time DOMContentLoaded
  // fires, so an inline paste could not find where it was pasted.
  var SELF = document.currentScript;

  var MOUNT_ID = "drw-rainfall-bar";
  var STYLE_ID = "drw-rainfall-bar-css";
  var REFRESH_MS = 10 * 60 * 1000;

  /* ── Config ─────────────────────────────────────────────────────────── */

  var LOCATIONS = [
    { label: "Dripping Springs", match: ["dripping springs", "dripping spr"] },
    { label: "Austin",           match: ["austin"] },
    { label: "Fredericksburg",   match: ["fredericksburg"] },
    { label: "Johnson City",     match: ["johnson city"] },
    { label: "Blanco",           match: ["blanco"], exclude: ["johnson city"] }
  ];

  var LCRA_BASE = "https://hydromet.lcra.org/media/";
  var FIVE_DAY  = "Rain5Day.csv";

  // LCRA blocks cross-origin browser reads, so fall back through public CORS
  // relays. Direct is tried first in case the policy ever loosens.
  var PROXIES = [
    function (u) { return u; },
    function (u) { return "https://corsproxy.io/?" + encodeURIComponent(u); },
    function (u) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(u); },
    function (u) { return "https://r.jina.ai/" + u; }
  ];

  var COL_TODAY     = ["today"];
  var COL_YESTERDAY = ["1 day ago", "yesterday", "last24"];

  /* ── Styles ─────────────────────────────────────────────────────────── */
  // Every class is prefixed and every property is set explicitly, so the
  // host page's stylesheet can't bleed in and this can't leak out.

  var CSS = [
    // Own the box model rather than inheriting whatever the host page sets.
    '.drwrb,.drwrb *{box-sizing:border-box}',
    '.drwrb{position:relative;display:block;font-family:inherit;',
      'background:#F7DE7F;border-radius:14px;overflow:hidden;',
      'box-shadow:0 1px 2px rgba(32,42,174,.08);max-width:100%}',
    '.drwrb-scroll{display:flex;align-items:stretch;overflow-x:auto;',
      'scroll-behavior:smooth;scroll-snap-type:x proximity;',
      '-webkit-overflow-scrolling:touch;scrollbar-width:none}',
    '.drwrb-scroll::-webkit-scrollbar{display:none}',
    '.drwrb-cell{flex:0 0 auto;padding:.85rem 1.4rem;scroll-snap-align:start;',
      'border-right:1px solid #D0BE84;text-align:center;min-width:8.5rem;',
      'display:flex;flex-direction:column;justify-content:center;gap:.15rem}',
    '.drwrb-cell:last-child{border-right:0}',
    '.drwrb-head{text-align:left;min-width:11rem;text-decoration:none}',
    'a.drwrb-head:hover .drwrb-title{text-decoration:underline}',
    '.drwrb-title{color:#202AAE;font-size:.8rem;font-weight:800;',
      'letter-spacing:.08em;text-transform:uppercase;line-height:1.2}',
    '.drwrb-sub{color:#5C5D9D;font-size:.72rem;font-weight:500;line-height:1.3}',
    '.drwrb-sub-short{display:none}',
    '.drwrb-loc{color:#5C5D9D;font-size:.68rem;font-weight:700;',
      'letter-spacing:.07em;text-transform:uppercase;line-height:1.2;white-space:nowrap}',
    '.drwrb-val{color:#202AAE;font-size:1.5rem;font-weight:800;line-height:1.1;',
      'font-variant-numeric:tabular-nums;letter-spacing:-.02em}',
    '.drwrb-val.is-empty{color:#8A87B4}',
    // Arrows sit over a fade so cells scroll under them rather than stopping short.
    '.drwrb-nav{position:absolute;top:0;bottom:0;width:3.6rem;border:0;padding:0;',
      'display:none;align-items:center;cursor:pointer;background:none}',
    '.drwrb-nav[data-show="1"]{display:flex}',
    '.drwrb-nav-prev{left:0;justify-content:flex-start;',
      'background:linear-gradient(90deg,#F7DE7F 55%,rgba(247,222,127,0))}',
    '.drwrb-nav-next{right:0;justify-content:flex-end;',
      'background:linear-gradient(270deg,#F7DE7F 55%,rgba(247,222,127,0))}',
    '.drwrb-nav span{display:flex;align-items:center;justify-content:center;',
      'width:2rem;height:2rem;border-radius:50%;background:#202AAE;color:#fff;',
      'font-size:1rem;line-height:1;margin:0 .5rem;box-shadow:0 1px 3px rgba(32,42,174,.3)}',
    '.drwrb-nav:disabled{opacity:0;pointer-events:none}',
    '.drwrb-nav:focus-visible{outline:3px solid #202AAE;outline-offset:-3px}',
    '@media (max-width:520px){',
      '.drwrb-cell{padding:.75rem .9rem;min-width:6.6rem}',
      '.drwrb-head{min-width:0;max-width:8.2rem}',
      '.drwrb-title{font-size:.7rem;letter-spacing:.06em}',
      '.drwrb-sub-full{display:none}',
      '.drwrb-sub-short{display:inline}',
      '.drwrb-val{font-size:1.25rem}',
      '.drwrb-nav{width:2.6rem}',
      '.drwrb-nav span{width:1.75rem;height:1.75rem;margin:0 .35rem}}',
    '@media (prefers-reduced-motion:reduce){.drwrb-scroll{scroll-behavior:auto}}'
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

  // LCRA publishes no rolling 48-hour figure, so the closest available
  // two-day window is yesterday's full day plus today since midnight.
  function total48(rows) {
    var t = mean(rows, COL_TODAY);
    var y = mean(rows, COL_YESTERDAY);
    if (t === null && y === null) return null;
    return (t || 0) + (y || 0);
  }

  function build(fiveDay) {
    return LOCATIONS.map(function (loc) {
      return { label: loc.label, total: total48(matchRows(fiveDay, loc)) };
    });
  }

  /* ── Render ─────────────────────────────────────────────────────────── */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // A gauge with no reading shows a dash. Printing 0.00" there would claim
  // it did not rain, which is a different statement from "we don't know".
  function fmt(v) { return v === null ? "&ndash;" : v.toFixed(2) + '"'; }

  function render(mount, rows, sub, shortSub) {
    var dash = mount.getAttribute("data-dashboard");
    var headTag = dash ? "a" : "div";
    var headAttr = dash ? ' href="' + esc(dash) + '" class="drwrb-cell drwrb-head"'
                        : ' class="drwrb-cell drwrb-head"';

    var cells = rows.map(function (r) {
      var empty = r.total === null ? " is-empty" : "";
      return '<div class="drwrb-cell">' +
               '<div class="drwrb-loc">' + esc(r.label) + "</div>" +
               '<div class="drwrb-val' + empty + '">' + fmt(r.total) + "</div>" +
             "</div>";
    }).join("");

    mount.innerHTML =
      '<div class="drwrb">' +
        '<div class="drwrb-scroll">' +
          "<" + headTag + headAttr + ">" +
            '<div class="drwrb-title">Rainfall Monitor</div>' +
            '<div class="drwrb-sub">' +
              '<span class="drwrb-sub-full">' + esc(sub) + "</span>" +
              '<span class="drwrb-sub-short">' + esc(shortSub) + "</span>" +
            "</div>" +
          "</" + headTag + ">" +
          cells +
        "</div>" +
        '<button class="drwrb-nav drwrb-nav-prev" aria-label="Scroll left"><span>&#8249;</span></button>' +
        '<button class="drwrb-nav drwrb-nav-next" aria-label="Scroll right"><span>&#8250;</span></button>' +
      "</div>";

    wireNav(mount);
  }

  function wireNav(mount) {
    var scroll = mount.querySelector(".drwrb-scroll");
    var prev = mount.querySelector(".drwrb-nav-prev");
    var next = mount.querySelector(".drwrb-nav-next");
    if (!scroll) return;

    function step(dir) {
      var cell = scroll.querySelector(".drwrb-cell:not(.drwrb-head)");
      var by = cell ? cell.getBoundingClientRect().width * 2 : scroll.clientWidth * 0.8;
      scroll.scrollBy({ left: dir * by, behavior: "smooth" });
    }
    prev.addEventListener("click", function () { step(-1); });
    next.addEventListener("click", function () { step(1); });

    function sync() {
      var over = scroll.scrollWidth - scroll.clientWidth;
      var show = over > 4 ? "1" : "0";
      prev.setAttribute("data-show", show);
      next.setAttribute("data-show", show);
      prev.disabled = scroll.scrollLeft <= 2;
      next.disabled = scroll.scrollLeft >= over - 2;
    }
    scroll.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    sync();
  }

  /* ── Load ───────────────────────────────────────────────────────────── */

  function stamp() {
    try {
      return "Tracking 48 hrs · updated " +
             new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) { return "Tracking 48 hrs · LCRA"; }
  }

  function load(mount) {
    fetchCSV(FIVE_DAY).then(function (rows) {
      render(mount, build(rows), stamp(), "48 hrs · LCRA");
    }).catch(function () {
      // Show the locations with dashes rather than hiding: an empty strip
      // looks broken, and zeros would be a lie.
      render(mount, LOCATIONS.map(function (l) {
        return { label: l.label, total: null };
      }), "Live data unavailable · retrying", "No live data");
    });
  }

  function start() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) {
      // Fall back to the script tag's own position when there's no container,
      // so an inline paste still renders where it was pasted.
      var self = SELF;
      if (!self || !self.parentNode) return;
      mount = document.createElement("div");
      mount.id = MOUNT_ID;
      self.parentNode.insertBefore(mount, self);
    }
    injectCSS();
    render(mount, LOCATIONS.map(function (l) {
      return { label: l.label, total: null };
    }), "Tracking 48 hrs · LCRA", "48 hrs · LCRA");
    load(mount);
    setInterval(function () { load(mount); }, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

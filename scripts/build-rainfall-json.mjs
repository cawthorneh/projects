/**
 * Fetch LCRA Hydromet and write a parsed snapshot the browser can read.
 *
 * The components originally read LCRA through public CORS relays. All three
 * are now dead — corsproxy.io refuses keyless URLs, allorigins returns 522,
 * r.jina.ai sits behind a Cloudflare challenge — while LCRA itself answers a
 * server directly with HTTP 200. So the fetch moves server-side and the
 * browser reads a static file instead of relaying.
 *
 * Column names are discovered, not assumed. LCRA's real headers are:
 *   Rain5Day.csv  Site,Location,Basin,Today,Last24,<MM/DD/YYYY x4>,Since <date>
 *   Rainfall.csv  Site,Location,Date Time,1 Hour,3 Hour,6 Hour,24 Hour,Since Midnight
 * Note the per-date columns, which change every day, and that "Last24" is a
 * rolling window that overlaps Today rather than being yesterday's total.
 */
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = "https://hydromet.lcra.org/media/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const LOCATIONS = [
  { id: "dripping_springs", label: "Dripping Springs", county: "Hays Co.",
    match: ["dripping springs", "dripping spr"] },
  { id: "austin",           label: "Austin",           county: "Travis Co.",
    match: ["austin"] },
  { id: "fredericksburg",   label: "Fredericksburg",   county: "Gillespie Co.",
    match: ["fredericksburg"] },
  { id: "johnson_city",     label: "Johnson City",     county: "Blanco Co.",
    match: ["johnson city"] },
  { id: "blanco",           label: "Blanco",           county: "Blanco Co.",
    match: ["blanco"], exclude: ["johnson city"] }
];

export function parseCSV(text) {
  const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const split = (line) => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; continue; }
      if (ch === "," && !q) { out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = split(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map(l => {
    const v = split(l), row = {};
    headers.forEach((h, i) => { row[h.toLowerCase()] = v[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}

// LCRA labels each of the previous days with its own date, so "yesterday" is
// whichever dated column is most recent — not a fixed name.
export function datedColumns(headers) {
  return headers
    .map(h => h.trim())
    .filter(h => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(h))
    .map(h => { const [m, d, y] = h.split("/").map(Number); return { header: h, t: Date.UTC(y, m - 1, d) }; })
    .sort((a, b) => b.t - a.t);
}

export function findCol(headers, test) {
  const hit = headers.find(h => test(h.trim().toLowerCase()));
  return hit ? hit.toLowerCase() : null;
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

function mean(values) {
  const v = values.filter(x => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function matchRows(rows, loc, locKey) {
  return rows.filter(r => {
    const name = String(r[locKey] || "").toLowerCase();
    if (!loc.match.some(m => name.includes(m))) return false;
    if (loc.exclude && loc.exclude.some(x => name.includes(x))) return false;
    return true;
  });
}

export function build(fiveDayText, intradayText) {
  const five = parseCSV(fiveDayText);
  const intra = parseCSV(intradayText);

  const locKey = "location";
  const dated = datedColumns(five.headers);
  const todayCol = findCol(five.headers, h => h === "today");
  const yesterdayCol = dated.length ? dated[0].header.toLowerCase() : null;

  const h1Col  = findCol(intra.headers, h => /^1 hour/.test(h));
  const h24Col = findCol(intra.headers, h => /^24 hour/.test(h));
  const midCol = findCol(intra.headers, h => /since midnight/.test(h));

  const locations = LOCATIONS.map(loc => {
    const d = matchRows(five.rows, loc, locKey);
    const i = matchRows(intra.rows, loc, locKey);
    const today = todayCol ? mean(d.map(r => num(r[todayCol]))) : null;
    const yesterday = yesterdayCol ? mean(d.map(r => num(r[yesterdayCol]))) : null;
    const total48 = (today === null && yesterday === null) ? null : (today || 0) + (yesterday || 0);
    const round = (v) => v === null ? null : Math.round(v * 100) / 100;
    return {
      id: loc.id, label: loc.label, county: loc.county,
      total48: round(total48), today: round(today), yesterday: round(yesterday),
      h24: h24Col ? round(mean(i.map(r => num(r[h24Col])))) : null,
      h1:  h1Col  ? round(mean(i.map(r => num(r[h1Col]))))  : null,
      midnight: midCol ? round(mean(i.map(r => num(r[midCol])))) : null,
      gauges: d.map(r => ({ name: r[locKey], today: round(num(r[todayCol])) })),
      matched: Math.max(d.length, i.length)
    };
  });

  return {
    generated: new Date().toISOString(),
    source: "https://hydromet.lcra.org/",
    window: "48h = today so far plus the whole of the previous calendar day",
    columns: { today: todayCol, yesterday: yesterdayCol, h24: h24Col, h1: h1Col, midnight: midCol },
    locations,
    // Kept so a future LCRA rename is diagnosable from the published file
    // rather than only from a failing site.
    debug: {
      fiveDayHeaders: five.headers,
      intradayHeaders: intra.headers,
      fiveDayRows: five.rows.length,
      intradayRows: intra.rows.length,
      datedColumns: dated.map(d => d.header)
    }
  };
}

async function get(file) {
  const r = await fetch(BASE + file, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return r.text();
}

// Only runs when invoked directly, so the parser can be imported by tests.
if (process.argv[1] && process.argv[1].endsWith("build-rainfall-json.mjs")) {
  const [a, b] = await Promise.all([get("Rain5Day.csv"), get("Rainfall.csv")]);
  const out = build(a, b);
  mkdirSync("docs/data", { recursive: true });
  writeFileSync("docs/data/rainfall.json", JSON.stringify(out, null, 2) + "\n");
  console.log("columns:", JSON.stringify(out.columns));
  console.log("dated columns:", out.debug.datedColumns.join(", "));
  for (const l of out.locations) {
    console.log(`  ${l.label.padEnd(18)} 48h=${String(l.total48).padEnd(6)} ` +
                `today=${String(l.today).padEnd(6)} yest=${String(l.yesterday).padEnd(6)} ` +
                `gauges=${l.matched}  ${l.gauges.slice(0,4).map(g => g.name).join(" | ")}`);
  }
}

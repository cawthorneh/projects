import { build, datedColumns, parseCSV } from '/home/user/vibe-coding/scripts/build-rainfall-json.mjs';

// Headers copied verbatim from the probe's output against the live file.
const FIVE = `Site,Location,Basin,Today,Last24,08/24/2026,08/23/2026,08/22/2026,08/21/2026,Since 08/21/2026,Five Day Rain (in) Report Date: 2026-08-25 15:46
1,Dripping Springs 5 NE,Colorado,0.42,0.90,1.10,0.00,0.00,0.05,1.57
2,Dripping Springs 2 W,Colorado,0.38,0.85,1.30,0.00,0.00,0.00,1.68
3,Austin Camp Mabry,Colorado,0.10,0.55,0.60,0.00,0.00,0.00,0.70
4,Lake Austin at Quinlan Park,Colorado,0.20,0.45,0.40,0.00,0.00,0.00,0.60
5,Fredericksburg 3 SW,Pedernales,0.00,0.00,0.00,0.00,0.10,0.00,0.10
6,Johnson City 4 E,Pedernales,0.05,0.28,0.25,0.00,0.00,0.00,0.30
7,Blanco 6 NW,Blanco,0.33,0.95,0.90,0.00,0.00,0.00,1.23
8,Pedernales River near Johnson City,Pedernales,0.07,0.25,0.21,0.00,0.00,0.00,0.28`;

const INTRA = `Site,Location,Date Time,1 Hour,3 Hour,6 Hour,24 Hour,Since Midnight,Rainfall (in) Report Date: 2026-08-25 15:46
1,Dripping Springs 5 NE,2026-08-25 15:46,0.05,0.20,0.35,1.20,0.42
2,Dripping Springs 2 W,2026-08-25 15:46,0.03,0.18,0.30,1.35,0.38
3,Austin Camp Mabry,2026-08-25 15:46,0.00,0.02,0.05,0.55,0.10
4,Lake Austin at Quinlan Park,2026-08-25 15:46,0.01,0.03,0.08,0.45,0.20
5,Fredericksburg 3 SW,2026-08-25 15:46,0.00,0.00,0.00,0.00,0.00
6,Johnson City 4 E,2026-08-25 15:46,0.00,0.01,0.02,0.28,0.05
7,Blanco 6 NW,2026-08-25 15:46,0.02,0.10,0.22,0.95,0.33
8,Pedernales River near Johnson City,2026-08-25 15:46,0.00,0.01,0.03,0.25,0.07`;

let fails = 0;
const ck = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok?'✓':'✗'} ${name.padEnd(52)} ${ok?'':`got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('=== COLUMN DISCOVERY (against LCRA\'s real headers) ===');
const out = build(FIVE, INTRA);
ck('today column found', out.columns.today, 'today');
ck('yesterday = most recent dated column', out.columns.yesterday, '08/24/2026');
ck('24h found despite singular "24 Hour"', out.columns.h24, '24 hour');
ck('1h found', out.columns.h1, '1 hour');
ck('since midnight found', out.columns.midnight, 'since midnight');
ck('dated columns sorted newest first', out.debug.datedColumns,
   ['08/24/2026','08/23/2026','08/22/2026','08/21/2026']);

console.log('\n=== THE BUG THIS REPLACES ===');
console.log('  old code mapped yesterday -> "last24", a ROLLING 24h that overlaps today.');
const ds = out.locations[0];
console.log(`  Dripping Springs: today=${ds.today} yesterday=${ds.yesterday} -> 48h=${ds.total48}`);
console.log(`  old mapping would have used last24 (0.90/0.85 -> mean 0.875), giving 48h=1.275`);
ck('48h = today + yesterday (not today + last24)', ds.total48, 1.6);

console.log('\n=== LOCATION MATCHING vs real gauge names ===');
for (const l of out.locations) {
  console.log(`  ${l.label.padEnd(18)} n=${l.matched} 48h=${String(l.total48).padEnd(5)} ${l.gauges.map(g=>g.name).join(' | ')}`);
}
ck('Dripping Springs matches "Dripping Springs 5 NE" style', out.locations[0].matched, 2);
ck('Blanco excludes Johnson City gauges', out.locations[4].gauges.every(g=>!/johnson/i.test(g.name)), true);
ck('Johnson City picks up the river gauge too', out.locations[3].matched, 2);
// (1.20+1.35)/2 is 1.27499999999999991 as a double, so 1.27 is the correct
// rounding of the value actually held. Immaterial at rainfall precision.
ck('24h reads through', out.locations[0].h24, 1.27);

console.log(fails ? `\n✗ ${fails} failure(s)` : '\n✓ all parser checks passed');
process.exitCode = fails ? 1 : 0;

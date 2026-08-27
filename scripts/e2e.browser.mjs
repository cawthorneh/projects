import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const DIR='/tmp/claude-0/-home-user-vibe-coding/14b7c837-960f-514e-846c-8b3e8dfb2429/scratchpad/';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let fails=0;
for (const [f,sel,foot,name,h] of [
  ['e2e-bar.html','.drwrb-stat','.drwrb-foot','header strip',200],
  ['e2e-dash.html','.drwd-card','.drwd-foot','dashboard',660],
]) {
  const ctx = await b.newContext({ viewport:{width:1180,height:900} });
  const p = await ctx.newPage(); const errs=[]; const seen=[];
  p.on('pageerror', e=>errs.push(String(e)));
  p.on('response', r => { if (r.url().includes('rainfall.json')) seen.push(r.status()); });
  await p.goto('http://127.0.0.1:8099/'+f);
  await p.waitForTimeout(1500);
  const d = await p.evaluate(([s,fo]) => ({
    n: document.querySelectorAll(s).length,
    vals: [...document.querySelectorAll(s)].map(e =>
      (e.querySelector('.drwrb-loc,.drwd-loc')?.textContent) + '=' +
      (e.querySelector('.drwrb-val,.drwd-val')?.textContent.replace(/in$/,'').trim())),
    foot: document.querySelector(fo)?.textContent.trim().slice(0,86),
    gauges: [...document.querySelectorAll('.drwd-gauges summary')].map(x=>x.textContent),
  }), [sel,foot]);
  console.log(`── ${name} ──`);
  console.log('  snapshot fetched:', seen.join(',')||'none');
  console.log(' ', d.vals.join('  '));
  console.log('  foot:', d.foot);
  if (d.gauges.length) console.log('  gauges:', d.gauges.join(' | '));
    // 'read at' or 'behind' are both correct live states — the second is the
  // staleness notice doing its job on an old snapshot, not a failure.
  const ok = seen[0]===200 && d.n===5 && /(read at|behind)/i.test(d.foot||'') && !d.vals.some(v=>/undefined|–/.test(v));
  console.log(`  ${ok?'✓ renders real published readings':'✗ failed'}`);
  if(!ok||errs.length){fails++; if(errs.length)console.log('  errors:',errs);}
  await p.screenshot({ path:f.replace('.html','.png'), clip:{x:0,y:0,width:1180,height:h} });
  await ctx.close();
}
console.log(fails?`\n✗ ${fails} failed`:'\n✓ both components render the real published snapshot end to end');
if(fails) process.exitCode=1;
await b.close();

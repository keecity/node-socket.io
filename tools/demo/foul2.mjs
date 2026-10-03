import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.addInitScript(() => { try { localStorage.setItem('cc_tut', '1'); } catch (e) {} });
await p.goto('file:///home/user/node-socket.io/public/court-demo.html'); await p.waitForTimeout(8000);
let fouls = 0, steals = 0;
for (let k = 0; k < 10; k++) {
  // Teal just stole it from right next to a Purple player; the player immediately taps
  await p.evaluate(() => { const g = window.game; const t = g.P.find(q => q.team === 1), d = g.P.find(q => q.team === 0); g.game.phase = 'live'; g.human.auto = false; g.human.meter = false; g.give(t); d.pos.set(t.pos.x + 0.7, 0, t.pos.z); d.action = null; t.react = 9; window.__st = window.__stats.steal; });
  await p.mouse.click(195, 420);
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => window.game.game.phase); if (r.startsWith('ft')) fouls++;
  await p.evaluate(() => { const g = window.game; g.game.ft = null; });
}
console.log('immediate taps -> fouls:', fouls, '/ 10');
await b.close();

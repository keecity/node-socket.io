import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto('file:///home/user/node-socket.io/public/court-demo.html'); await p.waitForTimeout(7000);
await p.click('#hplay'); await p.waitForTimeout(500);
for (const [label, gap] of [['slow', 700], ['fast', 150]]) {
  await p.evaluate(() => { const g = window.game, h = g.P[0]; g.game.phase = 'live'; g.give(h); h.pos.set(-12, 0, 0); h.boost = 0; h.stamina = 1; h.moveTarget = null; for (const q of g.P) if (q !== h) { q.pos.set(0, 0, 7); q.react = 99; } });
  const q = await p.evaluate(() => window.__w2s(13, 0)); let mx = 0;
  for (let i = 0; i < 14; i++) { await p.mouse.click(q[0], q[1]); await p.waitForTimeout(gap); mx = Math.max(mx, await p.evaluate(() => window.game.P[0].boost)); }
  const s1 = await p.evaluate(() => window.game.P[0].boost); await p.waitForTimeout(1500); const s2 = await p.evaluate(() => window.game.P[0].boost);
  console.log(label, 'max boost', mx.toFixed(2), 'speed x', (1 + 1.1 * mx).toFixed(2), '| after stop', s1.toFixed(2), '->', s2.toFixed(2));
}
await b.close();

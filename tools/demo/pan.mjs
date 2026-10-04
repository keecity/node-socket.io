import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 360, height: 780 } });
await p.goto('file:///home/user/node-socket.io/public/court-demo.html'); await p.waitForTimeout(7000);
await p.click('#hplay'); await p.waitForTimeout(500);
for (const x of [12, -12]) {
  await p.evaluate(x => { const g = window.game, h = g.P[0]; g.game.phase = 'live'; g.give(h); for (const q of g.P) { q.pos.set(x + (q.id % 3) - 1, 0, (q.id - 2.5)); q.react = 99; q.moveTarget = null; } }, x);
  await p.waitForTimeout(4000); await p.screenshot({ path: `pan${x > 0 ? 'far' : 'near'}.png` });
}
await b.close();

import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
p.on('pageerror', e => console.log('ERR', e.message));
await p.addInitScript(() => { try { localStorage.setItem('cc_tut', '1'); } catch (e) {} });
await p.goto('file:///home/user/node-socket.io/public/court-demo.html'); await p.waitForTimeout(8000);
await p.evaluate(() => { const g = window.game; g.game.phase = 'live'; g.human.on = true; const h = g.P.find(q => q.team === 1); g.give(h); g.P.forEach((q, i) => { q.pos.set(-12 + (i % 3) * 0.8, 0, (i - 2.5) * 0.9); q.react = 99; q.moveTarget = null; }); });
await p.waitForTimeout(3000); await p.screenshot({ path: 'ring_red.png' });
await b.close();

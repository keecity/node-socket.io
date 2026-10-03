import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
for (const [w, h] of [[390, 844], [835, 462], [1280, 720]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.addInitScript(() => { try { localStorage.setItem('cc_tut', '1'); } catch (e) {} });
  await p.goto('file:///home/user/node-socket.io/public/court-demo.html'); await p.waitForTimeout(9000);
  // tap check: ground point under a player's feet should map back near that player
  const r = await p.evaluate(() => { const g = window.game, q = g.P[0]; const cam = window.app.root.findByName('Camera') || null; return null; });
  await p.screenshot({ path: `vp_${w}.png` }); await p.close();
}
await b.close();

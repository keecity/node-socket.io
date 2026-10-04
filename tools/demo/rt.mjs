import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
for (const [w, h] of [[390, 844], [1280, 720]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(() => { try { localStorage.setItem('cc_tut', '1'); } catch (e) {} });
  await p.goto('file:///home/user/node-socket.io/public/court-demo.html'); await p.waitForTimeout(8000);
  await p.evaluate(() => { const g = window.game; g.game.phase = 'live'; const h = g.P[0]; g.give(h); h.pos.set(-6, 0, 0); for (const q of g.P) q.react = 99; });
  await p.waitForTimeout(500);
  // label of P[2] says where it is on screen; tap the player's feet (label bottom + ~ body height) and compare
  const pts = [[8, 3], [-10, -5], [0, 6]];
  for (const [x, z] of pts) {
    const s = await p.evaluate(([x, z]) => window.__w2s(x, z), [x, z]);
    await p.mouse.click(s[0], s[1]); await p.waitForTimeout(250);
    console.log(w, 'world', x, z, '-> tap target', await p.evaluate(() => { const t = window.game.P[0].moveTarget; return t ? t.x.toFixed(2) + ',' + t.z.toFixed(2) : '-'; }));
    await p.waitForTimeout(400);
  }
  await p.close();
}
await b.close();

import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
for (const f of ['file:///tmp/claude-0/-home-user-node-socket-io/f39474d5-a23f-5b25-8a44-868a8905bd48/scratchpad/v57.html', 'file:///home/user/node-socket.io/public/court-demo.html']) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.addInitScript(() => { try { localStorage.setItem('cc_tut', '1'); } catch (e) {} });
  await p.goto(f); await p.waitForTimeout(8000);
  await p.evaluate(() => { const h = document.getElementById('hplay'); if (h) h.click(); });
  await p.waitForTimeout(7000);
  const cinfo = await p.evaluate(() => { const c = window.app.root.findByName('Camera'); const f = c.forward, pp = c.getPosition(); return 'pos ' + [pp.x, pp.y, pp.z].map(v => v.toFixed(2)) + ' fwd ' + [f.x, f.y, f.z].map(v => v.toFixed(3)) + ' proj ' + c.camera.projection; }); console.log(cinfo);
  const r = await p.evaluate(() => { const g = window.game, cam = window.app.root.findByName('Camera').camera, s = new pc.Vec3(), pts = [[-14, 7.5], [14, 7.5], [-14, -7.5], [14, -7.5]].map(([x, z]) => { cam.worldToScreen(new pc.Vec3(x, 0, z), s); return [s.x, s.y]; });
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), ortho: cam.orthoHeight, asp: cam.aspectRatio, mode: cam.aspectRatioMode }; });
  console.log(f.split('/').pop(), JSON.stringify(r), 'h/w', (r.h / r.w).toFixed(3));
  await p.screenshot({ path: '/tmp/claude-0/-home-user-node-socket-io/f39474d5-a23f-5b25-8a44-868a8905bd48/scratchpad/shape_' + f.split('/').pop() + '.png' }); await p.close();
}
await b.close();

import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.addInitScript(() => { try { localStorage.setItem('cc_tut', '1'); } catch (e) {} });
await p.goto('file:///home/user/node-socket.io/public/court-demo.html'); await p.waitForTimeout(7000);
const st = () => p.evaluate(() => { const g = window.game, h = g.ball.holder; return `${g.game.phase} holder=${h ? h.name + '/t' + h.team + ' x=' + h.pos.x.toFixed(2) + ' z=' + h.pos.z.toFixed(2) + (h.oob ? ' OOB' : '') : '-'} | ${document.getElementById('toast').textContent}`; });
// AI team inbound after a basket (baseline)
await p.evaluate(() => window.game.inbound(1));
for (let i = 0; i < 14; i++) { console.log('teal:', await st()); await p.waitForTimeout(700); }
await p.screenshot({ path: 'inb1.png' });
// player inbound from sideline
await p.evaluate(() => window.game.inbound(0, { x: 3, z: -6, clone() { return this; } }));
for (let i = 0; i < 20 && !(await p.evaluate(() => window.game.game.timer <= 0)); i++) await p.waitForTimeout(400); console.log('purple:', await st()); await p.screenshot({ path: 'inb2.png' });
const xy = await p.evaluate(() => { const g = window.game, h = g.ball.holder, q = g.P.find(x => x.team === 0 && x !== h); const r = q.label.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height + 25]; });
await p.mouse.click(xy[0], xy[1]);
for (let i = 0; i < 5; i++) { await p.waitForTimeout(700); console.log('after tap:', await st()); }
await b.close();

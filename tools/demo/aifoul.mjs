import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.addInitScript(() => { try { localStorage.setItem('cc_tut', '1'); } catch (e) {} const T = window.__toasts = []; });
await p.goto('file:///home/user/node-socket.io/public/court-demo.html'); await p.waitForTimeout(8000);
// 1) AI reach-in on the player: Purple holder, Teal defender attempts AI steals repeatedly
let foul = null;
for (let k = 0; k < 25 && !foul; k++) {
  await p.evaluate(() => { const g = window.game; g.game.ft = null; g.game.phase = 'live'; const h = g.P.find(q => q.team === 0), d = g.P.find(q => q.team === 1); g.give(h); d.pos.set(h.pos.x + 0.8, 0, h.pos.z); d.action = { type: 'steal', t: 0.15, done: false }; });
  await p.waitForTimeout(400);
  foul = await p.evaluate(() => window.game.game.phase.startsWith('ft') ? document.getElementById('toast').textContent : null);
}
console.log('AI reach-in:', foul);
// 2) Purple free throw with the meter: wait for ftwait, hold, release
for (let i = 0; i < 30; i++) { const ph = await p.evaluate(() => window.game.game.phase + ' ' + window.game.game.timer.toFixed(1)); if (ph.startsWith('ftwait') && parseFloat(ph.split(' ')[1]) <= 0) break; await p.waitForTimeout(400); }
console.log('at line:', await p.evaluate(() => window.game.game.phase + ' | ' + document.getElementById('toast').textContent));
await p.mouse.move(195, 500); await p.mouse.down(); await p.waitForTimeout(900);
console.log('meter while holding:', await p.evaluate(() => document.getElementById('meter').className));
await p.mouse.up(); await p.waitForTimeout(300);
console.log('after release:', await p.evaluate(() => window.game.game.phase + ' left=' + (window.game.game.ft && window.game.game.ft.left)));
for (let i = 0; i < 40; i++) { await p.waitForTimeout(500); const s = await p.evaluate(() => window.game.game.phase); if (s !== 'ftair') break; }
console.log('later:', await p.evaluate(() => window.game.game.phase + ' score=' + window.game.game.score + ' | ' + document.getElementById('toast').textContent));
// 3) shooting foul: Teal shoots contested by Purple, force pendingFoul path quickly
await p.evaluate(() => { const g = window.game; g.game.ft = null; g.inbound(1); g.game.phase = 'live'; });
let sf = null;
for (let k = 0; k < 40 && !sf; k++) {
  await p.evaluate(() => { const g = window.game; if (g.game.phase !== 'live') return; const h = g.ball.holder; if (!h || h.action) return; const c = g.P.find(q => q.team !== h.team); c.pos.set(h.pos.x + 0.6, 0, h.pos.z + 0.3); h.action = null; g.game.shot = null; window.__startShot && window.__startShot(h); });
  await p.waitForTimeout(500);
  sf = await p.evaluate(() => /Shooting foul|And one/.test(document.getElementById('toast').textContent) ? document.getElementById('toast').textContent : null);
}
console.log('shooting foul:', sf);
await b.close();

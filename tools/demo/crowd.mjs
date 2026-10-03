import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.addInitScript(() => { try { localStorage.setItem('cc_tut', '1'); } catch (e) {} });
await p.goto('file:///home/user/node-socket.io/public/court-demo.html'); await p.waitForTimeout(8000);
const st = () => p.evaluate(() => { const g = window.game.game; return `${g.phase} t=${g.timer.toFixed(1)} crowd=${(g.crowd || []).map(x => x.toFixed(1))} dz=${(g.distract || 0).toFixed(2)} crowdUI="${document.getElementById('crowd').className}" | ${document.getElementById('toast').textContent}`; });
// 1) Teal at the line, the player heckles
await p.evaluate(() => { const g = window.game; g.game.crowd = [1, 1]; g.game.phase = 'live'; const h = g.P.find(q => q.team === 1); g.give(h); g.callFoul(g.P.find(q => q.team === 0), h); });
for (let i = 0; i < 30 && !(await p.evaluate(() => window.game.game.phase === 'ftwait' && window.game.game.timer <= 0)); i++) await p.waitForTimeout(300);
console.log('teal at line:', await st());
for (let i = 0; i < 12; i++) await p.mouse.click(195, 400);
console.log('after 12 taps:', await st());
await p.waitForTimeout(2500); console.log('later:', await st());
// 2) Purple at the line; computer heckles; then 10 s limit
await p.evaluate(() => { const g = window.game; g.game.ft = null; g.game.phase = 'live'; const h = g.P.find(q => q.team === 0); g.give(h); g.callFoul(g.P.find(q => q.team === 1), h); });
for (let i = 0; i < 30 && !(await p.evaluate(() => window.game.game.phase === 'ftwait' && window.game.game.timer <= 0)); i++) await p.waitForTimeout(300);
let maxdz = 0; for (let i = 0; i < 40; i++) { const r = await p.evaluate(() => [window.game.game.distract || 0, window.game.game.phase, window.game.game.timer]); maxdz = Math.max(maxdz, r[0]); if (r[1] !== 'ftwait') break; await p.waitForTimeout(400); }
console.log('purple line: max distraction seen', maxdz.toFixed(2), '|', await st());
await b.close();

import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('file:///home/user/node-socket.io/public/court-demo.html'); await p.waitForTimeout(8000); await p.click('#hprac'); await p.waitForTimeout(1500);
const st = () => p.evaluate(() => { const T = window.game.TUTS(); return T ? `step=${T.step} done=${T.done} | ${document.getElementById('ttitle').textContent} | ${document.getElementById('tok').textContent}` : 'no tutorial'; });
const waitStep = async n => { for (let i = 0; i < 40; i++) { const s = await st(); if (!s.startsWith('step=' + (n - 1))) return s; await p.waitForTimeout(500); } return 'TIMEOUT ' + await st(); };
console.log(await st()); await p.screenshot({ path: 'tut0.png' });
{ const q = await p.evaluate(() => window.__w2s(0, -4)); await p.mouse.click(q[0], q[1]); } console.log('->', await waitStep(1));
// sprint: tap far spot repeatedly
{ const q = await p.evaluate(() => window.__w2s(12, 1)); for (let i = 0; i < 4; i++) { await p.mouse.click(q[0], q[1]); await p.waitForTimeout(80); } }
console.log('->', await waitStep(2));
// pass: tap a teammate's label position
const xy = await p.evaluate(() => { const g = window.game, h = g.ball.holder, q = g.P.find(x => x.team === 0 && x !== h); const r = q.label.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height + 25]; });
await p.mouse.click(xy[0], xy[1]); console.log('->', await waitStep(3));
await p.screenshot({ path: 'tut3.png' });
// shoot: hold until marker centre (force perfect by programmatic shot)
await p.waitForTimeout(2500); await p.evaluate(() => { const g = window.game; g.ball.holder.shotQ = 1; window.__start = g.ball.holder; }); await p.evaluate(() => { const g = window.game; const h = g.ball.holder; h.moveTarget = null; }); await p.evaluate(() => window.game.ball.holder && (window.game.ball.holder.shotQ = 1)); await p.evaluate(() => { const g = window.game, h = g.ball.holder; g.human.down = false; }); await p.evaluate(() => { const h = window.game.ball.holder; h.shotQ = 1; }); await p.evaluate(() => { const g = window.game, h = g.ball.holder; h.shotQ = 1; h.moveTarget = null; window.game.NET; }); await p.evaluate(() => { const g = window.game; const h = g.ball.holder; g.human.down = false; }); await p.evaluate(() => { const g = window.game, h = g.ball.holder; window.__act && window.__act({ t: 'shoot', p: h.id, q: 1 }); }); 
console.log('->', await waitStep(4));
await p.screenshot({ path: 'tut4.png' });
for (let i = 0; i < 20; i++) { const near = await p.evaluate(() => document.getElementById('meter').className); if (near.includes('steal')) break; await p.waitForTimeout(500); }
await p.evaluate(() => { window.game.human.mt = 0.4347; }); await p.mouse.click(195, 500);
console.log('->', await waitStep(5));
await p.waitForTimeout(3000); console.log(await st(), await p.evaluate(() => window.game.game.phase + ' ' + document.getElementById('toast').textContent));
await b.close();

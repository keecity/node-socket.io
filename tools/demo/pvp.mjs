import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const rooms = {}; const pages = {};
const push = async (room) => { for (const [id, pg] of Object.entries(pages)) { if (!rooms[room] || !(id in rooms[room])) continue; const st = JSON.stringify(rooms[room]); pg.evaluate(([r, s, me]) => window.__recv(r, JSON.parse(s), me), [room, st, id]).catch(() => {}); } };
await ctx.exposeBinding('__relay', async (src, json) => { const m = JSON.parse(json); rooms[m.room] = rooms[m.room] || {};
  if (m.leave) delete rooms[m.room][m.me]; else rooms[m.room][m.me] = Object.assign(rooms[m.room][m.me] || {}, m.patch);
  for (const k in rooms[m.room][m.me] || {}) if (rooms[m.room][m.me][k] === null) delete rooms[m.room][m.me][k];
  await push(m.room); if (m.leave) { const pg = pages[m.me]; } });
await ctx.addInitScript(() => {
  const me = Math.random().toString(36).slice(2, 8); window.__me = me; const R = {};
  function mk(name) { const r = { name, hs: [], peersArr: [], prev: {} };
    const api = { name, presence: async patch => { window.__relay(JSON.stringify({ room: name, me, patch })); }, peers: () => r.peersArr,
      onPeers: h => { r.hs.push(h); return () => {}; }, on: () => () => {}, emit: async () => {}, connected: () => true, onConnection: () => () => {},
      leave: async () => { window.__relay(JSON.stringify({ room: name, me, leave: 1 })); delete R[name]; }, join: async n => { const x = mk(n); R[n] = x; await x.api.presence({}); return x.api; } };
    r.api = api; return r; }
  window.__recv = (room, st, id) => { const r = R[room]; if (!r) return; const ids = Object.keys(st);
    const peers = ids.map(i => Object.freeze({ peer: i, by: null, isMe: i === me, sameTab: i === me, kind: 'viewer', guest: false, presence: Object.freeze(st[i]), updatedAt: Date.now() }));
    const left = Object.keys(r.prev).filter(i => !(i in st)).map(i => ({ peer: i })); const joined = peers.filter(p => !(p.peer in r.prev));
    r.prev = st; r.peersArr = peers; for (const h of r.hs) h({ peers, joined, left, updated: peers }); };
  const lobby = mk('lobby'); R.lobby = lobby;
  window.claude = { use: async n => n === 'room' ? (setTimeout(() => lobby.api.presence({}), 10), lobby.api) : null };
});
async function open(name) { const p = await ctx.newPage(); p.on('pageerror', e => console.log(name, 'ERR', e.message)); await p.goto('file:///home/user/node-socket.io/public/court-demo.html'); await p.waitForTimeout(6000); pages[await p.evaluate(() => window.__me)] = p; return p; }
const A = await open('A'), B = await open('B');
await A.click('#online-btn'); await A.click('#onhost'); await A.waitForTimeout(1500);
console.log('A msg:', await A.textContent('#onmsg'));
await B.click('#online-btn'); await B.waitForTimeout(1000); console.log('B list:', await B.textContent('#onlist'));
await B.click('#onlist button'); await B.waitForTimeout(8000);
const info = p => p.evaluate(() => { const g = window.game; return `role=${g.NET.role} phase=${g.game.phase} score=${g.game.score} holder=${g.ball.holder ? g.ball.holder.name + '/t' + g.ball.holder.team : '-'} p0=${g.P[0].pos.x.toFixed(2)},${g.P[0].pos.z.toFixed(2)} p3=${g.P[3].pos.x.toFixed(2)} toast="${document.getElementById('toast').textContent}"`; });
console.log('A', await info(A)); console.log('B', await info(B));
await A.screenshot({ path: 'pvpA.png' }); await B.screenshot({ path: 'pvpB.png' });
const send = (c) => B.evaluate(c => { const g = window.game; g.NET.cmds.push(Object.assign(c, { n: ++g.NET.seq })); g.NET.cmds = g.NET.cmds.slice(-8); g.NET.room.presence({ cmds: g.NET.cmds }); }, c);
for (let i = 0; i < 30 && (await A.evaluate(() => window.game.game.phase)) !== 'live'; i++) await A.waitForTimeout(500);
await A.evaluate(() => { const g = window.game; const h = g.P.find(q => q.team === 0); g.give(h); g.game.phase = 'live'; g.human.on = true; const d = g.P.find(q => q.team === 1); d.pos.set(h.pos.x + 0.8, 0, h.pos.z); window.__d = d.id; });
await send({ t: 'steal', p: await A.evaluate(() => window.__d), q: 1 }); await A.waitForTimeout(4000); console.log('steal ->', await info(A));
await A.evaluate(() => { const g = window.game; const h = g.P.find(q => q.team === 1 && q.id !== window.__d); g.give(h); g.game.phase = 'live'; window.__s = h.id; });
await send({ t: 'shoot', p: await A.evaluate(() => window.__s), q: 1 });
for (let k = 0; k < 16; k++) { await A.waitForTimeout(1000); const x = await info(A); if (/score=0,[123]/.test(x)) { console.log('shot ->', x); break; } }
console.log('B:', await info(B));
console.log(await A.evaluate(() => window.__applied), await A.evaluate(() => JSON.stringify(window.__stats)));
await B.screenshot({ path: 'pvpB2.png' });
await b.close();

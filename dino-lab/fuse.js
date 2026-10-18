// welded joins, copied from index.html (boundaryLoops .. joinParts)
function vertexNormals(pos, I) {
  const n = pos.length / 3, nrm = new Float32Array(n * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]*3, b = I[t+1]*3, c = I[t+2]*3;
    const e1x = pos[b]-pos[a], e1y = pos[b+1]-pos[a+1], e1z = pos[b+2]-pos[a+2], e2x = pos[c]-pos[a], e2y = pos[c+1]-pos[a+1], e2z = pos[c+2]-pos[a+2];
    const fx = e1y*e2z - e1z*e2y, fy = e1z*e2x - e1x*e2z, fz = e1x*e2y - e1y*e2x;
    for (const o of [a, b, c]) { nrm[o] += fx; nrm[o+1] += fy; nrm[o+2] += fz; }
  }
  for (let v = 0; v < n; v++) { const l = Math.hypot(nrm[v*3], nrm[v*3+1], nrm[v*3+2]) || 1; nrm[v*3] /= l; nrm[v*3+1] /= l; nrm[v*3+2] /= l; }
  return nrm;
}
// ---------- reusable welded intersections ----------
// boundary loops of a triangle list (directed edges with no twin), as vertex index arrays
function boundaryLoops(I) {
  const K = 1 << 20, has = new Set();
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) has.add(I[t+e] * K + I[t+(e+1)%3]);
  const next = new Map();
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = I[t+e], b = I[t+(e+1)%3];
    if (!has.has(b * K + a)) { if (!next.has(a)) next.set(a, []); next.get(a).push(b); }
  }
  const loops = [];
  while (next.size) {
    const start = next.keys().next().value, loop = [start]; let cur = start;
    for (let guard = 0; guard < 1e6; guard++) {
      const l = next.get(cur); if (!l) break;
      const nx = l.pop(); if (!l.length) next.delete(cur);
      if (nx === start) break;
      loop.push(nx); cur = nx;
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}
// zip two nearby boundary loops (A from the head's hole, B from the fused patch) with a strip of triangles,
// marching both by arc length; winding follows A's boundary edges
function zipLoops(A, B, P) {
  const cum = L => { const c = [0]; for (let i = 1; i <= L.length; i++) { const a = L[i-1], b = L[i % L.length]; c.push(c[i-1] + Math.hypot(P[a*3]-P[b*3], P[a*3+1]-P[b*3+1], P[a*3+2]-P[b*3+2])); } return c.map(x => x / c[L.length]); };
  const d2 = (a, b) => (P[a*3]-P[b*3])**2 + (P[a*3+1]-P[b*3+1])**2 + (P[a*3+2]-P[b*3+2])**2;
  let s0 = 0; B.forEach((b, j) => { if (d2(A[0], b) < d2(A[0], B[s0])) s0 = j; });
  const fwd = B.slice(s0).concat(B.slice(0, s0)), rev = [fwd[0]].concat(fwd.slice(1).reverse());
  const tA = cum(A), score = L => { const tL = cum(L); let e = 0; for (let q = 1; q < 8; q++) { const f = q / 8; const ia = tA.findIndex(x => x >= f), ib = tL.findIndex(x => x >= f); e += d2(A[ia % A.length], L[ib % L.length]); } return e; };
  const Bq = score(fwd) <= score(rev) ? fwd : rev, tB = cum(Bq), out = [];
  let i = 0, j = 0;
  while (i < A.length || j < Bq.length) {
    if (j >= Bq.length || (i < A.length && tA[i+1] <= tB[j+1])) { out.push(A[(i+1) % A.length], A[i], Bq[j % Bq.length]); i++; }
    else { out.push(Bq[j], Bq[(j+1) % Bq.length], A[i % A.length]); j++; }
  }
  return out;
}
// Fill an unmatched cut without reusing a diagonal already in the surface.
// A fixed fan can duplicate existing faces across a concave boundary.
function capCutLoop(I, loop, P) {
  const L = loop.slice(), K = 1 << 20, edge = (a,b) => Math.min(a,b)*K+Math.max(a,b), edges = new Set();
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) edges.add(edge(I[t+e],I[t+(e+1)%3]));
  const normal = [0,0,0];
  for (let i = 0; i < L.length; i++) {
    const a = L[i]*3, b = L[(i+1)%L.length]*3;
    normal[0] += (P[a+1]-P[b+1])*(P[a+2]+P[b+2]);
    normal[1] += (P[a+2]-P[b+2])*(P[a]+P[b]);
    normal[2] += (P[a]-P[b])*(P[a+1]+P[b+1]);
  }
  const drop = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))), axes = [0,1,2].filter(a=>a!==drop);
  const cross = (a,b,c) => (P[b*3+axes[0]]-P[a*3+axes[0]])*(P[c*3+axes[1]]-P[a*3+axes[1]])-(P[b*3+axes[1]]-P[a*3+axes[1]])*(P[c*3+axes[0]]-P[a*3+axes[0]]);
  let area = 0;
  for (let i = 0; i < L.length; i++) { const a=L[i]*3,b=L[(i+1)%L.length]*3; area+=P[a+axes[0]]*P[b+axes[1]]-P[b+axes[0]]*P[a+axes[1]]; }
  const sign = area < 0 ? -1 : 1;
  while (L.length > 3) {
    let best = -1, cost = Infinity;
    for (let pass = 0; pass < 2 && best < 0; pass++) for (let i = 0; i < L.length; i++) {
      const a=L[(i+L.length-1)%L.length],b=L[i],c=L[(i+1)%L.length];
      if (a===c || edges.has(edge(a,c))) continue;
      if (!pass) {
        if (sign*cross(a,b,c)<=1e-14) continue;
        if (L.some(v=>v!==a&&v!==b&&v!==c&&sign*cross(a,b,v)>=0&&sign*cross(b,c,v)>=0&&sign*cross(c,a,v)>=0)) continue;
      }
      const d=(P[a*3]-P[c*3])**2+(P[a*3+1]-P[c*3+1])**2+(P[a*3+2]-P[c*3+2])**2;
      if (d<cost) {cost=d;best=i;}
    }
    if (best < 0) break;
    const a=L[(best+L.length-1)%L.length],b=L[best],c=L[(best+1)%L.length];
    I.push(a,c,b); edges.add(edge(a,c)); L.splice(best,1);
  }
  if (L.length===3) I.push(L[0],L[2],L[1]);
  return L.length>3 ? L : [];
}
// nearest vertex of a point set (uniform hash grid)
function meshRayInside(P, I, cell) {
  const grid = new Map(), triangles = [], key = (y, z) => y + ',' + z;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t+1] * 3, c = I[t+2] * 3;
    const y = P[a+1], z = P[a+2], uy = P[b+1]-y, uz = P[b+2]-z, vy = P[c+1]-y, vz = P[c+2]-z;
    const det = uy*vz-uz*vy; if (Math.abs(det) < 1e-14) continue;
    const q = triangles.length; triangles.push([y,z,uy,uz,vy,vz,P[a],P[b]-P[a],P[c]-P[a],1/det]);
    const y0 = Math.floor(Math.min(y,P[b+1],P[c+1])/cell), y1 = Math.floor(Math.max(y,P[b+1],P[c+1])/cell);
    const z0 = Math.floor(Math.min(z,P[b+2],P[c+2])/cell), z1 = Math.floor(Math.max(z,P[b+2],P[c+2])/cell);
    for (let j = y0; j <= y1; j++) for (let k = z0; k <= z1; k++) {
      const s = key(j,k); if (!grid.has(s)) grid.set(s,[]); grid.get(s).push(q);
    }
  }
  return (x,y,z) => {
    // Consistent tiny offsets keep rays off shared projected edges and poles.
    y += 1.3e-9; z += 2.7e-9;
    const list = grid.get(key(Math.floor(y/cell),Math.floor(z/cell))); if (!list) return false;
    let crossings = 0;
    for (const q of list) {
      const a = triangles[q], dy = y-a[0], dz = z-a[1];
      const u = (dy*a[5]-dz*a[4])*a[9], v = (a[2]*dz-a[3]*dy)*a[9];
      if (u >= 0 && v >= 0 && u+v <= 1 && a[6]+u*a[7]+v*a[8] > x+1e-8) crossings++;
    }
    return (crossings & 1) !== 0;
  };
}
function meshInside(P, N, cell, I) {
  if (I) return meshRayInside(P, I, cell);
  const g = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  for (let v = 0; v < P.length / 3; v++) { const k = key(Math.floor(P[v*3] / cell), Math.floor(P[v*3+1] / cell), Math.floor(P[v*3+2] / cell)); if (!g.has(k)) g.set(k, []); g.get(k).push(v); }
  return (x, y, z) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell); let best = -1, bd = 1e9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const l = g.get(key(cx + dx, cy + dy, cz + dz)); if (!l) continue; for (const u of l) { const dd = (P[u*3]-x)**2 + (P[u*3+1]-y)**2 + (P[u*3+2]-z)**2; if (dd < bd) { bd = dd; best = u; } } }
    return best >= 0 && (x - P[best*3]) * N[best*3] + (y - P[best*3+1]) * N[best*3+1] + (z - P[best*3+2]) * N[best*3+2] < 0;
  };
}
// neck + body -> one mesh: the neck is kept up to its last ring fully outside the body, the body loses the triangles
// the neck covers, the ring is stitched to the body's hole, and the collar is smoothed into a fillet
var joinCache = new Map();
var reuseJoins = false;
function smoothCollar(P, C) {
  const { sel, wts, adj, scratch } = C;
  if(!C.required) { const required=new Set(sel);for(const row of adj)for(const v of row)required.add(v);C.required=Uint32Array.from(required);C.lastInput=new Float32Array(C.required.length*3);C.lastOutput=new Float32Array(sel.length*3);C.hasOutput=false; }
  let unchanged=C.hasOutput;
  for(let i=0;i<C.required.length;i++) { const a=C.required[i]*3;for(let k=0;k<3;k++){const q=i*3+k;if(P[a+k]!==C.lastInput[q])unchanged=false;C.lastInput[q]=P[a+k];} }
  if(unchanged) {for(let i=0;i<sel.length;i++){const a=sel[i]*3;P[a]=C.lastOutput[i*3];P[a+1]=C.lastOutput[i*3+1];P[a+2]=C.lastOutput[i*3+2];}return;}
  for (let it = 0; it < 24; it++) {
    const fac = it % 2 ? -0.53 : 0.5;
    for (let i = 0; i < sel.length; i++) {
      const v = sel[i], ns = adj[i]; let x = 0, y = 0, z = 0;
      for (let q = 0; q < ns.length; q++) { const u = ns[q] * 3; x += P[u]; y += P[u+1]; z += P[u+2]; }
      const a = v * 3, k = fac * wts[i], den = ns.length || 1;
      scratch[i*3] = P[a] + k * (x / den - P[a]);
      scratch[i*3+1] = P[a+1] + k * (y / den - P[a+1]);
      scratch[i*3+2] = P[a+2] + k * (z / den - P[a+2]);
    }
    // Only the collar is touched. All rows read the previous iteration before any row is written.
    for (let i = 0; i < sel.length; i++) { const a = sel[i] * 3; P[a] = scratch[i*3]; P[a+1] = scratch[i*3+1]; P[a+2] = scratch[i*3+2]; }
  }
  for(let i=0;i<sel.length;i++){const a=sel[i]*3;C.lastOutput[i*3]=P[a];C.lastOutput[i*3+1]=P[a+1];C.lastOutput[i*3+2]=P[a+2];}C.hasOutput=true;
}
function joinParts(PB, IB, part, rCollar, key) {
  const cached = key && joinCache.get(key);
  if (reuseJoins && cached && part && cached.nb === PB.length && cached.nn === part.PP.length) {
    if (!cached.joined) return { P: PB, I: cached.I, joined: false };
    const P = new Float32Array(PB.length + part.PP.length + (cached.capCenters?.length || 0)*3); P.set(PB); P.set(part.PP, PB.length);
    for (const {v,source} of cached.capCenters || []) for (let k=0;k<3;k++) { let sum=0;for(const u of source)sum+=P[u*3+k];P[v*3+k]=sum/source.length; }
    smoothCollar(P, cached);
    return { P, I: cached.I, joined: true, capCenters:cached.capCenters };
  }
  if (!part) return { P: PB, I: Array.from(IB), joined: false };
  const { PP, I: IN } = part, nb = PB.length / 3, nn = PP.length / 3;
  const NB = vertexNormals(PB, IB), inBody = meshInside(PB, NB, 0.03, IB), inNeck = part.inside || meshInside(PP, vertexNormals(PP, IN), 0.03, IN);
  // cut both along their intersection: neck triangles outside the body, body triangles outside the neck
  const outN = new Uint8Array(nn); for (let v = 0; v < nn; v++) outN[v] = inBody(PP[v*3], PP[v*3+1], PP[v*3+2]) ? 0 : 1;
  const outB = new Uint8Array(nb); for (let v = 0; v < nb; v++) outB[v] = inNeck(PB[v*3], PB[v*3+1], PB[v*3+2]) ? 0 : 1;
  const I = []; for (let t = 0; t < IB.length; t += 3) if (outB[IB[t]] && outB[IB[t+1]] && outB[IB[t+2]]) I.push(IB[t], IB[t+1], IB[t+2]);
  const nI = []; for (let t = 0; t < IN.length; t += 3) if (outN[IN[t]] && outN[IN[t+1]] && outN[IN[t+2]]) nI.push(IN[t] + nb, IN[t+1] + nb, IN[t+2] + nb);
  if (nI.length === IN.length) { const I = Array.from(IB); if (key) joinCache.set(key, { nb: PB.length, nn: PP.length, I, joined: false }); return { P: PB, I, joined: false }; }   // the neck does not reach the body
  let P = new Float32Array((nb + nn) * 3); P.set(PB); P.set(PP, nb * 3);
  // Connect complete cut loops with a triangle strip. Collapsing several cut
  // vertices onto one nearest vertex creates nonmanifold fans and visible gaps.
  const bl = boundaryLoops(I), nl = boundaryLoops(nI);
  const bodyEdge = []; for (const L of bl) for (const v of L) bodyEdge.push(v);
  const d2 = (a, b) => (P[a*3]-P[b*3])**2 + (P[a*3+1]-P[b*3+1])**2 + (P[a*3+2]-P[b*3+2])**2;
  for (const v of nI) I.push(v);
  const candidates = [];
  const loopDistance = (A,B) => {
    let sum = 0;
    for (const v of A) { let best = Infinity; for (const u of B) best = Math.min(best,d2(v,u)); sum += best; }
    return sum/A.length;
  };
  const limit = Math.max(0.015,rCollar*0.8);
  for (let a = 0; a < bl.length; a++) for (let b = 0; b < nl.length; b++) {
    const distance = Math.max(loopDistance(bl[a],nl[b]),loopDistance(nl[b],bl[a]));
    if (distance < limit*limit) candidates.push({a,b,distance});
  }
  candidates.sort((a,b) => a.distance-b.distance);
  const usedB = new Set(), usedN = new Set();
  for (const c of candidates) {
    if (usedB.has(c.a) || usedN.has(c.b)) continue;
    usedB.add(c.a); usedN.add(c.b);
    for (const v of zipLoops(bl[c.a],nl[c.b],P)) I.push(v);
  }
  // Only unmatched new cut loops need a cap. Paired seams stay connected by
  // their strip, including when cached positions deform between refinements.
  const capCenters = [];
  for (const [loops,used] of [[bl,usedB],[nl,usedN]]) for (let i = 0; i < loops.length; i++) {
    if (used.has(i)) continue;
    const rest = capCutLoop(I,loops[i],P);
    if (rest.length) {
      const v=P.length/3, next=new Float32Array(P.length+3);next.set(P);
      for(let k=0;k<3;k++)next[v*3+k]=rest.reduce((s,u)=>s+P[u*3+k],0)/rest.length;
      P=next;capCenters.push({v,source:Uint32Array.from(rest)});
      for(let j=0;j<rest.length;j++)I.push(v,rest[(j+1)%rest.length],rest[j]);
    }
  }
  // fillet: smooth a collar around the seam (weighted by distance to it)
  const nv = P.length / 3, adj = Array.from({ length: nv }, () => []);
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = I[t+e], b = I[t+(e+1)%3]; adj[a].push(b); adj[b].push(a); }
  const seam = [...new Set(bodyEdge.concat(...nl))], neckJoin = key === 'body-neck' || key?.startsWith('head-body');
  const R = Math.min(1.8 * rCollar, neckJoin ? 1.8 * rCollar : 0.045), sel = [], wts = [];
  const gs = new Map(), ck = (x, y, z) => Math.floor(x / R) + ',' + Math.floor(y / R) + ',' + Math.floor(z / R);
  for (const u of seam) { const k = ck(P[u*3], P[u*3+1], P[u*3+2]); if (!gs.has(k)) gs.set(k, []); gs.get(k).push(u); }
  for (let v = 0; v < nv; v++) {
    if (!adj[v].length) continue;
    const cx = Math.floor(P[v*3] / R), cy = Math.floor(P[v*3+1] / R), cz = Math.floor(P[v*3+2] / R); let bd = Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const l = gs.get((cx+dx) + ',' + (cy+dy) + ',' + (cz+dz)); if (l) for (const u of l) bd = Math.min(bd, d2(v, u)); }
    const d = Math.sqrt(bd); if (d < R) { sel.push(v); wts.push(0.5 + 0.5 * Math.cos(Math.PI * d / R)); }
  }
  const template = { nb: PB.length, nn: PP.length, I, joined: true, capCenters,
    sel: Uint32Array.from(sel), wts: Float32Array.from(wts),
    adj: sel.map(v => Uint32Array.from(adj[v])), scratch: new Float32Array(sel.length * 3) };
  if (key) joinCache.set(key, template);
  smoothCollar(P, template);
  return { P, I, joined: true, capCenters };
}

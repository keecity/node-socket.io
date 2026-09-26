// Terrain-following road networks — pure JS, no dependencies.
// Works in a local 2D frame (x,z) with a height callback, so the same code lays out towns on a flat
// tile now and in a planet tile's tangent frame later.
//
//   generateRoadNetwork(heightAt, opts) → { roads:[{type,width,main,pts:[{x,z,y,tx,tz,s}], fade}], plaza }
//     • main roads grow from the plaza outward, steering toward gentle grades (greedy look-ahead)
//     • side streets branch off main roads; a street that meets another road joins it
//     • every paved road that ends unconnected continues as a dirt track that narrows and fades out
//     • all roads are smoothed into Catmull-Rom splines and given a graded height profile
//   RoadIndex(net)          → fast nearest-road queries (distance, road height, tangent)
//   gradeGrid(net, grid)    → cuts/fills a height grid so roads sit level across and smooth along

function mulberry(a){ return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const rr=(r,a,b)=>a+r()*(b-a);

export const DEFAULT_ROADS = {
  seed: 1, townRadius: 13, bound: 24,      // paved roads stay within townRadius; dirt tracks may reach bound
  mainCount: [2,4], width: 0.46, dirtWidth: 0.3, step: 0.45, maxGrade: 0.22,
  steepStop: 3.5,   // a road gives up when the best heading is steeper than maxGrade*steepStop
  sideEvery: [2.0,3.2], sideChance: 0.7, sideLen: [3,7], dirtLen: [4,10], joinDist: 1.0, plazaR: 1.35,
};

// ---------------------------------------------------------------- spline helpers
function catmull(pts, spacing){
  if(pts.length<2) return pts.slice();
  const out=[]; const P=i=>pts[Math.max(0,Math.min(pts.length-1,i))];
  for(let i=0;i<pts.length-1;i++){
    const p0=P(i-1), p1=P(i), p2=P(i+1), p3=P(i+2), L=Math.hypot(p2.x-p1.x,p2.z-p1.z), n=Math.max(1,Math.round(L/spacing));
    for(let k=0;k<n;k++){ const t=k/n, t2=t*t, t3=t2*t;
      const f=(a,b,c,d)=>0.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);
      out.push({x:f(p0.x,p1.x,p2.x,p3.x), z:f(p0.z,p1.z,p2.z,p3.z)}); }
  }
  out.push({x:pts[pts.length-1].x,z:pts[pts.length-1].z});
  return out;
}
function finish(pts, heightAt, maxGrade){   // tangents, arc length, graded height profile
  let s=0;
  for(let i=0;i<pts.length;i++){ const a=pts[Math.max(0,i-1)], b=pts[Math.min(pts.length-1,i+1)], L=Math.hypot(b.x-a.x,b.z-a.z)||1;
    pts[i].tx=(b.x-a.x)/L; pts[i].tz=(b.z-a.z)/L; if(i) s+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].z-pts[i-1].z); pts[i].s=s; pts[i].y=heightAt(pts[i].x,pts[i].z); }
  // smooth along the road (moving average ≈ 2.5 units) then limit grade both ways
  const raw=pts.map(p=>p.y), win=2.5;
  for(let i=0;i<pts.length;i++){ let sum=0,w=0; for(let j=i;j>=0&&pts[i].s-pts[j].s<win;j--){ const k=1-(pts[i].s-pts[j].s)/win; sum+=raw[j]*k; w+=k; }
    for(let j=i+1;j<pts.length&&pts[j].s-pts[i].s<win;j++){ const k=1-(pts[j].s-pts[i].s)/win; sum+=raw[j]*k; w+=k; } pts[i].y=sum/w; }
  for(let pass=0;pass<2;pass++){
    for(let i=1;i<pts.length;i++){ const d=pts[i].s-pts[i-1].s, m=maxGrade*d; pts[i].y=Math.min(pts[i-1].y+m,Math.max(pts[i-1].y-m,pts[i].y)); }
    for(let i=pts.length-2;i>=0;i--){ const d=pts[i+1].s-pts[i].s, m=maxGrade*d; pts[i].y=Math.min(pts[i+1].y+m,Math.max(pts[i+1].y-m,pts[i].y)); }
  }
  return pts;
}

// ---------------------------------------------------------------- index for nearest-road queries
export class RoadIndex{
  constructor(net,cell=1){ this.cell=cell; this.map=new Map(); this.net=net;
    net.roads.forEach((rd,ri)=>rd.pts.forEach((p,pi)=>{ const k=this.key(p.x,p.z); if(!this.map.has(k)) this.map.set(k,[]); this.map.get(k).push([ri,pi]); })); }
  key(x,z){ return Math.floor(x/this.cell)+','+Math.floor(z/this.cell); }
  // nearest road point within `range`: {d (to centreline), road, p, half (half width), fade}
  nearest(x,z,range=2,filter=null){
    let best=null, bd=range, n=Math.ceil(range/this.cell);
    const cx=Math.floor(x/this.cell), cz=Math.floor(z/this.cell);
    for(let i=-n;i<=n;i++) for(let j=-n;j<=n;j++){ const L=this.map.get((cx+i)+','+(cz+j)); if(!L) continue;
      for(const [ri,pi] of L){ const rd=this.net.roads[ri]; if(filter&&!filter(rd)) continue;
        // distance to the segment pi→pi+1 (and pi-1→pi)
        for(const q of [pi-1,pi]){ if(q<0||q+1>=rd.pts.length) continue; const a=rd.pts[q], b=rd.pts[q+1];
          const vx=b.x-a.x, vz=b.z-a.z, L2=vx*vx+vz*vz||1, t=Math.max(0,Math.min(1,((x-a.x)*vx+(z-a.z)*vz)/L2));
          const px=a.x+vx*t, pz=a.z+vz*t, d=Math.hypot(x-px,z-pz);
          if(d<bd){ bd=d; const f=rd.fade?rd.fade(a.s+(b.s-a.s)*t):1;
            best={d,road:rd,y:a.y+(b.y-a.y)*t,tx:vx/Math.sqrt(L2),tz:vz/Math.sqrt(L2),half:rd.width*0.5*(rd.type==='dirt'?(0.45+0.55*f):1),fade:f}; } } } }
    return best;
  }
}

// ---------------------------------------------------------------- generation
export function generateRoadNetwork(heightAt, opts={}){
  // rough ground: retry with more tolerance so every town gets streets
  for(let tries=0;tries<3;tries++){ const net=generateOnce(heightAt,{...opts,steepStop:(opts.steepStop||DEFAULT_ROADS.steepStop)*(1+tries)});
    if(net.roads.some(r=>r.main)||tries===2) return net; }
}
function generateOnce(heightAt, opts){
  const O={...DEFAULT_ROADS,...opts}, r=mulberry(O.seed*977+13), roads=[];
  const index={cells:new Map()}, C=1.2, ck=(x,z)=>Math.floor(x/C)+','+Math.floor(z/C);
  const addToIndex=(pts,id)=>pts.forEach(p=>{ const k=ck(p.x,p.z); if(!index.cells.has(k)) index.cells.set(k,[]); index.cells.get(k).push({x:p.x,z:p.z,id}); });
  const nearOther=(x,z,id,dist)=>{ const cx=Math.floor(x/C), cz=Math.floor(z/C), n=Math.ceil(dist/C); let best=null, bd=dist;
    for(let i=-n;i<=n;i++) for(let j=-n;j<=n;j++){ const L=index.cells.get((cx+i)+','+(cz+j)); if(!L) continue;
      for(const q of L){ if(q.id===id) continue; const d=Math.hypot(q.x-x,q.z-z); if(d<bd){ bd=d; best=q; } } } return best; };
  const grade=(x,z,nx,nz)=>Math.abs(heightAt(nx,nz)-heightAt(x,z))/Math.hypot(nx-x,nz-z);

  // greedy terrain-following growth: look a few steps ahead over a fan of headings
  function grow(x,z,dir,len,id,{limit=O.townRadius,join=true,wander=0.25}={}){
    const pts=[{x,z}]; let a=dir, joined=null, stopped='length';
    for(let t=0;t<len/O.step;t++){
      let best=null, bs=1e9;
      for(let k=-3;k<=3;k++){ const na=a+k*0.18; let px=x, pz=z, cost=0;
        for(let l=1;l<=3;l++){ const qx=px+Math.cos(na)*O.step, qz=pz+Math.sin(na)*O.step; cost+=grade(px,pz,qx,qz)*(4-l); px=qx; pz=qz; }
        cost+=Math.abs(k)*0.05+(r()-0.5)*wander*0.1; if(cost<bs){ bs=cost; best=na; } }
      a=best; const nx=x+Math.cos(a)*O.step, nz=z+Math.sin(a)*O.step;
      if(Math.hypot(nx,nz)>limit){ stopped='limit'; break; }
      if(grade(x,z,nx,nz)>O.maxGrade*O.steepStop){ stopped='steep'; break; }
      x=nx; z=nz; pts.push({x,z});
      if(join&&pts.length>3){ const q=nearOther(x,z,id,O.joinDist); if(q){ pts.push({x:q.x,z:q.z}); joined=q.id; stopped='joined'; break; } }
    }
    return {pts,dir:a,joined,stopped};
  }
  const addRoad=(ctrl,type,main,extra={})=>{ const pts=finish(catmull(ctrl,0.25),heightAt,O.maxGrade); const rd={type,main,width:type==='dirt'?O.dirtWidth:O.width,pts,...extra};
    roads.push(rd); addToIndex(pts,roads.length-1); return rd; };
  // dirt continuation: narrows and fades over its length so roads never end abruptly
  const dirtFrom=(end,dir,len,parent)=>{ const g=grow(end.x,end.z,dir,len,-1,{limit:O.bound,join:false,wander:1});
    if(g.pts.length<3) return; const total=(g.pts.length-1)*O.step;
    addRoad(g.pts,'dirt',false,{parent,fade:s=>Math.max(0,1-Math.pow(s/Math.max(total,1e-3),1.6))}); };

  // plaza + main roads
  const plaza={x:0,z:0,r:O.plazaR,y:heightAt(0,0)};
  const nMain=Math.round(rr(r,O.mainCount[0],O.mainCount[1]+0.49)), a0=r()*6.283;
  const mains=[];
  for(let i=0;i<nMain;i++){ const dir=a0+i*6.283/nMain+rr(r,-0.35,0.35), id=roads.length;
    const g=grow(Math.cos(dir)*O.plazaR*0.6,Math.sin(dir)*O.plazaR*0.6,dir,O.townRadius*1.4,id,{join:false});
    if(g.pts.length<3) continue; const rd=addRoad([{x:0,z:0},...g.pts],'paved',true); mains.push(rd);
    const e=g.pts[g.pts.length-1]; dirtFrom(e,g.dir,rr(r,O.dirtLen[0],O.dirtLen[1])*1.6,rd); }
  // side streets
  for(const m of mains){ let s=rr(r,O.sideEvery[0],O.sideEvery[1])+O.plazaR;
    while(s<m.pts[m.pts.length-1].s-1){ const p=m.pts.find(q=>q.s>=s)||m.pts[m.pts.length-1];
      for(const side of [-1,1]){ if(r()>O.sideChance*0.6) continue;
        const dir=Math.atan2(p.tz,p.tx)+side*(Math.PI/2+rr(r,-0.35,0.35)), id=roads.length;
        const sx=p.x+Math.cos(dir)*O.width*0.5, sz=p.z+Math.sin(dir)*O.width*0.5;
        const g=grow(sx,sz,dir,rr(r,O.sideLen[0],O.sideLen[1]),id,{join:true});
        if(g.pts.length<4) continue; const rd=addRoad([{x:p.x,z:p.z},...g.pts],'paved',false);
        if(g.stopped!=='joined'){ const e=g.pts[g.pts.length-1]; dirtFrom(e,g.dir,rr(r,O.dirtLen[0],O.dirtLen[1]),rd); } }
      s+=rr(r,O.sideEvery[0],O.sideEvery[1]); } }
  return {roads,plaza,opts:O};
}

// Cut/fill a height grid to the road profiles. grid: {res, x0, z0, size, get(i,j), set(i,j,h)} in the
// same units as the network. Roads are level across their width with a soft shoulder; the plaza is flat.
export function gradeGrid(net, grid, {shoulder=0.6}={}){
  const {res,x0,z0,size}=grid, cell=size/res, R=res+1, bd=new Float32Array(R*R).fill(1e9), by=new Float32Array(R*R), bw=new Float32Array(R*R);
  const touch=(x,z,y,half,strength)=>{ const reach=half+shoulder, i0=Math.max(0,Math.floor((x-reach-x0)/cell)), i1=Math.min(res,Math.ceil((x+reach-x0)/cell)),
      j0=Math.max(0,Math.floor((z-reach-z0)/cell)), j1=Math.min(res,Math.ceil((z+reach-z0)/cell));
    for(let j=j0;j<=j1;j++) for(let i=i0;i<=i1;i++){ const px=x0+i*cell, pz=z0+j*cell, d=Math.hypot(px-x,pz-z); if(d>reach) continue;
      const k=j*R+i, w=(d<=half?1:1-(d-half)/shoulder)*strength, ws=w*w*(3-2*w); if(ws>bw[k]||(ws===bw[k]&&d<bd[k])){ bw[k]=ws; bd[k]=d; by[k]=y; } } };
  for(const rd of net.roads){ for(let i=0;i<rd.pts.length;i++){ const p=rd.pts[i]; const f=rd.fade?rd.fade(p.s):1; if(f<=0.02) continue;
    touch(p.x,p.z,p.y,rd.width*0.5*(rd.type==='dirt'?(0.45+0.55*f):1),rd.type==='dirt'?0.7*f:1); } }
  const P=net.plaza; if(P) touch(P.x,P.z,P.y,P.r,1);
  for(let j=0;j<R;j++) for(let i=0;i<R;i++){ const k=j*R+i; if(bw[k]>0) grid.set(i,j,grid.get(i,j)+(by[k]-grid.get(i,j))*bw[k]); }
}

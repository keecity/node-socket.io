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
  mainCount: [2,4], width: 0.46, dirtWidth: 0.3, maxGrade: 0.12,
  simplify: 0.7,    // route simplification tolerance before spline smoothing
  sideEvery: [2.4,3.6], sideChance: 0.55, sideLen: [3,7], dirtLen: [4,10], joinDist: 1.0, plazaR: 1.35,
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
  const raw=pts.map(p=>p.y), win=5;
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
// A* over a cost grid: steep ground and water cost more (steeper than the road can climb is
// effectively blocked), turning costs extra so routes prefer long sweeping lines.
function planner(heightAt,O){
  const cell=O.cell, n=Math.ceil(O.bound*2/cell)+1, x0=-O.bound, H=new Float32Array(n*n);
  for(let j=0;j<n;j++) for(let i=0;i<n;i++) H[j*n+i]=heightAt(x0+i*cell,x0+j*cell);
  const DX=[1,1,0,-1,-1,-1,0,1], DZ=[0,1,1,1,0,-1,-1,-1], DL=DX.map((d,k)=>Math.hypot(d,DZ[k])*cell);
  const toCell=(x,z)=>[Math.max(0,Math.min(n-1,Math.round((x-x0)/cell))),Math.max(0,Math.min(n-1,Math.round((z-x0)/cell)))];
  function route(from,to,{avoid=null,stopNear=null,maxGrade=O.maxGrade}={}){
    const [si,sj]=toCell(from.x,from.z), [ti,tj]=toCell(to.x,to.z), N=n*n*8;
    const g=new Float32Array(N).fill(Infinity), prev=new Int32Array(N).fill(-1), closed=new Uint8Array(N);
    const heap=[], push=(k,f)=>{ heap.push([f,k]); let c=heap.length-1; while(c>0){ const p=(c-1)>>1; if(heap[p][0]<=heap[c][0]) break; [heap[p],heap[c]]=[heap[c],heap[p]]; c=p; } };
    const pop=()=>{ const top=heap[0], last=heap.pop(); if(heap.length){ heap[0]=last; let c=0; for(;;){ const l=2*c+1, r=l+1; let m=c; if(l<heap.length&&heap[l][0]<heap[m][0]) m=l; if(r<heap.length&&heap[r][0]<heap[m][0]) m=r; if(m===c) break; [heap[m],heap[c]]=[heap[c],heap[m]]; c=m; } } return top; };
    const hEst=(i,j)=>Math.hypot(i-ti,j-tj)*cell;
    for(let d=0;d<8;d++){ const k=(sj*n+si)*8+d; g[k]=0; push(k,hEst(si,sj)); }
    let end=-1, iter=0;
    while(heap.length&&iter++<400000){ const [,k]=pop(); if(closed[k]) continue; closed[k]=1;
      const c=k>>3, d=k&7, i=c%n, j=(c/n)|0;
      if((i===ti&&j===tj)||(stopNear&&g[k]>O.minJoin&&stopNear(x0+i*cell,x0+j*cell))){ end=k; break; }
      for(let t=-2;t<=2;t++){ const nd=(d+t+8)&7, ni=i+DX[nd], nj=j+DZ[nd]; if(ni<0||nj<0||ni>=n||nj>=n) continue;
        const nc=nj*n+ni, L=DL[nd], gr=Math.abs(H[nc]-H[c])/L;
        let cost=L*(1+O.gradeCost*gr*gr)+Math.abs(t)*O.turnCost*cell;
        if(gr>maxGrade) cost+=L*(gr-maxGrade)*O.steepCost;
        if(O.water!==undefined&&H[nc]<O.water) cost+=L*50;
        if(avoid&&avoid(x0+ni*cell,x0+nj*cell)) cost+=L*8;
        const nk=nc*8+nd, ng=g[k]+cost; if(ng<g[nk]){ g[nk]=ng; prev[nk]=k; push(nk,ng+hEst(ni,nj)); } } }
    if(end<0) return null;
    const path=[]; for(let k=end;k>=0;k=prev[k]){ const c=k>>3; path.push({x:x0+(c%n)*cell,z:x0+((c/n)|0)*cell}); if(prev[k]<0) break; }
    path.reverse(); path[0]={x:from.x,z:from.z}; return path;
  }
  return {route};
}
function simplify(pts,tol){   // Ramer-Douglas-Peucker: keep only the essential bends
  if(pts.length<3) return pts; const keep=new Uint8Array(pts.length); keep[0]=keep[pts.length-1]=1;
  const st=[[0,pts.length-1]]; while(st.length){ const [a,b]=st.pop(); let md=0, mi=-1; const A=pts[a], B=pts[b], vx=B.x-A.x, vz=B.z-A.z, L=Math.hypot(vx,vz)||1;
    for(let i=a+1;i<b;i++){ const d=Math.abs((pts[i].x-A.x)*vz-(pts[i].z-A.z)*vx)/L; if(d>md){ md=d; mi=i; } }
    if(md>tol){ keep[mi]=1; st.push([a,mi],[mi,b]); } }
  return pts.filter((_,i)=>keep[i]);
}

export function generateRoadNetwork(heightAt, opts={}){ return generateOnce(heightAt,{...opts}); }
function generateOnce(heightAt, opts){
  const O={cell:0.5,gradeCost:120,turnCost:0.6,steepCost:400,minJoin:2,...DEFAULT_ROADS,...opts}, r=mulberry(O.seed*977+13), roads=[];
  const P=planner(heightAt,O);
  const idx={cells:new Map()}, C=1.2, ck=(x,z)=>Math.floor(x/C)+','+Math.floor(z/C);
  const addToIndex=(pts,id)=>pts.forEach(p=>{ const k=ck(p.x,p.z); if(!idx.cells.has(k)) idx.cells.set(k,[]); idx.cells.get(k).push({x:p.x,z:p.z,id}); });
  const near=(x,z,dist,skip)=>{ const cx=Math.floor(x/C), cz=Math.floor(z/C), n=Math.ceil(dist/C);
    for(let i=-n;i<=n;i++) for(let j=-n;j<=n;j++){ const L=idx.cells.get((cx+i)+','+(cz+j)); if(!L) continue;
      for(const q of L){ if(skip&&skip(q.id)) continue; if(Math.hypot(q.x-x,q.z-z)<dist) return q; } } return null; };
  const addRoad=(ctrl,type,main,extra={})=>{ const pts=finish(catmull(simplify(ctrl,O.simplify),0.25),heightAt,O.maxGrade);
    const rd={type,main,width:type==='dirt'?O.dirtWidth:O.width,pts,...extra}; roads.push(rd); addToIndex(pts,roads.length-1); return rd; };
  const outward=(p,dir,dist)=>({x:p.x+Math.cos(dir)*dist,z:p.z+Math.sin(dir)*dist});
  const clampB=p=>{ const d=Math.hypot(p.x,p.z), m=O.bound-1; return d>m?{x:p.x*m/d,z:p.z*m/d}:p; };
  // dirt continuation: routed on outward, narrowing and fading so a road never ends abruptly
  const dirtFrom=(end,dir,len,parent)=>{ const tgt=clampB(outward(end,dir+(r()-0.5)*0.8,len)); const path=P.route(end,tgt,{maxGrade:O.maxGrade*1.5});
    if(!path||path.length<3) return; let total=0; for(let i=1;i<path.length;i++) total+=Math.hypot(path[i].x-path[i-1].x,path[i].z-path[i-1].z);
    addRoad(path,'dirt',false,{parent,fade:s=>Math.max(0,1-Math.pow(s/Math.max(total,1e-3),1.6))}); };
  const endDir=pts=>{ const a=pts[Math.max(0,pts.length-4)], b=pts[pts.length-1]; return Math.atan2(b.z-a.z,b.x-a.x); };

  const plaza={x:0,z:0,r:O.plazaR,y:heightAt(0,0)};
  const nMain=Math.round(rr(r,O.mainCount[0],O.mainCount[1]+0.49)), a0=r()*6.283, mains=[];
  for(let i=0;i<nMain;i++){ const dir=a0+i*6.283/nMain+rr(r,-0.35,0.35), id=roads.length;
    const tgt=clampB(outward({x:0,z:0},dir,O.townRadius*rr(r,0.8,1)));
    const path=P.route(outward({x:0,z:0},dir,O.plazaR*0.6),tgt,{avoid:(x,z)=>!!near(x,z,O.width*2,null)});
    if(!path||path.length<4) continue; const rd=addRoad([{x:0,z:0},...path],'paved',true); mains.push(rd);
    dirtFrom(path[path.length-1],endDir(path),rr(r,O.dirtLen[0],O.dirtLen[1])*1.6,rd); }
  for(const m of mains){ const mid=roads.indexOf(m); let s=rr(r,O.sideEvery[0],O.sideEvery[1])+O.plazaR;
    while(s<m.pts[m.pts.length-1].s-1.5){ const p=m.pts.find(q=>q.s>=s)||m.pts[m.pts.length-1];
      for(const side of [-1,1]){ if(r()>O.sideChance*0.6) continue;
        const dir=Math.atan2(p.tz,p.tx)+side*(Math.PI/2+rr(r,-0.4,0.4)), id=roads.length;
        const start=outward(p,dir,O.width*0.6), tgt=clampB(outward(p,dir,rr(r,O.sideLen[0],O.sideLen[1])));
        const path=P.route(start,tgt,{stopNear:(x,z)=>!!near(x,z,O.joinDist*0.7,q=>q===mid)});
        if(!path||path.length<4) continue;
        const last=path[path.length-1], joined=Math.hypot(last.x-tgt.x,last.z-tgt.z)>O.cell*1.5;
        const rd=addRoad([{x:p.x,z:p.z},...path],'paved',false);
        if(!joined) dirtFrom(last,endDir(path),rr(r,O.dirtLen[0],O.dirtLen[1]),rd); }
      s+=rr(r,O.sideEvery[0],O.sideEvery[1]); } }
  return {roads,plaza,opts:O};
}

// Cut/fill a height grid to the road profiles. grid: {res, x0, z0, size, get(i,j), set(i,j,h)} in the
// same units as the network. Roads are level across their width with a soft shoulder; the plaza is flat.
export function gradeGrid(net, grid, {shoulder=1.4}={}){
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

// Level a settlement: blend the grid toward a heavily smoothed copy of itself inside `radius`,
// fading back to natural terrain over `fall`. Hills become gentle slopes; the town keeps the land's tilt.
export function levelArea(grid,{x=0,z=0,radius,fall,blur,strength=1}){
  const {res,x0,z0,size}=grid, R=res+1, cell=size/res, b=Math.max(1,Math.round(blur/cell));
  let a=new Float32Array(R*R); for(let j=0;j<R;j++) for(let i=0;i<R;i++) a[j*R+i]=grid.get(i,j);
  const src=a.slice(), tmp=new Float32Array(R*R);
  for(let pass=0;pass<3;pass++){   // 3 box blurs ≈ gaussian
    for(let j=0;j<R;j++){ let sum=0; for(let i=-b;i<=b;i++) sum+=a[j*R+Math.max(0,Math.min(res,i))];
      for(let i=0;i<R;i++){ tmp[j*R+i]=sum/(2*b+1); sum+=a[j*R+Math.min(res,i+b+1)]-a[j*R+Math.max(0,i-b)]; } }
    for(let i=0;i<R;i++){ let sum=0; for(let j=-b;j<=b;j++) sum+=tmp[Math.max(0,Math.min(res,j))*R+i];
      for(let j=0;j<R;j++){ a[j*R+i]=sum/(2*b+1); sum+=tmp[Math.min(res,j+b+1)*R+i]-tmp[Math.max(0,j-b)*R+i]; } } }
  for(let j=0;j<R;j++) for(let i=0;i<R;i++){ const d=Math.hypot(x0+i*cell-x,z0+j*cell-z); let w=1-Math.max(0,Math.min(1,(d-radius)/fall)); w=w*w*(3-2*w)*strength;
    if(w>0) grid.set(i,j,src[j*R+i]+(a[j*R+i]-src[j*R+i])*w); }
}

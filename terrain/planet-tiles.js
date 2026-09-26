// Planet tile system — quad-sphere LOD with worker-built tiles.
//
//  • Recompute only on change: every frame computes a cheap key (anchor tile under the view ray,
//    altitude band, view-direction buckets, horizon flag). The tile selection is rebuilt only when
//    that key changes or a tile finishes building.
//  • Selection: quadtree from the 6 faces with horizon + frustum culling; a tile splits when the
//    camera is close, but only once all 4 children are ready — the parent stays drawn until then,
//    so there are never holes.
//  • Registry: one entry per address. A tile is built once and reused: queued/building tiles are
//    never requested twice, tiles leaving view go idle (instant to show again), and only the least
//    recently used idle tiles are freed when over budget.
//  • Workers build tiles in the background; the main thread uploads a few per frame.
//  • Skirts on every tile hide cracks between levels; ocean patches come from the same tiles.
//
// Dependencies are injected so the module stays bundle-agnostic:
//   deps = {THREE, gridIndex, faceDir, dirFace, tileKey}
export function createPlanetTiles(deps, {scene, radius, res=48, maxLevel=9, splitK=1.8, workerSrc, params,
    terrainMaterial, oceanMaterial, workers=Math.max(1,Math.min(4,(navigator.hardwareConcurrency||4)-1)), budget=1600, uploadMs=3}){
  const {THREE,gridIndex,faceDir,dirFace,tileKey}=deps, R=radius, FACE_KM=Math.PI/2*R;
  const tiles=new Map(), group=new THREE.Group(); scene.add(group);
  const stats={drawn:0,loaded:0,building:0,waiting:0,queued:0,recomputes:0,level:0};
  let gen=0;   // bumps on new params: stale worker results are dropped

  // ---- shared index: grid + skirt ring (both windings so skirts show from either side)
  const Rr=res+1, ring=[]; for(let i=0;i<Rr;i++) ring.push(i); for(let j=1;j<Rr;j++) ring.push(j*Rr+Rr-1); for(let i=Rr-2;i>=0;i--) ring.push((Rr-1)*Rr+i); for(let j=Rr-2;j>0;j--) ring.push(j*Rr);
  const base=gridIndex(res), index=new Uint32Array(base.length+ring.length*12); index.set(base);
  { let t=base.length, n=Rr*Rr, m=ring.length; for(let q=0;q<m;q++){ const a=ring[q], b=ring[(q+1)%m], c=n+q, d=n+(q+1)%m; index.set([a,b,c,b,d,c,a,c,b,b,c,d],t); t+=12; } }
  const indexAttr=new THREE.BufferAttribute(index,1);

  // ---- workers
  const pool=[], queue=[]; let wid=0;
  const workerURL=URL.createObjectURL(new Blob([workerSrc],{type:'text/javascript'}));
  // a worker that errors or goes silent is replaced and its tile re-queued, so the pipeline never stalls
  function spawn(i){ const w=new Worker(workerURL); w.busy=null; w.since=0;
    w.onmessage=e=>{ w.busy=null; onBuilt(e.data); pump(); };
    w.onerror=e=>{ e.preventDefault&&e.preventDefault(); retire(w); };
    w.postMessage({type:'params',params,R,res,ring}); pool[i]=w; }
  function retire(w){ const i=pool.indexOf(w); if(i<0) return; const t=w.busy; w.terminate(); if(t&&t.state==='building'){ t.state='queued'; t.prio=-1e9; queue.push(t); } spawn(i); pump(); }
  for(let i=0;i<workers;i++) spawn(i);
  setInterval(()=>{ const now=performance.now(); for(const w of [...pool]) if(w.busy&&now-w.since>8000) retire(w); },2000);
  function pump(){ queue.sort((a,b)=>a.prio-b.prio);
    for(const w of pool){ if(w.busy) continue; let t=queue.shift(); while(t&&t.state!=='queued') t=queue.shift(); if(!t) break;
      t.state='building'; w.busy=t; w.since=performance.now(); w.postMessage({type:'tile',key:t.key,gen,f:t.f,L:t.L,x:t.x,y:t.y}); } }
  const uploads=[];
  function onBuilt(m){ if(m.gen!==gen) return; const t=tiles.get(m.key); if(!t||t.state!=='building') return; t.state='arrived'; uploads.push([t,m]); }
  function upload(t,m){
    const g=new THREE.BufferGeometry(); g.setIndex(indexAttr);
    g.setAttribute('position',new THREE.BufferAttribute(m.positions,3)); g.setAttribute('normal',new THREE.BufferAttribute(m.normals,3)); g.setAttribute('aTerr',new THREE.BufferAttribute(m.terrain,4)); g.setAttribute('aMorph',new THREE.BufferAttribute(m.morph,2));
    g.boundingSphere=new THREE.Sphere(new THREE.Vector3(),m.radius);
    const mesh=new THREE.Mesh(g,terrainMaterial); mesh.position.fromArray(m.center); mesh.matrixAutoUpdate=false; mesh.updateMatrix(); mesh.visible=false; mesh.userData.level=t.L;
    group.add(mesh); t.mesh=mesh;
    if(m.ocean){ const og=new THREE.BufferGeometry(); og.setIndex(indexAttr); og.setAttribute('position',new THREE.BufferAttribute(m.ocean,3)); og.setAttribute('normal',new THREE.BufferAttribute(m.oceanNormals,3));
      og.boundingSphere=g.boundingSphere; const om=new THREE.Mesh(og,oceanMaterial); om.position.copy(mesh.position); om.matrixAutoUpdate=false; om.updateMatrix(); om.visible=false; om.renderOrder=1; group.add(om); t.ocean=om; }
    t.hmin=m.hmin; t.hmax=m.hmax; t.state='ready';
  }

  // ---- registry
  const dirTmp=[0,0,0];
  function get(f,L,x,y){ const k=tileKey(f,L,x,y); let t=tiles.get(k); if(t) t.seen=performance.now();
    if(!t){ const [a,b]=[-1+2*(x+0.5)/(1<<L),-1+2*(y+0.5)/(1<<L)]; faceDir(f,a,b,dirTmp);
      t={key:k,f,L,x,y,state:'none',mesh:null,ocean:null,dir:new THREE.Vector3(...dirTmp),size:FACE_KM/(1<<L)*1.15,ang:(Math.PI/2)/(1<<L)*0.8,last:0,hmin:-3,hmax:2}; tiles.set(k,t); }
    return t; }
  function request(t,prio){ if(t.state==='none'){ t.state='queued'; t.prio=prio; queue.push(t); } else if(t.state==='queued') t.prio=Math.min(t.prio,prio); }
  const children=t=>[[0,0],[1,0],[0,1],[1,1]].map(([i,j])=>get(t.f,t.L+1,t.x*2+i,t.y*2+j));

  // ---- selection (runs only when the key changes or tiles arrive)
  const frustum=new THREE.Frustum(), pm=new THREE.Matrix4(), sph=new THREE.Sphere(), camPos=new THREE.Vector3(), tp=new THREE.Vector3();
  let draw=new Set();
  function select(camera){
    stats.recomputes++; camera.updateMatrixWorld(); pm.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    camPos.copy(camera.position); const D=camPos.length(), cd=camPos.clone().divideScalar(D);
    const horizon=Math.acos(Math.min(1,(R-2)/Math.max(D,R-1)))+Math.acos(Math.min(1,(R-2)/(R+3)));
    for(const q of queue) q.prio=1e9;   // anything not requested again this pass drops to the back
    const next=new Set(); let maxL=0;
    const visit=t=>{
      // horizon + frustum culling (inflated so small camera moves never expose a gap before the next recompute)
      if(Math.acos(Math.max(-1,Math.min(1,t.dir.dot(cd))))-t.ang*1.4>horizon) return;
      tp.copy(t.dir).multiplyScalar(R); sph.set(tp,t.size*0.85+3); if(!frustum.intersectsSphere(sph)) return;
      const dist=Math.max(0,tp.distanceTo(camPos)-t.size*0.5);
      // hysteresis: split at splitK, only merge back beyond 1.25×; prefetch children from 1.6× so they are ready in time
      const want=t.L<maxLevel&&dist<t.size*splitK*(t.split?1.25:1), soon=t.L<maxLevel&&dist<t.size*splitK*1.3;
      t.split=false;
      if(want||soon){ const ch=children(t);
        if(want&&ch.every(c=>c.state==='ready')){ t.split=true; ch.forEach(visit); return; }
        ch.forEach(c=>request(c,c.dir.clone().multiplyScalar(R).distanceTo(camPos)+(want?0:1e4))); }
      if(t.state==='ready'){ next.add(t); maxL=Math.max(maxL,t.L); } else request(t,dist-1e6);   // uncovered: most urgent
    };
    for(let f=0;f<6;f++) visit(get(f,0,0,0));
    for(const t of draw) if(!next.has(t)){ if(t.mesh) t.mesh.visible=false; if(t.ocean) t.ocean.visible=false; t.last=performance.now(); }
    for(const t of next){ if(t.mesh) t.mesh.visible=true; if(t.ocean) t.ocean.visible=true; }
    draw=next; stats.level=maxL; pump(); evict();
  }
  function evict(){   // only built tiles count toward the budget; coarse base levels are never freed
    for(const [k,t] of tiles) if(t.state==='none'&&performance.now()-(t.seen||0)>5000) tiles.delete(k);   // drop stale placeholders
    const ready=[...tiles.values()].filter(t=>t.state==='ready'); if(ready.length<=budget) return;
    const idle=ready.filter(t=>!draw.has(t)&&t.L>3&&!t.split).sort((a,b)=>a.last-b.last);
    for(const t of idle.slice(0,ready.length-budget)){ for(const m of [t.mesh,t.ocean]) if(m){ group.remove(m); m.geometry.dispose(); } tiles.delete(t.key); }
  }

  // ---- change key: recompute only when this differs from last frame's
  const ray=new THREE.Ray(), fwd=new THREE.Vector3(), planet=new THREE.Sphere(new THREE.Vector3(),R); let lastKey='';
  function viewKey(camera){
    camera.getWorldDirection(fwd); ray.set(camera.position,fwd); const D=camera.position.length(), alt=Math.max(0.01,D-R);
    const hit=ray.intersectSphere(planet,tp), horizonFlag=!hit;
    const p=(hit?tp:camera.position).clone().normalize(), af=dirFace([p.x,p.y,p.z]);
    const L=Math.max(0,Math.min(maxLevel,Math.floor(Math.log2(FACE_KM/(alt*2)))));
    const n=1<<L, ax=Math.min(n-1,Math.floor((af.a+1)/2*n)), ay=Math.min(n-1,Math.floor((af.b+1)/2*n));
    const up=camera.position.clone().normalize(), tilt=Math.round(Math.acos(Math.max(-1,Math.min(1,-fwd.dot(up))))/(8*Math.PI/180));
    const east=new THREE.Vector3(0,1,0).cross(up).normalize(), north=up.clone().cross(east), heading=Math.round(Math.atan2(fwd.dot(east),fwd.dot(north))/(12*Math.PI/180));
    return [af.f,L,ax,ay,Math.floor(Math.log(alt)/Math.log(1.25)),tilt,heading,horizonFlag?1:0].join(',');
  }
  let dirty=true;
  function update(camera){
    const t0=performance.now(); while(uploads.length&&performance.now()-t0<uploadMs){ const [t,m]=uploads.shift(); upload(t,m); dirty=true; }   // time budget per frame
    const k=viewKey(camera); if(k!==lastKey){ lastKey=k; dirty=true; }
    if(dirty){ dirty=false; select(camera); }
    stats.drawn=draw.size; stats.loaded=[...tiles.values()].filter(t=>t.state==='ready').length; stats.building=[...tiles.values()].filter(t=>t.state==='building').length; stats.waiting=uploads.length; stats.queued=queue.length;
  }
  function setParams(p){ gen++; params=p; queue.length=0; uploads.length=0;
    for(const t of tiles.values()) for(const m of [t.mesh,t.ocean]) if(m){ group.remove(m); m.geometry.dispose(); }
    tiles.clear(); draw=new Set(); lastKey=''; dirty=true; for(const w of pool){ w.busy=null; w.postMessage({type:'params',params,R,res,ring}); } }
  const setSplitK=v=>{ if(v!==splitK){ splitK=v; dirty=true; } if(terrainMaterial.userData.uniforms&&terrainMaterial.userData.uniforms.uSplitK) terrainMaterial.userData.uniforms.uSplitK.value=splitK; };
  return {update,setParams,setSplitK,stats,group};
}

// Worker body (appended to the terrain-gen + cube-sphere sources): builds one tile per message.
export const PLANET_WORKER=`
let T=null, R=100, RES=48, RING=[];
const o3=[0,0,0], c3=[0,0,0];
self.onmessage=e=>{ const m=e.data;
  if(m.type==='params'){ T=createTerrain(m.params); R=m.R; RES=m.res; RING=m.ring; return; }
  const {f,L,x,y}=m, n=1<<L, FACE=Math.PI/2*R;
  const pointAt=(u,v,o)=>{ faceDir(f,-1+2*(x+u)/n,-1+2*(y+v)/n,o3); o.x=o3[0]*R; o.y=o3[1]*R; o.z=o3[2]*R; o.ux=o3[0]; o.uy=o3[1]; o.uz=o3[2]; return o; };
  const r=buildTile(T,{res:RES,pointAt,cellSize:FACE/n/RES});
  faceDir(f,-1+2*(x+0.5)/n,-1+2*(y+0.5)/n,c3); const cx=c3[0]*R, cy=c3[1]*R, cz=c3[2]*R;
  const V=(RES+1)*(RES+1), M=RING.length, pos=new Float32Array((V+M)*3), nor=new Float32Array((V+M)*3), ter=new Float32Array((V+M)*4);
  let rad=0;
  for(let i=0;i<V;i++){ const X=r.positions[i*3]-cx, Y=r.positions[i*3+1]-cy, Z=r.positions[i*3+2]-cz; pos[i*3]=X; pos[i*3+1]=Y; pos[i*3+2]=Z; rad=Math.max(rad,Math.hypot(X,Y,Z)); }
  nor.set(r.normals); ter.set(r.terrain);
  // geomorph: how far each vertex sits from where the parent tile would put it (parent = every other vertex)
  const morph=new Float32Array((V+M)*2), RR=RES+1, H=i=>r.terrain[i*4], tsize=FACE/n*1.15;
  for(let j=0;j<RR;j++) for(let i=0;i<RR;i++){ const k=j*RR+i; let ph=H(k);
    if(i&1&&!(j&1)) ph=(H(k-1)+H(k+1))/2; else if(j&1&&!(i&1)) ph=(H(k-RR)+H(k+RR))/2; else if(i&1&&j&1) ph=(H(k-RR-1)+H(k-RR+1)+H(k+RR-1)+H(k+RR+1))/4;
    morph[k*2]=ph-H(k); morph[k*2+1]=tsize; }
  const drop=FACE/n*0.12+0.3;   // skirt depth (km): deeper than coarse/fine height differences in mountains
  RING.forEach((k,q)=>{ const o=V+q, ax=r.positions[k*3], ay=r.positions[k*3+1], az=r.positions[k*3+2], L=Math.hypot(ax,ay,az);
    pos[o*3]=ax-ax/L*drop-cx; pos[o*3+1]=ay-ay/L*drop-cy; pos[o*3+2]=az-az/L*drop-cz;
    nor[o*3]=r.normals[k*3]; nor[o*3+1]=r.normals[k*3+1]; nor[o*3+2]=r.normals[k*3+2]; for(let c=0;c<4;c++) ter[o*4+c]=r.terrain[k*4+c]; morph[o*2]=morph[k*2]; morph[o*2+1]=tsize; });
  let ocean=null, oceanNormals=null;
  if(r.hmin<0.01){ ocean=new Float32Array((V+M)*3); oceanNormals=new Float32Array((V+M)*3);
    const put=(o,k)=>{ const ax=r.positions[k*3], ay=r.positions[k*3+1], az=r.positions[k*3+2], L=Math.hypot(ax,ay,az);
      const W=R-0.002; ocean[o*3]=ax/L*W-cx; ocean[o*3+1]=ay/L*W-cy; ocean[o*3+2]=az/L*W-cz; oceanNormals[o*3]=ax/L; oceanNormals[o*3+1]=ay/L; oceanNormals[o*3+2]=az/L; };
    for(let i=0;i<V;i++) put(i,i); RING.forEach((k,q)=>put(V+q,k)); }
  const tr=[pos.buffer,nor.buffer,ter.buffer,morph.buffer]; if(ocean) tr.push(ocean.buffer,oceanNormals.buffer);
  self.postMessage({key:m.key,gen:m.gen,positions:pos,normals:nor,terrain:ter,morph,ocean,oceanNormals,center:[cx,cy,cz],radius:rad+drop,hmin:r.hmin,hmax:r.hmax},tr);
};`;

// Settlement siting — finds flat, dry, low places for towns on any terrain and turns them into
// flattening pads for createTerrain({pads}). Works in a tangent frame (center, up, t1, t2), so the
// same code sites towns on a flat tile or anywhere on a planet.

function mulberry(a){ return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

// Returns up to `count` sites [{x,y,z,h,score}] sorted best-first, at least `spacing` apart.
// radius: search half-extent in the tangent plane; water: sea level (sites stay above it).
export function findSettlementSites(terrain,{center=[0,0,0],up=[0,1,0],t1=[1,0,0],t2=[0,0,1],radius=2.5,count=1,spacing=1,
  water=0,clearance=0.008,samples=32,probe=0.06,seed=1,pick='best',maxSlope=0.02}={}){
  const r=mulberry(seed*7919+3), s={}, cand=[];
  const P=(a,b)=>[center[0]+t1[0]*a+t2[0]*b, center[1]+t1[1]*a+t2[1]*b, center[2]+t1[2]*a+t2[2]*b];
  for(let j=0;j<=samples;j++) for(let i=0;i<=samples;i++){
    // jittered grid so each seed explores different spots
    const a=radius*(2*(i+r()*0.8-0.4)/samples-1), b=radius*(2*(j+r()*0.8-0.4)/samples-1), p=P(a,b);
    terrain.sample(p[0],p[1],p[2],up[0],up[1],up[2],s); const h=s.h, m=s.mountain; let sl=0;
    for(const [da,db] of [[probe,0],[-probe,0],[0,probe],[0,-probe]]){ const q=P(a+da,b+db); terrain.sample(q[0],q[1],q[2],up[0],up[1],up[2],s); sl=Math.max(sl,Math.abs(s.h-h)); }
    const score=m*4+Math.max(0,water+clearance-h)*80+sl*12+Math.hypot(a,b)/radius*0.3+r()*0.05;
    cand.push({x:p[0],y:p[1],z:p[2],h,score,ok:h>water+clearance&&sl<maxSlope&&Math.hypot(a,b)<radius*0.9});
  }
  cand.sort((a,b)=>a.score-b.score);
  // variety: choose among all acceptable sites (dry, not too steep) instead of always the flattest lowest one
  if(pick==='random'){ const ok=cand.filter(c=>c.ok); if(ok.length){ for(let i=ok.length-1;i>0;i--){ const j=(r()*(i+1))|0; [ok[i],ok[j]]=[ok[j],ok[i]]; } cand.splice(0,cand.length,...ok); } }
  const out=[]; for(const c of cand){ if(out.every(o=>Math.hypot(o.x-c.x,o.y-c.y,o.z-c.z)>=spacing)) out.push(c); if(out.length>=count) break; }
  return out;
}

// Pads for createTerrain({pads}): flat to r, blended out over `fall`, kept `clearance` above water.
export function sitesToPads(sites,{r=0.08,fall=0.3,water=0,clearance=0.012,rough=0.0006}={}){
  return sites.map(s=>({x:s.x,y:s.y,z:s.z,r,fall,h:Math.max(s.h,water+clearance),rough}));
}

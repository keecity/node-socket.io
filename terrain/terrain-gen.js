// Terrain generator — pure JS, no dependencies, safe to run in a Web Worker.
//
// Height is a function of a 3D point and its local "up" direction, so the same code drives
// a flat test tile now (up = +Y) and quad-sphere planet tiles later (up = normalize(p)).
// Everything is seeded and deterministic: a tile rebuilt from the same address is identical.
//
// Layers:
//   1. region mask   — where mountain ranges vs. flat valley floors are
//   2. domain warp   — bends ridgelines so they branch instead of lining up on a grid
//   3. ridged multifractal with derivative damping — sharp crests, eroded-looking flanks
//   4. gully filter  — slope-aligned channels running downhill (triplanar, seamless on a sphere)
//   5. droplet erosion (optional, per grid) — hydraulic carving + sediment fans
//
// Units are arbitrary; the lab uses kilometres.

export const DEFAULT_TERRAIN = {
  seed: 7,
  mountainHeight: 1.35,   // peak height above the valley floor
  valleyHeight: 0.05,     // relief of the flat areas
  coverage: 0.52,         // 0..1, how much of the land is mountains
  maskScale: 0.11,        // frequency of the mountain/valley regions
  ridgeScale: 0.32,       // base frequency of the ridges
  octaves: 9,
  sharpness: 2.1,         // ridge crest sharpness (1 = rounded, 3 = knife edges)
  ridgeGain: 1.9,         // how much detail follows existing ridges
  erosionDamping: 0.55,   // derivative damping: smooth slopes, detail stays on crests and flats
  warp: 0.75,             // domain warp amount
  warpScale: 0.18,
  gullyStrength: 0.9,     // slope-aligned channel depth
  gullyScale: 3.2,        // channel frequency
  gullySlope: 3.0,        // how strongly slope steers the channels
  gullyOctaves: 5,
  pads: null,             // [{x,y,z,r,fall,h,rough}] flattened settlement areas (same units)
};

// ---------------------------------------------------------------- noise
function mulberry(a){ return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

export function makeNoise(seed){
  const r=mulberry(seed*9973+17), perm=new Uint8Array(512), val=new Float32Array(256);
  for(let i=0;i<256;i++){ perm[i]=i; val[i]=r()*2-1; }
  for(let i=255;i>0;i--){ const j=(r()*(i+1))|0; const t=perm[i]; perm[i]=perm[j]; perm[j]=t; }
  for(let i=0;i<256;i++) perm[i+256]=perm[i];
  const H=(x,y,z)=>val[perm[perm[perm[x&255]+(y&255)]+(z&255)]];

  // value noise with analytic derivatives (quintic). out = [value, dx, dy, dz], value in ~[-1,1]
  function noised(x,y,z,out){
    const ix=Math.floor(x), iy=Math.floor(y), iz=Math.floor(z), fx=x-ix, fy=y-iy, fz=z-iz;
    const ux=fx*fx*fx*(fx*(fx*6-15)+10), uy=fy*fy*fy*(fy*(fy*6-15)+10), uz=fz*fz*fz*(fz*(fz*6-15)+10);
    const dux=30*fx*fx*(fx*(fx-2)+1), duy=30*fy*fy*(fy*(fy-2)+1), duz=30*fz*fz*(fz*(fz-2)+1);
    const a=H(ix,iy,iz), b=H(ix+1,iy,iz), c=H(ix,iy+1,iz), d=H(ix+1,iy+1,iz);
    const e=H(ix,iy,iz+1), f=H(ix+1,iy,iz+1), g=H(ix,iy+1,iz+1), h=H(ix+1,iy+1,iz+1);
    const k1=b-a, k2=c-a, k3=e-a, k4=a-b-c+d, k5=a-c-e+g, k6=a-b-e+f, k7=-a+b+c-d+e-f-g+h;
    out[0]=a+k1*ux+k2*uy+k3*uz+k4*ux*uy+k5*uy*uz+k6*uz*ux+k7*ux*uy*uz;
    out[1]=dux*(k1+k4*uy+k6*uz+k7*uy*uz);
    out[2]=duy*(k2+k5*uz+k4*ux+k7*uz*ux);
    out[3]=duz*(k3+k6*ux+k5*uy+k7*ux*uy);
    return out;
  }
  // 2D cell hash for the gully filter
  const hash2=(x,y,o)=>{ const i=perm[perm[x&255]+(y&255)]; o[0]=val[i]*0.5+0.5; o[1]=val[perm[i+37]]*0.5+0.5; return o; };
  return {noised,hash2};
}

// octave rotation (breaks grid alignment between octaves)
const RM=[0.00,0.80,0.60, -0.80,0.36,-0.48, -0.60,-0.48,0.64];

// ---------------------------------------------------------------- terrain
export function createTerrain(opts={}){
  const P={...DEFAULT_TERRAIN,...opts};
  const N=makeNoise(P.seed), nd=[0,0,0,0], hc=[0,0];

  // fbm value + world-space gradient. out=[v,gx,gy,gz]
  function fbm(x,y,z,freq,oct,out){
    let m0=freq,m1=0,m2=0,m3=0,m4=freq,m5=0,m6=0,m7=0,m8=freq;   // accumulated matrix M (q = M p)
    let v=0,gx=0,gy=0,gz=0,a=0.5,norm=0;
    for(let i=0;i<oct;i++){
      N.noised(m0*x+m1*y+m2*z, m3*x+m4*y+m5*z, m6*x+m7*y+m8*z, nd);
      v+=a*nd[0]; norm+=a;
      gx+=a*(m0*nd[1]+m3*nd[2]+m6*nd[3]); gy+=a*(m1*nd[1]+m4*nd[2]+m7*nd[3]); gz+=a*(m2*nd[1]+m5*nd[2]+m8*nd[3]);
      const n0=2*(RM[0]*m0+RM[1]*m3+RM[2]*m6), n1=2*(RM[0]*m1+RM[1]*m4+RM[2]*m7), n2=2*(RM[0]*m2+RM[1]*m5+RM[2]*m8);
      const n3=2*(RM[3]*m0+RM[4]*m3+RM[5]*m6), n4=2*(RM[3]*m1+RM[4]*m4+RM[5]*m7), n5=2*(RM[3]*m2+RM[4]*m5+RM[5]*m8);
      const n6=2*(RM[6]*m0+RM[7]*m3+RM[8]*m6), n7=2*(RM[6]*m1+RM[7]*m4+RM[8]*m7), n8=2*(RM[6]*m2+RM[7]*m5+RM[8]*m8);
      m0=n0;m1=n1;m2=n2;m3=n3;m4=n4;m5=n5;m6=n6;m7=n7;m8=n8; a*=0.5;
    }
    out[0]=v/norm; out[1]=gx/norm; out[2]=gy/norm; out[3]=gz/norm; return out;
  }

  // ridged multifractal with derivative damping. returns [h 0..~1, gx, gy, gz]
  function ridged(x,y,z,out){
    let m0=P.ridgeScale,m1=0,m2=0,m3=0,m4=P.ridgeScale,m5=0,m6=0,m7=0,m8=P.ridgeScale;
    let sum=0,a=1,w=1,dx=0,dy=0,dz=0,gx=0,gy=0,gz=0,norm=0;
    for(let i=0;i<P.octaves;i++){
      N.noised(m0*x+m1*y+m2*z, m3*x+m4*y+m5*z, m6*x+m7*y+m8*z, nd);
      const wx=m0*nd[1]+m3*nd[2]+m6*nd[3], wy=m1*nd[1]+m4*nd[2]+m7*nd[3], wz=m2*nd[1]+m5*nd[2]+m8*nd[3];
      const s=nd[0]<0?-1:1, r0=1-Math.abs(nd[0]), r=Math.pow(Math.max(r0,0),P.sharpness);
      const k=-s*P.sharpness*Math.pow(Math.max(r0,1e-4),P.sharpness-1);   // d(ridge)/d(noise)
      const rx=k*wx, ry=k*wy, rz=k*wz;
      // damping: detail is suppressed where the accumulated slope is steep (flanks stay clean, crests stay busy)
      const damp=1/(1+P.erosionDamping*(dx*dx+dy*dy+dz*dz));
      const c=a*w*r*damp; sum+=c; norm+=a;
      gx+=a*w*damp*rx; gy+=a*w*damp*ry; gz+=a*w*damp*rz;
      dx+=a*rx*w; dy+=a*ry*w; dz+=a*rz*w;
      w=Math.min(1,Math.max(0,r*P.ridgeGain));
      const n0=2*(RM[0]*m0+RM[1]*m3+RM[2]*m6), n1=2*(RM[0]*m1+RM[1]*m4+RM[2]*m7), n2=2*(RM[0]*m2+RM[1]*m5+RM[2]*m8);
      const n3=2*(RM[3]*m0+RM[4]*m3+RM[5]*m6), n4=2*(RM[3]*m1+RM[4]*m4+RM[5]*m7), n5=2*(RM[3]*m2+RM[4]*m5+RM[5]*m8);
      const n6=2*(RM[6]*m0+RM[7]*m3+RM[8]*m6), n7=2*(RM[6]*m1+RM[7]*m4+RM[8]*m7), n8=2*(RM[6]*m2+RM[7]*m5+RM[8]*m8);
      m0=n0;m1=n1;m2=n2;m3=n3;m4=n4;m5=n5;m6=n6;m7=n7;m8=n8; a*=0.5;
    }
    out[0]=sum/norm; out[1]=gx/norm; out[2]=gy/norm; out[3]=gz/norm; return out;
  }

  // gully filter (after clayjohn's "eroded terrain noise"): slope-aligned cosine stripes in a
  // jittered cell grid. (u,v) are plane coords, (ga,gb) the height gradient in that plane.
  const TAU=Math.PI*2;
  function erosionCell(u,v,dirx,diry,o){
    const iu=Math.floor(u), iv=Math.floor(v), fu=u-iu, fv=v-iv; let va=0,vb=0,vc=0,wt=0;
    for(let i=-2;i<=1;i++) for(let j=-2;j<=1;j++){
      N.hash2(iu-i,iv-j,hc); const pu=fu+i-hc[0]*0.5, pv=fv+j-hc[1]*0.5;
      const w=Math.exp(-(pu*pu+pv*pv)*2); wt+=w; const mag=(pu*dirx+pv*diry)*TAU;
      va+=Math.cos(mag)*w; const sn=-Math.sin(mag)*w; vb+=sn*dirx; vc+=sn*diry;
    }
    o[0]=va/wt; o[1]=vb/wt; o[2]=vc/wt; return o;
  }
  const eo=[0,0,0];
  function gullyPlane(u,v,ga,gb){
    let hx=0,hy=0,hz=0,a=0.5,f=1;
    const bx=gb*P.gullySlope, by=-ga*P.gullySlope;      // gradient rotated 90° → stripes run downhill
    for(let i=0;i<P.gullyOctaves;i++){
      erosionCell(u*P.gullyScale*f, v*P.gullyScale*f, bx+hz, by-hy, eo);
      hx+=eo[0]*a; hy+=eo[1]*a*f; hz+=eo[2]*a*f; a*=0.4; f*=2;
    }
    return hx;   // ~[-1,1]: negative = channel, positive = spur
  }

  const t4=[0,0,0,0], w1=[0,0,0,0], w2=[0,0,0,0], w3=[0,0,0,0], rg=[0,0,0,0], vl=[0,0,0,0];
  // Height at 3D point p with local up u. out = {h, gully, mountain}
  function sample(px,py,pz,ux,uy,uz,out){
    // 1. regions
    fbm(px+31.7,py-12.3,pz+5.1,P.maskScale,4,t4);
    const m0=t4[0]*0.5+0.5, lo=P.coverage-0.12, hi=P.coverage+0.12;
    let mt=Math.min(1,Math.max(0,(m0-(1-hi))/((1-lo)-(1-hi)))); mt=mt*mt*(3-2*mt);
    // 2. warp
    fbm(px,py,pz,P.warpScale,3,w1); fbm(px+17.1,py+3.3,pz-9.2,P.warpScale,3,w2); fbm(px-5.7,py+11.9,pz+23.4,P.warpScale,3,w3);
    const qx=px+P.warp*w1[0], qy=py+P.warp*w2[0], qz=pz+P.warp*w3[0];
    // 3. ridges (+ gentle valley floor)
    ridged(qx,qy,qz,rg); fbm(px-40,py+2,pz+11,0.9,4,vl);
    let mh=P.mountainHeight*mt; const vh=P.valleyHeight;
    let h=vh*(vl[0]*0.5+0.5)+mh*rg[0]*rg[0]*1.6;        // squaring keeps valley floors flat, lifts peaks
    const gs=mh*rg[0]*3.2, gx=gs*rg[1]+vh*0.5*vl[1], gy=gs*rg[2]+vh*0.5*vl[2], gz=gs*rg[3]+vh*0.5*vl[3];
    // 4. gullies — gradient projected onto the tangent plane, triplanar-blended by up (seamless on a sphere)
    const gd=gx*ux+gy*uy+gz*uz, tx=gx-ux*gd, ty=gy-uy*gd, tz=gz-uz*gd, slope=Math.hypot(tx,ty,tz);
    let gully=0;
    if(P.gullyStrength>0&&mh>1e-4){
      let ax=ux*ux*ux*ux, ay=uy*uy*uy*uy, az=uz*uz*uz*uz; const s=ax+ay+az; ax/=s; ay/=s; az/=s;
      if(ay>0.01) gully+=ay*gullyPlane(px,pz,tx,tz);
      if(ax>0.01) gully+=ax*gullyPlane(pz,py,tz,ty);
      if(az>0.01) gully+=az*gullyPlane(px,py,tx,ty);
      const sm=Math.min(1,slope/0.9);                 // only on slopes
      h+=gully*P.gullyStrength*0.06*mh*sm*(0.35+0.65*rg[0]);
      gully*=sm;
    }
    // 5. settlement pads: flatten an area (towns, arenas) and blend it into the surroundings
    if(P.pads) for(let i=0;i<P.pads.length;i++){ const pd=P.pads[i], d=Math.hypot(px-pd.x,py-(pd.y||0),pz-pd.z);
      if(d<pd.r+pd.fall){ let w=Math.min(1,Math.max(0,1-(d-pd.r)/pd.fall)); w=w*w*(3-2*w);
        h+=(pd.h+(pd.rough||0)*vl[0]-h)*w; gully*=1-w; mt*=1-w; } }
    out.h=h; out.gully=gully; out.mountain=mt; return out;
  }
  return {params:P, sample};
}

// ---------------------------------------------------------------- tile grid
// Builds one tile. pointAt(u,v,out) maps tile coords (0..1, margin may go outside) to a base
// point {x,y,z} and unit up {ux,uy,uz}; the surface point is base + up*h.
// Flat tile:  base = (x0+u*size, 0, z0+v*size), up = +Y.
// Planet tile: base = cubeToSphere(face,u,v)*R, up = normalize(base).
export function buildTile(terrain, {res=256, pointAt, droplets=0, dropletSeed=1, cellSize=1}){
  const M=4, W=res+1+2*M, n=W*W;                         // margin for normals, cavity, erosion
  const bx=new Float32Array(n), by=new Float32Array(n), bz=new Float32Array(n), ux=new Float32Array(n), uy=new Float32Array(n), uz=new Float32Array(n);
  const h=new Float32Array(n), gully=new Float32Array(n), mount=new Float32Array(n), pt={x:0,y:0,z:0,ux:0,uy:1,uz:0}, s={};
  for(let j=0;j<W;j++) for(let i=0;i<W;i++){
    const k=j*W+i; pointAt((i-M)/res,(j-M)/res,pt);
    bx[k]=pt.x; by[k]=pt.y; bz[k]=pt.z; ux[k]=pt.ux; uy[k]=pt.uy; uz[k]=pt.uz;
    terrain.sample(pt.x,pt.y,pt.z,pt.ux,pt.uy,pt.uz,s); h[k]=s.h; gully[k]=s.gully; mount[k]=s.mountain;
  }
  let flow=new Float32Array(n), dep=new Float32Array(n);
  if(droplets>0) ({flow,dep}=erodeDroplets(h,W,{droplets,seed:dropletSeed,cellSize,margin:M}));

  // outputs (interior only)
  const V=(res+1)*(res+1), pos=new Float32Array(V*3), nor=new Float32Array(V*3), terr=new Float32Array(V*4);
  const X=k=>bx[k]+ux[k]*h[k], Y=k=>by[k]+uy[k]*h[k], Z=k=>bz[k]+uz[k]*h[k];
  let hmin=1e9,hmax=-1e9;
  for(let j=0;j<=res;j++) for(let i=0;i<=res;i++){
    const k=(j+M)*W+(i+M), o=j*(res+1)+i;
    pos[o*3]=X(k); pos[o*3+1]=Y(k); pos[o*3+2]=Z(k);
    // normal from neighbours (works for flat and curved tiles)
    const l=k-1, r=k+1, d=k-W, u=k+W;
    const ax=X(r)-X(l), ay=Y(r)-Y(l), az=Z(r)-Z(l), cx=X(u)-X(d), cy=Y(u)-Y(d), cz=Z(u)-Z(d);
    let nx=cy*az-cz*ay, ny=cz*ax-cx*az, nz=cx*ay-cy*ax; const L=Math.hypot(nx,ny,nz)||1;
    if(nx*ux[k]+ny*uy[k]+nz*uz[k]<0) { nx=-nx; ny=-ny; nz=-nz; }
    nor[o*3]=nx/L; nor[o*3+1]=ny/L; nor[o*3+2]=nz/L;
    // cavity: + in creases/valleys, - on crests (in height units per cell)
    const cav=(h[l]+h[r]+h[d]+h[u]+0.5*(h[d-1]+h[d+1]+h[u-1]+h[u+1]))/6-h[k];
    terr[o*4]=h[k]; terr[o*4+1]=gully[k]; terr[o*4+2]=cav/cellSize; terr[o*4+3]=Math.min(1,flow[k]*0.05+dep[k]*15)*(droplets>0?1:0);
    if(h[k]<hmin) hmin=h[k]; if(h[k]>hmax) hmax=h[k];
  }
  return {res,positions:pos,normals:nor,terrain:terr,hmin,hmax,mountain:mount};
}

export function flatPointAt(x0,z0,size){ return (u,v,o)=>{ o.x=x0+u*size; o.y=0; o.z=z0+v*size; o.ux=0; o.uy=1; o.uz=0; return o; }; }

// shared index buffer for a (res+1)^2 grid
export function gridIndex(res){
  const idx=new Uint32Array(res*res*6); let t=0;
  for(let j=0;j<res;j++) for(let i=0;i<res;i++){ const a=j*(res+1)+i, b=a+1, c=a+res+1, d=c+1;
    if((i+j)&1){ idx[t++]=a; idx[t++]=c; idx[t++]=b; idx[t++]=b; idx[t++]=c; idx[t++]=d; }
    else { idx[t++]=a; idx[t++]=c; idx[t++]=d; idx[t++]=a; idx[t++]=d; idx[t++]=b; } }
  return idx;
}

// ---------------------------------------------------------------- hydraulic droplet erosion
// Particle erosion on a square height grid (after Hans Beyer / Sebastian Lague). Modifies h in place.
// Returns per-cell flow (how much water passed) and deposition, which the material uses.
// For the planet this runs on regions larger than a tile (margins) so seams stay hidden.
export function erodeDroplets(h,W,{droplets=50000,seed=1,cellSize=1,margin=0,
  inertia=0.05,capacity=5,minCapacity=0.01,erodeRate=0.35,depositRate=0.25,evaporate=0.015,gravity=4,life=40,radius=3}={}){
  const r=mulberry(seed*131+7), n=W*W, flow=new Float32Array(n), dep=new Float32Array(n);
  let hmax=0; for(let i=0;i<n;i++) hmax=Math.max(hmax,Math.abs(h[i]));
  const S=(1/cellSize)/(W*0.004+1);   // height → "cell units" so slopes are in a sane range at any scale
  const hs=new Float32Array(n); for(let i=0;i<n;i++) hs[i]=h[i]*S;
  // erosion brush
  const bo=[], bw=[]; let bs=0;
  for(let y=-radius;y<=radius;y++) for(let x=-radius;x<=radius;x++){ const d=Math.hypot(x,y); if(d<radius){ bo.push([x,y]); const w=1-d/radius; bw.push(w); bs+=w; } }
  for(let i=0;i<bw.length;i++) bw[i]/=bs;
  const grad=(x,y)=>{ const ix=x|0, iy=y|0, fx=x-ix, fy=y-iy, k=iy*W+ix;
    const a=hs[k], b=hs[k+1], c=hs[k+W], d=hs[k+W+1];
    return [(b-a)*(1-fy)+(d-c)*fy, (c-a)*(1-fx)+(d-b)*fx, a*(1-fx)*(1-fy)+b*fx*(1-fy)+c*(1-fx)*fy+d*fx*fy]; };
  const lo=1, hi=W-2-1e-3;
  for(let q=0;q<droplets;q++){
    let x=lo+r()*(hi-lo), y=lo+r()*(hi-lo), dx=0, dy=0, sp=1, wat=1, sed=0;
    for(let t=0;t<life;t++){
      const ix=x|0, iy=y|0, fx=x-ix, fy=y-iy, k=iy*W+ix; const [gx,gy,hh]=grad(x,y);
      dx=dx*inertia-gx*(1-inertia); dy=dy*inertia-gy*(1-inertia); const L=Math.hypot(dx,dy); if(L<1e-9) break; dx/=L; dy/=L;
      x+=dx; y+=dy; if(x<lo||y<lo||x>hi||y>hi) break;
      flow[k]+=wat*0.02;
      const nh=grad(x,y)[2], dh=nh-hh;
      const cap=Math.max(-dh*sp*wat*capacity,minCapacity);
      if(sed>cap||dh>0){   // deposit
        const amt=dh>0?Math.min(dh,sed):(sed-cap)*depositRate; sed-=amt;
        hs[k]+=amt*(1-fx)*(1-fy); hs[k+1]+=amt*fx*(1-fy); hs[k+W]+=amt*(1-fx)*fy; hs[k+W+1]+=amt*fx*fy; dep[k]+=amt;
      } else {             // erode with brush
        const amt=Math.min((cap-sed)*erodeRate,-dh);
        for(let b=0;b<bo.length;b++){ const cx=ix+bo[b][0], cy=iy+bo[b][1]; if(cx<0||cy<0||cx>=W||cy>=W) continue;
          const kk=cy*W+cx, e=Math.min(hs[kk],amt*bw[b]); hs[kk]-=e; sed+=e; }
      }
      sp=Math.sqrt(Math.max(0,sp*sp+dh*gravity)); wat*=1-evaporate;
    }
  }
  for(let i=0;i<n;i++) h[i]=hs[i]/S;
  // blur flow a little for shading
  const f2=new Float32Array(n); for(let y=1;y<W-1;y++) for(let x=1;x<W-1;x++){ const k=y*W+x; f2[k]=(flow[k]*4+flow[k-1]+flow[k+1]+flow[k-W]+flow[k+W])/8; }
  return {flow:f2,dep};
}

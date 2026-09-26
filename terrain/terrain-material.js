// Terrain material — MeshStandardMaterial extended with slope/height/erosion-driven layers.
// Texture-free (all surface detail is procedural) so it works anywhere; lit, shadowed and
// fogged by three.js as usual. Needs the per-vertex `aTerr` attribute from buildTile():
//   x = height, y = gully (-channel/+spur), z = cavity (+crease/-crest), w = water flow/deposition
//
// upMode 0 = flat tile (up is +Y), 1 = planet (up = normalize(worldPos - planetCenter)).

export const DEFAULT_MATERIAL = {
  snowLine: 1.05, snowFade: 0.18, rockSlope: 0.52, rockSoftness: 0.16, waterLevel: 0.035,
  detail: 1.0, strata: 0.35, wetBand: 0.0015, beach: 0.004,   // km above water: real beaches are only a few metres high caustics: 1.0,
  sand: [0.55,0.49,0.37],
  grass: [0.27,0.33,0.10], grassDry: [0.52,0.52,0.22], dirt: [0.33,0.28,0.20], rock: [0.19,0.19,0.20], rockLight: [0.42,0.40,0.37], snow: [0.93,0.95,0.98],
};

// opts.km: world units per km (1 in the lab, 100 in the game). opts.hole: [x0,z0,x1,z1] world rect to discard
// (where a finer patch is drawn). opts.overlay: {mask, extent, asphalt, stone} road/plaza mask (R=road G=plaza B=dirt).
// opts.detailTex: close-range grass detail texture, opts.detailScale: its repeat per world unit.
export function createTerrainMaterial(THREE, opts={}){
  const P={...DEFAULT_MATERIAL,...opts};
  const U={
    uSnowLine:{value:P.snowLine}, uSnowFade:{value:P.snowFade}, uRockSlope:{value:P.rockSlope}, uRockSoft:{value:P.rockSoftness},
    uWater:{value:P.waterLevel}, uDetail:{value:P.detail}, uStrata:{value:P.strata}, uUpMode:{value:opts.upMode||0}, uTime:{value:0}, uWetBand:{value:P.wetBand}, uBeach:{value:P.beach}, uCaustics:{value:P.caustics}, uSand:{value:new THREE.Color(...P.sand)}, uCenter:{value:new THREE.Vector3()},
    uGrass:{value:new THREE.Color(...P.grass)}, uGrassDry:{value:new THREE.Color(...P.grassDry)}, uDirt:{value:new THREE.Color(...P.dirt)},
    uRock:{value:new THREE.Color(...P.rock)}, uRockLight:{value:new THREE.Color(...P.rockLight)}, uSnow:{value:new THREE.Color(...P.snow)},
  };
  U.uKm={value:opts.km||1};
  const defines={};
  if(opts.hole){ defines.TERRAIN_HOLE=''; U.uHole={value:new THREE.Vector4(...opts.hole)}; }
  if(opts.overlay){ defines.TERRAIN_OVERLAY=''; Object.assign(U,{tMask:{value:opts.overlay.mask},uMaskE:{value:opts.overlay.extent},tAsph:{value:opts.overlay.asphalt},tStone:{value:opts.overlay.stone}}); }
  if(opts.sunVis){ defines.TERRAIN_SUNVIS=''; }
  if(opts.morph){ defines.TERRAIN_MORPH=''; U.uSplitK={value:opts.splitK||2.2}; }   // planet LOD geomorphing (needs aMorph: parent delta, tile size)   // needs per-vertex `aSun` (bakeSunVisibility)
  if(opts.detailTex){ defines.TERRAIN_DETAILTEX=''; Object.assign(U,{tDetail:{value:opts.detailTex},uDetailScale:{value:opts.detailScale||0.9}}); }
  const m=new THREE.MeshStandardMaterial({roughness:0.9,metalness:0});
  m.defines=defines;
  if(opts.polygonOffset){ m.polygonOffset=true; m.polygonOffsetFactor=1; m.polygonOffsetUnits=2; }
  m.userData.uniforms=U;
  m.onBeforeCompile=sh=>{
    Object.assign(sh.uniforms,U);
    sh.vertexShader=sh.vertexShader
      .replace('#include <common>',`#include <common>
        attribute vec4 aTerr; varying vec4 vTerr; varying vec3 vWPos; varying vec3 vWNorm;
        #ifdef TERRAIN_SUNVIS
        attribute float aSun; varying float vSun;
        #endif
        #ifdef TERRAIN_MORPH
        attribute vec2 aMorph; uniform float uSplitK;
        #endif`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        #ifdef TERRAIN_MORPH
        { vec3 wp0=(modelMatrix*vec4(position,1.)).xyz; float md=distance(wp0,cameraPosition);
          float mk=smoothstep(aMorph.y*uSplitK*1.05,aMorph.y*uSplitK*1.9,md); transformed+=normalize(wp0)*aMorph.x*mk; }
        #endif`)
      .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
        vTerr=aTerr; vWPos=(modelMatrix*vec4(transformed,1.)).xyz; vWNorm=normalize(mat3(modelMatrix)*objectNormal);
        #ifdef TERRAIN_SUNVIS
        vSun=aSun;
        #endif`);
    sh.fragmentShader=sh.fragmentShader
      .replace('#include <common>',`#include <common>
        varying vec4 vTerr; varying vec3 vWPos; varying vec3 vWNorm;
        uniform float uSnowLine,uSnowFade,uRockSlope,uRockSoft,uWater,uDetail,uStrata,uTime,uWetBand,uBeach,uCaustics; uniform vec3 uSand; uniform int uUpMode; uniform vec3 uCenter; uniform float uKm;
        #ifdef TERRAIN_SUNVIS
        varying float vSun;
        #endif
        #ifdef TERRAIN_HOLE
        uniform vec4 uHole;
        #endif
        #ifdef TERRAIN_OVERLAY
        uniform sampler2D tMask,tAsph,tStone; uniform float uMaskE;
        #endif
        #ifdef TERRAIN_DETAILTEX
        uniform sampler2D tDetail; uniform float uDetailScale;
        #endif
        uniform vec3 uGrass,uGrassDry,uDirt,uRock,uRockLight,uSnow;
        float tHash(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        float tNoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
          return mix(mix(mix(tHash(i),tHash(i+vec3(1,0,0)),f.x),mix(tHash(i+vec3(0,1,0)),tHash(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(tHash(i+vec3(0,0,1)),tHash(i+vec3(1,0,1)),f.x),mix(tHash(i+vec3(0,1,1)),tHash(i+vec3(1,1,1)),f.x),f.y),f.z); }
        float tFbm(vec3 p){ float s=0.,a=.5; for(int i=0;i<4;i++){ s+=a*tNoise(p); p=p*2.03+17.1; a*=.5; } return s; }
        // triplanar rock: projections weighted by the surface normal so cliffs don't smear
        float tRock(vec3 p, vec3 n){ vec3 w=pow(abs(n),vec3(4.)); w/=w.x+w.y+w.z;
          return tFbm(p.yzx*vec3(1.,3.,1.))*w.x + tFbm(p.xzy)*w.y + tFbm(p*vec3(1.,3.,1.))*w.z; }
        vec3 tUp(){ return uUpMode==1 ? normalize(vWPos-uCenter) : vec3(0.,1.,0.); }
        float gLayer; float gRockW; float gSnowW; float gCav; float gWet;
        float tCaustic(vec2 p,float t){ float a=tNoise(vec3(p,t)), b=tNoise(vec3(p*1.37+11.,t*1.3)); return pow(1.-abs(a-b),9.); }`)
      .replace('#include <map_fragment>',`
        #ifdef TERRAIN_HOLE
        if(vWPos.x>uHole.x&&vWPos.z>uHole.y&&vWPos.x<uHole.z&&vWPos.z<uHole.w) discard;
        #endif
        vec3 KP=vWPos/uKm;                                 // position in km: all procedural detail is scale-independent
        vec3 up=tUp(); vec3 wn=normalize(vWNorm); float h=vTerr.x, gully=vTerr.y, cav=clamp(vTerr.z*0.35,-1.,1.), flow=vTerr.w;
        float slope=1.-clamp(dot(wn,up),0.,1.);          // 0 flat .. 1 vertical
        vec3 P=KP*18.;                                  // detail space (tile units are km → ~55 m features)
        float macro=tFbm(KP*1.3), fine=tNoise(P*3.);
        // grass: lush in hollows, dry on exposed ground
        vec3 grass=mix(uGrass,uGrassDry,clamp(macro*1.3-0.35+(-cav)*0.3,0.,1.))*(0.85+0.3*fine);
        #ifdef TERRAIN_DETAILTEX
        { vec2 duv=vWPos.xz*uDetailScale; vec3 dt=texture2D(tDetail,duv).rgb, da=textureLod(tDetail,duv,12.).rgb;
          float near=1.-smoothstep(25.*uKm/100.,120.*uKm/100.,distance(cameraPosition,vWPos));
          grass*=mix(vec3(1.),clamp(dt/max(da,vec3(0.02)),0.,3.),near); }
        #endif
        // rock: triplanar grain + height strata, lighter on crests, dark in channels
        float rn=tRock(P*0.6,wn);
        vec3 rock=mix(uRock,uRockLight,clamp(rn*1.4-0.45+(-cav)*0.35+gully*0.25,0.,1.));
        rock*=1.+uStrata*0.25*sin(h*90.+rn*6.);
        // blend weights
        float rs=uRockSlope-gully*0.06+(macro-0.5)*0.12;
        gRockW=smoothstep(rs-uRockSoft,rs+uRockSoft,slope);
        float dirtW=clamp(smoothstep(rs-uRockSoft*2.2,rs-uRockSoft*0.4,slope)*(1.-gRockW)*0.8+flow*0.6+max(cav,0.)*0.25,0.,1.);
        vec3 col=mix(grass,uDirt*(0.8+0.4*fine),dirtW);
        col=mix(col,rock,gRockW);
        // moss/grass creeping into rock creases on gentler rock
        col=mix(col,grass*0.8,gRockW*smoothstep(0.1,0.6,cav)*(1.-smoothstep(0.55,0.85,slope))*0.7);
        // snow: above the line, sliding off steep faces, sticking in creases
        float sl=uSnowLine+(macro-0.5)*uSnowFade*1.5;
        gSnowW=smoothstep(sl-uSnowFade*0.5,sl+uSnowFade*0.5,h)*(1.-smoothstep(0.55,0.78,slope-max(cav,0.)*0.2));
        col=mix(col,uSnow*(0.9+0.1*fine),gSnowW);
        // cavity darkening (ambient occlusion from the height field)
        gCav=cav; col*=mix(1.,0.62,smoothstep(0.,0.9,cav))*mix(1.,1.08,smoothstep(0.,0.8,-cav));
        #ifdef TERRAIN_OVERLAY
        { vec2 muv=vWPos.xz/(2.*uMaskE)+.5; vec4 mk=texture2D(tMask,muv)*step(0.,muv.x)*step(muv.x,1.)*step(0.,muv.y)*step(muv.y,1.);
          vec3 asph=texture2D(tAsph,vWPos.xz*1.6).rgb*0.9, stone=texture2D(tStone,vWPos.xz*2.2).rgb*vec3(.6,.57,.53);
          float paint=step(.9,mk.r)*step(.9,mk.g)*step(.9,mk.b);
          col=mix(col,uDirt*(0.8+0.4*fine),mk.b*0.75); col=mix(col,asph,mk.r); col=mix(col,stone,mk.g*(1.-mk.r)); col=mix(col,vec3(.9,.8,.45),paint); }
        #endif
        // shore: sandy banks on gentle slopes near the waterline, then a dark wet band just above it
        float above=h-uWater, depth=max(-above,0.);
        float beachW=(1.-smoothstep(uBeach*0.4,uBeach,above))*(1.-smoothstep(0.18,0.4,slope))*(1.-gSnowW);
        col=mix(col,uSand*(0.85+0.3*fine),beachW*smoothstep(-0.01,0.,above+0.01));
        gWet=(1.-smoothstep(0.,uWetBand,above))*step(-0.0005,above);
        col*=mix(1.,0.58,gWet);
        // underwater: sand-toned bed, absorbed by depth (red first), with moving caustics in the shallows
        if(depth>0.){ col=mix(col,uSand*0.8,0.35*(1.-gRockW));
          col*=exp(-depth*vec3(42.,17.,13.));
          col+=vec3(0.75,0.9,0.85)*tCaustic(KP.xz*260.,uTime*0.9)*uCaustics*0.35*exp(-depth*70.)*smoothstep(0.,0.002,depth); }
        #ifdef TERRAIN_SUNVIS
        col*=mix(0.42,1.,vSun);   // baked terrain shadow (mountains shading valleys)
        #endif
        diffuseColor.rgb*=col;`)
      .replace('#include <roughnessmap_fragment>',`float roughnessFactor=roughness*mix(mix(mix(0.95,0.8,gRockW),0.55,gSnowW),0.3,gWet);`)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        { // procedural detail normal: gradient of rock noise, stronger on rock
          vec3 dp=vWPos/uKm*42.; float e=0.35, n0=tFbm(dp);
          vec3 g=vec3(tFbm(dp+vec3(e,0,0))-n0, tFbm(dp+vec3(0,e,0))-n0, tFbm(dp+vec3(0,0,e))-n0)/e;
          vec3 wn2=normalize(vWNorm); g-=wn2*dot(g,wn2);
          float k=uDetail*mix(0.25,0.9,gRockW)*(1.-gSnowW*0.7);
          normal=normalize(normal-(viewMatrix*vec4(g*k,0.)).xyz);
        }`);
  };
  m.customProgramCacheKey=()=>'terrain-v3'+Object.keys(defines).join();
  return m;
}

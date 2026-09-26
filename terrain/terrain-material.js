// Terrain material — MeshStandardMaterial extended with slope/height/erosion-driven layers.
// Texture-free (all surface detail is procedural) so it works anywhere; lit, shadowed and
// fogged by three.js as usual. Needs the per-vertex `aTerr` attribute from buildTile():
//   x = height, y = gully (-channel/+spur), z = cavity (+crease/-crest), w = water flow/deposition
//
// upMode 0 = flat tile (up is +Y), 1 = planet (up = normalize(worldPos - planetCenter)).

export const DEFAULT_MATERIAL = {
  snowLine: 1.05, snowFade: 0.18, rockSlope: 0.52, rockSoftness: 0.16, waterLevel: 0.035,
  detail: 1.0, strata: 0.35, wetBand: 0.006, beach: 0.018, caustics: 1.0,
  sand: [0.55,0.49,0.37],
  grass: [0.27,0.33,0.10], grassDry: [0.52,0.52,0.22], dirt: [0.33,0.28,0.20], rock: [0.19,0.19,0.20], rockLight: [0.42,0.40,0.37], snow: [0.93,0.95,0.98],
};

export function createTerrainMaterial(THREE, opts={}){
  const P={...DEFAULT_MATERIAL,...opts};
  const U={
    uSnowLine:{value:P.snowLine}, uSnowFade:{value:P.snowFade}, uRockSlope:{value:P.rockSlope}, uRockSoft:{value:P.rockSoftness},
    uWater:{value:P.waterLevel}, uDetail:{value:P.detail}, uStrata:{value:P.strata}, uUpMode:{value:opts.upMode||0}, uTime:{value:0}, uWetBand:{value:P.wetBand}, uBeach:{value:P.beach}, uCaustics:{value:P.caustics}, uSand:{value:new THREE.Color(...P.sand)}, uCenter:{value:new THREE.Vector3()},
    uGrass:{value:new THREE.Color(...P.grass)}, uGrassDry:{value:new THREE.Color(...P.grassDry)}, uDirt:{value:new THREE.Color(...P.dirt)},
    uRock:{value:new THREE.Color(...P.rock)}, uRockLight:{value:new THREE.Color(...P.rockLight)}, uSnow:{value:new THREE.Color(...P.snow)},
  };
  const m=new THREE.MeshStandardMaterial({roughness:0.9,metalness:0});
  m.userData.uniforms=U;
  m.onBeforeCompile=sh=>{
    Object.assign(sh.uniforms,U);
    sh.vertexShader=sh.vertexShader
      .replace('#include <common>',`#include <common>
        attribute vec4 aTerr; varying vec4 vTerr; varying vec3 vWPos; varying vec3 vWNorm;`)
      .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
        vTerr=aTerr; vWPos=(modelMatrix*vec4(transformed,1.)).xyz; vWNorm=normalize(mat3(modelMatrix)*objectNormal);`);
    sh.fragmentShader=sh.fragmentShader
      .replace('#include <common>',`#include <common>
        varying vec4 vTerr; varying vec3 vWPos; varying vec3 vWNorm;
        uniform float uSnowLine,uSnowFade,uRockSlope,uRockSoft,uWater,uDetail,uStrata,uTime,uWetBand,uBeach,uCaustics; uniform vec3 uSand; uniform int uUpMode; uniform vec3 uCenter;
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
        vec3 up=tUp(); vec3 wn=normalize(vWNorm); float h=vTerr.x, gully=vTerr.y, cav=clamp(vTerr.z*0.35,-1.,1.), flow=vTerr.w;
        float slope=1.-clamp(dot(wn,up),0.,1.);          // 0 flat .. 1 vertical
        vec3 P=vWPos*18.;                                  // detail space (tile units are km → ~55 m features)
        float macro=tFbm(vWPos*1.3), fine=tNoise(P*3.);
        // grass: lush in hollows, dry on exposed ground
        vec3 grass=mix(uGrass,uGrassDry,clamp(macro*1.3-0.35+(-cav)*0.3,0.,1.))*(0.85+0.3*fine);
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
        // shore: sandy banks on gentle slopes near the waterline, then a dark wet band just above it
        float above=h-uWater, depth=max(-above,0.);
        float beachW=(1.-smoothstep(uBeach*0.4,uBeach,above))*(1.-smoothstep(0.18,0.4,slope))*(1.-gSnowW);
        col=mix(col,uSand*(0.85+0.3*fine),beachW*smoothstep(-0.01,0.,above+0.01));
        gWet=(1.-smoothstep(0.,uWetBand,above))*step(-0.0005,above);
        col*=mix(1.,0.58,gWet);
        // underwater: sand-toned bed, absorbed by depth (red first), with moving caustics in the shallows
        if(depth>0.){ col=mix(col,uSand*0.8,0.35*(1.-gRockW));
          col*=exp(-depth*vec3(42.,17.,13.));
          col+=vec3(0.75,0.9,0.85)*tCaustic(vWPos.xz*260.,uTime*0.9)*uCaustics*0.35*exp(-depth*70.)*smoothstep(0.,0.002,depth); }
        diffuseColor.rgb*=col;`)
      .replace('#include <roughnessmap_fragment>',`float roughnessFactor=roughness*mix(mix(mix(0.95,0.8,gRockW),0.55,gSnowW),0.3,gWet);`)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        { // procedural detail normal: gradient of rock noise, stronger on rock
          vec3 dp=vWPos*42.; float e=0.35, n0=tFbm(dp);
          vec3 g=vec3(tFbm(dp+vec3(e,0,0))-n0, tFbm(dp+vec3(0,e,0))-n0, tFbm(dp+vec3(0,0,e))-n0)/e;
          vec3 wn2=normalize(vWNorm); g-=wn2*dot(g,wn2);
          float k=uDetail*mix(0.25,0.9,gRockW)*(1.-gSnowW*0.7);
          normal=normalize(normal-(viewMatrix*vec4(g*k,0.)).xyz);
        }`);
  };
  m.customProgramCacheKey=()=>'terrain-v2';
  return m;
}

// Water surface — planar mirror reflections + depth-aware colour, shoreline foam and soft contact.
// Depth comes from the tile's height grid (a texture), so the same material works for every
// planet tile: give it that tile's heights, origin and size.
//
// Blending is exact for a see-through layer: out = bed·T·(1−F) + scatter·(1−T)·(1−F) + reflection·F
// (T = transmittance through the water column, F = Fresnel), so shallows show the bed and grazing
// views become a mirror. The terrain material tints the bed by depth (absorption) on its side.

export const DEFAULT_WATER = {
  level: 0.035, deep: [0.015,0.075,0.085], shallow: [0.10,0.34,0.32], clarity: 55, // 1/km extinction
  foamWidth: 0.012, foam: 1.0, waveScale: 38, waveStrength: 0.22, distortion: 0.018, glint: 1.0,
};

// heights: Float32Array of (res+1)^2 grid heights; returns a half-float texture for the water shader
export function makeHeightTexture(THREE, heights, res){
  const n=(res+1)*(res+1), half=new Uint16Array(n); for(let i=0;i<n;i++) half[i]=THREE.DataUtils.toHalfFloat(heights[i]);
  const t=new THREE.DataTexture(half,res+1,res+1,THREE.RedFormat,THREE.HalfFloatType);
  t.minFilter=t.magFilter=THREE.LinearFilter; t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping; t.needsUpdate=true; return t;
}

// Reflector: the three.js addon class (three/addons/objects/Reflector.js)
// size/origin/level in km; km = world units per km (1 in the lab, 100 in the game)
export function createWater(THREE, Reflector, {size=8, origin=[-4,-4], res=256, heightTex=null, km=1, reflectRes=1024, ...opts}={}){
  const P={...DEFAULT_WATER,...opts};
  const geo=new THREE.PlaneGeometry(size*km,size*km).rotateX(-Math.PI/2);
  const mesh=new Reflector(geo,{textureWidth:reflectRes,textureHeight:reflectRes,clipBias:0.0005*km});
  const reflTex=mesh.getRenderTarget().texture, texMatrix=mesh.material.uniforms.textureMatrix.value;
  mesh.material.dispose();
  const U={
    tReflect:{value:reflTex}, textureMatrix:{value:texMatrix}, tHeight:{value:heightTex}, uOrigin:{value:new THREE.Vector2(...origin)}, uSize:{value:size}, uRes:{value:res},
    uLevel:{value:P.level}, uDeep:{value:new THREE.Color(...P.deep)}, uShallow:{value:new THREE.Color(...P.shallow)}, uClarity:{value:P.clarity},
    uFoamW:{value:P.foamWidth}, uFoam:{value:P.foam}, uWaveScale:{value:P.waveScale}, uWaveStr:{value:P.waveStrength}, uDistort:{value:P.distortion}, uGlint:{value:P.glint},
    uTime:{value:0}, uKm:{value:km}, uSunDir:{value:new THREE.Vector3(0,1,0)}, uSunColor:{value:new THREE.Color(1,0.95,0.85)}, uSky:{value:new THREE.Color(0.55,0.65,0.75)},
  };
  mesh.material=new THREE.ShaderMaterial({
    uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{}]), transparent:true, depthWrite:false, fog:true,
    vertexShader:`
      uniform mat4 textureMatrix; varying vec4 vRefl; varying vec3 vWP;
      #include <common>
      #include <fog_pars_vertex>
      void main(){ vRefl=textureMatrix*vec4(position,1.); vec4 wp=modelMatrix*vec4(position,1.); vWP=wp.xyz;
        vec4 mvPosition=viewMatrix*wp; gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader:`
      uniform sampler2D tReflect, tHeight; uniform vec2 uOrigin; uniform float uKm,uSize,uRes,uLevel,uClarity,uFoamW,uFoam,uWaveScale,uWaveStr,uDistort,uGlint,uTime;
      uniform vec3 uDeep,uShallow,uSunDir,uSunColor,uSky; varying vec4 vRefl; varying vec3 vWP;
      #include <common>
      #include <fog_pars_fragment>
      float wHash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float wNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(wHash(i),wHash(i+vec2(1,0)),f.x),mix(wHash(i+vec2(0,1)),wHash(i+vec2(1,1)),f.x),f.y); }
      // wave height field: several scrolling directional layers
      float wH(vec2 p){ float t=uTime;
        return wNoise(p*1.0+vec2(t*0.35,t*0.21))*0.5 + wNoise(p*2.3+vec2(-t*0.42,t*0.31))*0.3
             + wNoise(p*5.1+vec2(t*0.61,-t*0.55))*0.15 + wNoise(p*11.7+vec2(-t*0.9,-t*0.7))*0.07; }
      float bedH(vec2 xz){ vec2 uv=(xz-uOrigin)/uSize; uv=uv*(uRes/(uRes+1.))+0.5/(uRes+1.);
        if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) return -1e3; return texture2D(tHeight,uv).r; }
      void main(){
        vec3 V=normalize(cameraPosition-vWP); float dist=length(cameraPosition-vWP)/uKm; vec3 WK=vWP/uKm;
        float depth=uLevel-bedH(WK.xz);
        // normal from wave field; calmer in the shallows and toward the horizon (avoids shimmer)
        vec2 p=WK.xz*uWaveScale; float e=0.08, h0=wH(p);
        vec2 g=vec2(wH(p+vec2(e,0))-h0, wH(p+vec2(0,e))-h0)/e;
        float calm=smoothstep(0.,uFoamW*1.5,depth)*mix(1.,0.35,smoothstep(3.,25.,dist));
        vec3 N=normalize(vec3(-g.x*uWaveStr*calm,1.,-g.y*uWaveStr*calm));
        // Fresnel (Schlick, water F0≈0.02)
        float cosV=clamp(dot(N,V),0.,1.), F=0.02+0.98*pow(1.-cosV,5.);
        // mirror reflection, distorted by the waves
        vec2 ruv=vRefl.xy/vRefl.w+N.xz*uDistort*calm;
        vec3 refl=texture2D(tReflect,ruv).rgb;
        // transmittance through the water column along the view ray
        float path=max(depth,0.)/max(V.y,0.08);
        float T=exp(-path*uClarity);
        vec3 scatter=mix(uShallow,uDeep,1.-exp(-max(depth,0.)*uClarity*0.6))*(0.35+0.65*max(uSunDir.y,0.));
        // sun glint
        vec3 Hh=normalize(uSunDir+V); float spec=pow(max(dot(N,Hh),0.),900.)*40.+pow(max(dot(N,Hh),0.),120.)*1.2;
        vec3 glint=uSunColor*spec*uGlint*F*step(0.,uSunDir.y);
        // shoreline foam: bands washing toward the shore, broken up by noise
        float fz=clamp(1.-depth/uFoamW,0.,1.);
        float bands=sin(depth/uFoamW*14.-uTime*1.8+wNoise(WK.xz*300.)*4.)*0.5+0.5;
        float brk=wNoise(WK.xz*420.+uTime*0.3)*wNoise(WK.xz*130.-uTime*0.2);
        float foam=clamp(fz*fz*1.4+fz*smoothstep(0.55,0.95,bands)*0.9,0.,1.)*smoothstep(0.08,0.45,brk+fz*0.3)*uFoam;
        vec3 foamCol=vec3(0.92,0.95,0.95)*(0.45+0.55*max(dot(vec3(0,1,0),uSunDir),0.))+uSky*0.25;
        // compose: exact see-through blend (see header)
        vec3 src=scatter*(1.-T)*(1.-F)+refl*F+glint;
        float a=1.-T*(1.-F);
        src=mix(src,foamCol*a,foam); a=mix(a,1.,foam*0.9);
        a*=smoothstep(0.,0.0012,depth);            // soft contact line
        gl_FragColor=vec4(a>0.001?src/a:src,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  Object.assign(mesh.material.uniforms,U);
  mesh.position.y=P.level*km;
  mesh.userData.uniforms=U;
  mesh.userData.setLevel=l=>{ U.uLevel.value=l; mesh.position.y=l*km; };
  return mesh;
}

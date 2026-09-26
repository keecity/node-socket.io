// Cube-sphere math for planet tiles — pure JS, safe in workers.
// Tile address: face 0..5, level L (0 = whole face), x,y in [0, 2^L). Face coords a,b ∈ [-1,1].
// Faces are set up so that U×V = −N: the shared grid index (terrain-gen gridIndex) then winds
// counter-clockwise seen from outside on every face.
export const FACES=[
  {n:[ 1,0,0],u:[0,0, 1],v:[0,1,0]}, {n:[-1,0,0],u:[0,0,-1],v:[0,1,0]},
  {n:[0, 1,0],u:[1,0,0],v:[0,0, 1]}, {n:[0,-1,0],u:[1,0,0],v:[0,0,-1]},
  {n:[0,0, 1],u:[-1,0,0],v:[0,1,0]}, {n:[0,0,-1],u:[1,0,0],v:[0,1,0]},
];
// face coords → unit direction (spherified cube: near-uniform tile sizes, no pole pinching)
export function faceDir(f,a,b,out){
  const F=FACES[f], x=F.n[0]+a*F.u[0]+b*F.v[0], y=F.n[1]+a*F.u[1]+b*F.v[1], z=F.n[2]+a*F.u[2]+b*F.v[2];
  const x2=x*x, y2=y*y, z2=z*z;
  let sx=x*Math.sqrt(Math.max(0,1-y2/2-z2/2+y2*z2/3)), sy=y*Math.sqrt(Math.max(0,1-z2/2-x2/2+z2*x2/3)), sz=z*Math.sqrt(Math.max(0,1-x2/2-y2/2+x2*y2/3));
  const L=Math.hypot(sx,sy,sz); out[0]=sx/L; out[1]=sy/L; out[2]=sz/L; return out;
}
// unit direction → {f,a,b} (inverse of the plain cube projection; used for anchors/keys)
export function dirFace(d){
  const ax=Math.abs(d[0]), ay=Math.abs(d[1]), az=Math.abs(d[2]); let f;
  if(ax>=ay&&ax>=az) f=d[0]>0?0:1; else if(ay>=az) f=d[1]>0?2:3; else f=d[2]>0?4:5;
  const F=FACES[f], k=1/(d[0]*F.n[0]+d[1]*F.n[1]+d[2]*F.n[2]);
  return {f,a:(d[0]*F.u[0]+d[1]*F.u[1]+d[2]*F.u[2])*k, b:(d[0]*F.v[0]+d[1]*F.v[1]+d[2]*F.v[2])*k};
}
export const tileKey=(f,L,x,y)=>f+'/'+L+'/'+x+'/'+y;
// tile's (u,v)∈[0,1] → face coords
export const tileAB=(L,x,y,u,v)=>{ const n=1<<L; return [-1+2*(x+u)/n, -1+2*(y+v)/n]; };

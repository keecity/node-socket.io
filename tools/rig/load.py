import pygltflib,numpy as np
def load(fn):
    g=pygltflib.GLTF2().load(fn);b=g.binary_blob()
    def acc(i):
        a=g.accessors[i];bv=g.bufferViews[a.bufferView]
        dt={5126:np.float32,5125:np.uint32,5123:np.uint16}[a.componentType];c={"VEC3":3,"VEC2":2,"SCALAR":1}[a.type]
        r=np.frombuffer(b,dt,a.count*c,bv.byteOffset+(a.byteOffset or 0));return r.reshape(a.count,c) if c>1 else r
    p=g.meshes[0].primitives[0]
    img=g.images[0];bv=g.bufferViews[img.bufferView];im=b[bv.byteOffset:bv.byteOffset+bv.byteLength]
    return acc(p.attributes.POSITION).copy(),acc(p.attributes.NORMAL).copy(),acc(p.attributes.TEXCOORD_0).copy(),acc(p.indices).astype(np.uint32).reshape(-1,3),im,img.mimeType

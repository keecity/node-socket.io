import struct, json, io, sys
from PIL import Image
def shrink(src, dst, maxpx, q):
    d=open(src,'rb').read(); jl=struct.unpack('<I',d[12:16])[0]; j=json.loads(d[20:20+jl]); bo=20+jl; bl=struct.unpack('<I',d[bo:bo+4])[0]; B=d[bo+8:bo+8+bl]
    views=[B[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']] for v in j['bufferViews']]
    for im in j.get('images',[]):
        i=im['bufferView']; I=Image.open(io.BytesIO(views[i])).convert('RGB'); print(src, I.size, len(views[i]))
        I.thumbnail((maxpx,maxpx), Image.LANCZOS); o=io.BytesIO(); I.save(o,'JPEG',quality=q,optimize=True); views[i]=o.getvalue(); im['mimeType']='image/jpeg'; print(' ->', I.size, len(views[i]))
    nb=bytearray()
    for v,data in zip(j['bufferViews'],views):
        while len(nb)%4: nb.append(0)
        v['byteOffset']=len(nb); v['byteLength']=len(data); nb+=data
    while len(nb)%4: nb.append(0)
    j['buffers'][0]['byteLength']=len(nb)
    js=json.dumps(j,separators=(',',':')).encode()
    while len(js)%4: js+=b' '
    out=struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(nb))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(nb),0x004E4942)+bytes(nb)
    open(dst,'wb').write(out); print(dst, len(d),'->',len(out))
shrink('hair_styles.glb','hair_small.glb',512,72)
shrink('hoop.glb','hoop_small.glb',512,75)

# "save for web": re-encode every embedded image, cap its size at what a phone shows, re-encode sounds
import re, base64, io, json, subprocess, sys, tempfile, os
from PIL import Image
path = sys.argv[1]; h = open(path).read(); n0 = len(h)
MAXPX = 640   # widest any sprite is drawn on a phone at 2x density is under this
def img(m):
    raw = base64.b64decode(m.group(2)); im = Image.open(io.BytesIO(raw)); im.load()
    alpha = im.mode in ('RGBA', 'LA', 'P'); im = im.convert('RGBA' if alpha else 'RGB')
    if max(im.size) > MAXPX: im.thumbnail((MAXPX, MAXPX), Image.LANCZOS)
    o = io.BytesIO(); im.save(o, 'WEBP', quality=78, method=6, alpha_quality=80, exact=False)
    new = o.getvalue()
    return 'data:image/webp;base64,' + base64.b64encode(new if len(new) < len(raw) else raw).decode()
h = re.sub(r'data:image/(webp|png|jpe?g);base64,([A-Za-z0-9+/=]+)', img, h)
# sound clips inside ASSETS: mono 64 kbps mp3
def snd(m):
    raw = base64.b64decode(m.group(2))
    with tempfile.TemporaryDirectory() as d:
        a, b = os.path.join(d, 'a.mp3'), os.path.join(d, 'b.mp3'); open(a, 'wb').write(raw)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', a, '-ac', '1', '-b:a', '64k', '-map_metadata', '-1', b], check=True)
        new = open(b, 'rb').read()
    return '"' + m.group(1) + '": "' + base64.b64encode(new if len(new) < len(raw) else raw).decode() + '"'
h = re.sub(r'"(snd_[a-z]+)": "([A-Za-z0-9+/=]+)"', snd, h)
open(path, 'w').write(h); print('save for web:', n0, '->', len(h))
# JPEG textures (court + teal jersey) and textures inside the player model: optimized progressive JPEG, metadata stripped
h = open(path).read(); n1 = len(h)
def jpg(raw, q=78):
    im = Image.open(io.BytesIO(raw)).convert('RGB'); o = io.BytesIO(); im.save(o, 'JPEG', quality=q, optimize=True, progressive=True); new = o.getvalue()
    return new if len(new) < len(raw) else raw
def asset(m):
    k, raw = m.group(1), base64.b64decode(m.group(2))
    if k in ('color', 'height', 'teal'): raw = jpg(raw)
    elif raw[:4] == b'glTF':
        import struct
        jl = struct.unpack('<I', raw[12:16])[0]; j = json.loads(raw[20:20 + jl]); bo = 20 + jl; bl = struct.unpack('<I', raw[bo:bo + 4])[0]; B = raw[bo + 8:bo + 8 + bl]
        views = [B[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in j['bufferViews']]
        for imd in j.get('images', []): i = imd['bufferView']; views[i] = jpg(views[i], 80); imd['mimeType'] = 'image/jpeg'
        nb = bytearray()
        for v, d in zip(j['bufferViews'], views):
            while len(nb) % 4: nb.append(0)
            v['byteOffset'] = len(nb); v['byteLength'] = len(d); nb += d
        while len(nb) % 4: nb.append(0)
        j['buffers'][0]['byteLength'] = len(nb); js = json.dumps(j, separators=(',', ':')).encode()
        while len(js) % 4: js += b' '
        new = struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(nb)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(nb), 0x004E4942) + bytes(nb)
        raw = new if len(new) < len(raw) else raw
    return '"' + k + '": "' + base64.b64encode(raw).decode() + '"'
h = re.sub(r'"(color|height|teal|hoop|player|hair)": "([A-Za-z0-9+/=]+)"', asset, h)
open(path, 'w').write(h); print('textures:', n1, '->', len(h))

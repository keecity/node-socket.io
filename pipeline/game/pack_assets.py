"""Base64-encode rig.fbx and anims/*.glb into assets/*.b64.txt for the page to load."""
import base64
import glob
import os

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "assets")
os.makedirs(out, exist_ok=True)
for src in [os.path.join(here, "rig.fbx")] + sorted(glob.glob(os.path.join(here, "anims", "*.glb"))):
    dst = os.path.join(out, os.path.basename(src) + ".b64.txt")
    with open(src, "rb") as f, open(dst, "w") as g:
        g.write(base64.b64encode(f.read()).decode())
    print(dst)

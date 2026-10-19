"""Base64-encode each monster pack's binary files (rig and clips) as <file>.b64.txt.

Static hosts that refuse .glb/.fbx (such as artifacts) serve these text copies; the game loads
`<path>.b64.txt` for every binary it needs. Run after `creature_pipeline pack`.
"""
import base64
import glob
import os

here = os.path.dirname(os.path.abspath(__file__))
for pack in sorted(glob.glob(os.path.join(here, "monsters", "*", "monster.json"))):
    root = os.path.dirname(pack)
    files = [f for f in glob.glob(os.path.join(root, "*")) + glob.glob(os.path.join(root, "clips", "*"))
             if f.lower().endswith((".glb", ".fbx"))]
    for src in sorted(files):
        with open(src, "rb") as f, open(src + ".b64.txt", "w") as g:
            g.write(base64.b64encode(f.read()).decode())
    print(f"{os.path.relpath(root, here)}: {len(files)} files encoded")

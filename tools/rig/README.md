# Player rig

Rebuilds `public/models/player_rigged.glb` from the raw Tripo mesh.

    pip install pygltflib numpy scipy pillow
    cp <raw>/basketball_player.glb tools/rig/player.glb
    cd tools/rig && python3 export.py

| file | what it does |
| --- | --- |
| `rig.py` | Mesh cleanup (sneakers moved onto the feet and scaled up a touch, sock tucked inside the shoe, stray armband/patch removed), the 20-joint skeleton measured from the mesh, structured skin weights: spine blended by height, limbs by position along the bone with soft joints, shorts blending hips→thighs, shoes rigid on the foot. |
| `anim.py` | Control rig: per-control keyframe curves, two-bone IK for arms and legs, hand contact on the ball, wrist limits with forearm twist sharing. |
| `clips.py` | The four clips — `Idle`, `Dribble`, `Shoot`, `Dunk` — authored as keyframed controls. |
| `export.py` | Bakes the clips at 30 fps and writes the GLB (skinned mesh + `basketball` node). |
| `closeups.py`, `audit.py` | Review tools: `python3 closeups.py Shoot 0.3,0.6` renders front / 3/4 / side close-ups; `python3 audit.py` flags wrist over-rotation, hand flips and folded elbows on every frame. |

Shoot and Dunk are authored against a rim centred at (0, 1.35, 1.8); `public/player-viewer.html` places the hoop there.

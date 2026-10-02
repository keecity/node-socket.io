# Player rig

Rebuilds `public/models/player_rigged.glb` from the raw Tripo mesh.

    pip install pygltflib numpy scipy
    cp <raw>/basketball_player.glb tools/rig/player.glb
    cd tools/rig && python3 export.py

- `build.py` cleans the mesh (moves the floating sneakers onto the feet, drops the stray armband and patch),
  builds the 23-bone skeleton, computes skin weights and authors the clips.
- `export.py` writes the GLB: skinned mesh, a `basketball` node, and the clips `Idle`, `Dribble`, `Shoot`, `Dunk` (30 fps, baked).
- Shoot and Dunk target a rim at (0, 1.35, 1.8); `player-viewer.html` places the hoop there.

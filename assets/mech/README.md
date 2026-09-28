# Mech rig

Rigged version of `mech-build-01.fbx` (3ds Max export), built for PlayCanvas.

![Idle and Walk rendered in the PlayCanvas engine](preview.png)

| File | Use |
| --- | --- |
| `mech_rigged.glb` | Upload this to the PlayCanvas Editor (or load with `pc.Asset` type `container`). |
| `mech_rigged.fbx` | Same rig and clips, if you want to edit in 3ds Max/Blender. |
| `rig_mech.py` | Script that builds the rig from the original FBX (Blender 4.2 / `bpy`). |

## What's in it

- One skinned mesh (`MechBody`, 34.5k verts, 7 materials, textures embedded).
- 23 bones, Y-up, model faces **+Z**, about 2.8 units tall:

  ```
  Root
  └─ Hips ─┬─ Spine ─┬─ Head
           │         ├─ Shoulder_L ─ UpperArm_L ─ ForeArm_L ─ Hand_L
           │         └─ Shoulder_R ─ UpperArm_R ─ ForeArm_R ─ Hand_R
           ├─ UpperLeg_L ─ LowerLeg_L ─ Foot_L   (same for _R)
           └─ SkirtFront_L/R, SkirtSide_L/R, SkirtBack
  ```

- Hard-surface binding: every armor part follows exactly one bone at weight
  1.0, so nothing bends or stretches.
- Animation clips (30 fps, in place, loopable): `Idle` (2 s) and `Walk` (1 s).

Cleanup done on the source: 9 duplicate parts that were stacked on top of
each other were removed, mirrored parts had their inside-out faces fixed, and
the leg normal map was reconnected.

## PlayCanvas (engine API)

```js
const asset = new pc.Asset('mech', 'container', { url: 'mech_rigged.glb' });
app.assets.add(asset);
asset.ready((a) => {
  const mech = a.resource.instantiateRenderEntity();
  app.root.addChild(mech);
  mech.addComponent('anim', { activate: true });
  const clips = {};
  a.resource.animations.forEach((c) => (clips[c.resource.name] = c.resource));
  mech.anim.assignAnimation('Idle', clips.Idle);
  mech.anim.assignAnimation('Walk', clips.Walk);
  mech.anim.baseLayer.transition('Walk', 0.2); // switch clips with a blend
});
app.assets.load(asset);
```

In the Editor, drop `mech_rigged.glb` into Assets; the import creates a template
plus `Idle` and `Walk` animation assets that you can put in an Anim State Graph.

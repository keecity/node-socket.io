# Mine (RTS building)

A Three.js iron-ore mine built entirely from separate, named, destroyable parts. Open `/mine/` while `npm start` is running.

## Asset
- **Textures** come from `atlas.webp`, the supplied material atlas. Each tile is cut out at load time (`ATLAS_TILES` in `mine.js`) and mapped in real-world metres, using box projection per triangle. Tiles repeat mirrored, which hides seams because the tiles aren't authored to tile.
- **Geometry:** every hard-surface piece is a chamfered solid: concrete, plates, walls, footings and copings. Structural steel uses real I-beam and C-channel profiles, and the roof is actual corrugated sheet.
- **No terrain.** Footings, walls and plinths extend 0.6 m below y = 0. The tunnel lining runs `tunnelLength` metres (12 by default) back from the portal, so it buries into your terrain. About 2.4 m inside the frame, the bore fades to black and is closed by a dark plug, so terrain behind that point never shows through the mouth. For a clean mouth, keep terrain at least ~3 m behind the portal face. The viewer's **preview terrain** toggle shows this.
- The layout replicates `reference.webp`. The viewer opens on the fitted reference camera and has an **overlay** slider for comparison.

```js
import { createMine } from './mine.js';
const mine = createMine({ tunnelLength: 12, groundHeight: (x, z) => terrain.heightAt(x, z) });
scene.add(mine.root);
await mine.ready;            // atlas loaded
// every frame:
mine.update(dt);
```

| API | What it does |
| --- | --- |
| `mine.parts[name]` | Every part by name: `building_wall_front`, `portal_steel_header`, `tunnel_crown`, `bin_1_ore_40`, `conveyor_belt`, `hopper_leg_fl`, … |
| `mine.sections` | `portal`, `tunnel`, `conveyor`, `hopper`, `building`, `bin_0`, `bin_1`, `bin_2` |
| `destroy(name)` | Throws a part or whole section apart. The pieces tumble onto `groundHeight` and settle as rubble, with a dust puff. |
| `destroyAll()` / `rebuild()` | Demolishes the whole mine in stages / restores everything. |
| `setConveyor({ running, speed })` | The belt surface scrolls, the idlers and pulleys spin, and ore rocks ride up into the hopper. |
| `setFill('bin_0'\|'bin_1'\|'bin_2'\|'hopper', 0..1, { instant, rate })` | Ore rocks drop in from the floor up, or shrink away when the level goes down. |
| `getFill(name)`, `partOf(mesh)` | Reads the current fill level / gets `{part, section}` from a raycast hit. |

With `autoCycle` on, belt ore fills the hopper, the building drains it, and the output stockpiles in the bins one by one.
**Download .glb** exports the model with every part name kept.

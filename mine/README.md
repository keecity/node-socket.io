# Mine (RTS building)

A procedural Three.js mine built entirely from separate named parts. Open `/mine/` while `npm start` is running.

```js
import { createMine } from './mine.js';
const mine = createMine({ seed: 1, autoCycle: true, beltSpeed: 1.2 });
scene.add(mine.root);
// every frame:
mine.update(dt);
```

| API | What it does |
| --- | --- |
| `mine.parts[name]` | Every part by name: `building_wall_front`, `portal_lintel`, `hill_rock_12`, `bin_1_ore_40`, `conveyor_belt`, … |
| `mine.sections` | `portal`, `conveyor`, `hopper`, `building`, `bin_0..2`, `hill_rocks`, `ground_rocks` |
| `destroy(name)` | Throws a part or whole section apart. The pieces tumble and settle as rubble with a dust puff. |
| `destroyAll()` / `rebuild()` | Demolishes the whole mine in stages / restores everything. |
| `setConveyor({ running, speed })` | The belt texture scrolls, the rollers spin, and the ore rocks ride up into the hopper. |
| `setFill('bin_0'\|'bin_1'\|'bin_2'\|'hopper', 0..1, { instant, rate })` | Ore rocks drop in from the bottom of the heap up, or shrink away when the level goes down. |
| `getFill(name)`, `partOf(mesh)` | Reads the current fill level / gets `{part, section}` from a raycast hit. |

With `autoCycle` on, belt ore fills the hopper, the building drains it, and the output stockpiles in the bins one by one.
The viewer can export a `.glb` that keeps every part name, for use in other engines.

# Woodcutter Camp (RTS building)

A modular three.js build of the sawmill concept (`assets/concept.webp`), textured from the material atlas (`assets/atlas.webp`).
Every piece is its own mesh so it can be destroyed, animated or swapped.

Run `npm start` and open `http://localhost:3000/woodcutter-camp/`, or serve this folder with any static server.

## Hierarchy (567 meshes)
| Group | Contents |
|---|---|
| Foundation | 64 slab tiles (not destructible) |
| Workshop | ConcreteWall (8 panels), Siding (71 single boards), Partition (32 boards), Trim, Window (frame, mullions, 8 panes) |
| Frame | Posts, Footings, Beams, Braces/king posts, Rafters |
| Roof | 24 corrugated sheets, ridge caps, skylight vents, barge boards |
| LeanTo | Frame + 9 roof sheets |
| Sawmill | Infeed, Saw (spinning `saw_blade`), Outfeed (13 spinning `roller_N`), Lamp |
| LogYard | Rack + **Logs** (`log_0..5`, one mesh each, bark plus end-grain caps) |
| LumberYard | Stack_0/1 → Pallet + **Boards** (`board_<layer>_<i>` single boards plus stickers) |
| DustCollector | legs, hopper, body, cap, stack, pipe |

Each mesh has `userData.category` (`roof`, `siding`, `frame`, `log`, `board`, …) and `userData.destructible`. These export to glTF `extras`.

## Viewer controls
- **Construct**: build-up animation, in order: foundation, walls, frame, roof, stock.
- **Toggle production**: a log lifts off the rack, turns in line with the saw and is cut into boards. The boards roll down the outfeed and are stacked one at a time.
- **Damage**: 3 stages (roof off, then walls down, then collapse). **Click** any part to knock it off.
- **Repair**: restore everything. **Export .glb**: download the intact model for Unity, Unreal or Godot.

`camp.js` holds the model, `main.js` the viewer, destruction and animation, and `textures.js` slices the atlas.

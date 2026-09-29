# Spline-lofted widebody coupe

Original model inspired by a widebody FR-S/86 track car (no real brands or logos).

## Files (`out/`)
- `spline_car.blend` – full scene. Collections: `Body`, `Wheels`, `FrontBumpers`, `RearBumpers`, `SideSkirts`, `Construction_Splines` (hidden; editable Bezier curves).
- `car_default.glb` – assembled car (Race front/rear bumper, Flat skirts). `car_base.glb` – body, wheels, wing and interior with no swap parts.
- `FrontBumper_{Stock,Race,Street}.glb`, `RearBumper_{Stock,Race}.glb`, `SideSkirts_{Stock,Flat,Wing}.glb` – each shares the car's origin, so drop it in next to `car_base.glb`.
- `preview_*.png` – renders.

## Swapping parts in Blender
Toggle the eye icon on one object per collection (`FrontBumpers`, `RearBumpers`, `SideSkirts`). The body has a panel line at every seam, so every variant fits.

## How it's built
`build_car.py` (needs `pip install bpy`) samples side-profile splines (roofline, beltline, floor), a top-view width spline and a cross-section spline at every 2 cm station, lofts them into a quad grid, and splits it at panel lines. Run `python build_car.py -- --render` to regenerate everything.

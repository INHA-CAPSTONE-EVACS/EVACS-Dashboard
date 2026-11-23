# EVACS original low-poly vehicle models

These assets are original procedural geometry generated locally by
`app/tools/build_vehicle_models.py`, without downloads or external resources.
The generated geometry and material definitions are dedicated to the public
domain under **CC0-1.0** (Creative Commons Zero 1.0 Universal). No attribution
is required. Provided without warranty. License identifier is also embedded in
each GLB's asset extras.

## Model contract

| Model | Length (Z) | Width (X) | Height (Y) |
|---|---:|---:|---:|
| sedan.glb | 4.50 m | 1.80 m | 1.50 m |
| emergency.glb | 4.50 m | 1.80 m | 1.64 m including lightbar |

Both use glTF Y-up, X across the vehicle, and **forward = -Z** (headlamps).
Bounds: X [-0.90, 0.90], Z [-2.25, 2.25], Y [0, height].
The origin is centered on the ground plane; tire contact is Y=0.
No root transforms, textures, external buffers, animation, or dependencies.

For the installed deck ScenegraphLayer integration (which does not automatically
convert Y-up to map Z-up), use the parent integration's verified orientation:
`getOrientation: d => [0, -d.headingDegrees, 90]`.
Roll 90 degrees maps model +Y to map +Z and forward -Z to north +Y;
negative heading yaw maps eastbound heading 90 degrees to map +X.
Do not additionally bake that conversion into these assets.

The sedan has a light neutral body for multiplicative per-instance `getColor`.
All materials use `KHR_materials_unlit` and subtle baked vertex-color face
shading, keeping the body and lamps readable without scene lighting.
The emergency car is painted red (`livery`, 0.84/0.09/0.07) over body, cabin and
pillars so it is distinguishable from normal traffic at a glance, and adds a
white side stripe plus a red/blue roof lightbar.
Multiplicative instance tint affects the whole model, including lights/glass;
use white instance color for the emergency model to preserve its livery.

The body, cabin and four 16-sided cylindrical tires are individually closed
solids; windows and hubs are decorative surface overlays, not a single fused
3D-printable manifold. Each file is a self-contained glTF 2.0 binary.

Regenerate from `app`:

```sh
python3 tools/build_vehicle_models.py
python3 -m pytest tests/test_vehicle_models.py -q
```

Output is deterministic. `--output-dir PATH` supports isolated generation.

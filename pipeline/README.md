# Creature animation pipeline

Turn AI-generated video of a creature into a game-ready animation clip on that creature's own
rig, with no frames fixed by hand. Works for any body shape (four legs, wings, tails) because
the joint detector is trained per monster on renders of the monster itself.

```
rig.fbx ──► skeleton.json ──► synth (3000 posed renders, exact labels) ──► train detector (DINOv2 + head)
   │                                                                              │
   └──► start-frame (front + side view, 16:9) ──► video model ──► clip.mp4 ──► solve ──► clip.glb (three.js)
                                                                                 ▲
                                          exam (invented motion, known answer) ──┘ gate before trusting it
```

## How it works

1. **Rig**: an artist-made rig (FBX or GLB). Bones must sit inside the body and the creature
   should face +Z (glTF convention). No auto-rigging.
2. **Two cameras in one picture**: the start frame shows the creature from the front (left) and
   the side (right). Generating both views in a single clip keeps them in sync; two separate
   generations never match. The video model must keep the cameras locked.
3. **Synthetic training data**: three.js renders the rig in random poses inside each joint's
   limits from both cameras, under even all-round lighting with mild variation. Half the samples
   are motion blurred, and every image is degraded (desaturation, blur, noise, JPEG) like
   generated video. Labels are exact because we posed the model.
4. **Detector**: DINOv2 ViT-S/14 features plus a small heatmap head, trained once per monster.
   By default DINO stays frozen and its features are cached, so it trains on CPU.
5. **Solve**: detect joints in each view, triangulate them in 3D, reject the clip if the two
   views disagree, fit rotations on the rig with the rig's own bone lengths, then refine
   those rotations directly against the 2D detections in both views (robust loss, temporal
   smoothing) so a joint hidden in one view is placed by the other view plus the skeleton.
6. **Exam**: an invented random motion whose every joint position is known. Every change to
   the pipeline and every new monster must pass it.

## Setup

```bash
pip install -r requirements.txt
python -m playwright install chromium   # skip if Chromium is already provided
```

DINOv2 is loaded from a local clone (`~/.cache/creature_pipeline/dinov2`, cloned on first use,
or set `DINOV2_REPO`).

## Usage

```bash
P="python -m creature_pipeline"
$P skeleton rig.fbx -o skeleton.json                       # then edit joint limits if needed
$P synth --rig rig.fbx --skeleton skeleton.json -o data --poses 3000
$P train data -o detector.pt                               # --input-size 448 sharper, --finetune on GPU
$P start-frame --rig rig.fbx --skeleton skeleton.json -o start_frame.png --layout layout.json
$P prompt "BITE: the creature lunges forward and snaps its jaws twice"   # prompt for the video model
#   generate clips from start_frame.png with that prompt (idle, walk in place, attack, ...)
$P exam --skeleton skeleton.json --rig rig.fbx --detector detector.pt --layout layout.json
$P solve walk.mp4 --skeleton skeleton.json --detector detector.pt --layout layout.json \
        --target rig.fbx -o walk.glb
```

`solve` exits with code 2 when the two views disagree: regenerate the clip instead of fixing it.

Clips must contain the creature and nothing else. Anything extra the video model draws (lightning,
impact flashes, debris, a shockwave) is a mismatch between the views and fails the check even when the
body motion is right, so `prompt` always appends a subject-only clause. Add attack effects in the game.

### Joint limits

`python -m creature_pipeline skeleton rig.fbx --anatomical-limits` sets limits from bone names
(`limits.py`): the jaw only hinges open, knees are near-hinges, tails bend but do not twist,
`*_nub` tip bones are locked. The solver treats them as hard limits on every non-root joint,
which removes sideways jaw wobble and twisting tails or feet that the cameras cannot see.

`skeleton.json` holds per-joint `limits` in degrees for X, Y and Z, measured in world-aligned
rest frames (X across the body, Y up, Z forward). X is the main swing for legs, spine and tail.
Defaults are ±40° on X and ±15° on Y and Z, and the root gets ±10° pitch, ±30° yaw and ±8° roll.
Tighten them to match the creature (for example knees that only bend one way): the training poses
and the exam both sample inside these limits.

### Playing clips in three.js

```js
const model = await new FBXLoader().loadAsync("rig.fbx");      // or the GLB of the model
const clip = (await new GLTFLoader().loadAsync("walk.glb")).animations[0];
const mixer = new THREE.AnimationMixer(model);
mixer.clipAction(clip).play();
```

Tracks bind to bones by name. For an FBX loaded directly, pass `--target rig.fbx` to `solve`
so the root track uses the file's units and axes. For a GLB model in metres with Y up, omit it.

## Results on the first monster (26-bone quadruped, Wan 3.0 Prime clips)

- Detector: DINOv2 ViT-S/14 fine-tuned at 448px for 15 epochs on 6000 renders (RTX 3090,
  ~1 h, ~$0.20). Validation error 1.95% of image width; median 3.4 px on the exam.
- Exam (invented motion, 96 frames): 3.8% of body height mean joint error with refinement
  (5.7% without). Target is 3%. Worst joints are the tail tip (hidden from the front) and
  far-side feet (hidden from the side camera).
- Idle, walk and attack clips all passed the view-agreement check and solved cleanly.

## Limits

- With a front and a side camera only the vertical axis is seen twice, so the view-agreement
  check catches height mismatches but not a left/right leg swap in one view.
- A limb hidden behind the body in both views is guessed by the detector.
- Twist along a single bone is not observable from joint positions and stays at rest.

## Tests

```bash
python -m pytest tests
```

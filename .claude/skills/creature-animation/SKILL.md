---
name: creature-animation
description: Generate creature animation clips with a video model (Higgsfield, Wan 3.0 Prime two-view clips) and turn them into rig animations with the creature pipeline in keecity/node-socket.io (pipeline/), renting a Vast.ai GPU for detector training. Use when asked to make, generate or solve animations/clips for a monster or creature, or to train its joint detector. The user supplies the rig, the action list and any rules (speeds, trims, which clips); this skill only covers how to carry the work out.
---

# Creature animation: generate clips, train on a GPU, solve

The user gives the rig, the actions and the rules. Follow their rules over anything here. This
skill is the how-to only: never invent actions, rates, trims or reuse clips on your own.

## 0. Get the code

The pipeline lives in `keecity/node-socket.io`, folder `pipeline/` (branch `claude/lucid-bohr-slx95y`
unless the user names another). If it is not in the session, attach it (`add_repo`) and clone it.
Read `pipeline/README.md` once; `python -m creature_pipeline <cmd> --help` lists every option.

```bash
cd pipeline && pip install -r requirements.txt     # Chromium is usually pre-installed
P="python -m creature_pipeline"
```

Work files (renders, videos, keys, motions) go in the scratchpad, never in the repo.

## 1. Start frame (one image, both views)

```bash
$P skeleton rig.fbx -o skeleton.json
$P start-frame --rig rig.fbx --skeleton skeleton.json -o start_frame.png --layout layout.json
```

The frame shows the creature front view (left) and side view (right) in one 16:9 picture.
`layout.json` holds the camera geometry; keep it, `solve` needs the same file.

## 2. Generate the clips (Higgsfield)

1. Upload the start frame: `mcp__Higgsfield__media_upload` (filename, content_type) returns a
   presigned PUT URL and a media id; `curl -X PUT -H "Content-Type: image/png" --data-binary @start_frame.png "<url>"`,
   then `media_confirm`.
2. Build each prompt with the pipeline so the wording stays consistent:
   `$P prompt "BITE: the creature lunges forward and snaps its jaws twice"`
   Pass the user's action description; the command wraps it with the split-screen, locked-camera,
   subject-only text. Do not add effects (lightning, dust, flashes): extra things in frame break
   the two-view check.
3. Generate with `mcp__Higgsfield__generate_video_batch` (one request per action):
   `model: "wan3_0_prime"`, `prompt` from step 2, `medias: [{value: <start frame media id>, role: start image}]`.
   Check `balance` first and tell the user the credit cost before a large batch. Wait with
   `jobs_wait`, then download each result mp4 to the scratchpad.
4. Look at each clip before using it (extract a few frames with ffmpeg): both panels must show
   the same motion, the cameras must not move, the creature must stay in frame.

## 3. Train the detector (once per monster) on a rented GPU

Make the training data locally (CPU is fine):

```bash
$P synth --rig rig.fbx --skeleton skeleton.json -o data --poses 3000   # --acrobatic for spins/flips/jumps
```

Training at `--input-size 448 --finetune` needs a GPU. Use Vast.ai through its REST API.

**Key**: if the environment has a Vast network secret (Authorization: Bearer added automatically
to requests for `console.vast.ai`), call the API with no auth header and `K` unset. Otherwise ask
the user to add one (environment settings, Network secrets: host `console.vast.ai`, header
`Authorization`, prefix `Bearer`); never ask for the key in chat, never commit or print it.
Do not touch instances you did not create in this session (list first; leave the others alone).

**Moving files** (the GPU host cannot reach this container):
- Job in: zip `pipeline/` (without `__pycache__`), `data/train/{images,labels.json}` and a `run.sh`;
  get two upload slots with `mcp__Higgsfield__media_upload` (`creature_job.zip`,
  `creature_result.zip`); PUT the job zip to the first. Its public download URL is what the
  instance fetches.
- Result out: pass the second slot's presigned PUT URL to the instance as env `RESULT_URL`;
  `run.sh` ends by zipping `detector.pt` + the log and `curl -X PUT -H "Content-Type: application/zip" --data-binary @result.zip "$RESULT_URL"`.
  Presigned URLs expire (24 h): make new ones per job.

`run.sh` (runs on the instance):
```bash
#!/bin/bash
cd /workspace/job || exit 1
pip install -q pillow
git clone -q --depth 1 https://github.com/facebookresearch/dinov2.git ~/.cache/creature_pipeline/dinov2
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
cd pipeline && pip install -q -r requirements.txt
python -u -W ignore -m creature_pipeline train ../data/train -o ../detector.pt --input-size 448 --epochs 12 --finetune 2>&1 | tee ../train.log
cd .. && python -c "import zipfile; z=zipfile.ZipFile('result.zip','w'); [z.write(f) for f in ('detector.pt','train.log')]"
curl -sS -X PUT -H "Content-Type: application/zip" --data-binary @result.zip "$RESULT_URL"
```

**Find an offer** (single RTX 3090/4090/A5000, reliable, driver <= 560 — newer drivers have
failed with the pytorch 2.5.1 / CUDA 12.4 image):
```bash
curl -sS -G https://console.vast.ai/api/v0/bundles/ --data-urlencode \
 'q={"rentable":{"eq":true},"num_gpus":{"eq":1},"gpu_name":{"in":["RTX 4090","RTX 3090","RTX A5000"]},"reliability2":{"gte":0.99},"inet_down":{"gte":300},"disk_space":{"gte":40},"driver_version":{"lte":"560.99.99"},"order":[["dph_total","asc"]],"type":"on-demand","limit":6}'
```
Check credit first: `GET /api/v0/users/current/` (field `credit`). Tell the user the hourly price.

**Rent** (`PUT /api/v0/asks/<offer id>/`) with body:
```json
{"client_id":"me","image":"pytorch/pytorch:2.5.1-cuda12.4-cudnn9-devel","disk":40,"runtype":"args",
 "label":"creature-detector-train","env":{"RESULT_URL":"<presigned PUT>"},
 "args":["bash","-c","set -x; export DEBIAN_FRONTEND=noninteractive; command -v git >/dev/null || (apt-get update -qq && apt-get install -y -qq git curl); mkdir -p /workspace/job && cd /workspace/job && curl -sSL -o job.zip '<job zip URL>' && python -c \"import zipfile; zipfile.ZipFile('job.zip').extractall('.')\" && bash run.sh; sleep 600"]}
```
If an offer is gone or the instance never starts, destroy it and try the next offer.

**Watch**: `GET /api/v0/instances/<id>/` (`actual_status`, `status_msg`); logs via
`PUT /api/v0/instances/request_logs/<id>/` with `{"tail":"40"}`, then fetch the returned
`result_url`. Check every few minutes (use a background wait, not tight polling).

**Always destroy** the instance when the result is uploaded or the job fails:
`DELETE /api/v0/instances/<id>/`. Confirm it is gone, report the cost.

Then download the result zip from the upload slot and unzip `detector.pt` into the scratchpad.

## 4. Check, solve, export

```bash
$P exam --skeleton skeleton.json --rig rig.fbx --detector detector.pt --layout layout.json   # accuracy gate
$P solve clip.mp4 --skeleton skeleton.json --detector detector.pt --layout layout.json --target rig.fbx -o clip.glb
```
`solve` exits with code 2 when the two views disagree: regenerate that clip, do not force it.
`--motion out.npz` keeps the solved motion for `pack`. For a game package use
`$P pack --skeleton ... --animset <user's animset.json> --motion-dir ... --target rig.fbx -o <dir> --registry ... --log ...`
with the user's animset (their rules for rates, windows and which clips exist).

Show the user a side-by-side check (generated video | solved clip) before calling a clip done.
Commit pipeline changes to the user's branch; never commit keys, videos or rented-host details.

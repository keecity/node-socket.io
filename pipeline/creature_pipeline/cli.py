"""Command line: python -m creature_pipeline <command> ...

  skeleton     rig (.fbx/.glb) -> skeleton.json (edit joint limits there)
  synth        render random training poses from the rig
  train        train the per-monster joint detector
  exam         invented-motion exam (simulated detector, or real detector on rendered frames)
  start-frame  render the two-view start image for the video model, plus its layout/cameras
  solve        generated clip -> checked, solved animation GLB for three.js
"""
import argparse
import json
import os
import sys

import numpy as np

def load_skeleton(path):
    from .skeleton import Skeleton
    ext = os.path.splitext(path)[1].lower()
    if ext == ".json":
        return Skeleton.load(path)
    if ext == ".fbx":
        from .fbx import skeleton_from_fbx
        return skeleton_from_fbx(path)
    from .gltf import skeleton_from_gltf
    return skeleton_from_gltf(path)


def cmd_skeleton(a):
    skel = load_skeleton(a.rig)
    if a.anatomical_limits:
        from .limits import apply
        matched = apply(skel)
        print(f"anatomical limits set on {len(matched)} bones; unmatched bones keep defaults")
    skel.save(a.out)
    print(f"{len(skel)} joints, rest extent {skel.extent():.3f} m -> {a.out}")


def cmd_synth(a):
    from .synth import generate
    generate(load_skeleton(a.skeleton), a.rig, a.out, n_poses=a.poses, size=a.size, seed=a.seed)


def cmd_train(a):
    from .detector import train
    train(a.data, a.out, size=a.input_size, epochs=a.epochs, finetune=a.finetune, backbone_name=a.backbone)


def cmd_start_frame(a):
    from PIL import Image
    import io
    from .cameras import stereo_rig
    from .synth import Renderer
    from .video import compose, default_layout, save_layout
    from . import quat
    skel = load_skeleton(a.skeleton)
    layout = default_layout(a.width, a.height)
    side = layout["views"][0][2]
    render_cams = stereo_rig(skel.extent(), side, side, margin=a.margin, center=skel.center())
    from .synth import even_look
    look = even_look(float(skel.rest_positions[:, 1].min() - 0.01 * skel.height()))
    with Renderer(skel, a.rig, side) as r:
        pngs = r.render(render_cams, [(quat.identity(len(skel)), skel.rest_positions[0])], look)
    bg = tuple(int(255 * c) for c in look["background"])
    compose([Image.open(io.BytesIO(p)).convert("RGB") for p in pngs], layout, bg).save(a.out)
    det_cams = stereo_rig(skel.extent(), a.view_size, a.view_size, margin=a.margin, center=skel.center())
    save_layout(layout, det_cams, a.layout)
    print(f"start frame -> {a.out}, layout + cameras -> {a.layout}")


def cmd_exam(a):
    from .cameras import stereo_rig
    from .exam import run_exam
    from .motion import random_motion
    skel = load_skeleton(a.skeleton)
    rng = np.random.default_rng(a.seed)
    local, root, _ = random_motion(skel, rng, frames=a.frames, travel=a.travel * skel.extent())
    if a.detector:
        from .detector import Detector
        from .synth import render_motion
        from .video import load_layout
        _, cams = load_layout(a.layout)
        frames_dir = a.frames_dir or "exam_frames"
        render_motion(skel, a.rig, local, root, frames_dir, size=cams[0].width, cams=cams)
        det = Detector(a.detector)
        kp = _detect_dir(det, frames_dir, len(cams), cams[0].width)
        refine_2d = True
    else:
        cams = stereo_rig(skel.extent(), 448, 448, center=skel.center())
        kp = None
        refine_2d = False
    result = run_exam(skel, cams, local, root, keypoints=kp, rng=rng, pass_pct_height=a.pass_pct, refine_2d=refine_2d)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["passed"] else 1)


def _detect_dir(det, frames_dir, n_views, size):
    from PIL import Image
    files = sorted(f for f in os.listdir(frames_dir) if f.endswith(".png"))
    frames = np.stack([np.asarray(Image.open(os.path.join(frames_dir, f)).convert("RGB")) for f in files])
    views = [frames[:, :, k * size:(k + 1) * size] for k in range(n_views)]
    return np.stack([det(v) for v in views])


def cmd_solve(a):
    from .detector import Detector
    from .exam import solve
    from .gltf import write_animation_glb
    from .video import load_layout, read_frames, split_views
    skel = load_skeleton(a.skeleton)
    layout, cams = load_layout(a.layout)
    frames, fps = read_frames(a.video, a.fps)
    views = split_views(frames, layout, cams[0].width)
    det = Detector(a.detector)
    kp = np.stack([det(v) for v in views])
    from .exam import CLIP_REFINE
    opts = dict(CLIP_REFINE, key_every=a.key_every, keys_only=a.keys_only)
    local, root, report = solve(skel, cams, kp, sigma_frames=a.smooth, refine_2d=not a.no_refine, refine_opts=opts)
    report["frames"] = len(frames)
    report["fps"] = fps
    print(json.dumps(report, indent=2))
    if not report["ok"] and not a.force:
        print("clip rejected: regenerate it (or pass --force to export anyway)", file=sys.stderr)
        sys.exit(2)
    root_space = None
    if a.target and a.target.lower().endswith(".fbx"):
        from .fbx import root_parent_space
        root_space = root_parent_space(a.target)
    write_animation_glb(a.out, skel, local, root, fps, root_space=root_space,
                        clip_name=a.name or os.path.splitext(os.path.basename(a.video))[0])
    if a.keypoints:
        np.save(a.keypoints, kp)
    print(f"animation -> {a.out}")


def main(argv=None):
    p = argparse.ArgumentParser(prog="creature_pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("skeleton")
    s.add_argument("rig")
    s.add_argument("-o", "--out", default="skeleton.json")
    s.add_argument("--anatomical-limits", action="store_true",
                   help="set per-joint limits from bone names (jaw hinge, knee hinge, no tail twist, ...)")
    s.set_defaults(fn=cmd_skeleton)

    s = sub.add_parser("synth")
    s.add_argument("--rig", required=True, help="rigged model (.fbx or .glb) to render")
    s.add_argument("--skeleton", required=True, help="skeleton.json (limits) or the rig itself")
    s.add_argument("-o", "--out", required=True)
    s.add_argument("--poses", type=int, default=3000)
    s.add_argument("--size", type=int, default=448)
    s.add_argument("--seed", type=int, default=0)
    s.set_defaults(fn=cmd_synth)

    s = sub.add_parser("train")
    s.add_argument("data")
    s.add_argument("-o", "--out", default="detector.pt")
    s.add_argument("--input-size", type=int, default=224, help="DINO input side (multiple of 14); 448 is sharper, ~6x slower")
    s.add_argument("--epochs", type=int, default=15)
    s.add_argument("--backbone", default="dinov2_vits14")
    s.add_argument("--finetune", action="store_true", help="also train DINO's last blocks (GPU)")
    s.set_defaults(fn=cmd_train)

    s = sub.add_parser("start-frame")
    s.add_argument("--rig", required=True)
    s.add_argument("--skeleton", required=True)
    s.add_argument("-o", "--out", default="start_frame.png")
    s.add_argument("--layout", default="layout.json")
    s.add_argument("--width", type=int, default=1600)
    s.add_argument("--height", type=int, default=900)
    s.add_argument("--view-size", type=int, default=448, help="detector view size (match synth --size)")
    s.add_argument("--margin", type=float, default=1.5)
    s.set_defaults(fn=cmd_start_frame)

    s = sub.add_parser("exam")
    s.add_argument("--skeleton", required=True)
    s.add_argument("--rig", help="needed with --detector to render the exam motion")
    s.add_argument("--detector")
    s.add_argument("--layout", default="layout.json")
    s.add_argument("--frames", type=int, default=120)
    s.add_argument("--frames-dir")
    s.add_argument("--travel", type=float, default=0.3, help="root speed in body lengths per second")
    s.add_argument("--pass-pct", type=float, default=3.0, help="max mean joint error, % of body height")
    s.add_argument("--seed", type=int, default=0)
    s.set_defaults(fn=cmd_exam)

    s = sub.add_parser("solve")
    s.add_argument("video")
    s.add_argument("--skeleton", required=True)
    s.add_argument("--detector", required=True)
    s.add_argument("--layout", default="layout.json")
    s.add_argument("-o", "--out", default="animation.glb")
    s.add_argument("--name")
    s.add_argument("--fps", type=float)
    s.add_argument("--smooth", type=float, default=1.0, help="temporal smoothing sigma in frames")
    s.add_argument("--no-refine", action="store_true", help="skip fitting the rig directly to the 2D detections")
    s.add_argument("--key-every", type=int, help="solve keys every n frames, curve in between")
    s.add_argument("--keys-only", action="store_true", help="with --key-every, use only the key frames' detections")
    s.add_argument("--target", help="model the game plays the clip on; for an .fbx the root track is written in its units/axes")
    s.add_argument("--keypoints", help="also save raw detections (.npy)")
    s.add_argument("--force", action="store_true")
    s.set_defaults(fn=cmd_solve)

    a = p.parse_args(argv)
    a.fn(a)

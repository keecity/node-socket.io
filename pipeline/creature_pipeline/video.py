"""Video I/O and the composite layout shared by the start frame and solving.

Video models output 16:9, so the start frame is a 16:9 canvas holding the two square views
side by side with bars above and below. The layout records where each view sits so a
generated clip of any resolution can be cut back into the two camera views.
"""
import json
import subprocess

import numpy as np


def default_layout(canvas_w=1600, canvas_h=900):
    side = canvas_w // 2
    top = (canvas_h - side) // 2
    return {"canvas": [canvas_w, canvas_h], "views": [[0, top, side, side], [side, top, side, side]]}


def save_layout(layout, cams, path):
    with open(path, "w") as f:
        json.dump({"layout": layout, "cameras": [c.to_dict() for c in cams]}, f, indent=2)


def load_layout(path):
    from .cameras import Camera
    with open(path) as f:
        d = json.load(f)
    return d["layout"], [Camera.from_dict(c) for c in d["cameras"]]


def compose(views, layout, background=(0, 0, 0)):
    """Paste per-camera PIL images into the canvas."""
    from PIL import Image
    canvas = Image.new("RGB", tuple(layout["canvas"]), background)
    for img, (x, y, w, h) in zip(views, layout["views"]):
        canvas.paste(img.resize((w, h)), (x, y))
    return canvas


def read_frames(path, fps=None):
    """Decode a video with ffmpeg -> uint8 (T, H, W, 3) and its frame rate."""
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                            "stream=width,height,r_frame_rate", "-of", "json", path],
                           capture_output=True, text=True, check=True)
    s = json.loads(probe.stdout)["streams"][0]
    w, h = s["width"], s["height"]
    num, den = s["r_frame_rate"].split("/")
    src_fps = float(num) / float(den)
    cmd = ["ffmpeg", "-v", "error", "-i", path]
    if fps:
        cmd += ["-vf", f"fps={fps}"]
    cmd += ["-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)
    return frames, (fps or src_fps)


def split_views(frames, layout, view_size):
    """(T, H, W, 3) clip -> list per camera of (T, view_size, view_size, 3), scaling the layout to the clip."""
    from PIL import Image
    H, W = frames.shape[1:3]
    cw, ch = layout["canvas"]
    sx, sy = W / cw, H / ch
    out = []
    for x, y, w, h in layout["views"]:
        box = (round(x * sx), round(y * sy), round((x + w) * sx), round((y + h) * sy))
        out.append(np.stack([np.asarray(Image.fromarray(f).crop(box).resize((view_size, view_size)))
                             for f in frames]))
    return out

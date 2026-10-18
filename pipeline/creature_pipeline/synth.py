"""Synthetic training data: render the creature in random poses from both rig cameras.

The browser page (viewer/render.html) draws pixels with three.js, on any GPU or software
GL. Python owns the poses, so the labels are exact: we posed the model, we know where
every joint is. About half the samples are motion-blurred (several sub-frames between two
poses averaged), then every image is degraded a little the way generated video is.
"""
import base64
import io
import json
import mimetypes
import os
import urllib.request

import numpy as np

from . import quat
from .cameras import stereo_rig

HERE = os.path.dirname(os.path.abspath(__file__))
RENDER_HTML = os.path.join(HERE, "..", "viewer", "render.html")
CDN = "https://cdn.jsdelivr.net/"
CACHE = os.path.join(os.path.expanduser("~"), ".cache", "creature_pipeline", "cdn")


def umeyama(src, dst):
    """Similarity (scale s, rotation R, translation t) minimising |s R src + t - dst|."""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    a, b = src - mu_s, dst - mu_d
    u, d, vt = np.linalg.svd(b.T @ a / len(src))
    S = np.eye(3)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        S[2, 2] = -1
    R = u @ S @ vt
    s = np.trace(np.diag(d) @ S) / a.var(0).sum()
    M = np.eye(4)
    M[:3, :3] = s * R
    M[:3, 3] = mu_d - s * R @ mu_s
    return M


def camera_for_three(cam):
    eye = cam.center
    fov_y = float(np.degrees(2 * np.arctan(cam.height / 2 / cam.K[1, 1])))
    return {"position": eye.tolist(), "target": (eye + cam.R[2]).tolist(), "up": (-cam.R[1]).tolist(), "fov_y": fov_y}


def _direction(rng, azimuth, elevation):
    az, el = np.radians(azimuth), np.radians(elevation)
    return [float(np.cos(el) * np.sin(az)), float(np.sin(el)), float(np.cos(el) * np.cos(az))]


def _tint(rng, spread):
    return np.clip(1 + rng.uniform(-spread, spread, 3), 0, 1.2).tolist()


# Directions of the six fill lights: front, back, left, right, top, below.
LIGHT_DIRS = [(0, 0.35, 1), (0, 0.35, -1), (-1, 0.35, 0), (1, 0.35, 0), (0, 1, 0), (0, -1, 0.2)]
LIGHT_LEVELS = [1.0, 0.8, 0.9, 0.9, 1.0, 0.35]


def even_look(ground_y, brightness=1.0, tint=(1.0, 1.0, 1.0), background=(0.62, 0.64, 0.68),
              ground=(0.45, 0.43, 0.4), rng=None, wobble=0.0):
    """Shadowless all-round lighting. ``wobble`` varies each light a little (training only)."""
    lights = []
    for d, level in zip(LIGHT_DIRS, LIGHT_LEVELS):
        k = 1.0 + (rng.uniform(-wobble, wobble) if rng is not None else 0.0)
        lights.append({"color": list(tint), "intensity": float(1.1 * level * k * brightness),
                       "dir": (np.array(d) / np.linalg.norm(d)).tolist()})
    return {"background": list(background), "ground": list(ground), "ground_y": float(ground_y),
            "exposure": float(brightness), "hemi": 1.0 * brightness, "ambient": 0.5 * brightness, "lights": lights}


def random_look(rng, ground_y):
    """Training variation stays mild: brightness +-20%, slight colour tint, per-light +-25%."""
    return even_look(ground_y, brightness=float(rng.uniform(0.8, 1.2)),
                     tint=np.clip(1 + rng.uniform(-0.08, 0.08, 3), 0, 1).tolist(),
                     background=rng.uniform(0.05, 0.95, 3).tolist(), ground=rng.uniform(0.1, 0.9, 3).tolist(),
                     rng=rng, wobble=0.25)


def degrade(png_bytes, rng):
    """Mimic generated-video artefacts: desaturation, softness, sensor noise, compression."""
    from PIL import Image, ImageEnhance, ImageFilter
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    img = ImageEnhance.Color(img).enhance(rng.uniform(0.6, 1.1))
    img = ImageEnhance.Contrast(img).enhance(rng.uniform(0.8, 1.15))
    if rng.random() < 0.5:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.2)))
    a = np.asarray(img).astype(np.float32) + rng.normal(0, rng.uniform(0, 6), (img.height, img.width, 3))
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=int(rng.uniform(55, 92)))
    return buf.getvalue()


def _route(page, model_path, files):
    def handle(route):
        url = route.request.url
        if url.startswith("http://cp.local/files/"):
            name = url[len("http://cp.local/files/"):]
            if name in files:
                return route.fulfill(path=files[name], content_type="application/octet-stream")
        if url == "http://cp.local/render.html":
            return route.fulfill(path=RENDER_HTML, content_type="text/html")
        if url.startswith("http://cp.local/model"):
            return route.fulfill(path=model_path, content_type="application/octet-stream")
        if url.startswith(CDN):
            local = os.path.join(CACHE, url[len(CDN):].replace("/", os.sep))
            if not os.path.exists(local):
                os.makedirs(os.path.dirname(local), exist_ok=True)
                with urllib.request.urlopen(url) as r, open(local, "wb") as f:
                    f.write(r.read())
            ctype = mimetypes.guess_type(local)[0] or "application/javascript"
            return route.fulfill(path=local, content_type=ctype, headers={"Access-Control-Allow-Origin": "*"})
        return route.abort()
    page.route("**/*", handle)


class Renderer:
    """Context manager around a headless browser page holding the posed model."""

    def __init__(self, skel, model_path, size=448, headless=True):
        self.skel, self.model_path, self.size, self.headless = skel, model_path, size, headless
        self.files = {}  # extra files served at http://cp.local/files/<name>

    def __enter__(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        args = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
        self.browser = self._pw.chromium.launch(headless=self.headless, args=args)
        self.page = self.browser.new_page()
        self.page.on("pageerror", lambda e: print("page error:", e))
        _route(self.page, self.model_path, self.files)
        self.page.goto("http://cp.local/render.html")
        self.page.wait_for_function("window.cpReady === true")
        ext = os.path.splitext(self.model_path)[1].lower()
        rest3 = self.page.evaluate("([u, s]) => cp.load(u, s)", [f"http://cp.local/model{ext}", self.size])
        missing = [n for n in self.skel.names if _sanitize(n) not in rest3]
        if missing:
            raise ValueError(f"bones not found in the model: {missing}")
        src = np.array([rest3[_sanitize(n)] for n in self.skel.names])
        M = umeyama(src, self.skel.rest_positions)
        aligned = self.page.evaluate("([m, n]) => cp.align(m, n)", [M.T.flatten().tolist(), self.skel.names])
        got = np.array([aligned[n] for n in self.skel.names])
        self.alignment_error = float(np.abs(got - self.skel.rest_positions).max())
        if self.alignment_error > 0.02 * max(self.skel.height(), 1e-6):
            raise ValueError(f"model bones do not match the skeleton (max {self.alignment_error:.4f} m off)")
        return self

    def __exit__(self, *exc):
        self.browser.close()
        self._pw.stop()

    def play_clip(self, glb_path, times):
        """Play an exported clip on the model in three.js; bone world positions (len(times), J, 3)."""
        self.files["clip.glb"] = glb_path
        pos = self.page.evaluate("([u, n, t]) => cp.playClip(u, n, t)",
                                 ["http://cp.local/files/clip.glb", self.skel.names, list(times)])
        return np.array(pos)

    def render(self, cams, subframes, look):
        """subframes: list of (global_rot (J,4), root (3,)). Returns list of PNG bytes, one per camera."""
        self.page.evaluate("look => cp.setLook(look)", look)
        poses = [{"names": self.skel.names, "glob": g.tolist(), "root": r.tolist()} for g, r in subframes]
        b64 = self.page.evaluate("([c, p]) => cp.render(c, p)", [[camera_for_three(c) for c in cams], poses])
        return [base64.b64decode(s) for s in b64]


def _sanitize(name):
    # three.js PropertyBinding.sanitizeNodeName: whitespace -> "_", reserved chars removed
    import re
    return re.sub(r"[\[\]\.:\/]", "", re.sub(r"\s", "_", name))


def sample_pose(skel, rng, blur, n_sub=6, acrobatic=False):
    """Random pose inside joint limits; with blur, a short sweep towards a second pose.

    ``acrobatic`` covers spins, flips and jumps: the whole body turns to any heading, tips up to
    35 deg nose up/down and 20 deg sideways, and is lifted off the floor in half the samples;
    a blurred sample also spins up to 60 deg during the exposure.
    """
    lo, hi = skel.limits[..., 0], skel.limits[..., 1]
    a = lo + (hi - lo) * rng.random(lo.shape)
    root = int(np.flatnonzero(skel.parents < 0)[0])
    if acrobatic:
        a[root] = np.radians([rng.uniform(-35, 35), rng.uniform(-180, 180), rng.uniform(-20, 20)])
    if blur:
        b = np.clip(a + (hi - lo) * rng.uniform(-0.25, 0.25, lo.shape), lo, hi)
        if acrobatic:
            b[root] = a[root] + np.radians([rng.uniform(-10, 10), rng.uniform(-60, 60), rng.uniform(-5, 5)])
        eulers = [a + (b - a) * k / (n_sub - 1) for k in range(n_sub)]
    else:
        eulers = [a]
    root_jitter = rng.normal(0, 0.03 * skel.height(), 3)
    if acrobatic and rng.random() < 0.5:
        root_jitter[1] += rng.uniform(0.05, 0.6) * skel.height()
    subs = []
    for e in eulers:
        local = quat.from_euler_xyz(e)[None]
        root = (skel.rest_positions[0] + root_jitter)[None]
        pos, glob = skel.forward(local, root)
        subs.append((pos[0], glob[0], root[0]))
    return subs


def generate(skel, model_path, out_dir, n_poses=3000, size=448, blur_fraction=0.5, seed=0, margin=1.5,
             zoom_jitter=0.15, acrobatic=False, log=print):
    """Each sample re-frames the rig by up to +-zoom_jitter so small framing drift in generated video is covered."""
    rng = np.random.default_rng(seed)
    os.makedirs(os.path.join(out_dir, "images"), exist_ok=True)
    ground_y = skel.rest_positions[:, 1].min() - 0.01 * skel.height()
    items = []
    with Renderer(skel, model_path, size) as r:
        log(f"model aligned to skeleton (max error {r.alignment_error * 1000:.1f} mm)")
        for i in range(n_poses):
            m = margin * rng.uniform(1 - zoom_jitter, 1 + zoom_jitter)
            cams = stereo_rig(skel.extent(), size, size, margin=m, center=skel.center())
            subs = sample_pose(skel, rng, rng.random() < blur_fraction, acrobatic=acrobatic)
            label_pos = subs[len(subs) // 2][0]
            pngs = r.render(cams, [(g, root) for _, g, root in subs], random_look(rng, ground_y))
            for cam, png in zip(cams, pngs):
                rel = f"images/{i:06d}_{cam.name}.jpg"
                with open(os.path.join(out_dir, rel), "wb") as f:
                    f.write(degrade(png, rng))
                uv, depth = cam.project(label_pos)
                inside = (uv[:, 0] >= 0) & (uv[:, 0] < size) & (uv[:, 1] >= 0) & (uv[:, 1] < size) & (depth > 0)
                items.append({"image": rel, "uv": uv.round(2).tolist(), "visible": inside.astype(int).tolist(),
                              "width": size, "height": size, "blur": len(subs) > 1})
            if (i + 1) % 100 == 0:
                log(f"rendered {i + 1}/{n_poses}")
    with open(os.path.join(out_dir, "labels.json"), "w") as f:
        json.dump({"joints": skel.names, "items": items}, f)
    return items


def render_motion(skel, model_path, local, root, out_dir, size=448, cams=None, seed=0, margin=1.5):
    """Render a known motion (e.g. the exam) as side-by-side frames for detector evaluation."""
    from PIL import Image
    rng = np.random.default_rng(seed)
    cams = cams or stereo_rig(skel.extent(), size, size, margin=margin, center=skel.center())
    os.makedirs(out_dir, exist_ok=True)
    pos, glob = skel.forward(local, root)
    look = random_look(rng, skel.rest_positions[:, 1].min() - 0.01 * skel.height())
    with Renderer(skel, model_path, size) as r:
        for t in range(len(local)):
            pngs = r.render(cams, [(glob[t], root[t])], look)
            halves = [Image.open(io.BytesIO(degrade(p, rng))) for p in pngs]
            frame = Image.new("RGB", (size * len(halves), size))
            for k, h in enumerate(halves):
                frame.paste(h, (k * size, 0))
            frame.save(os.path.join(out_dir, f"{t:05d}.png"))
    return pos

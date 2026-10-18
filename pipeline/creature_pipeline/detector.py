"""Per-monster joint detector: frozen DINOv2 features + a small heatmap head.

Train once per monster on synthetic renders (see synth.py / viewer/render.html). Two modes:
  * frozen (default, CPU friendly): DINO runs once over every image, features are cached
    to disk, and only the head trains.
  * finetune (GPU): additionally unfreezes DINO's last ``unfreeze_blocks`` blocks.
Inference returns per-view (u, v, confidence) for every joint.
"""
import json
import math
import os

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

PATCH = 14
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)


def load_backbone(name="dinov2_vits14"):
    """DINOv2 via torch.hub, from a local clone when available (set DINOV2_REPO, or it is cloned
    into ~/.cache/creature_pipeline/dinov2); falls back to downloading the hub archive."""
    repo = os.environ.get("DINOV2_REPO", os.path.expanduser("~/.cache/creature_pipeline/dinov2"))
    if not os.path.isdir(repo):
        import subprocess
        try:
            subprocess.run(["git", "clone", "-q", "--depth", "1", "https://github.com/facebookresearch/dinov2.git", repo],
                           check=True)
        except (OSError, subprocess.CalledProcessError):
            return torch.hub.load("facebookresearch/dinov2:main", name, trust_repo=True)
    return torch.hub.load(repo, name, source="local")


class HeatmapHead(nn.Module):
    """Patch features (B, C, h, w) -> joint heatmaps (B, J, 4h, 4w)."""

    def __init__(self, in_dim, joints, width=128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(in_dim, width, 3, padding=1), nn.GELU(),
            nn.ConvTranspose2d(width, width, 4, 2, 1), nn.GELU(),
            nn.ConvTranspose2d(width, width // 2, 4, 2, 1), nn.GELU(),
            nn.Conv2d(width // 2, joints, 1),
        )

    def forward(self, f):
        return self.net(f)


def preprocess(images, size):
    """uint8 (B, H, W, 3) -> normalised float tensor (B, 3, size, size)."""
    x = torch.from_numpy(np.ascontiguousarray(np.stack(list(images)))).permute(0, 3, 1, 2).float() / 255.0
    x = F.interpolate(x, size=(size, size), mode="bilinear", align_corners=False)
    return (x - MEAN) / STD


def patch_features(backbone, x):
    out = backbone.forward_features(x)["x_norm_patchtokens"]  # (B, N, C)
    B, N, C = out.shape
    h = int(math.isqrt(N))
    return out.transpose(1, 2).reshape(B, C, h, h)


def gaussian_targets(uv_norm, vis, side, sigma=1.5):
    """uv in [0,1] (B, J, 2) -> heatmaps (B, J, side, side); invisible joints get all zeros."""
    g = torch.arange(side, dtype=torch.float32, device=uv_norm.device) + 0.5
    u = uv_norm[..., 0:1, None] * side
    v = uv_norm[..., 1:2, None] * side
    hm = torch.exp(-((g.view(1, 1, 1, -1) - u) ** 2 + (g.view(1, 1, -1, 1) - v) ** 2) / (2 * sigma ** 2))
    return hm * vis[..., None, None]


def coord_loss(logits, uv, vis, sigma=2.0):
    """Integral (soft-argmax) regression plus a KL pull towards a Gaussian around the label.

    Plain MSE on sparse heatmaps lets the head sit near all-zeros for a long time; regressing
    the expected coordinate gives every pixel a gradient from the first step.
    """
    B, J, H, W = logits.shape
    logp = F.log_softmax(logits.flatten(2), -1).view_as(logits)
    p = logp.exp()
    xs = (torch.arange(W, device=logits.device).float() + 0.5) / W
    ys = (torch.arange(H, device=logits.device).float() + 0.5) / H
    u = (p.sum(-2) * xs).sum(-1)
    v = (p.sum(-1) * ys).sum(-1)
    w = vis.sum().clamp(min=1)
    l_coord = ((torch.stack([u, v], -1) - uv).abs().sum(-1) * vis).sum() / w
    t = gaussian_targets(uv, torch.ones_like(vis), H, sigma)
    t = t / t.flatten(2).sum(-1).clamp(min=1e-8)[..., None, None]
    kl = ((t * (torch.log(t.clamp(min=1e-8)) - logp)).sum((-1, -2)) * vis).sum() / w
    return 10 * l_coord + kl


def decode(heatmaps, softmax=False):
    """Soft-argmax around the peak. Returns uv in [0,1] (B, J, 2) and confidence (B, J).

    With ``softmax`` the maps are logits from coord_loss training and confidence is the
    probability mass near the peak; otherwise they are regressed heatmaps."""
    if softmax:
        heatmaps = F.softmax(heatmaps.flatten(2), -1).view_as(heatmaps)
    B, J, H, W = heatmaps.shape
    flat = heatmaps.flatten(2)
    conf, idx = flat.max(-1)
    py, px = (idx // W).float(), (idx % W).float()
    # refine with a 5x5 window weighted by positive heat
    ys = torch.arange(H).view(1, 1, H, 1).float()
    xs = torch.arange(W).view(1, 1, 1, W).float()
    window = ((ys - py[..., None, None]).abs() <= 2) & ((xs - px[..., None, None]).abs() <= 2)
    w = heatmaps.clamp(min=0) * window
    s = w.sum((-1, -2)).clamp(min=1e-6)
    u = ((w * xs).sum((-1, -2)) / s + 0.5) / W
    v = ((w * ys).sum((-1, -2)) / s + 0.5) / H
    if softmax:
        conf = s
    return torch.stack([u, v], -1), conf.clamp(0, 1)


# --- dataset -----------------------------------------------------------------
def load_dataset(root):
    """Dataset written by the renderer: images/*.png + labels.json.

    labels.json: {"joints": [names], "items": [{"image": "images/000001_front.png",
                  "uv": [[u, v], ...] (pixels), "visible": [0/1, ...], "width": W, "height": H}]}
    """
    with open(os.path.join(root, "labels.json")) as f:
        meta = json.load(f)
    return meta["joints"], meta["items"]


def _read_image(path):
    from PIL import Image
    return np.asarray(Image.open(path).convert("RGB"))


def _batch(root, items, size):
    imgs = preprocess([_read_image(os.path.join(root, it["image"])) for it in items], size)
    uv, vis = _labels(items)
    return imgs, uv, vis


def _labels(items):
    uv = np.stack([np.array(it["uv"]) / [it["width"], it["height"]] for it in items])
    vis = np.array([it["visible"] for it in items])
    return torch.from_numpy(uv).float(), torch.from_numpy(vis).float()


def cache_features(backbone, root, items, size, device, batch=16):
    path = os.path.join(root, f"features_{size}.pt")
    if os.path.exists(path):
        return torch.load(path)
    feats = []
    backbone.eval().to(device)
    with torch.inference_mode():
        for i in range(0, len(items), batch):
            x, _, _ = _batch(root, items[i:i + batch], size)
            feats.append(patch_features(backbone, x.to(device)).half().cpu())
    feats = torch.cat(feats)
    torch.save(feats, path)
    return feats


def train(root, out_path, size=224, epochs=15, lr=1e-3, batch=32, backbone_name="dinov2_vits14",
          finetune=False, unfreeze_blocks=2, backbone_lr=2e-5, loss="coord", device=None, log=print):
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    joints, items = load_dataset(root)
    backbone = load_backbone(backbone_name)
    head = HeatmapHead(backbone.embed_dim, len(joints)).to(device)
    rng = np.random.default_rng(0)
    order = rng.permutation(len(items))
    n_val = max(1, len(items) // 20)
    val_idx, train_idx = order[:n_val], order[n_val:]

    params = list(head.parameters())
    backbone_params = []
    if finetune:
        backbone.to(device).train()
        for p in backbone.parameters():
            p.requires_grad = False
        for blk in backbone.blocks[-unfreeze_blocks:]:
            for p in blk.parameters():
                p.requires_grad = True
                backbone_params.append(p)
        feats = None
    else:
        feats = cache_features(backbone, root, items, size, device)
    groups = [{"params": params, "lr": lr}]
    if backbone_params:
        groups.append({"params": backbone_params, "lr": backbone_lr})
    opt = torch.optim.AdamW(groups, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, epochs)
    uv_all, vis_all = _labels(items)

    def run(idx, training):
        head.train(training)
        total, n = 0.0, 0
        for i in range(0, len(idx), batch):
            b = idx[i:i + batch]
            if feats is not None:
                f = feats[b].float().to(device)
            else:
                x, _, _ = _batch(root, [items[k] for k in b], size)
                with torch.set_grad_enabled(training):
                    f = patch_features(backbone, x.to(device))
            uv, vis = uv_all[b].to(device), vis_all[b].to(device)
            with torch.set_grad_enabled(training):
                pred = head(f)
                if loss == "coord":
                    loss_v = coord_loss(pred.float(), uv, vis)
                else:
                    target = gaussian_targets(uv, vis, pred.shape[-1]).to(device)
                    loss_v = F.mse_loss(pred, target) * 1000
            if training:
                opt.zero_grad()
                loss_v.backward()
                opt.step()
            with torch.no_grad():
                p_uv, _ = decode(pred.float().cpu(), softmax=loss == "coord")
                err = ((p_uv - uv.cpu()).norm(dim=-1) * vis.cpu()).sum() / vis.sum().clamp(min=1)
            total += float(err) * len(b)
            n += len(b)
        return total / max(n, 1)

    history = []
    for ep in range(epochs):
        tr = run(rng.permutation(train_idx), True)
        va = run(val_idx, False)
        sched.step()
        history.append({"epoch": ep + 1, "train_err": tr, "val_err": va})
        log(f"epoch {ep + 1}/{epochs}  train err {tr * 100:.2f}%  val err {va * 100:.2f}% of image width", flush=True)
    torch.save({"joints": joints, "size": size, "backbone": backbone_name, "head": head.state_dict(), "loss": loss,
                "backbone_state": backbone.state_dict() if finetune else None, "history": history}, out_path)
    return history


class Detector:
    def __init__(self, path, device=None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        ck = torch.load(path, map_location="cpu")
        self.joints, self.size = ck["joints"], ck["size"]
        self.softmax = ck.get("loss", "mse") == "coord"
        self.backbone = load_backbone(ck["backbone"])
        if ck.get("backbone_state"):
            self.backbone.load_state_dict(ck["backbone_state"])
        self.backbone.eval().to(self.device)
        self.head = HeatmapHead(self.backbone.embed_dim, len(self.joints))
        self.head.load_state_dict(ck["head"])
        self.head.eval().to(self.device)

    @torch.inference_mode()
    def __call__(self, images, batch=16):
        """uint8 images (N, H, W, 3) -> (N, J, 3) of (u_px, v_px, confidence)."""
        H, W = images.shape[1:3]
        out = []
        for i in range(0, len(images), batch):
            f = patch_features(self.backbone, preprocess(images[i:i + batch], self.size).to(self.device))
            uv, conf = decode(self.head(f).float().cpu(), softmax=self.softmax)
            out.append(torch.cat([uv * torch.tensor([W, H]), conf[..., None]], -1))
        return torch.cat(out).numpy()

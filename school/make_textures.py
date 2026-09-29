"""Generate the small tileable/decal textures used by build_school.py.  usage: make_textures.py out_dir"""
import sys, os, random, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
random.seed(4)

def brick():
    S = 512; im = Image.new('RGB', (S, S), (238, 216, 176)); d = ImageDraw.Draw(im)
    rows, per = 12, 4; bh = S / rows; bw = S / per
    for r in range(rows):
        off = (bw / 2) if r % 2 else 0
        for c in range(-1, per + 1):
            x0 = c * bw + off + 3; y0 = r * bh + 3
            base = np.array([232, 170, 96]) + np.array([random.randint(-14, 14)] * 3) * [1, 1.2, 1.4]
            d.rounded_rectangle([x0, y0, x0 + bw - 6, y0 + bh - 6], radius=5, fill=tuple(int(np.clip(v, 0, 255)) for v in base))
    im.save(f'{out}/brick.jpg', quality=90)

def wood():
    S = 512; im = Image.new('RGB', (S, S)); d = ImageDraw.Draw(im); pw = S / 7
    for i in range(7):
        y = 0
        while y < S:
            L = random.randint(180, 340); base = random.randint(-14, 14)
            col = (222 + base, 172 + base, 112 + base)
            d.rectangle([(-30 + (i * 97) % 200 + (y if False else 0)), i * pw, S, (i + 1) * pw - 3], fill=col) if False else None
            d.rectangle([0, i * pw, S, (i + 1) * pw - 3], fill=col)
            y = S
        d.line([0, i * pw, S, i * pw], fill=(150, 100, 60), width=3)
    for k in range(40):
        x = random.randint(0, S); y = random.randint(0, S)
        d.line([x, y - 20, x, y + 20], fill=(150, 100, 60), width=2)
    im.save(f'{out}/wood.jpg', quality=90)

def tile():
    S = 512; im = Image.new('RGB', (S, S)); d = ImageDraw.Draw(im); n = 4; s = S / n
    cols = [(250, 245, 232), (150, 205, 235), (250, 215, 110), (140, 210, 150)]
    for i in range(n):
        for j in range(n):
            d.rectangle([i * s, j * s, (i + 1) * s, (j + 1) * s], fill=cols[(i + j) % 2 if (i + j) % 2 == 0 else 1 + (i % 3)] if False else (cols[0] if (i + j) % 2 == 0 else cols[1]))
    for i in range(n + 1):
        d.line([i * s, 0, i * s, S], fill=(200, 200, 190), width=3); d.line([0, i * s, S, i * s], fill=(200, 200, 190), width=3)
    im.save(f'{out}/tile.jpg', quality=90)

def poster(name, kind):
    S = 256; im = Image.new('RGB', (S, S), (255, 255, 255)); d = ImageDraw.Draw(im)
    if kind == 'sun':
        d.rectangle([0, 0, S, S], fill=(255, 226, 120))
        for a in range(0, 360, 30):
            x = S / 2 + 90 * math.cos(math.radians(a)); y = S / 2 + 90 * math.sin(math.radians(a))
            d.line([S / 2, S / 2, x, y], fill=(255, 150, 40), width=12)
        d.ellipse([S / 2 - 60, S / 2 - 60, S / 2 + 60, S / 2 + 60], fill=(255, 170, 30))
    elif kind == 'star':
        d.rectangle([0, 0, S, S], fill=(80, 130, 230))
        pts = []
        for i in range(10):
            r = 100 if i % 2 == 0 else 42; a = math.radians(-90 + i * 36)
            pts.append((S / 2 + r * math.cos(a), S / 2 + r * math.sin(a)))
        d.polygon(pts, fill=(255, 220, 60), outline=(150, 60, 190))
    elif kind == 'abc':
        d.rectangle([0, 0, S, S], fill=(250, 250, 245))
        try: f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 74)
        except Exception: f = ImageFont.load_default()
        for i, (ch, c) in enumerate(zip('ABC', [(230, 60, 60), (60, 140, 230), (250, 190, 40)])):
            d.text((22 + i * 72, 90), ch, fill=c, font=f)
        d.rectangle([0, 0, S - 1, S - 1], outline=(120, 120, 120), width=6)
    else:
        d.rectangle([0, 0, S, S], fill=(250, 240, 225))
        for _ in range(16):
            x = random.randint(20, 230); y = random.randint(20, 230); r = random.randint(18, 42)
            d.ellipse([x - r, y - r, x + r, y + r], fill=random.choice([(240, 80, 80), (80, 170, 240), (250, 200, 50), (110, 200, 120), (170, 100, 220)]))
    im.save(f'{out}/{name}.jpg', quality=90)

def sky():
    W, H = 256, 256; a = np.zeros((H, W, 3), np.uint8)
    for y in range(H):
        t = y / H; a[y, :] = (int(120 + 80 * t), int(170 + 60 * t), int(235 + 15 * t))
    im = Image.fromarray(a); d = ImageDraw.Draw(im)
    for cx, cy, r in [(70, 190, 40), (120, 200, 55), (185, 185, 38)]: d.ellipse([cx - r, cy - r / 2, cx + r, cy + r / 2], fill=(255, 255, 255))
    im.save(f'{out}/sky.jpg', quality=90)

brick(); wood(); tile(); sky()
poster('poster_sun', 'sun'); poster('poster_star', 'star'); poster('poster_abc', 'abc'); poster('poster_art', 'art')
print('textures ->', out)

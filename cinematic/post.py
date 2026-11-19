"""Overlay the evidence-ladder label on the rendered frames, then encode the previews.

python post.py <render_dir> <out_dir>
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

SRC, DST = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(DST, 'frames'), exist_ok=True)
meta = json.load(open(os.path.join(SRC, 'label.json')))
S0, S1 = meta['scan']
track = {int(k): v for k, v in meta['track'].items()}
FONT = ImageFont.truetype('C:/Windows/Fonts/consolab.ttf', 15)
FONT_S = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 13)
STEPS = [  # (from frame, level, text, colour)
    (S0, 'L0', 'OBSERVED', (128, 144, 168)),
    (S0 + 6, 'L1', 'SUSPECTED', (255, 176, 46)),
    (S0 + 12, 'L2', 'REPRODUCED', (0, 240, 255)),
    (S0 + 20, 'L3', 'VERIFIED', (57, 255, 20)),
]
SUB = '10.5.37.10'
DETAIL = 'CVE-2026-125357 \u00b7 Munin munin-httpd'

frames = sorted(f for f in os.listdir(SRC) if f.startswith('f_') and f.endswith('.png'))
for name in frames:
    f = int(name[2:6])
    im = Image.open(os.path.join(SRC, name)).convert('RGB')
    W, H = im.size
    step = None
    for s in STEPS:
        if f >= s[0]:
            step = s
    u, v, depth = track.get(f, [0, 0, -1])
    if step and depth > 0:
        ov = Image.new('RGBA', im.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        ax, ay = u * W, (1 - v) * H
        # once the building leaves the frame the label pins to the edge, like an AR tag
        pinned = ax > W - 24 or ay > H * 0.9
        lx, ly = min(ax, W - 24) - 40, max(min(ay, H * 0.9), H * 0.32) - 70
        lvl, text, col = step[1], step[2], step[3]
        line2 = DETAIL if lvl == 'L3' else SUB
        w1 = d.textlength(f'{lvl}  {text}', font=FONT)
        w2 = d.textlength(line2, font=FONT_S)
        bw = max(w1, w2) + 22
        bx0, by0 = lx - bw, ly - 44
        fade = min(1.0, (f - S0) / 4)
        a = int(235 * fade)
        if not pinned:
            d.line([(ax, ay), (lx, ly)], fill=(*col, a), width=2)
            d.ellipse([ax - 4, ay - 4, ax + 4, ay + 4], outline=(*col, a), width=2)
        d.rectangle([bx0, by0, lx, ly], fill=(3, 6, 11, int(215 * fade)), outline=(*col, int(150 * fade)), width=1)
        d.text((bx0 + 11, by0 + 6), lvl, font=FONT, fill=(*col, a))
        d.text((bx0 + 11 + d.textlength(lvl + '  ', font=FONT), by0 + 6), text, font=FONT, fill=(235, 245, 255, a))
        d.text((bx0 + 11, by0 + 25), line2, font=FONT_S, fill=(150, 165, 190, a))
        if lvl == 'L3':  # Consolas has no check glyph, so draw one
            cx = bx0 + 11 + d.textlength(lvl + '  ' + text + ' ', font=FONT)
            d.line([(cx, by0 + 15), (cx + 4, by0 + 19), (cx + 11, by0 + 9)], fill=(*col, a), width=2)
        im = Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB')
    im.save(os.path.join(DST, 'frames', name))

fr = os.path.join(DST, 'frames', 'f_%04d.png')
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', '24', '-i', fr, '-c:v', 'libx264', '-crf', '17', '-preset', 'slow',
                '-pix_fmt', 'yuv420p', '-movflags', '+faststart', os.path.join(DST, 'nightwire-cinematic.mp4')], check=True)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', '24', '-i', fr, '-vf', 'fps=16,scale=880:-1:flags=lanczos',
                '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '58', '-compression_level', '6', '-loop', '0',
                os.path.join(DST, 'cinematic.webp')], check=True)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', os.path.join(DST, 'frames', frames[-12]), '-q:v', '2',
                os.path.join(DST, 'cinematic-poster.jpg')], check=True)
print('done', len(frames), 'frames')

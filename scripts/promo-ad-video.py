# -*- coding: utf-8 -*-
"""
promo-ad-video — put a recorded walkthrough inside the 1080x1920 ad frame.

    python scripts/promo-ad-video.py

Reads  promo/video/*-540x788.webm
Writes promo/video/ad/<name>-ad1080x1920.webm
       promo/video/ad/disclosure-overlay-1080x1920.png

Same geometry as the stills (scripts/promo-ad-frame.py): the screen is scaled
to the 896x1306 safe box and anchored to its top at (44, 130), leaving the
bottom 484px as flat cream for the caption to sit over.

── ⚠️ WHAT THIS CANNOT DO, AND WHY ─────────────────────────────────────────
The only ffmpeg on this machine is the one Playwright downloads for its own
video recording, and it is a minimal build:

  * encoders: libvpx (VP8) only  -> output is WebM, NOT MP4
  * filters:  scale, pad, format -> NO drawtext, NO overlay

So the disclosure line cannot be burned in here. It is written out instead as
a transparent PNG the same size as the frame: drop it on the timeline above
the video in whatever editor the voiceover is recorded in, and it lands
exactly where the padding already is.

TikTok wants MP4/MOV, so the WebM needs one export through that editor
anyway. Both jobs therefore land in the same place rather than needing a
second tool here.
"""
import os
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont

FRAME_W, FRAME_H = 1080, 1920
PAD_TOP, PAD_LEFT = 130, 44
SAFE_W, SAFE_H = 896, 1306
BACKGROUND = (255, 247, 250)          # Colors.ts cream
INK = (110, 102, 117)                 # Colors.ts muted

FFMPEG = os.path.expandvars(
    r'%LOCALAPPDATA%\ms-playwright\ffmpeg-1011\ffmpeg-win64.exe')

DISCLOSURE = ('Example screens. People and shops shown are illustrations, '
              'not real members.')


def disclosure_overlay(dst: str) -> None:
    """A transparent plate carrying the line, sized to the whole frame.

    Written as an image because this ffmpeg has neither drawtext nor overlay.
    It sits in the bottom band, which is covered by TikTok's caption area —
    deliberately: that band is ours and otherwise empty, and a sentence there
    is always on screen, unlike a caption that a reshare can drop.
    """
    im = Image.new('RGBA', (FRAME_W, FRAME_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 30)
    except OSError:
        font = ImageFont.load_default()

    # Just under the screen, inside the safe box's bottom edge.
    y = PAD_TOP + SAFE_H + 28
    words, lines, cur = DISCLOSURE.split(), [], ''
    for w in words:
        trial = (cur + ' ' + w).strip()
        if d.textlength(trial, font=font) > SAFE_W - 40:
            lines.append(cur); cur = w
        else:
            cur = trial
    lines.append(cur)
    for i, line in enumerate(lines):
        w = d.textlength(line, font=font)
        d.text((PAD_LEFT + (SAFE_W - w) / 2, y + i * 38), line, font=font, fill=INK + (255,))
    im.save(dst)


def frame_one(src: str, dst: str) -> None:
    vf = ('scale=%d:%d,pad=%d:%d:%d:%d:color=0x%02X%02X%02X'
          % (SAFE_W, SAFE_H, FRAME_W, FRAME_H, PAD_LEFT, PAD_TOP, *BACKGROUND))
    subprocess.run(
        [FFMPEG, '-y', '-loglevel', 'error', '-i', src, '-vf', vf,
         '-c:v', 'libvpx', '-b:v', '3M', '-crf', '12', '-an', dst],
        check=True)


def duration(path: str) -> str:
    try:
        out = subprocess.run([FFMPEG, '-i', path], capture_output=True, text=True).stderr
        for line in out.splitlines():
            if 'Duration:' in line:
                return line.split('Duration:')[1].split(',')[0].strip()
    except Exception:
        pass
    return '?'


def main(d: str = 'promo/video') -> None:
    if not os.path.exists(FFMPEG):
        print('no ffmpeg at ' + FFMPEG)
        print('run: npx playwright install ffmpeg')
        return
    ad = os.path.join(d, 'ad')
    os.makedirs(ad, exist_ok=True)

    srcs = sorted(f for f in os.listdir(d) if f.endswith('-540x788.webm'))
    if not srcs:
        print('no recordings in ' + d)
        return

    print('safe box %dx%d at (%d,%d) inside %dx%d\n'
          % (SAFE_W, SAFE_H, PAD_LEFT, PAD_TOP, FRAME_W, FRAME_H))
    for f in srcs:
        base = f.replace('-540x788.webm', '')
        dst = os.path.join(ad, base + '-ad1080x1920.webm')
        frame_one(os.path.join(d, f), dst)
        print('%-44s -> %-44s %s  %.2f MB'
              % (f, os.path.basename(dst), duration(dst),
                 os.path.getsize(dst) / 1048576))

    plate = os.path.join(ad, 'disclosure-overlay-1080x1920.png')
    disclosure_overlay(plate)
    print('\noverlay plate: %s' % plate)
    print('  drop it above the video in the editor; it is already positioned.')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'promo/video')

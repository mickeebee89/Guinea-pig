# -*- coding: utf-8 -*-
"""
promo-ad-frame — put a screen capture inside a 1080x1920 ad frame, in the part
of it a viewer can actually see.

    python scripts/promo-ad-frame.py "C:\\Users\\micky\\Pictures\\Cavyscreenshots"

Writes <dir>/ad/<name>-ad1080x1920.png for every PNG in <dir>.

── WHY THE SCREEN IS NOT CENTRED ──────────────────────────────────────────
A vertical ad is 1080x1920, but TikTok's own chrome covers most of the edges:

    top     130px   (the account strip)
    bottom  484px   (caption, sound, the button rail)
    left     44px
    right   140px   (the like / comment / share column)

Which leaves 896 x 1306 — about 56% of the frame — actually visible. Centring
a phone screen in 1080x1920 therefore drops roughly a quarter of it behind the
caption and buttons, and the bottom of a screenshot is where the call to
action usually is.

So this anchors the screen to the TOP of the safe box rather than to the
middle of the frame, and leaves the bottom 484px as flat background for the
caption to sit over.

── THE CAPTURE SIZE THAT WASTES NOTHING ───────────────────────────────────
The safe box is 896 x 1306, an aspect of 0.686. A 9:16 phone capture (0.5625)
is TALLER than that, so fitting it whole means scaling to the safe HEIGHT and
leaving ~160px of unused width either side.

To fill the safe box exactly, capture at 540 x 788 CSS with device pixel
ratio 2 (= 1080 x 1576), which scales to 896 x 1306 with nothing left over.
A 540 x 960 capture still works; it just sits narrower in the frame.
"""
import os
import sys
from PIL import Image

# TikTok vertical, and near enough to Reels and Shorts to use one frame.
FRAME_W, FRAME_H = 1080, 1920
PAD_TOP, PAD_BOTTOM, PAD_LEFT, PAD_RIGHT = 130, 484, 44, 140
SAFE_W = FRAME_W - PAD_LEFT - PAD_RIGHT      # 896
SAFE_H = FRAME_H - PAD_TOP - PAD_BOTTOM      # 1306

# Colors.ts `cream`. The frame should read as part of the product, not as a
# black letterbox.
BACKGROUND = (255, 247, 250)

# ── PER-FILE CROPS ─────────────────────────────────────────────────────────
#
# Two captures need trimming before they are framed, and the numbers used to
# live in my head and get applied by hand — which made the script something
# you could only run with me sitting next to it. They live here now.
#
# Keyed by the capture's base name, with the `-1080w` / `-540w` suffix removed.
#
# ⚠️ EACH ENTRY RECORDS THE SOURCE HEIGHT IT WAS MEASURED AGAINST, and a crop
# is SKIPPED WITH A WARNING if the file is a different height. A pixel offset
# measured on a 1576-tall capture means nothing on a 1900-tall one, and
# silently cropping the wrong band would be worse than not cropping at all:
# you would get a frame that looked deliberate and was wrong.
#
# So if you recapture at a new size and see the warning, either re-measure the
# offset here or recapture at a scroll position that needs no crop.
CROPS = {
    'cavy-stylist-model-profile': {
        'for_height': 1576,
        'top': 0,
        'bottom': 1496,
        'why': 'the page runs on into a half-cut "Reviews" heading',
    },
    'cavy-model-stylist-portfolio': {
        'for_height': 1576,
        'top': 470,
        'bottom': None,          # None = to the bottom of the image
        'why': 'drops the calendar tail so the work grid leads the frame',
    },
}


def base_name(filename: str) -> str:
    base = filename[:-4] if filename.lower().endswith('.png') else filename
    for suffix in ('-540w', '-1080w'):
        if base.endswith(suffix):
            return base[:-len(suffix)]
    return base


def frame_one(src, dst: str) -> str:
    """`src` is a path or an already-open Image."""
    im = src if isinstance(src, Image.Image) else Image.open(src)
    im = im.convert('RGB')

    # Fit inside the safe box, never upscale past 2x — beyond that a capture
    # taken at DPR 1 starts to look soft enough to notice.
    scale = min(SAFE_W / im.width, SAFE_H / im.height)
    w, h = round(im.width * scale), round(im.height * scale)
    im = im.resize((w, h), Image.LANCZOS)

    out = Image.new('RGB', (FRAME_W, FRAME_H), BACKGROUND)
    # Centred across the safe box (which is itself off-centre in the frame,
    # because the right-hand button column is wider than the left margin),
    # and anchored to its top.
    x = PAD_LEFT + (SAFE_W - w) // 2
    out.paste(im, (x, PAD_TOP))
    out.save(dst)
    return '%dx%d at (%d,%d), %.2fx' % (w, h, x, PAD_TOP, scale)


def main(d: str) -> None:
    ad = os.path.join(d, 'ad')
    os.makedirs(ad, exist_ok=True)
    names = sorted(f for f in os.listdir(d) if f.lower().endswith('.png'))
    if not names:
        print('no PNGs in ' + d)
        return

    print('safe box %dx%d at (%d,%d) inside %dx%d\n' %
          (SAFE_W, SAFE_H, PAD_LEFT, PAD_TOP, FRAME_W, FRAME_H))

    skipped = []
    for n in names:
        base = base_name(n)
        im = Image.open(os.path.join(d, n))
        note = ''

        crop = CROPS.get(base)
        if crop:
            if im.height == crop['for_height']:
                bottom = crop['bottom'] or im.height
                im = im.crop((0, crop['top'], im.width, bottom))
                note = '  (cropped %d..%d — %s)' % (crop['top'], bottom, crop['why'])
            else:
                skipped.append((n, im.height, crop['for_height']))
                note = '  (CROP SKIPPED — see the warning below)'

        info = frame_one(im, os.path.join(ad, base + '-ad1080x1920.png'))
        print('%-46s -> %s%s' % (n, info, note))

    if skipped:
        print('\n\u26a0\ufe0f  CROPS SKIPPED, because the capture is not the height they were measured on:')
        for n, got, want in skipped:
            print('    %-46s is %dpx tall, the crop was measured on %dpx' % (n, got, want))
        print('    Re-measure the offset in CROPS, or recapture at a scroll position needing no crop.')

    print('\n%d ad frame(s) in %s' % (len(names), ad))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'promo/2026-09-29')

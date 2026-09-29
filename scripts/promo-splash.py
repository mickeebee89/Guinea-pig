# -*- coding: utf-8 -*-
"""
promo-splash — the closing frame for a walkthrough video.

    python scripts/promo-splash.py

Writes promo/video/splash-1080x1920.png   (the finished ad frame)
       promo/video/splash-540x788.png     (the same artwork, recorder-sized)

The only frame in the set that is not a screenshot of the product, so it is
built from the product's own parts rather than designed fresh: the homepage
lockup (site/public/guinea-pig-logo.png), Colors.ts cream and rose, and the
same 896x1306 safe box everything else sits in.

Wording settled with Micky, 30 Sep 2026:
    Join Cavy now
    help build the community
    cavybeauty.com

The 540x788 copy is CROPPED AND RESIZED FROM the 1080x1920 one, not drawn a
second time at half scale. scripts/promo-record.js shows it as the video's last
beat, and promo-ad-video.py then scales the whole recording back up into the
same safe box — so a separately drawn splash would be a second implementation
of one frame, free to drift from the first. There is one drawing, and the video
path is the exact inverse of the compositor's.
"""
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
PAD_TOP, PAD_LEFT = 130, 44
SAFE_W, SAFE_H = 896, 1306

CREAM = (255, 247, 250)
ROSE = (219, 75, 134)
DARK = (43, 37, 49)
MUTED = (110, 102, 117)

LOGO = 'site/public/guinea-pig-logo.png'
OUT = 'promo/video/splash-1080x1920.png'
OUT_SMALL = 'promo/video/splash-540x788.png'
REC_W, REC_H = 540, 788


def font(size, bold=False):
    for name in (('seguisb.ttf', 'segoeui.ttf') if bold else ('segoeui.ttf',)):
        try:
            return ImageFont.truetype('C:/Windows/Fonts/' + name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def centred(d, text, f, y, fill):
    w = d.textlength(text, font=f)
    d.text((PAD_LEFT + (SAFE_W - w) / 2, y), text, font=f, fill=fill)


def main():
    im = Image.new('RGB', (W, H), CREAM)
    d = ImageDraw.Draw(im)

    # Vertically centred in the SAFE BOX, not in the frame — the bottom 484px
    # is behind TikTok's caption and buttons.
    block_top = PAD_TOP + (SAFE_H - 620) // 2

    if os.path.exists(LOGO):
        logo = Image.open(LOGO).convert('RGBA')
        side = 300
        logo.thumbnail((side, side), Image.LANCZOS)
        # The homepage sets the mascot in a soft pink disc; same here, so the
        # frame reads as the site rather than as a title card.
        disc = 380
        cx = PAD_LEFT + SAFE_W // 2
        d.ellipse([cx - disc // 2, block_top, cx + disc // 2, block_top + disc],
                  fill=(255, 227, 239))
        im.paste(logo, (cx - logo.width // 2,
                        block_top + (disc - logo.height) // 2), logo)
        y = block_top + disc + 70
    else:
        print('! no logo at ' + LOGO + ' — text only')
        y = block_top + 120

    centred(d, 'Join Cavy now', font(84, bold=True), y, ROSE)
    centred(d, 'help build the community', font(42), y + 120, DARK)
    centred(d, 'cavybeauty.com', font(38), y + 210, MUTED)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    im.save(OUT)
    print('wrote %s  %dx%d' % (OUT, im.width, im.height))

    small = (im.crop((PAD_LEFT, PAD_TOP, PAD_LEFT + SAFE_W, PAD_TOP + SAFE_H))
               .resize((REC_W, REC_H), Image.LANCZOS))
    small.save(OUT_SMALL)
    print('wrote %s  %dx%d  (safe box only, for the recorder)'
          % (OUT_SMALL, small.width, small.height))


if __name__ == '__main__':
    main()

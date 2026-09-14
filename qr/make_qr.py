#!/usr/bin/env python3
"""Generate the PickleStack QR code and a printable card to pin up at the courts.

    python3 qr/make_qr.py

Writes qr/picklestack-qr.png (the code on its own) and
qr/picklestack-card.png (the code with the address, sized for A6/4x6 print).
Re-run it if the site ever moves — change URL below and everything regenerates.
"""
import pathlib
import qrcode
from qrcode.constants import ERROR_CORRECT_Q
from PIL import Image, ImageDraw, ImageFont

URL = "https://3dlaundryhub.github.io/picklestack/"
HERE = pathlib.Path(__file__).parent

INK = (14, 39, 35)        # app --ink, near-black with a green cast
TEAL = (11, 131, 117)     # app --accent
MUTED = (93, 125, 117)    # app --muted
PAPER = (255, 255, 255)

def font(name, size):
    for path in (
        "/System/Library/Fonts/Supplemental/%s.ttf" % name,
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()

# --- the code itself ---------------------------------------------------------
# Error correction Q (25%) survives creases, glare and a bit of print wear
# while staying sparse enough to scan fast from a phone held at arm's length.
qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_Q, box_size=20, border=2)
qr.add_data(URL)
qr.make(fit=True)
code = qr.make_image(fill_color=INK, back_color=PAPER).convert("RGB")
code.save(HERE / "picklestack-qr.png")

# --- printable card ----------------------------------------------------------
W, H = 1200, 1600
card = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(card)

d.rounded_rectangle([24, 24, W - 24, H - 24], radius=36, outline=(205, 228, 222), width=3)

title = font("Arial Bold", 96)
sub = font("Arial", 40)
addr = font("Arial Bold", 34)
foot = font("Arial", 34)

def centre(text, f, y, fill):
    w = d.textbbox((0, 0), text, font=f)[2]
    d.text(((W - w) / 2, y), text, font=f, fill=fill)

centre("PickleStack", title, 120, INK)
centre("Pickleball rounds, scores & standings", sub, 240, MUTED)

size = 760
code_img = code.resize((size, size), Image.LANCZOS)
card.paste(code_img, ((W - size) // 2, 350))

centre("3dlaundryhub.github.io/picklestack", addr, 1200, TEAL)
centre("Scan to open. No app, no sign-in.", foot, 1270, MUTED)

# an optic-yellow rule, the one flash of colour the app uses for a live court
d.rounded_rectangle([(W - 180) / 2, 1370, (W + 180) / 2, 1380], radius=5, fill=(214, 230, 60))

card.save(HERE / "picklestack-card.png")

for p in ("picklestack-qr.png", "picklestack-card.png"):
    f = HERE / p
    print("%-26s %5.0f KB  %s" % (p, f.stat().st_size / 1024, Image.open(f).size))
print("encodes: %s" % URL)

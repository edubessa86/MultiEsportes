#!/usr/bin/env python3
"""Generate Multiesporte launcher icons using the app's navy/cyan/lime identity."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "assets"
SIZE = 1024
NAVY = (7, 17, 31, 255)
CARD = (16, 29, 46, 255)
CYAN = (125, 235, 255, 255)
LIME = (183, 243, 74, 255)
WHITE = (255, 255, 255, 255)


def draw_mark(image, monochrome=False):
    d = ImageDraw.Draw(image)
    ink = WHITE if monochrome else CYAN
    accent = WHITE if monochrome else LIME
    # Rounded orbital ring: movement, training and continuity.
    d.arc((190, 190, 834, 834), start=205, end=520, fill=ink, width=24)
    d.arc((250, 250, 774, 774), start=20, end=170, fill=accent, width=16)
    # Dynamic lightning bolt, echoing the in-app brand mark.
    points = [(555, 190), (365, 535), (482, 535), (430, 815),
              (665, 430), (535, 430)]
    d.polygon(points, fill=accent)
    # Small performance pulse accent.
    d.line([(250, 690), (335, 690), (385, 625), (440, 735),
            (495, 675), (570, 675)], fill=ink, width=17, joint="curve")


def save_png(image, filename):
    image.save(ROOT / filename, format="PNG", optimize=True)


def main():
    ROOT.mkdir(parents=True, exist_ok=True)

    # Standard app icon: dark premium field and high-contrast athletic symbol.
    icon = Image.new("RGBA", (SIZE, SIZE), NAVY)
    d = ImageDraw.Draw(icon)
    d.rounded_rectangle((70, 70, 954, 954), radius=205, fill=CARD)
    draw_mark(icon)
    save_png(icon, "icon.png")

    # Android adaptive foreground is transparent; background is configured separately.
    foreground = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw_mark(foreground)
    save_png(foreground, "android-icon-foreground.png")

    background = Image.new("RGBA", (SIZE, SIZE), NAVY)
    save_png(background, "android-icon-background.png")

    # Android themed icon uses a single-color mark on transparency.
    mono = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw_mark(mono, monochrome=True)
    save_png(mono, "android-icon-monochrome.png")

    # Splash mark: transparent symbol, scaled to sit comfortably on the splash screen.
    splash = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw_mark(splash)
    save_png(splash, "splash-icon.png")

    print("Generated launcher, adaptive, monochrome and splash icons.")


if __name__ == "__main__":
    main()

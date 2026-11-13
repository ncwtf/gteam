# gteam brand assets

Logo and identity kit for **gteam** (God Team). The mark is a circular charcoal badge with a white eight-tooth gear, a key-like connecting arm ending in a ring joint, and a thin violet halo. The wordmark is lowercase **gteam** set in Poppins Bold.

These files are the source of truth for the desktop app, MCP tooling, the marketing site, and print.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| Badge | `#1E1E26` | Circular icon background |
| Badge glow | `#3F3358` → `#1E1E26` | Soft violet radial light in the lower-left of the badge |
| Navy | `#0B1220` | Dark canvas, wordmark on light, body text |
| Violet | `#8B5CF6` | Halo (ends) |
| Violet light | `#A78BFA` | Halo (center) |
| White | `#FFFFFF` | Gear, wordmark on dark, mono-white |

Do not recolor the gear or the halo independently for marketing lockups. Use the prepared on-dark / on-light files instead.

## Typography

- Wordmark: **Poppins Bold** (700), lowercase `gteam`.
- Tracking: −0.02 em (slightly tight, so the five letters read as one unit).
- All SVG wordmarks have the letters converted to outlines. They do not require the font file to render.
- UI and documentation type (not in this kit): Inter or Poppins, regular and medium, title case or sentence case — never use the outlined wordmark as body text.

## Clear space

Keep a clear margin around the mark of at least **20% of the badge diameter** (one fifth). For the horizontal lockup, that margin is measured from the outermost points of the badge, the `t` ascender, and the `g` descender.

Do not put other logos, rules, or copy inside that margin. Do not add a drop shadow, outline, or second color behind the badge.

## Minimum size

| Asset | Minimum |
| --- | --- |
| Full-color icon (badge) | 24 px on screen, 8 mm in print |
| Mono icon | 24 px |
| Glyph (no badge) | 20 px |
| Tray / template icon | Use the simplified tray masters only, at 16, 22, or 32 px |
| Horizontal lockup | Badge at least 24 px tall (lockup about 90 px wide) |
| Wordmark only | 72 px wide |

Below 24 px, use a tray icon, never a scaled-down full-color badge.

## Which file to use

### Product / app
- `app-icon/icon.png` (1024), `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico` — Tauri / OS app icons. The badge is full-bleed in the square; the OS applies its own mask (squircle, etc.).
- `svg/icon.svg` and `png/icon-{16,32,48,64,128,256,512,1024}.png` — in-app about screens, settings, notifications at larger sizes.
- `svg/tray-white.svg`, `svg/tray-black.svg` and `png/tray-{white,black}-{16,22,32}.png` — menu-bar / system-tray template images (macOS-style: single color plus alpha, simplified 6-tooth construction, no halo, no glow). Use the white files on dark trays and the black files on light trays.

### Web
- `favicon.svg`, `favicon.ico`, `png/apple-touch-icon-180.png` — site favicons.
- `png/og-1200x630.png` — Open Graph / social share image (horizontal lockup on `#0B1220`).
- `svg/lockup-horizontal-on-dark.svg` on `#0B1220` or photography; `svg/lockup-horizontal-on-light.svg` on white or light grey.
- `svg/lockup-stacked-on-dark.svg` / `on-light.svg` — square or narrow placements (app store tiles, social avatars with a caption, posters).
- `svg/wordmark-dark.svg` (white letters) and `svg/wordmark-light.svg` (navy letters) — when the badge is already present or the layout is text-only.

### Print / watermark / one-color
- `svg/icon-mono-black.svg` / `icon-mono-white.svg` — a stencil of the badge (solid circle, mark knocked out). Use black on light paper, white on dark paper or photography.
- `svg/icon-glyph-dark.svg` (white glyph) and `svg/icon-glyph-light.svg` (navy glyph) — the gear, arm and halo without the circle, for watermarks or when a circular badge would fight a busy background.

### Previews
- `png/preview-horizontal-dark-1600x900.png` and `preview-horizontal-light-1600x900.png` — 16:9 presentations of the horizontal lockup.
- `contact-sheet.png` — every variant on an appropriate background, for review.

Prefer the SVG as the master. Use the PNG exports when a raster is required; do not re-export from a screenshot.

## Construction (for implementers)

The icon lives in a 1024×1024 viewBox. The badge is a full-bleed circle (center 512, 512, radius 512). The gear is slightly above-left of the badge center so the arm can sit on the lower-right diagonal. Eight teeth sit on 45° increments; the south-east tooth is replaced by a straight arm that ends in a ring joint. The violet halo is a circular arc centered on the gear, fading at both ends.

Wordmark and badge share a horizontal centerline through the x-height of `gteam` (not the cap height, and not the full ascender-to-descender height).

## License and trademark

The **gteam** name and this logo are trademarks. The files in this folder are provided for use on official gteam products and communications. They are not covered by the Apache 2.0 or AGPL-3.0 licenses of the product code. Do not redraw, recolor, rotate, or add the mark to a third-party logo lockup without permission.

Rebuild everything in this folder with:

```bash
/tmp/brandvenv/bin/python /workspace/gteam-brand/build.py
```

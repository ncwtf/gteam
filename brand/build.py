#!/usr/bin/env python3
"""Build the gteam brand asset kit: SVGs, PNGs, app icons, contact sheet."""
from __future__ import annotations

import math
import os
import shutil
import zipfile
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))

import cairosvg
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform
from PIL import Image, ImageDraw, ImageFont, ImageChops, ImageFilter
from shapely.ops import unary_union

from geom import build_mark, shapely_to_d, halo_poly, circle as circle_poly

ROOT = Path("/workspace/gteam-brand")
SVG = ROOT / "svg"
PNG = ROOT / "png"
APP = ROOT / "app-icon"
TMP = Path("/tmp/gteam-build")

POPPINS = "/usr/share/fonts/truetype/sand-box/google/Poppins/Poppins-Bold.ttf"

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------
BADGE = "#1E1E26"
BADGE_GLOW = "#3F3358"
BADGE_GLOW_MID = "#2A2536"
NAVY = "#0B1220"          # wordmark / lockup dark bg / on-light text
VIOLET = "#8B5CF6"
VIOLET_LT = "#A78BFA"
VIOLET_SOFT = "#6D28D9"
WHITE = "#FFFFFF"
BLACK = "#0B1220"

# ---------------------------------------------------------------------------
# Master geometry (viewBox 0 0 1024 1024). Derived from the approved raster,
# then snapped to clean geometric values and scaled so the badge is full-bleed.
# Reference badge r = 409.71 in a 1024 canvas; we scale to r = 512.
# ---------------------------------------------------------------------------
VB = 1024.0
CX = 512.0
CY = 512.0
R = 512.0
S = R / 409.71  # 1.249664

HX = CX + (-11.01) * S          # hub / gear center
HY = CY + (-30.48) * S

HUB_R = 53.67 * S
HOLE_R = 126.38 * S
ROOT_R = 184.30 * S
TIP_R = 223.00 * S              # perpendicular distance, gear-center → tip flat

# Tooth (unfilleted trapezoid + uniform corner radius), in master units
TOOTH_TW = 50.0 * S             # unfilleted tip half-width (visible flat ≈ tw - rho)
TOOTH_ALPHA = math.radians(16.0)
TOOTH_RHO = 14.0 * S
N_TEETH = 8
ARM_TOOTH = 1                   # SE tooth (axis 45°) is replaced by the arm
# axes: 0=east, 45=SE, 90=south, ... in y-down coords
TOOTH_AXES = [i * 45.0 for i in range(N_TEETH)]

ARM_ANG = 45.0                  # snapped to the SE tooth axis
ARM_HALF_W = 52.0 * S
END_DIST = 322.55 * S
END_INNER = 32.50 * S
END_OUTER = 67.00 * S
EX = HX + END_DIST * math.cos(math.radians(ARM_ANG))
EY = HY + END_DIST * math.sin(math.radians(ARM_ANG))

HALO_R = 293.8 * S              # from hub
HALO_SW = 6.5 * S               # core stroke
HALO_GLOW_SW = 15.0 * S
HALO_A0 = -158.0                # arc start (from hub, 0=east, y-down)
HALO_A1 = -22.0

# Precomputed boolean geometry (no SVG masks — cairosvg's mask support is unreliable)
MARK_GEOM = build_mark(
    HX, HY, ROOT_R, TIP_R, HOLE_R, TOOTH_TW, TOOTH_ALPHA, TOOTH_RHO,
    TOOTH_AXES, ARM_ANG, EX, EY, END_OUTER, END_INNER, ARM_HALF_W,
)
MARK_D = shapely_to_d(MARK_GEOM)
HUB_GEOM = circle_poly(HX, HY, HUB_R, res=32)
HALO_GEOM = halo_poly(HX, HY, HALO_R, HALO_SW, HALO_A0, HALO_A1)
HALO_GLOW_GEOM = halo_poly(HX, HY, HALO_R, HALO_GLOW_SW, HALO_A0, HALO_A1)
BADGE_GEOM = circle_poly(CX, CY, R, res=64)
MONO_GEOM = BADGE_GEOM.difference(unary_union([MARK_GEOM, HUB_GEOM, HALO_GEOM]))
MONO_D = shapely_to_d(MONO_GEOM)
HALO_D = shapely_to_d(HALO_GEOM)
HALO_GLOW_D = shapely_to_d(HALO_GLOW_GEOM)
HALO_X0 = HX + HALO_R * math.cos(math.radians(HALO_A0))
HALO_X1 = HX + HALO_R * math.cos(math.radians(HALO_A1))

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def fmt(n: float) -> str:
    s = f"{n:.3f}"
    s = s.rstrip("0").rstrip(".")
    return s or "0"


def polar(cx, cy, r, deg):
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def rotate_pt(x, y, deg, cx=0, cy=0):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    dx, dy = x - cx, y - cy
    return cx + c * dx - s * dy, cy + s * dx + c * dy


def local_to_world(x, y, axis_deg, cx, cy):
    """Local +x along axis, +y toward increasing angle (y-down)."""
    a = math.radians(axis_deg)
    return (cx + x * math.cos(a) - y * math.sin(a),
            cy + x * math.sin(a) + y * math.cos(a))


def fillet_corner(p0, c, p1, r):
    """Tangent points, center, radius, sweep for a circular fillet at corner c.

    Returns (t1, t2, center, radius, sweep_flag) or None if degenerate.
    sweep_flag is 0 or 1 for the SVG A command going t1 → t2 along the fillet
    (the arc that stays away from the original sharp corner).
    """
    v1 = (p0[0] - c[0], p0[1] - c[1])
    v2 = (p1[0] - c[0], p1[1] - c[1])
    n1 = math.hypot(*v1) or 1.0
    n2 = math.hypot(*v2) or 1.0
    u1, u2 = (v1[0] / n1, v1[1] / n1), (v2[0] / n2, v2[1] / n2)
    dot = max(-1.0, min(1.0, u1[0] * u2[0] + u1[1] * u2[1]))
    ang = math.acos(dot)
    if ang < 1e-3 or abs(math.pi - ang) < 1e-3:
        return None
    t = r / math.tan(ang / 2.0)
    if t > n1 - 0.4 or t > n2 - 0.4:
        t = min(n1, n2) * 0.45
        r = t * math.tan(ang / 2.0)
        if r < 0.5:
            return None
    t1 = (c[0] + u1[0] * t, c[1] + u1[1] * t)
    t2 = (c[0] + u2[0] * t, c[1] + u2[1] * t)
    bis = (u1[0] + u2[0], u1[1] + u2[1])
    bn = math.hypot(*bis) or 1.0
    bis = (bis[0] / bn, bis[1] / bn)
    d = r / math.sin(ang / 2.0)
    ctr = (c[0] + bis[0] * d, c[1] + bis[1] * d)
    a1 = math.atan2(t1[1] - ctr[1], t1[0] - ctr[0])
    a2 = math.atan2(t2[1] - ctr[1], t2[0] - ctr[0])
    # Cross product of ctr→t1 and ctr→t2 tells us the signed short arc.
    cross = (t1[0] - ctr[0]) * (t2[1] - ctr[1]) - (t1[1] - ctr[1]) * (t2[0] - ctr[0])
    # We want the arc whose midpoint is closer to ctr than to the sharp corner?
    # The correct fillet mid is near `ctr + r * bis`? No: ctr is along the
    # interior bisector from c, so the fillet mid (on the outline) is in the
    # OPPOSITE direction from c, i.e. mid = ctr - r * bis (away from corner).
    mid_wanted = (ctr[0] - bis[0] * r, ctr[1] - bis[1] * r)
    # Short-arc midpoint:
    da = a2 - a1
    while da > math.pi:
        da -= 2 * math.pi
    while da < -math.pi:
        da += 2 * math.pi
    mid_short = (ctr[0] + r * math.cos(a1 + da / 2), ctr[1] + r * math.sin(a1 + da / 2))
    use_short = math.hypot(mid_short[0] - mid_wanted[0], mid_short[1] - mid_wanted[1]) < r
    if use_short:
        sweep = 1 if da > 0 else 0
        large = 0
    else:
        sweep = 0 if da > 0 else 1
        large = 1
    return t1, t2, ctr, r, sweep, large


def path_rounded_polygon(corners, radius) -> str:
    """Closed path through `corners` with circular fillets of `radius`."""
    n = len(corners)
    cmds = []
    first = None
    for i in range(n):
        p0 = corners[(i - 1) % n]
        c = corners[i]
        p1 = corners[(i + 1) % n]
        fil = fillet_corner(p0, c, p1, radius)
        if fil is None:
            pt = c
            if first is None:
                first = pt
                cmds.append(f"M{fmt(pt[0])} {fmt(pt[1])}")
            else:
                cmds.append(f"L{fmt(pt[0])} {fmt(pt[1])}")
        else:
            t1, t2, ctr, r, sweep, large = fil
            if first is None:
                first = t1
                cmds.append(f"M{fmt(t1[0])} {fmt(t1[1])}")
            else:
                cmds.append(f"L{fmt(t1[0])} {fmt(t1[1])}")
            cmds.append(
                f"A{fmt(r)} {fmt(r)} 0 {large} {sweep} {fmt(t2[0])} {fmt(t2[1])}"
            )
    cmds.append("Z")
    return " ".join(cmds)


def tooth_corners(axis_deg, cx, cy, Rr, Rt, tw, alpha):
    """Unfilleted trapezoid corners, walk increasing-angle (out, across, back)."""
    rl = local_to_world(Rr * math.cos(alpha), -Rr * math.sin(alpha), axis_deg, cx, cy)
    tl = local_to_world(Rt, -tw, axis_deg, cx, cy)
    tr = local_to_world(Rt, tw, axis_deg, cx, cy)
    rr = local_to_world(Rr * math.cos(alpha), Rr * math.sin(alpha), axis_deg, cx, cy)
    return [rl, tl, tr, rr]


def tooth_path(axis_deg, cx=HX, cy=HY, Rr=ROOT_R, Rt=TIP_R,
               tw=TOOTH_TW, alpha=TOOTH_ALPHA, rho=TOOTH_RHO) -> str:
    return path_rounded_polygon(tooth_corners(axis_deg, cx, cy, Rr, Rt, tw, alpha), rho)


def arm_shaft_path() -> str:
    """Rectangle along the arm axis, from well inside the root circle to the
    end-ring center, so unions with both. Ends are buried; no cap needed."""
    a = math.radians(ARM_ANG)
    ux, uy = math.cos(a), math.sin(a)
    px, py = -uy, ux  # perpendicular
    # start a little inside the inner hole so it is fully covered by the root
    r0 = HOLE_R * 0.4
    r1 = END_DIST
    w = ARM_HALF_W
    p1 = (HX + ux * r0 + px * w, HY + uy * r0 + py * w)
    p2 = (HX + ux * r1 + px * w, HY + uy * r1 + py * w)
    p3 = (HX + ux * r1 - px * w, HY + uy * r1 - py * w)
    p4 = (HX + ux * r0 - px * w, HY + uy * r0 - py * w)
    return (
        f"M{fmt(p1[0])} {fmt(p1[1])} L{fmt(p2[0])} {fmt(p2[1])} "
        f"L{fmt(p3[0])} {fmt(p3[1])} L{fmt(p4[0])} {fmt(p4[1])} Z"
    )


def svg_arc_path(cx, cy, r, a0, a1, stroke=True) -> str:
    """Arc from a0 to a1 (degrees, increasing). Uses the short or long arc as needed."""
    x0, y0 = polar(cx, cy, r, a0)
    x1, y1 = polar(cx, cy, r, a1)
    da = (a1 - a0) % 360
    large = 1 if da > 180 else 0
    sweep = 1  # increasing angle in y-down = clockwise = sweep 1
    if stroke:
        return f"M{fmt(x0)} {fmt(y0)} A{fmt(r)} {fmt(r)} 0 {large} {sweep} {fmt(x1)} {fmt(y1)}"
    return f"M{fmt(x0)} {fmt(y0)} A{fmt(r)} {fmt(r)} 0 {large} {sweep} {fmt(x1)} {fmt(y1)}"


def halo_filled_arc(cx, cy, r, sw, a0, a1) -> str:
    """Annular-sector path (a thick arc as a filled shape) with rounded caps."""
    r_out, r_in = r + sw / 2, r - sw / 2
    # cap centers at the two ends
    # We'll use two end circles + the annulus sector for round caps, via one path:
    # outer arc a0→a1, cap around end 1, inner arc a1→a0, cap around end 0.
    x0o, y0o = polar(cx, cy, r_out, a0)
    x1o, y1o = polar(cx, cy, r_out, a1)
    x0i, y0i = polar(cx, cy, r_in, a0)
    x1i, y1i = polar(cx, cy, r_in, a1)
    da = (a1 - a0) % 360
    large = 1 if da > 180 else 0
    # outer a0→a1 sweep 1; inner a1→a0 sweep 0
    # round cap: half-circle at each end, radius sw/2
    # At end a1, going from outer to inner: a half-circle around the end-center
    # that's on the 'far' side (continuing outward).
    return (
        f"M{fmt(x0o)} {fmt(y0o)} "
        f"A{fmt(r_out)} {fmt(r_out)} 0 {large} 1 {fmt(x1o)} {fmt(y1o)} "
        f"A{fmt(sw/2)} {fmt(sw/2)} 0 1 1 {fmt(x1i)} {fmt(y1i)} "
        f"A{fmt(r_in)} {fmt(r_in)} 0 {large} 0 {fmt(x0i)} {fmt(y0i)} "
        f"A{fmt(sw/2)} {fmt(sw/2)} 0 1 1 {fmt(x0o)} {fmt(y0o)} Z"
    )


# ---------------------------------------------------------------------------
# Wordmark paths (Poppins Bold, no font dependency in the SVG)
# ---------------------------------------------------------------------------
def wordmark_paths(font_size: float, origin_x: float, baseline_y: float,
                   tracking: float = -0.02):
    """Return (list of path d strings, total width, metrics dict).

    tracking is in em (negative = tighter). font_size is the typographic size
    (1em), baseline_y is the SVG baseline.
    """
    font = TTFont(POPPINS)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    os2 = font["OS/2"]
    upm = font["head"].unitsPerEm
    scale = font_size / upm
    track = tracking * font_size
    x = origin_x
    paths = []
    boxes = []
    for i, ch in enumerate("gteam"):
        name = cmap[ord(ch)]
        g = glyph_set[name]
        pen = SVGPathPen(glyph_set)
        tpen = TransformPen(pen, Transform(scale, 0, 0, -scale, x, baseline_y))
        g.draw(tpen)
        d = pen.getCommands()
        paths.append(d)
        adv = hmtx[name][0] * scale
        # bbox in font units
        glyf = font["glyf"][name]
        boxes.append({
            "ch": ch,
            "x0": x + glyf.xMin * scale,
            "x1": x + glyf.xMax * scale,
            "y0": baseline_y - glyf.yMax * scale,
            "y1": baseline_y - glyf.yMin * scale,
        })
        x += adv
        if i < 4:
            x += track
    width = x - origin_x
    metrics = {
        "width": width,
        "x_height": os2.sxHeight * scale,
        "cap": os2.sCapHeight * scale,
        "ascender": os2.sTypoAscender * scale,
        "descender": os2.sTypoDescender * scale,  # negative
        "boxes": boxes,
        "upm": upm,
        "sxHeight": os2.sxHeight,
    }
    font.close()
    return paths, width, metrics


def wordmark_group(font_size, origin_x, baseline_y, fill, tracking=-0.02) -> str:
    paths, width, metrics = wordmark_paths(font_size, origin_x, baseline_y, tracking)
    parts = [f'<path d="{d}" fill="{fill}"/>' for d in paths]
    return "\n    ".join(parts), width, metrics


# ---------------------------------------------------------------------------
# Mark fragments (gear + arm) used by every variant
# ---------------------------------------------------------------------------
def gear_positive_shapes() -> str:
    """White (visible) pieces of the mark, before holes are punched."""
    teeth = []
    for i, axis in enumerate(TOOTH_AXES):
        if i == ARM_TOOTH:
            continue
        teeth.append(f'<path d="{tooth_path(axis)}"/>')
    return "\n      ".join([
        f'<circle cx="{fmt(HX)}" cy="{fmt(HY)}" r="{fmt(ROOT_R)}"/>',
        *teeth,
        f'<path d="{arm_shaft_path()}"/>',
        f'<circle cx="{fmt(EX)}" cy="{fmt(EY)}" r="{fmt(END_OUTER)}"/>',
    ])


def gear_holes() -> str:
    return "\n      ".join([
        f'<circle cx="{fmt(HX)}" cy="{fmt(HY)}" r="{fmt(HOLE_R)}" fill="black"/>',
        f'<circle cx="{fmt(EX)}" cy="{fmt(EY)}" r="{fmt(END_INNER)}" fill="black"/>',
    ])


def hub_circle(fill=WHITE) -> str:
    return f'<circle cx="{fmt(HX)}" cy="{fmt(HY)}" r="{fmt(HUB_R)}" fill="{fill}"/>'


def halo_elements(core_color="url(#haloCore)", glow_color=VIOLET, fade=True) -> str:
    core = halo_filled_arc(HX, HY, HALO_R, HALO_SW, HALO_A0, HALO_A1)
    glow = halo_filled_arc(HX, HY, HALO_R, HALO_GLOW_SW, HALO_A0, HALO_A1)
    mask_attr = ' mask="url(#haloFade)"' if fade else ""
    return f'''<g{mask_attr}>
      <path d="{glow}" fill="{glow_color}" fill-opacity="0.38"/>
      <path d="{core}" fill="{core_color}"/>
    </g>'''


def svg_wrap(inner: str, viewBox="0 0 1024 1024", w=None, h=None) -> str:
    size_attr = ""
    if w and h:
        size_attr = f' width="{w}" height="{h}"'
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewBox}"{size_attr} '
        f'fill="none">\n  {inner}\n</svg>\n'
    )



def defs_gradients() -> str:
    return f'''<defs>
    <radialGradient id="badgeFill" cx="34%" cy="70%" r="72%">
      <stop offset="0%" stop-color="{BADGE_GLOW}"/>
      <stop offset="38%" stop-color="{BADGE_GLOW_MID}"/>
      <stop offset="100%" stop-color="{BADGE}"/>
    </radialGradient>
    <linearGradient id="haloFill" x1="{fmt(HALO_X0)}" y1="0" x2="{fmt(HALO_X1)}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{VIOLET}" stop-opacity="0"/>
      <stop offset="22%" stop-color="{VIOLET_LT}" stop-opacity="1"/>
      <stop offset="78%" stop-color="{VIOLET_LT}" stop-opacity="1"/>
      <stop offset="100%" stop-color="{VIOLET}" stop-opacity="0"/>
    </linearGradient>
  </defs>'''


def mark_elements(fill: str = WHITE) -> str:
    return "\n  ".join([
        f'<path fill-rule="evenodd" d="{MARK_D}" fill="{fill}"/>',
        f'<circle cx="{fmt(HX)}" cy="{fmt(HY)}" r="{fmt(HUB_R)}" fill="{fill}"/>',
    ])


def halo_elements() -> str:
    return f'''<path d="{HALO_GLOW_D}" fill="url(#haloFill)" fill-opacity="0.28"/>
  <path d="{HALO_D}" fill="url(#haloFill)"/>'''


def svg_icon_color() -> str:
    inner = f'''{defs_gradients()}
  <circle cx="{fmt(CX)}" cy="{fmt(CY)}" r="{fmt(R)}" fill="url(#badgeFill)"/>
  {mark_elements(WHITE)}
  {halo_elements()}'''
    return svg_wrap(inner)


def svg_icon_mono(color: str) -> str:
    """Single-color stencil: filled badge with the mark punched out."""
    inner = f'<path fill-rule="evenodd" d="{MONO_D}" fill="{color}"/>'
    return svg_wrap(inner)


def glyph_bbox(padding=36):
    """Tight square around gear + arm + halo, plus padding, in 1024 space."""
    from shapely.ops import unary_union
    g = unary_union([MARK_GEOM, HUB_GEOM, HALO_GLOW_GEOM])
    x0, y0, x1, y1 = g.bounds
    x0 -= padding
    y0 -= padding
    x1 += padding
    y1 += padding
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return cx - side / 2, cy - side / 2, side


def svg_glyph(on_dark: bool) -> str:
    """Gear + arm + halo, no badge. Square viewBox cropped to the glyph."""
    x, y, side = glyph_bbox()
    fill = WHITE if on_dark else NAVY
    halo_core = VIOLET_LT if on_dark else VIOLET
    # Recolor halo: on light backgrounds use a solid violet (the fade gradient still applies)
    inner = f'''{defs_gradients()}
  <g transform="translate({fmt(-x)} {fmt(-y)})">
    {mark_elements(fill)}
    <path d="{HALO_GLOW_D}" fill="url(#haloFill)" fill-opacity="0.28"/>
    <path d="{HALO_D}" fill="url(#haloFill)"/>
  </g>'''
    return svg_wrap(inner, viewBox=f"0 0 {fmt(side)} {fmt(side)}")


def svg_tray(color: str) -> str:
    """Chunkier 6-tooth glyph, no halo, no glow, designed to hold at 16px.

    ViewBox 0 0 32 32. macOS-style template: single color plus alpha.
    """
    hx, hy = 14.85, 14.85
    root, tip = 6.05, 8.85
    hole, hub = 3.85, 1.6
    tw, alpha, rho = 2.05, math.radians(17), 0.5
    axes = [45 + i * 60 for i in range(6)]
    end_d, end_out, end_in, arm_w = 11.35, 3.15, 1.4, 2.0
    ex = hx + end_d * math.cos(math.radians(45))
    ey = hy + end_d * math.sin(math.radians(45))
    mark = build_mark(
        hx, hy, root, tip, hole, tw, alpha, rho,
        axes, 45, ex, ey, end_out, end_in, arm_w, res=24,
    )
    d = shapely_to_d(mark)
    inner = f'''<path fill-rule="evenodd" d="{d}" fill="{color}"/>
  <circle cx="{fmt(hx)}" cy="{fmt(hy)}" r="{fmt(hub)}" fill="{color}"/>'''
    return svg_wrap(inner, viewBox="0 0 32 32")


# ----- lockup -----
# Proportions from the approved lockup: icon diameter D, gap = 0.14 D,
# x-height = 0.373 D, icon center aligned to x-height mid-line.
ICON_IN_LOCKUP = 1024.0  # we compose in a large space then crop

def lockup_horizontal_parts(icon_d: float, text_fill: str):
    gap = 0.122 * icon_d  # visual gap ≈ 0.14 D after the g sidebearing
    xh_ratio = 0.373
    x_height = xh_ratio * icon_d
    # font size so Poppins sxHeight maps to x_height
    font = TTFont(POPPINS)
    sxh = font["OS/2"].sxHeight
    font.close()
    font_size = x_height / (sxh / 1000.0)
    # typographic bounds
    # We'll place icon at x=0,y=0 size icon_d
    icon_cx = icon_d / 2
    # x-height mid aligned with icon center
    # baseline is at icon_cx + x_height/2  (below the mid, since y-down)
    # wait: x-height mid should be at icon_cx. Mid of x-height is baseline - x_height/2
    # in SVG: y_mid = baseline - x_height/2  (because glyphs go up = smaller y)
    # we want y_mid = icon_cx, so baseline = icon_cx + x_height/2
    baseline = icon_cx + x_height / 2
    text_x = icon_d + gap
    paths, width, metrics = wordmark_paths(font_size, text_x, baseline, tracking=-0.02)
    # total bounds including descender / ascender
    desc = abs(metrics["descender"])
    asc = metrics["ascender"]
    # visual bbox of text
    y0 = min(b["y0"] for b in metrics["boxes"])
    y1 = max(b["y1"] for b in metrics["boxes"])
    x1 = text_x + width
    # pad for the icon (0..icon_d) and text
    total_w = x1
    total_h = icon_d
    # The text may extend slightly above/below the icon due to t-ascender / g-descender
    top = min(0, y0)
    bot = max(icon_d, y1)
    return {
        "paths": paths,
        "width": width,
        "metrics": metrics,
        "text_x": text_x,
        "baseline": baseline,
        "font_size": font_size,
        "icon_d": icon_d,
        "gap": gap,
        "total_w": total_w,
        "y0": top,
        "y1": bot,
        "fill": text_fill,
    }


def svg_lockup_horizontal(on_dark: bool, pad=80) -> str:
    text_fill = WHITE if on_dark else NAVY
    L = lockup_horizontal_parts(1024, text_fill)
    # viewBox with padding
    x0 = -pad
    y0 = L["y0"] - pad
    w = L["total_w"] + 2 * pad
    h = (L["y1"] - L["y0"]) + 2 * pad
    icon = svg_icon_color()
    # embed icon via a nested svg
    text = "\n    ".join(f'<path d="{d}" fill="{text_fill}"/>' for d in L["paths"])
    inner = f'''<svg x="0" y="0" width="1024" height="1024" viewBox="0 0 1024 1024">
    {icon.replace('<?xml version="1.0" encoding="UTF-8"?>', '').strip().removeprefix('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none">').removesuffix('</svg>').strip()}
  </svg>
  {text}'''
    # The nested approach is messy because svg_icon_color already wraps. Better:
    return None, L, (x0, y0, w, h)  # we'll assemble properly below


def assemble_lockup_h(on_dark: bool, pad=72) -> str:
    text_fill = WHITE if on_dark else NAVY
    L = lockup_horizontal_parts(1024, text_fill)
    x0 = -pad
    y0 = L["y0"] - pad
    w = L["total_w"] + 2 * pad
    h = (L["y1"] - L["y0"]) + 2 * pad
    # Pull the icon's inner content (defs + shapes) and the wordmark into one svg
    icon_inner = svg_icon_color()
    # strip the outer <svg> wrapper
    start = icon_inner.find(">") + 1
    end = icon_inner.rfind("</svg>")
    icon_body = icon_inner[start:end].strip()
    text = "\n    ".join(f'<path d="{d}" fill="{text_fill}"/>' for d in L["paths"])
    inner = f'''{icon_body}
  {text}'''
    return svg_wrap(inner, viewBox=f"{fmt(x0)} {fmt(y0)} {fmt(w)} {fmt(h)}")


def assemble_lockup_stacked(on_dark: bool, pad=72) -> str:
    text_fill = WHITE if on_dark else NAVY
    icon_d = 1024
    # stacked: icon above wordmark, wordmark centered under the icon
    # slightly tighter: gap under icon ≈ 0.16 D, wordmark a bit smaller than horizontal
    # Use a slightly smaller type so the wordmark width is close to the icon width
    font = TTFont(POPPINS)
    sxh = font["OS/2"].sxHeight
    font.close()
    # Choose font size so wordmark width ≈ icon diameter * 1.15
    # We'll compute, then center.
    # First get width at a reference size
    probe = 400
    _, probe_w, _ = wordmark_paths(probe, 0, 0, tracking=-0.02)
    target_w = icon_d * 1.05
    font_size = probe * (target_w / probe_w)
    # gap
    gap = 0.18 * icon_d
    # wordmark at y below the icon
    _, width, metrics = wordmark_paths(font_size, 0, 0, tracking=-0.02)
    # place text so it's centered under the icon (icon is 0..1024)
    text_x = (icon_d - width) / 2
    # baseline: icon bottom + gap + (distance from y0 of glyphs to baseline)
    # at baseline 0, boxes have y0 = -asc, y1 = +desc
    paths, width, metrics = wordmark_paths(font_size, text_x, 0, tracking=-0.02)
    # shift baseline
    # top of text at baseline + (y0) since y0 is already relative to baseline 0 (negative)
    # we want top of text = icon_d + gap
    y_top_at_bl0 = min(b["y0"] for b in metrics["boxes"])
    baseline = icon_d + gap - y_top_at_bl0
    paths, width, metrics = wordmark_paths(font_size, text_x, baseline, tracking=-0.02)
    y1 = max(b["y1"] for b in metrics["boxes"])
    x0 = min(0, text_x) - pad
    y0 = -pad
    w = max(icon_d, text_x + width) - min(0, text_x) + 2 * pad
    h = y1 + pad - y0
    icon_inner = svg_icon_color()
    start = icon_inner.find(">") + 1
    end = icon_inner.rfind("</svg>")
    icon_body = icon_inner[start:end].strip()
    text = "\n    ".join(f'<path d="{d}" fill="{text_fill}"/>' for d in paths)
    inner = f'''{icon_body}
  {text}'''
    return svg_wrap(inner, viewBox=f"{fmt(x0)} {fmt(y0)} {fmt(w)} {fmt(h)}")


def assemble_wordmark(on_dark: bool, pad=40) -> str:
    text_fill = WHITE if on_dark else NAVY
    font_size = 400
    paths, width, metrics = wordmark_paths(font_size, 0, 0, tracking=-0.02)
    y0 = min(b["y0"] for b in metrics["boxes"]) - pad
    y1 = max(b["y1"] for b in metrics["boxes"]) + pad
    # shift so x starts at pad (first glyph has a left sidebearing)
    x0 = min(b["x0"] for b in metrics["boxes"]) - pad
    x1 = max(b["x1"] for b in metrics["boxes"]) + pad
    # re-emit at baseline 0, viewBox cropped
    text = "\n    ".join(f'<path d="{d}" fill="{text_fill}"/>' for d in paths)
    return svg_wrap(text, viewBox=f"{fmt(x0)} {fmt(y0)} {fmt(x1-x0)} {fmt(y1-y0)}")


# ---------------------------------------------------------------------------
# Render / export
# ---------------------------------------------------------------------------
def write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not content.startswith("<?xml"):
        content = '<?xml version="1.0" encoding="UTF-8"?>\n' + content
    path.write_text(content)
    return path


def render_png(svg_path: Path, png_path: Path, width: int, height: int | None = None,
               background=None):
    png_path.parent.mkdir(parents=True, exist_ok=True)
    kwargs = {"url": str(svg_path), "write_to": str(png_path), "output_width": width}
    if height:
        kwargs["output_height"] = height
    cairosvg.svg2png(**kwargs)
    im = Image.open(png_path).convert("RGBA")
    if background is not None:
        bg = Image.new("RGBA", im.size, background)
        bg.alpha_composite(im)
        im = bg
    im.save(png_path)
    return im


def render_to_size(svg_path: Path, size: int) -> Image.Image:
    tmp = TMP / f"_r_{size}_{svg_path.stem}.png"
    return render_png(svg_path, tmp, size, size)


# ---------------------------------------------------------------------------
# Comparison (for visual QA)
# ---------------------------------------------------------------------------
def build_comparison():
    """Overlay the vector icon on the approved raster (aligned by badge circle)."""
    svg = write(TMP / "icon.svg", svg_icon_color())
    # Render with the same padding as the reference: badge r=409.71 in 1024,
    # our badge is full-bleed r=512 in 1024. So render ours at 2*512 = 1024
    # then composite into a 1024 canvas with the same margin as the reference.
    # Reference badge center (510.77, 505.52), r=409.71
    vec = render_to_size(svg, 1024)  # full-bleed
    # Place it so the badge matches the reference circle.
    canvas = Image.new("RGBA", (1024, 1024), (255, 255, 255, 255))
    # scale our 1024 (r=512) to r=409.71 → size = 1024 * 409.71/512
    target_d = int(round(1024 * 409.71 / 512.0))
    vec_r = vec.resize((target_d, target_d), Image.Resampling.LANCZOS)
    # top-left so center lands on (510.77, 505.52)
    x = int(round(510.77 - target_d / 2))
    y = int(round(505.52 - target_d / 2))
    canvas.paste(vec_r, (x, y), vec_r)
    ref = Image.open("/tmp/icon-ref.jpg").convert("RGBA")
    # side by side + difference
    sheet = Image.new("RGBA", (1024 * 3, 1024), (255, 255, 255, 255))
    sheet.paste(ref, (0, 0))
    sheet.paste(canvas, (1024, 0))
    # difference
    a = np_rgba(ref)
    b = np_rgba(canvas)
    import numpy as np
    diff = np.abs(a.astype(int) - b.astype(int)).mean(axis=2)
    # amplify
    vis = np.clip(diff * 3, 0, 255).astype("uint8")
    # also a 50/50 blend
    blend = Image.blend(ref, canvas, 0.5)
    diff_im = Image.fromarray(vis).convert("RGBA")
    # red-tint the diff and put it in the third slot as blend with red overlay
    sheet.paste(blend, (2048, 0))
    sheet.save(TMP / "compare-icon.png")
    # crop a tighter view of just the mark
    print("saved", TMP / "compare-icon.png")

    # lockup comparison
    lock = write(TMP / "lockup-h-dark.svg", assemble_lockup_h(True, pad=0))
    # render to similar size as the 1280x720 reference
    # We'll render large and letterbox onto 1280x720 #0B1220
    # First find rendered aspect
    # Use cairosvg without forcing height to preserve aspect, then fit
    out = TMP / "lockup-h-raw.png"
    cairosvg.svg2png(url=str(lock), write_to=str(out), output_width=1600)
    im = Image.open(out).convert("RGBA")
    bg = Image.new("RGBA", (1280, 720), (*hex_rgb(NAVY), 255))
    # scale to a similar icon size as the reference (icon d ≈ 327)
    # our lockup with pad=0: icon is 1024 in viewBox units. After render at 1600,
    # icon pixel size = 1600 * 1024 / viewBox_width
    # easier: scale so icon diameter is 327
    # We don't know exact pixel mapping; just fit im into the canvas with similar margins.
    # Reference content bbox was 134-1153, 192-519 — but our wordmark is wider
    # (real Poppins vs AI text). Fit locked-up graphic to a similar vertical size.
    target_h = 328  # icon diameter in the ref
    scale = target_h / 1024  # icon is 1024 units and with pad=0 the viewBox height may be >1024
    # get viewBox of lock
    # Safer: scale by height of the image to ~ 328 * (viewBox_h/1024)
    # Just scale so the image height (which includes ascender/descender) maps reasonably.
    # The icon is the full 1024 of the source; the rendered image includes only viewBox.
    # With pad=0, y0 may be slightly negative (t ascender) so height > 1024.
    new_w = int(im.width * (target_h / 1024))
    new_h = int(im.height * (target_h / 1024))
    im2 = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
    # center vertically, and place with a left margin similar to ref (134)
    lx = 134
    ly = (720 - new_h) // 2
    bg.alpha_composite(im2, (lx, ly))
    refL = Image.open("/tmp/lockup-ref.jpg").convert("RGBA")
    sheet2 = Image.new("RGBA", (1280 * 2, 720), (*hex_rgb(NAVY), 255))
    sheet2.paste(refL, (0, 0))
    sheet2.paste(bg, (1280, 0))
    sheet2.save(TMP / "compare-lockup.png")
    print("saved", TMP / "compare-lockup.png", "lockup render", new_w, new_h)


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def np_rgba(im):
    import numpy as np
    return np.array(im.convert("RGBA"))


# ---------------------------------------------------------------------------
# ICNS / ICO
# ---------------------------------------------------------------------------
def write_ico(src_1024: Image.Image, path: Path, sizes=(16, 24, 32, 48, 64, 128, 256)):
    # Save from the largest size so Pillow does not upscale a 16px frame.
    sizes = tuple(sorted(sizes, reverse=True))
    imgs = [src_1024.resize((s, s), Image.Resampling.LANCZOS) for s in sizes]
    imgs[0].save(path, format="ICO", sizes=[im.size for im in imgs],
                 append_images=imgs[1:])


def write_icns(src_1024: Image.Image, path: Path):
    try:
        import icnsutil
        from icnsutil import IcnsFile
    except ImportError:
        os.system("/tmp/brandvenv/bin/pip install -q icnsutil")
        import icnsutil
        from icnsutil import IcnsFile

    # Map of icns types
    # 16, 32, 64, 128, 256, 512, 1024 and @2x variants
    tmpdir = TMP / "icns_src"
    if tmpdir.exists():
        shutil.rmtree(tmpdir)
    tmpdir.mkdir()
    mapping = {
        "16x16": 16,
        "16x16@2x": 32,
        "32x32": 32,
        "32x32@2x": 64,
        "128x128": 128,
        "128x128@2x": 256,
        "256x256": 256,
        "256x256@2x": 512,
        "512x512": 512,
        "512x512@2x": 1024,
    }
    icns = IcnsFile()
    for name, size in mapping.items():
        p = tmpdir / f"{name}.png"
        src_1024.resize((size, size), Image.Resampling.LANCZOS).save(p)
        try:
            icns.add_media(file=str(p))
        except Exception as e:
            # fallback: try type key
            print("icns add_media warn", name, e)
    icns.write(str(path))


# ---------------------------------------------------------------------------
# Contact sheet
# ---------------------------------------------------------------------------
def label_font(size):
    for p in [
        "/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf",
        "/usr/share/fonts/truetype/sand-box/google/Poppins/Poppins-Medium.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size=size)
            except Exception:
                pass
    return ImageFont.load_default()


def paste_centered(dst, src, box, scale_to=None):
    """Paste src (RGBA) centered in box=(x,y,w,h) on dst, optionally scaled to height or width."""
    x, y, w, h = box
    im = src
    if scale_to == "contain":
        s = min(w / im.width, h / im.height)
        im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.Resampling.LANCZOS)
    cx = x + (w - im.width) // 2
    cy = y + (h - im.height) // 2
    if dst.mode != "RGBA":
        dst = dst.convert("RGBA")
    dst.alpha_composite(im, (cx, cy))
    return dst


def build_contact_sheet(assets: dict) -> Image.Image:
    """assets: name -> PIL image (RGBA)."""
    W = 2600
    margin = 56
    col_gap = 28
    section_h = 64
    # Define rows: (title, bg, items as (label, key, cell_w, cell_h))
    dark = hex_rgb(NAVY) + (255,)
    light = (255, 255, 255, 255)
    grey = (244, 244, 247, 255)
    checker_note = (236, 236, 240, 255)

    rows_spec = [
        ("Icon — full color & monochrome", [
            ("Full color", "icon", 280, 280, "checker"),
            ("Mono white", "mono_white", 280, 280, "dark"),
            ("Mono black", "mono_black", 280, 280, "light"),
            ("Glyph on dark", "glyph_dark", 280, 280, "dark"),
            ("Glyph on light", "glyph_light", 280, 280, "light"),
        ]),
        ("Tray — simplified template (shown at 8× for legibility; masters are 16 / 22 / 32)", [
            ("Tray white 16", "tray_w16", 200, 200, "dark"),
            ("Tray white 22", "tray_w22", 200, 200, "dark"),
            ("Tray white 32", "tray_w32", 200, 200, "dark"),
            ("Tray black 16", "tray_b16", 200, 200, "light"),
            ("Tray black 22", "tray_b22", 200, 200, "light"),
            ("Tray black 32", "tray_b32", 200, 200, "light"),
        ]),
        ("Lockup — horizontal", [
            ("On dark", "lock_h_dark", 1200, 360, "dark"),
            ("On light", "lock_h_light", 1200, 360, "light"),
        ]),
        ("Lockup — stacked", [
            ("On dark", "lock_s_dark", 520, 640, "dark"),
            ("On light", "lock_s_light", 520, 640, "light"),
        ]),
        ("Wordmark", [
            ("On dark", "wm_dark", 900, 260, "dark"),
            ("On light", "wm_light", 900, 260, "light"),
        ]),
        ("App & web", [
            ("App icon 256", "app_256", 280, 280, "checker"),
            ("Favicon 32 (4×)", "fav32", 200, 200, "light"),
            ("Apple touch 180", "apple180", 220, 220, "light"),
            ("OG 1200×630 (scaled)", "og", 800, 420, "dark"),
        ]),
    ]

    def cell_bg(kind, w, h):
        if kind == "dark":
            return Image.new("RGBA", (w, h), dark)
        if kind == "light":
            return Image.new("RGBA", (w, h), light)
        # checker
        im = Image.new("RGBA", (w, h), (226, 226, 232, 255))
        d = ImageDraw.Draw(im)
        s = 16
        for yy in range(0, h, s):
            for xx in range(0, w, s):
                if ((xx // s) + (yy // s)) % 2 == 0:
                    d.rectangle([xx, yy, xx + s - 1, yy + s - 1], fill=(245, 245, 248, 255))
        return im

    title_f = label_font(28)
    label_f = label_font(16)
    head_f = label_font(36)

    # measure height
    height = 140
    row_heights = []
    for title, items in rows_spec:
        cell_h = max(it[3] for it in items) + 36  # label under
        row_heights.append(section_h + cell_h + 24)
        height += row_heights[-1]

    sheet = Image.new("RGBA", (W, height), (250, 250, 252, 255))
    draw = ImageDraw.Draw(sheet)
    draw.text((margin, 36), "gteam  brand asset kit", font=head_f, fill=(20, 20, 28, 255))
    draw.text((margin, 84), "God Team  ·  Poppins Bold wordmark  ·  badge #1E1E26  ·  violet #8B5CF6 / #A78BFA",
              font=label_f, fill=(90, 90, 110, 255))

    y = 140
    for (title, items), rh in zip(rows_spec, row_heights):
        draw = ImageDraw.Draw(sheet)
        draw.text((margin, y + 10), title, font=title_f, fill=(30, 30, 40, 255))
        y_cells = y + section_h
        x = margin
        for label, key, cw, ch, kind in items:
            if x + cw > W - margin:
                # wrap within the row if needed (shouldn't)
                x = margin
                y_cells += ch + 40
            bg = cell_bg(kind, cw, ch)
            sheet.paste(bg, (x, y_cells))
            # inner padding
            if key in assets:
                img = assets[key]
                inner_pad = 16
                paste_centered(sheet, img, (x + inner_pad, y_cells + inner_pad,
                                            cw - 2 * inner_pad, ch - 2 * inner_pad),
                               scale_to="contain")
            draw = ImageDraw.Draw(sheet)
            draw.text((x, y_cells + ch + 6), label, font=label_f, fill=(70, 70, 85, 255))
            # hairline
            draw.rectangle([x, y_cells, x + cw, y_cells + ch], outline=(210, 210, 218, 255))
            x += cw + col_gap
        y += rh

    return sheet


# ---------------------------------------------------------------------------
# Preview / OG helpers
# ---------------------------------------------------------------------------
def composite_on(svg_path: Path, size: tuple[int, int], bg_hex: str, fill_ratio=0.72) -> Image.Image:
    bg = Image.new("RGBA", size, hex_rgb(bg_hex) + (255,))
    # render svg fairly large
    raw = TMP / f"_comp_{svg_path.stem}_{size[0]}x{size[1]}.png"
    # width such that the graphic fills fill_ratio of the shorter side or of width
    cairosvg.svg2png(url=str(svg_path), write_to=str(raw), output_width=size[0] * 2)
    im = Image.open(raw).convert("RGBA")
    max_w = int(size[0] * fill_ratio)
    max_h = int(size[1] * fill_ratio)
    s = min(max_w / im.width, max_h / im.height)
    im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.Resampling.LANCZOS)
    bg.alpha_composite(im, ((size[0] - im.width) // 2, (size[1] - im.height) // 2))
    return bg


# ---------------------------------------------------------------------------
# README
# ---------------------------------------------------------------------------
README = f'''# gteam brand assets

Logo and identity kit for **gteam** (God Team). The mark is a circular charcoal badge with a white eight-tooth gear, a key-like connecting arm ending in a ring joint, and a thin violet halo. The wordmark is lowercase **gteam** set in Poppins Bold.

These files are the source of truth for the desktop app, MCP tooling, the marketing site, and print.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| Badge | `{BADGE}` | Circular icon background |
| Badge glow | `{BADGE_GLOW}` → `{BADGE}` | Soft violet radial light in the lower-left of the badge |
| Navy | `{NAVY}` | Dark canvas, wordmark on light, body text |
| Violet | `{VIOLET}` | Halo (ends) |
| Violet light | `{VIOLET_LT}` | Halo (center) |
| White | `{WHITE}` | Gear, wordmark on dark, mono-white |

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
- `svg/icon.svg` and `png/icon-{{16,32,48,64,128,256,512,1024}}.png` — in-app about screens, settings, notifications at larger sizes.
- `svg/tray-white.svg`, `svg/tray-black.svg` and `png/tray-{{white,black}}-{{16,22,32}}.png` — menu-bar / system-tray template images (macOS-style: single color plus alpha, simplified 6-tooth construction, no halo, no glow). Use the white files on dark trays and the black files on light trays.

### Web
- `favicon.svg`, `favicon.ico`, `png/apple-touch-icon-180.png` — site favicons.
- `png/og-1200x630.png` — Open Graph / social share image (horizontal lockup on `{NAVY}`).
- `svg/lockup-horizontal-on-dark.svg` on `{NAVY}` or photography; `svg/lockup-horizontal-on-light.svg` on white or light grey.
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
'''


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main(compare_only=False):
    import numpy as np  # noqa: F401  (used in compare)
    TMP.mkdir(parents=True, exist_ok=True)
    SVG.mkdir(parents=True, exist_ok=True)
    PNG.mkdir(parents=True, exist_ok=True)
    APP.mkdir(parents=True, exist_ok=True)

    if compare_only:
        build_comparison()
        return

    # 1. SVGs
    files = {
        "icon": write(SVG / "icon.svg", svg_icon_color()),
        "icon-mono-white": write(SVG / "icon-mono-white.svg", svg_icon_mono(WHITE)),
        "icon-mono-black": write(SVG / "icon-mono-black.svg", svg_icon_mono(BLACK)),
        "icon-glyph-dark": write(SVG / "icon-glyph-dark.svg", svg_glyph(on_dark=True)),
        "icon-glyph-light": write(SVG / "icon-glyph-light.svg", svg_glyph(on_dark=False)),
        "tray-white": write(SVG / "tray-white.svg", svg_tray(WHITE)),
        "tray-black": write(SVG / "tray-black.svg", svg_tray(BLACK)),
        "lockup-horizontal-on-dark": write(SVG / "lockup-horizontal-on-dark.svg", assemble_lockup_h(True)),
        "lockup-horizontal-on-light": write(SVG / "lockup-horizontal-on-light.svg", assemble_lockup_h(False)),
        "lockup-stacked-on-dark": write(SVG / "lockup-stacked-on-dark.svg", assemble_lockup_stacked(True)),
        "lockup-stacked-on-light": write(SVG / "lockup-stacked-on-light.svg", assemble_lockup_stacked(False)),
        "wordmark-dark": write(SVG / "wordmark-dark.svg", assemble_wordmark(True)),
        "wordmark-light": write(SVG / "wordmark-light.svg", assemble_wordmark(False)),
    }
    # favicon svg = color icon
    shutil.copy(files["icon"], ROOT / "favicon.svg")
    shutil.copy(files["icon"], SVG / "favicon.svg")

    # 2. Icon PNG sizes
    icon_sizes = [16, 32, 48, 64, 128, 256, 512, 1024]
    icon_pngs = {}
    for s in icon_sizes:
        im = render_png(files["icon"], PNG / f"icon-{s}.png", s, s)
        icon_pngs[s] = im

    for name, bg_hint in [
        ("icon-mono-white", None),
        ("icon-mono-black", None),
        ("icon-glyph-dark", None),
        ("icon-glyph-light", None),
    ]:
        for s in [64, 128, 256, 512, 1024]:
            render_png(files[name], PNG / f"{name}-{s}.png", s, s)

    # tray
    tray_assets = {}
    for color in ("white", "black"):
        for s in (16, 22, 32):
            im = render_png(files[f"tray-{color}"], PNG / f"tray-{color}-{s}.png", s, s)
            # also an 8× preview for the contact sheet
            preview = render_png(files[f"tray-{color}"], TMP / f"tray-{color}-{s}-8x.png", s * 8, s * 8)
            tray_assets[f"tray_{color[0]}{s}"] = preview

    # lockups / wordmarks at useful widths
    def render_w(key, w, name=None):
        dest = PNG / f"{name or key}.png"
        return render_png(files[key], dest, w)

    lock_h_dark = render_w("lockup-horizontal-on-dark", 2000)
    lock_h_light = render_w("lockup-horizontal-on-light", 2000)
    lock_s_dark = render_w("lockup-stacked-on-dark", 1200)
    lock_s_light = render_w("lockup-stacked-on-light", 1200)
    wm_dark = render_w("wordmark-dark", 1600)
    wm_light = render_w("wordmark-light", 1600)

    # 3. Preview cards 1600×900
    preview_dark = composite_on(files["lockup-horizontal-on-dark"], (1600, 900), NAVY, fill_ratio=0.78)
    preview_light = composite_on(files["lockup-horizontal-on-light"], (1600, 900), WHITE, fill_ratio=0.78)
    preview_dark.convert("RGB").save(PNG / "preview-horizontal-dark-1600x900.png")
    preview_light.convert("RGB").save(PNG / "preview-horizontal-light-1600x900.png")

    # OG 1200×630
    og = composite_on(files["lockup-horizontal-on-dark"], (1200, 630), NAVY, fill_ratio=0.76)
    og.convert("RGB").save(PNG / "og-1200x630.png")

    # 4. App icon set
    master = icon_pngs[1024].resize((1024, 1024), Image.Resampling.LANCZOS)
    master.save(APP / "icon.png")
    icon_pngs[32].resize((32, 32), Image.Resampling.LANCZOS).save(APP / "32x32.png")
    icon_pngs[128].resize((128, 128), Image.Resampling.LANCZOS).save(APP / "128x128.png")
    icon_pngs[256].resize((256, 256), Image.Resampling.LANCZOS).save(APP / "128x128@2x.png")
    write_ico(master, APP / "icon.ico")
    write_ico(master, ROOT / "favicon.ico", sizes=(16, 32, 48))
    try:
        write_icns(master, APP / "icon.icns")
    except Exception as e:
        print("ICNS warning:", type(e), e)

    # apple touch 180 — full-bleed color icon on the badge (already circular)
    render_png(files["icon"], PNG / "apple-touch-icon-180.png", 180, 180)
    shutil.copy(PNG / "apple-touch-icon-180.png", ROOT / "apple-touch-icon.png") if False else None
    render_png(files["icon"], ROOT / "apple-touch-icon.png", 180, 180)

    # 5. Contact sheet
    # Scale tray previews already done. For favicon 32, show 4×.
    fav32 = render_png(files["icon"], TMP / "fav32-4x.png", 128, 128)
    assets = {
        "icon": icon_pngs[256],
        "mono_white": Image.open(PNG / "icon-mono-white-256.png"),
        "mono_black": Image.open(PNG / "icon-mono-black-256.png"),
        "glyph_dark": Image.open(PNG / "icon-glyph-dark-256.png"),
        "glyph_light": Image.open(PNG / "icon-glyph-light-256.png"),
        **tray_assets,
        "lock_h_dark": lock_h_dark,
        "lock_h_light": lock_h_light,
        "lock_s_dark": lock_s_dark,
        "lock_s_light": lock_s_light,
        "wm_dark": wm_dark,
        "wm_light": wm_light,
        "app_256": icon_pngs[256],
        "fav32": fav32,
        "apple180": Image.open(PNG / "apple-touch-icon-180.png"),
        "og": og,
    }
    sheet = build_contact_sheet(assets)
    sheet.convert("RGB").save(ROOT / "contact-sheet.png", quality=95)
    print("contact sheet", sheet.size)

    # 6. README
    (ROOT / "README.md").write_text(README)

    # 7. Comparison overlays for QA (not part of the kit, live in /tmp)
    build_comparison()

    print("done. svg files:", len(list(SVG.glob('*.svg'))))


if __name__ == "__main__":
    import sys
    main(compare_only=("--compare" in sys.argv))

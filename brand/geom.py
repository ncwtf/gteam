"""Boolean-union geometry for the gteam mark. Returns SVG path `d` strings."""
from __future__ import annotations
import math
from shapely.geometry import Point, Polygon, LineString, LinearRing
from shapely.ops import unary_union
from shapely.validation import make_valid

# Re-export construction from build once we pass params in.

def circle(cx, cy, r, res=32):
    return Point(cx, cy).buffer(r, resolution=res)


def sample_arc(ctr, r, a1, a2, sweep, n=12):
    """Points from a1 to a2 (radians), inclusive. sweep=1 means a increases (y-down CW)."""
    da = a2 - a1
    if sweep == 1:
        while da < 0:
            da += 2 * math.pi
        while da > 2 * math.pi:
            da -= 2 * math.pi
    else:
        while da > 0:
            da -= 2 * math.pi
        while da < -2 * math.pi:
            da += 2 * math.pi
    pts = []
    steps = max(n, int(abs(da) / (math.pi / 24)))
    for i in range(steps + 1):
        a = a1 + da * i / steps
        pts.append((ctr[0] + r * math.cos(a), ctr[1] + r * math.sin(a)))
    return pts


def fillet_corner(p0, c, p1, r):
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
    da = a2 - a1
    while da > math.pi:
        da -= 2 * math.pi
    while da < -math.pi:
        da += 2 * math.pi
    mid_wanted = (ctr[0] - bis[0] * r, ctr[1] - bis[1] * r)
    mid_short = (ctr[0] + r * math.cos(a1 + da / 2), ctr[1] + r * math.sin(a1 + da / 2))
    use_short = math.hypot(mid_short[0] - mid_wanted[0], mid_short[1] - mid_wanted[1]) < r
    if use_short:
        sweep = 1 if da > 0 else 0
    else:
        sweep = 0 if da > 0 else 1
    return t1, t2, ctr, r, sweep


def rounded_polygon(corners, radius, n_arc=10):
    pts = []
    n = len(corners)
    for i in range(n):
        p0 = corners[(i - 1) % n]
        c = corners[i]
        p1 = corners[(i + 1) % n]
        fil = fillet_corner(p0, c, p1, radius)
        if fil is None:
            pts.append(c)
        else:
            t1, t2, ctr, r, sweep = fil
            a1 = math.atan2(t1[1] - ctr[1], t1[0] - ctr[0])
            a2 = math.atan2(t2[1] - ctr[1], t2[0] - ctr[0])
            arc = sample_arc(ctr, r, a1, a2, sweep, n=n_arc)
            pts.extend(arc)
    # close if needed
    if pts and (pts[0] != pts[-1]):
        pts.append(pts[0])
    return Polygon(pts)


def local_to_world(x, y, axis_deg, cx, cy):
    a = math.radians(axis_deg)
    return (cx + x * math.cos(a) - y * math.sin(a),
            cy + x * math.sin(a) + y * math.cos(a))


def tooth_poly(axis_deg, cx, cy, Rr, Rt, tw, alpha, rho):
    rl = local_to_world(Rr * math.cos(alpha), -Rr * math.sin(alpha), axis_deg, cx, cy)
    tl = local_to_world(Rt, -tw, axis_deg, cx, cy)
    tr = local_to_world(Rt, tw, axis_deg, cx, cy)
    rr = local_to_world(Rr * math.cos(alpha), Rr * math.sin(alpha), axis_deg, cx, cy)
    return rounded_polygon([rl, tl, tr, rr], rho)


def arm_poly(hx, hy, ex, ey, half_w, r0, r1):
    a = math.atan2(ey - hy, ex - hx)
    ux, uy = math.cos(a), math.sin(a)
    px, py = -uy, ux
    pts = [
        (hx + ux * r0 + px * half_w, hy + uy * r0 + py * half_w),
        (hx + ux * r1 + px * half_w, hy + uy * r1 + py * half_w),
        (hx + ux * r1 - px * half_w, hy + uy * r1 - py * half_w),
        (hx + ux * r0 - px * half_w, hy + uy * r0 - py * half_w),
    ]
    return Polygon(pts)


def halo_poly(hx, hy, r, sw, a0, a1, res=64):
    da = a1 - a0
    n = max(res, int(abs(da) / 2))
    pts = []
    for i in range(n + 1):
        a = a0 + da * i / n
        pts.append((hx + r * math.cos(math.radians(a)),
                    hy + r * math.sin(math.radians(a))))
    line = LineString(pts)
    return line.buffer(sw / 2.0, resolution=16, cap_style=1, join_style=1)


def shapely_to_d(geom) -> str:
    geoms = []
    if geom.is_empty:
        return ""
    g = make_valid(geom)
    t = g.geom_type
    if t == "Polygon":
        geoms = [g]
    elif t == "MultiPolygon":
        geoms = list(g.geoms)
    elif t == "GeometryCollection":
        geoms = [p for p in g.geoms if p.geom_type in ("Polygon", "MultiPolygon")]
        more = []
        for p in geoms:
            if p.geom_type == "MultiPolygon":
                more.extend(p.geoms)
            else:
                more.append(p)
        geoms = more
    else:
        raise ValueError(f"Cannot path-ify {t}")

    def ring_d(coords):
        coords = list(coords)
        if len(coords) < 3:
            return ""
        # drop closing duplicate for a cleaner Z
        if coords[0] == coords[-1]:
            coords = coords[:-1]
        parts = [f"M{coords[0][0]:.3f} {coords[0][1]:.3f}"]
        for x, y in coords[1:]:
            parts.append(f"L{x:.3f} {y:.3f}")
        parts.append("Z")
        return " ".join(parts)

    bits = []
    for poly in geoms:
        bits.append(ring_d(poly.exterior.coords))
        for inter in poly.interiors:
            bits.append(ring_d(inter.coords))
    return " ".join(b for b in bits if b)


def build_mark(hx, hy, root_r, tip_r, hole_r, tw, alpha, rho,
               tooth_axes, arm_tooth_axis,
               ex, ey, end_outer, end_inner, arm_half_w,
               res=32):
    parts = [circle(hx, hy, root_r, res=res)]
    for axis in tooth_axes:
        if abs((axis % 360) - (arm_tooth_axis % 360)) < 0.5:
            continue
        parts.append(tooth_poly(axis, hx, hy, root_r, tip_r, tw, alpha, rho))
    parts.append(arm_poly(hx, hy, ex, ey, arm_half_w, hole_r * 0.4, math.hypot(ex - hx, ey - hy)))
    parts.append(circle(ex, ey, end_outer, res=res))
    union = unary_union(parts)
    union = union.difference(circle(hx, hy, hole_r, res=res))
    union = union.difference(circle(ex, ey, end_inner, res=res))
    return make_valid(union)

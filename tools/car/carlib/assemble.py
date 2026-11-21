"""Builds the whole car for one level of detail as a Blender object hierarchy with named,
pivoted nodes. Geometry only; materials are attached by name from a dict the caller provides."""

import math

import bpy
from mathutils import Matrix, Vector

from . import body, cockpit, dims as D, wheels, wings
from .geom import Mesh, loft


def gl(p):
    """Build frame (+X fwd, +Y left, +Z up) to glTF frame (+X fwd, +Y up, +Z right), rounded."""
    return [round(p[0], 5), round(p[2], 5), round(-p[1], 5)]


KINGPIN_Y = 0.672

# Fewer materials (draw calls) for the lower levels of detail
REMAP = {
    "high": {},
    "mobile": {"soot": "dark", "plank": "dark", "tcam": "dark", "headrest": "dark", "interior": "dark",
               "nut": "rim", "boot": "dark", "paint_edge": "paint", "metal_satin": "metal_dark",
               "exhaust": "metal_dark", "caliper": "metal_dark", "grip": "dark"},
}
REMAP["far"] = dict(REMAP["mobile"], **{"mirror_glass": "dark", "wheel_cover": "rim", "carbon_matte": "carbon",
                                        "visor": "dark", "brake_disc": "metal_dark"})


class Car:
    def __init__(self, lod):
        self.lod = lod
        self.q = body.Q(lod)
        self.patches = []
        self.static = Mesh()
        self.nodes = []  # (name, parent, pivot (world), Mesh or None, extras)
        self.stats = {}

    def node(self, name, parent, pivot, mesh=None, extras=None):
        self.nodes.append((name, parent, Vector(pivot), mesh, extras or {}))

    def count(self, label, mesh):
        self.stats[label] = self.stats.get(label, 0) + mesh.tri_count()


def build(lod):
    car = Car(lod)
    q = car.q
    paint, carbon, dark = Mesh(), Mesh(), Mesh()
    far = lod == "far"

    body.build_spine(paint, dark, car.patches, q)
    body.build_sidepods(paint, dark, car.patches, q)
    body.build_airbox(paint, dark, car.patches, q)
    body.build_floor(carbon, dark, q)
    body.build_rear(carbon, dark, q)
    wings.build_front_wing(paint, carbon, car.patches, q)
    flap = Mesh()
    wings.build_rear_wing(paint, carbon, flap, car.patches, q)
    wings.build_beam_wing(carbon, q)
    cockpit.build_halo(paint, car.patches, q)
    cockpit.build_headrest(dark, q)
    cockpit.build_mirrors(paint, carbon, dark, car.patches, q)
    if not far:
        cockpit.build_tcam(dark, q)
    for label, m in (("paint", paint), ("carbon", carbon), ("dark", dark)):
        car.count("body_" + label, m)
        car.static.merge(m)
    car.node("body", "car", (0, 0, 0), car.static)

    # rear crash structure tip: rain light
    rl = Mesh()
    x = D.X_CRASH_TIP - 0.004
    zc = D.Z_CRASH_CENTRE
    pts = [Vector((x, y, z)) for (y, z) in ((0.045, zc - 0.030), (-0.045, zc - 0.030), (-0.045, zc + 0.030),
                                            (0.045, zc + 0.030))]
    i0 = rl.add_verts(pts)
    rl.add_face((i0, i0 + 1, i0 + 2, i0 + 3), "rain_light", uv1=[(0, 0), (1, 0), (1, 1), (0, 1)])
    car.node("rain_light", "car", (x, 0, zc), rl)

    # DRS flap: hinge at the flap trailing edge, spanwise
    hinge = wings.drs_hinge()
    car.count("drs_flap", flap)
    car.node("drs_flap", "car", (hinge.x, 0, hinge.z), flap,
             {"axis": "z", "open_deg": D.DRS_OPEN_DEG, "rest": "closed"})

    # cockpit: steering wheel and helmet
    sw = cockpit.build_steering_wheel(q) if not far else Mesh()
    pitch = math.radians(D.STEERING_COLUMN_PITCH_DEG)
    # built facing +X; turn it to face the driver (-X) and tilt the face up towards the eyes
    sw = sw.transformed(Matrix.Rotation(pitch, 4, "Y") @ Matrix.Rotation(math.pi, 4, "Z"))
    car.count("steering_wheel", sw)
    if not far:
        car.node("steering_wheel", "car", D.STEERING_WHEEL_CENTRE, sw.translate(D.STEERING_WHEEL_CENTRE),
                 {"axis": gl([-math.cos(pitch), 0.0, math.sin(pitch)])})
    hm = cockpit.build_helmet(q, car.patches)
    hc = Vector(D.HELMET_CENTRE)
    neck = hc + Vector((-0.02, 0, -0.10))
    hm.translate(hc)
    car.count("helmet", hm)
    car.node("helmet", "car", neck, hm, {"axis": "y"})

    # corners
    segs = {"high": 64, "mobile": 32, "far": 14}[lod]
    for corner in ("FL", "FR", "RL", "RR"):
        front = corner[0] == "F"
        left = corner[1] == "L"
        track = D.TRACK_FRONT if front else D.TRACK_REAR
        x = D.X_FRONT_AXLE if front else D.X_REAR_AXLE
        y = track / 2 * (1 if left else -1)
        ctr = Vector((x, y, D.WHEEL_Z))
        width = D.TYRE_WIDTH_FRONT if front else D.TYRE_WIDTH_REAR
        rim_w = D.RIM_WIDTH_FRONT if front else D.RIM_WIDTH_REAR
        mirror = Matrix.Scale(-1, 4, Vector((0, 1, 0))) if not left else Matrix.Identity(4)

        def place(m):
            return m.transformed(mirror).translate(ctr)

        tyre = wheels.build_tyre(width, q, segs)
        rim = wheels.build_rim(rim_w, q, segs, car.patches)
        wheel = Mesh().merge(tyre).merge(rim)
        wheel = place(wheel)
        car.count("wheels", wheel)
        car.node("suspension_" + corner, "car", ctr, None, {"axis": "y", "travel": "translation"})
        parent = "suspension_" + corner
        if front:
            # kingpin: vertical through the outboard ball joints, inside the wheel
            kp = Vector((x, KINGPIN_Y * (1 if left else -1), D.WHEEL_Z))
            car.node("steer_" + corner, parent, kp, None, {"axis": "y"})
            parent = "steer_" + corner
        if not far:
            up = place(wheels.build_upright(front, q))
            car.count("uprights", up)
            car.node("upright_" + corner, parent, ctr, up)
        car.node("wheel_" + corner, parent, ctr, wheel, {"axis": "z"})
        if not far:
            disc = place(wheels.build_disc(rim_w, q, segs // 2, front))
            car.count("brake_discs", disc)
            car.node("brake_disc_" + corner, "wheel_" + corner, ctr, disc)

    # suspension links: one node per link, pivot at the inboard end
    sign = {"L": 1, "R": -1}

    def mir(p, side):
        return Vector((p[0], p[1] * sign[side], p[2]))

    links = {
        "F": [("lower", [D.FRONT_LOWER_FRONT_IN, D.FRONT_LOWER_REAR_IN, D.FRONT_LOWER_OUT]),
              ("upper", [D.FRONT_UPPER_FRONT_IN, D.FRONT_UPPER_REAR_IN, D.FRONT_UPPER_OUT]),
              ("trackrod", [D.FRONT_TRACK_ROD_IN, D.FRONT_TRACK_ROD_OUT]),
              ("pushrod", [D.FRONT_PUSHROD_IN, D.FRONT_PUSHROD_OUT])],
        "R": [("lower", [D.REAR_LOWER_FRONT_IN, D.REAR_LOWER_REAR_IN, D.REAR_LOWER_OUT]),
              ("upper", [D.REAR_UPPER_FRONT_IN, D.REAR_UPPER_REAR_IN, D.REAR_UPPER_OUT]),
              ("toelink", [D.REAR_TOE_LINK_IN, D.REAR_TOE_LINK_OUT]),
              ("pullrod", [D.REAR_PULLROD_IN, D.REAR_PULLROD_OUT])],
    }
    def on_chassis(p):
        """Inboard pick-ups sit on the chassis or gearbox surface, never in the air beside it."""
        x, y, z = p
        sp = body.spine_params(x)
        z = min(max(z, sp[1] + 0.03), sp[3] - 0.035)
        w = body.spine_half_width_at(x, z)
        return (x, min(y, max(0.04, w - 0.006)), z)

    for corner in ("FL", "FR", "RL", "RR"):
        axle, side = corner[0], corner[1]
        for kind, pts in links[axle]:
            pts = [on_chassis(p) for p in pts[:-1]] + [pts[-1]]
            wp = [mir(p, side) for p in pts]
            wish = kind in ("lower", "upper")
            m = cockpit.link_mesh(wp, q, chord=0.075 if wish else 0.05, thick=0.022 if wish else 0.018)
            inb = wp[0].lerp(wp[1], 0.5) if len(wp) == 3 else wp[0]
            out = wp[-1]
            car.count("suspension", m)
            attach = "steer_" + corner if axle == "F" else "suspension_" + corner
            if far:
                car.static.merge(m)
                continue
            car.node("arm_%s_%s" % (corner, kind), "car", inb, m,
                     {"outboard": gl(out), "follows": attach})
        if axle == "R" and not far:
            ds = cockpit.driveshaft(q, D.TRACK_REAR / 2 - 0.2)
            if side == "R":
                ds = ds.mirrored_y()
            car.count("suspension", ds)
            car.node("driveshaft_" + corner, "car", (D.X_REAR_AXLE, 0.14 * sign[side], D.WHEEL_Z - 0.03), ds,
                     {"outboard": gl((D.X_REAR_AXLE, (D.TRACK_REAR / 2 - 0.2) * sign[side], D.WHEEL_Z)),
                      "follows": "upright_" + corner})
    return car


def to_blender(car, materials, collection):
    """Create the object hierarchy. Every node's origin is its pivot; rest rotations are identity."""
    objs = {}
    root = bpy.data.objects.new("car", None)
    collection.objects.link(root)
    root["lod"] = car.lod
    objs["car"] = root
    for name, parent, pivot, mesh, extras in car.nodes:
        if mesh is not None:
            local = Mesh().merge(mesh).translate(-pivot)
            local.mat = [REMAP[car.lod].get(m, m) for m in local.mat]
            ob = local.to_object(name, materials, collection, sharp_angle_deg=38.0, merge_dist=1e-5,
                                 recalc=not name.startswith("wheel_"))
        else:
            ob = bpy.data.objects.new(name, None)
            collection.objects.link(ob)
        par = objs[parent]
        ob.parent = par
        ppiv = Vector((0, 0, 0)) if parent == "car" else next(n[2] for n in car.nodes if n[0] == parent)
        ob.location = pivot - ppiv
        for k, v in extras.items():
            ob[k] = v
        objs[name] = ob
    return objs

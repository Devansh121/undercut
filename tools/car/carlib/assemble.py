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
BUMP_REF = 0.030  # metres of wheel travel represented by a link morph target at influence 1
STEER_REF = 0.35  # radians of road-wheel steer represented by a steer morph target at influence 1

# Materials merged per level of detail, to keep draw calls down (High about 40, Mobile about 20)
_MINOR = {"soot": "dark", "plank": "dark", "tcam": "dark", "headrest": "dark", "interior": "dark",
          "boot": "dark", "paint_edge": "paint", "metal_satin": "metal_dark", "caliper": "metal_dark",
          "grip": "dark", "nut": "rim"}
REMAP = {
    "high": dict(_MINOR),
    "mobile": dict(_MINOR, **{"carbon_matte": "carbon", "mirror_glass": "dark", "metal_dark": "dark",
                              "exhaust": "dark", "visor": "dark"}),
}
REMAP["far"] = dict(REMAP["mobile"], **{"brake_disc": "dark"})
# per node, extra merges that only make sense there (a cover on a Mobile wheel is rim-coloured)
NODE_REMAP = {
    "mobile": {"wheel": {"paint": "rim"}, "upright": {"carbon": "brake_disc", "dark": "brake_disc"},
               "suspension": {"metal_dark": "carbon", "dark": "carbon"},
               "drs_flap": {"carbon": "paint"}, "steering_wheel": {"paint": "carbon"}},
    "far": {"wheel": {"paint": "tyre", "rim": "tyre"}, "drs_flap": {"carbon": "paint"}},
    "high": {"upright": {"metal_dark": "carbon", "dark": "carbon"}, "drs_flap": {"carbon": "paint"},
             "suspension": {"metal_dark": "carbon", "dark": "carbon"}},
}


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


def _rigid(mesh, lo, hi, pivot, rest_out, new_out):
    """Positions of vertices lo..hi after rotating a link about its inboard pivot so that its
    outboard joint moves from rest_out to new_out."""
    q = (rest_out - pivot).rotation_difference(new_out - pivot)
    return [pivot + q @ (mesh.v[i] - pivot) for i in range(lo, hi)]


def build(lod):
    car = Car(lod)
    q = car.q
    paint, carbon, dark = Mesh(), Mesh(), Mesh()
    far = lod == "far"

    body.build_spine(paint, dark, car.patches, q)
    body.build_intake(paint, dark, q)
    body.build_sidepods(paint, dark, car.patches, q)
    body.build_floor(carbon, dark, q)
    body.build_rear(carbon, dark, q)
    wings.build_front_wing(paint, carbon, car.patches, q)
    flap = Mesh()
    wings.build_rear_wing(paint, carbon, flap, car.patches, q)
    wings.build_beam_wing(carbon, q)
    cockpit.build_halo(paint, car.patches, q)
    cockpit.build_headrest(dark, q)
    if not far:
        # parts too small to read on a car in the distance
        cockpit.build_halo_mounts(paint, q)
        cockpit.build_mirrors(paint, carbon, dark, car.patches, q)
        cockpit.build_tcam(dark, q)
        cockpit.build_driver(paint, dark, q)
        cockpit.build_cockpit_padding(dark, q)
    for label, m in (("paint", paint), ("carbon", carbon), ("dark", dark)):
        car.count("body_" + label, m)
        car.static.merge(m)
    car.node("body", "car", (0, 0, 0), car.static)

    # rain light: the lamp sits just behind the bezel on the crash-structure tip
    rl = Mesh()
    x = D.X_CRASH_TIP - 0.002
    zc = D.Z_CRASH_CENTRE
    lw, lh = body.RAIN_LIGHT
    pts = [Vector((x, y, zc + z)) for (y, z) in ((lw, -lh), (-lw, -lh), (-lw, lh), (lw, lh))]
    i0 = rl.add_verts(pts)
    rl.add_face((i0, i0 + 1, i0 + 2, i0 + 3), "rain_light", uv1=[(0, 0), (1, 0), (1, 1), (0, 1)])
    car.node("rain_light", "car", (x, 0, zc), rl)

    # DRS flap: hinge at the flap trailing edge, spanwise
    hinge = wings.drs_hinge()
    car.count("drs_flap", flap)
    car.node("drs_flap", "car", (hinge.x, 0, hinge.z), flap,
             {"axis": "z", "open_deg": D.DRS_OPEN_DEG, "rest": "closed"})

    # cockpit: steering wheel with the driver's gloves, and the helmet
    if not far:
        sw = cockpit.build_steering_wheel(q).merge(cockpit.build_gloves(q))
        pitch = math.radians(D.STEERING_COLUMN_PITCH_DEG)
        # built facing +X; turn it to face the driver (-X) and tilt the face up towards the eyes
        sw = sw.transformed(Matrix.Rotation(pitch, 4, "Y") @ Matrix.Rotation(math.pi, 4, "Z"))
        car.count("steering_wheel", sw)
        car.node("steering_wheel", "car", D.STEERING_WHEEL_CENTRE, sw.translate(D.STEERING_WHEEL_CENTRE),
                 {"axis": gl([-math.cos(pitch), 0.0, math.sin(pitch)])})
    hm = cockpit.build_helmet(q, car.patches)
    hc = Vector(D.HELMET_CENTRE)
    neck = hc + Vector((-0.02, 0, -0.10))
    hm.translate(hc)
    car.count("helmet", hm)
    car.node("helmet", "car", neck, hm, {"axis": "y"})

    # corners
    segs = {"high": 64, "mobile": 40, "far": 16}[lod]
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
        if not left:
            # mirrored wheels read their sidewall texture the right way round
            tyre.uv1 = [[(1.0 - u, v) for (u, v) in uv] for uv in tyre.uv1]
        rim = wheels.build_rim(rim_w, q, segs, car.patches)
        wheel = place(Mesh().merge(tyre).merge(rim))
        car.count("wheels", wheel)
        car.node("suspension_" + corner, "car", ctr, None, {"axis": "y", "travel": "translation"})
        parent = "suspension_" + corner
        if front:
            # kingpin: vertical through the outboard ball joints, inside the wheel
            kp = Vector((x, KINGPIN_Y * (1 if left else -1), D.WHEEL_Z))
            car.node("steer_" + corner, parent, kp, None, {"axis": "y"})
            parent = "steer_" + corner
        if not far:
            # the disc is a solid of revolution with no markings, so it rides on the upright
            # (which does not spin) and its glow material is per corner there
            up = place(Mesh().merge(wheels.build_upright(front, q)).merge(wheels.build_disc(rim_w, q, segs // 2, front)))
            car.count("uprights", up)
            car.node("upright_" + corner, parent, ctr, up)
        car.node("wheel_" + corner, parent, ctr, wheel, {"axis": "z"})

    # suspension links and driveshafts: one mesh, rigid links in their rest pose, with morph
    # targets for each corner's bump travel and each front corner's steer
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
        w = body.spine_y(x, z)
        return (x, min(y, max(0.04, w - 0.006)), z)

    lm = Mesh()
    segs_l = []  # (lo, hi, pivot, outboard, corner)
    for corner in ("FL", "FR", "RL", "RR"):
        axle, side = corner[0], corner[1]
        for kind, pts in links[axle]:
            pts = [on_chassis(p) for p in pts[:-1]] + [pts[-1]]
            wp = [mir(p, side) for p in pts]
            wish = kind in ("lower", "upper")
            m = cockpit.link_mesh(wp, q, chord=0.075 if wish else 0.05, thick=0.022 if wish else 0.018)
            if len(wp) == 3:
                # the two legs of a wishbone share the hinge line through both inboard joints
                pivot = wp[0].lerp(wp[1], 0.5)
            else:
                pivot = wp[0]
            lo = len(lm.v)
            lm.merge(m)
            segs_l.append((lo, len(lm.v), pivot, wp[-1], corner))
        if axle == "R":
            ds = cockpit.driveshaft(q, D.TRACK_REAR / 2 - 0.2)
            if side == "R":
                ds = ds.mirrored_y()
            lo = len(lm.v)
            lm.merge(ds)
            segs_l.append((lo, len(lm.v), Vector((D.X_REAR_AXLE, 0.14 * sign[side], D.WHEEL_Z - 0.03)),
                           Vector((D.X_REAR_AXLE, (D.TRACK_REAR / 2 - 0.2) * sign[side], D.WHEEL_Z)), corner))
    if far:
        # links are thinner than a pixel on a car this far away
        return car
    car.count("suspension", lm)
    targets = {}
    for corner in ("FL", "FR", "RL", "RR"):
        pos = [v.copy() for v in lm.v]
        for lo, hi, piv, out, c in segs_l:
            if c == corner:
                pos[lo:hi] = _rigid(lm, lo, hi, piv, out, out + Vector((0, 0, BUMP_REF)))
        targets["bump_" + corner] = pos
    for corner in ("FL", "FR"):
        kp = Vector((D.X_FRONT_AXLE, KINGPIN_Y * sign[corner[1]], D.WHEEL_Z))
        rot = Matrix.Rotation(STEER_REF, 3, "Z")
        pos = [v.copy() for v in lm.v]
        for lo, hi, piv, out, c in segs_l:
            if c == corner:
                pos[lo:hi] = _rigid(lm, lo, hi, piv, out, kp + rot @ (out - kp))
        targets["steer_" + corner] = pos
    car.node("suspension_links", "car", (0, 0, 0), lm,
             {"morph": {"bump_ref_m": BUMP_REF, "steer_ref_rad": STEER_REF}, "_targets": targets})
    return car


def to_blender(car, materials, collection):
    """Create the object hierarchy. Every node's origin is its pivot; rest rotations are identity.
    Meshes are triangulated here and checked: an edge shared by more than two faces, or an open
    edge on a part that is meant to be closed, fails the build."""
    objs = {}
    problems = []
    root = bpy.data.objects.new("car", None)
    collection.objects.link(root)
    root["lod"] = car.lod
    objs["car"] = root
    for name, parent, pivot, mesh, extras in car.nodes:
        if mesh is not None:
            group = name.split("_")[0]
            remap = dict(REMAP[car.lod], **NODE_REMAP[car.lod].get(group, NODE_REMAP[car.lod].get(name, {})))
            local = Mesh().merge(mesh).translate(-pivot).triangulated()
            if "_targets" not in extras:
                local.drop_degenerate()
            def resolve(m):
                seen = set()
                while m in remap and m not in seen:
                    seen.add(m)
                    m = remap[m]
                return m

            local.mat = [resolve(m) for m in local.mat]
            problems += local.check_manifold("%s/%s" % (car.lod, name))
            morph = "_targets" in extras
            ob = local.to_object(name, materials, collection, sharp_angle_deg=38.0,
                                 merge_dist=0.0 if morph else 1e-5, recalc=not name.startswith("wheel_") and not morph)
            if morph:
                ob.shape_key_add(name="Basis", from_mix=False)
                for tname, pos in extras["_targets"].items():
                    kb = ob.shape_key_add(name=tname, from_mix=False)
                    flat = []
                    for p in pos:
                        flat.extend(p - pivot)
                    kb.data.foreach_set("co", flat)
        else:
            ob = bpy.data.objects.new(name, None)
            collection.objects.link(ob)
        par = objs[parent]
        ob.parent = par
        ppiv = Vector((0, 0, 0)) if parent == "car" else next(n[2] for n in car.nodes if n[0] == parent)
        ob.location = pivot - ppiv
        for k, v in extras.items():
            if not k.startswith("_"):
                ob[k] = v
        objs[name] = ob
    if problems:
        raise SystemExit("Mesh topology check failed:\n  " + "\n  ".join(problems))
    return objs

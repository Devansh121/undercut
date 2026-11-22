"""Branch-authored conifers: drooping tiers of separate needle sprays, at every level of detail.

The Far level is the Mobile tree itself. Far is drawn only beyond 250 m, and no cheaper stand-in
held the tree's tone and density at that swap (docs/circuit-model-kits.md has the measurements):
crossed cards shade from mip-averaged normals and alpha that the near sprays never have, and
sparser geometry changes how much sky shows through the crown.
"""
import math
import bpy
import numpy as np
from mathutils import Vector

_CACHE = {}
COLOUR = np.array((.023, .041, .018))


def authored(fir, detailed):
    """Two distinct habits: narrow pendulous spruce, broad irregular fir whorls."""
    vertices, faces, tints = [], [], []
    h, radius = (15., 3.2) if fir else (18., 2.8)

    def leaf(points, tint):
        start = len(vertices)
        vertices.extend(points)
        faces.extend([(start, start+1, start+2), (start, start+2, start+3)])
        tints.extend([tint] * 4)

    tiers = 17 if fir else 22
    for tier in range(tiers):
        t = tier / tiers
        z = 2.1 + t * (h-2.8) + .15*math.sin(tier*4.31)
        envelope = radius * (1-t)**(.72 if fir else .9)
        count = 6 if fir else 7
        for branch in range(count):
            phase = tier * 2.399963 + branch * math.tau/count
            jitter = math.sin(tier*17.3+branch*29.1)
            length = envelope*(.79+.18*jitter)
            # A few missing limbs leave air through the crown rather than continuous skirts.
            if (tier*13+branch*7) % 19 == 3:
                continue
            radial = Vector((math.cos(phase), math.sin(phase), 0))
            across = Vector((-radial.y, radial.x, 0))
            root = Vector((0, 0, z))
            drop = (.27 if fir else .65)*length
            tip = root + radial*length + Vector((0, 0, -drop))
            # The final 15% turns up on fir, hangs in pendant spruce branchlets.
            twigs = 6 if fir else 5
            for twig in range(twigs):
                f = .2 + twig*(.87/twigs)
                centre = root.lerp(tip, f) + Vector((0, 0, .15*math.sin(f*math.pi)))
                span = length*(1-f)*(.48 if fir else .34)+.08
                tint = .68 + .22*(.5+.5*math.sin(tier*11+branch*5+twig*3))
                for side in (-1, 1):
                    end = centre + across*(span*side) + radial*(length*.15)
                    end.z += (.04 if fir else -.20) - .10*math.sin(twig*2+branch)
                    width = (.14 if fir else .115) + span*.12
                    along = radial * (.18 + .16*(1-f))
                    # Bent, tapered needle sprays. Independent geometry leaves irregular holes.
                    points = [centre-along*.25, end-along*.45+Vector((0,0,-width*.2)),
                              end+along*.7+Vector((0,0,width)), centre+along*.65]
                    leaf([tuple(p) for p in points], tint)
                    if detailed:
                        # Raised central spray adds volume at close range without moving tips.
                        mid = centre.lerp(end, .55)
                        leaf([tuple(centre), tuple(mid+along*.8),
                              tuple(end+Vector((0,0,width*.65))), tuple(mid-along*.4)], tint*.9)
            # Sparse growing tip prevents a squared-off branch end.
            leaf([tuple(root.lerp(tip,.75)-across*.12), tuple(tip-across*.03),
                  tuple(tip+Vector((0,0,.21 if fir else -.12))), tuple(root.lerp(tip,.75)+across*.12)], .84)
    # Leader shoot: several small irregular sprays, never an opaque cone.
    for k in range(7):
        z = h-.9+k*.13
        angle = k*2.399963
        r = .20*(1-k/8)
        p = Vector((math.cos(angle)*r, math.sin(angle)*r, z))
        leaf([(0,0,z-.2), tuple(p), (0,0,z+.16), tuple(p*.5+Vector((0,0,z*.5)))], .9)
    return np.array(vertices), faces, np.array(tints), h, radius


def build(g, ident):
    fir = ident.endswith('fir')
    if ident not in _CACHE:
        _CACHE[ident] = authored(fir, True)
    high = _CACHE[ident]
    vertices, faces, tints, h, radius = high if g['lod'] == 0 else authored(fir, False)
    name = ident+'-needles'
    # Each LOD owns a fresh material.
    old = bpy.data.materials.get(name)
    if old: old.name = name+'-previous'
    leaf = g['material'](name, tuple(COLOUR), .96, double=True)
    bark = bpy.data.materials.get('forest-bark') or g['material']('forest-bark', (.052,.039,.025), .96, tex_kind='grain')
    g['tapered_rod']('trunk', (0,0,0), (0,0,h-.2), .18, .02, bark, segs=8)
    mesh = bpy.data.meshes.new('individual-needle-sprays')
    mesh.from_pydata(vertices.tolist(), [], faces)
    ob = bpy.data.objects.new('individual-needle-sprays', mesh)
    bpy.context.collection.objects.link(ob)
    g['finish'](ob, ob.name, leaf, smooth=False)
    tint = mesh.color_attributes.new('foliageTint','FLOAT_COLOR','POINT')
    tint.data.foreach_set('color', np.column_stack([tints,tints,tints,np.ones(len(tints))]).ravel())
    # Exposed woody limbs on alternate tiers read through the gaps on High; they follow the same
    # drooping branch habit as their sprays.
    tiers = 17 if fir else 22
    for k in range(0, tiers, 2) if g['lod'] == 0 else ():
        z = 2.1+k/tiers*(h-2.8)+.15*math.sin(k*4.31)
        r = radius*(1-k/tiers)**(.72 if fir else .9)
        count = 6 if fir else 7
        for j in range(count):
            if (k*13+j*7)%19 == 3: continue
            angle = k*2.399963+j*math.tau/count
            length = r*(.79+.18*math.sin(k*17.3+j*29.1))
            end = (math.cos(angle)*length*.8,math.sin(angle)*length*.8,z-(.27 if fir else .65)*length*.8)
            g['rod']('exposed-limb',(0,0,z),end,.018,bark,segs=4)
    g['attachments'].append({'name':'foliage','position':[0,h/2,0],'material':name})

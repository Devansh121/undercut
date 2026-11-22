"""Branch-authored conifers and orthographic albedo impostors from the same triangles.

No renderer/light is used for atlas construction: CPU triangle projection preserves holes,
branch droop and vertex albedo without baking a sun direction into a changing sky.
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


def atlas(vertices, faces, tints, height, radius, lin_to_srgb):
    """Three 256x512 view tiles, z-buffered triangle coverage with the authored vertex tints."""
    width, rows = 256, 512
    result = np.zeros((rows, width*3, 4), dtype=np.float32)
    for view in range(3):
        angle = view*math.pi/3
        normal = np.array((math.cos(angle), math.sin(angle), 0))
        lateral = np.array((-math.sin(angle), math.cos(angle), 0))
        u = (vertices @ lateral / (radius*2.1) + .5)*(width-1)
        v = vertices[:, 2]/height*(rows-1)
        depth = vertices @ normal
        zbuf = np.full((rows, width), -np.inf)
        tile = result[:, view*width:(view+1)*width]
        for face in faces:
            ind = np.array(face)
            x, y = u[ind], v[ind]
            x0, x1 = max(0,int(np.floor(x.min()))), min(width-1,int(np.ceil(x.max())))
            y0, y1 = max(0,int(np.floor(y.min()))), min(rows-1,int(np.ceil(y.max())))
            den = (y[1]-y[2])*(x[0]-x[2])+(x[2]-x[1])*(y[0]-y[2])
            if abs(den) < 1e-6 or x1 < x0 or y1 < y0:
                continue
            yy, xx = np.mgrid[y0:y1+1, x0:x1+1]
            a = ((y[1]-y[2])*(xx-x[2])+(x[2]-x[1])*(yy-y[2]))/den
            b = ((y[2]-y[0])*(xx-x[2])+(x[0]-x[2])*(yy-y[2]))/den
            c = 1-a-b
            d = a*depth[ind[0]]+b*depth[ind[1]]+c*depth[ind[2]]
            mask = (a>=0)&(b>=0)&(c>=0)&(d>zbuf[y0:y1+1,x0:x1+1])
            tint = a*tints[ind[0]]+b*tints[ind[1]]+c*tints[ind[2]]
            # Same intrinsic albedo as near, with a small ambient branch-contact allowance.
            rgb = lin_to_srgb(COLOUR[None,None,:]*tint[:,:,None]*.92)
            target = tile[y0:y1+1,x0:x1+1]
            target[mask,:3] = rgb[mask]
            target[mask,3] = 1
            zbuf[y0:y1+1,x0:x1+1][mask] = d[mask]
        # Edge dilation carries albedo into transparent texels for mip filtering, not coverage.
        for _ in range(3):
            opaque = tile[:,:,3] > 0
            for axis in (0,1):
                for shift in (-1,1):
                    other = np.roll(tile, shift, axis=axis)
                    m = (~opaque)&(other[:,:,3] > 0)
                    tile[m,:3] = other[m,:3]
    return result


def build(g, ident):
    fir = ident.endswith('fir')
    if ident not in _CACHE:
        high = authored(fir, True)
        _CACHE[ident] = (high, atlas(*high[:3], high[3], high[4], g['lin_to_srgb']))
    high, pixels = _CACHE[ident]
    vertices, faces, tints, h, radius = high if g['lod'] != 1 else authored(fir, False)
    name = ident+'-needles'
    # Each LOD owns a fresh material, so its atlas cannot leak into the next build.
    old = bpy.data.materials.get(name)
    if old: old.name = name+'-previous'
    leaf = g['material'](name, tuple(COLOUR), .96, double=g['lod'] < 2)
    bark = bpy.data.materials.get('forest-bark') or g['material']('forest-bark', (.052,.039,.025), .96, tex_kind='grain')
    g['tapered_rod']('trunk', (0,0,0), (0,0,h-.2 if g['lod']<2 else 2.2), .18, .02, bark, segs=8)
    if g['lod'] < 2:
        mesh = bpy.data.meshes.new('individual-needle-sprays')
        mesh.from_pydata(vertices.tolist(), [], faces)
        ob = bpy.data.objects.new('individual-needle-sprays', mesh)
        bpy.context.collection.objects.link(ob)
        g['finish'](ob, ob.name, leaf, smooth=False)
        tint = mesh.color_attributes.new('foliageTint','FLOAT_COLOR','POINT')
        tint.data.foreach_set('color', np.column_stack([tints,tints,tints,np.ones(len(tints))]).ravel())
        # Exposed woody limbs follow the same drooping branch habit as their sprays.
        tiers = 17 if fir else 22
        for k in range(tiers):
            z = 2.1+k/tiers*(h-2.8)+.15*math.sin(k*4.31)
            r = radius*(1-k/tiers)**(.72 if fir else .9)
            count = 6 if fir else 7
            for j in range(count):
                if (k*13+j*7)%19 == 3: continue
                angle = k*2.399963+j*math.tau/count
                length = r*(.79+.18*math.sin(k*17.3+j*29.1))
                end = (math.cos(angle)*length*.8,math.sin(angle)*length*.8,z-(.27 if fir else .65)*length*.8)
                # Woody limbs on alternate tiers read through the gaps; every tier is over budget.
                if g['lod'] == 0 and k % 2 == 0:
                    g['rod']('exposed-limb',(0,0,z),end,.018,bark,segs=4)
    else:
        image = bpy.data.images.new(ident+'-authored-views',width=768,height=512,alpha=True)
        image.pixels.foreach_set(pixels.ravel()); image.pack()
        nt = leaf.node_tree; bsdf = nt.nodes.get('Principled BSDF')
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image=image
        nt.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
        cut = nt.nodes.new('ShaderNodeMath'); cut.operation='GREATER_THAN';cut.inputs[1].default_value=.5
        nt.links.new(tex.outputs['Alpha'],cut.inputs[0]);nt.links.new(cut.outputs[0],bsdf.inputs['Alpha'])
        leaf.surface_render_method='DITHERED'
        for view in range(3):
            angle=view*math.pi/3
            lateral=Vector((-math.sin(angle),math.cos(angle),0))
            points=[tuple(lateral*(s*radius*1.05)+Vector((0,0,z))) for s,z in [(-1,0),(1,0),(1,h),(-1,h)]]
            # Explicit opposing faces keep upward canopy normals on both sides.
            mesh=bpy.data.meshes.new('authored-impostor')
            mesh.from_pydata(points+points,[],[(0,1,2,3),(7,6,5,4)])
            ob=bpy.data.objects.new('authored-impostor',mesh);bpy.context.collection.objects.link(ob)
            uv=mesh.uv_layers.new()
            for poly in mesh.polygons:
                for li in poly.loop_indices:
                    vi=mesh.loops[li].vertex_index%4
                    u,v=[(0,0),(1,0),(1,1),(0,1)][vi]
                    uv.data[li].uv=((view+u)/3,v)
            g['finish'](ob,ob.name,leaf,custom_uv=True)
    g['attachments'].append({'name':'foliage','position':[0,h/2,0],'material':name})

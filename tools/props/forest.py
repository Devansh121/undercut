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
SOURCE = {}
# Atlas tile (width, height) per card face. Far takes over beyond 250 m, where a tree is under
# 80 px tall; the tile still holds the turntable comparison view at about 1.6 px per texel.
TILE = (192, 384)


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


def atlas(vertices, faces, tints, height, radius, lin_to_srgb, supersample=2, normal_step=1):
    """Six 256x512 view tiles, one per opposing face, from a z-buffered projection of the High tree.

    Each tile is rasterised at `supersample` times the resolution and box-filtered, so a texel
    holds the mean albedo and mean normal of the needles it covers and alpha is the covered
    fraction. A point-sampled texel would carry one facet at full contrast; a multisampled near
    tree averages the facets in a pixel, and the card has to represent that same average.
    Normals are filtered over `normal_step` texels more (a smaller, separately sized atlas).
    """
    width, rows = TILE
    hw, hr = width*supersample, rows*supersample
    result = np.zeros((rows, width*6, 4), dtype=np.float32)
    # Tangent-space normals of the covering triangle (u along the card, v up, z towards the
    # viewer), flipped to face the viewer as the double-sided foliage renders. The cards then
    # shade with the near tree's own normals under any light, with no light baked in.
    nw, nr = width//normal_step, rows//normal_step
    normals = np.zeros((nr, nw*6, 3), dtype=np.float32)
    corners = vertices[np.array(faces)]
    face_normals = np.cross(corners[:, 1]-corners[:, 0], corners[:, 2]-corners[:, 0])
    face_normals /= np.maximum(np.linalg.norm(face_normals, axis=1, keepdims=True), 1e-9)
    up = np.array((0., 0., 1.))
    for view in range(6):
        angle = (view % 3)*math.pi/3
        normal = np.array((math.cos(angle), math.sin(angle), 0)) * (1 if view < 3 else -1)
        lateral = np.array((-math.sin(angle), math.cos(angle), 0))
        # Sample centres of the fine grid sit inside the texels they are filtered into.
        u = (vertices @ lateral / (radius*2.1) + .5)*hw - .5
        v = vertices[:, 2]/height*hr - .5
        depth = vertices @ normal
        zbuf = np.full((hr, hw), -np.inf)
        albedo = np.zeros((hr, hw, 3))
        cover = np.zeros((hr, hw))
        fine = np.zeros((hr, hw, 3))
        for index, face in enumerate(faces):
            ind = np.array(face)
            x, y = u[ind], v[ind]
            x0, x1 = max(0,int(np.floor(x.min()))), min(hw-1,int(np.ceil(x.max())))
            y0, y1 = max(0,int(np.floor(y.min()))), min(hr-1,int(np.ceil(y.max())))
            den = (y[1]-y[2])*(x[0]-x[2])+(x[2]-x[1])*(y[0]-y[2])
            if abs(den) < 1e-6 or x1 < x0 or y1 < y0:
                continue
            yy, xx = np.mgrid[y0:y1+1, x0:x1+1]
            a = ((y[1]-y[2])*(xx-x[2])+(x[2]-x[1])*(yy-y[2]))/den
            b = ((y[2]-y[0])*(xx-x[2])+(x[0]-x[2])*(yy-y[2]))/den
            c = 1-a-b
            d = a*depth[ind[0]]+b*depth[ind[1]]+c*depth[ind[2]]
            mask = (a>=0)&(b>=0)&(c>=0)&(d>zbuf[y0:y1+1,x0:x1+1])
            tint = a[:,:,None]*tints[ind[0]]+b[:,:,None]*tints[ind[1]]+c[:,:,None]*tints[ind[2]]
            albedo[y0:y1+1,x0:x1+1][mask] = tint[mask]
            cover[y0:y1+1,x0:x1+1][mask] = 1
            nf = face_normals[index]
            if nf @ normal < 0:
                nf = -nf
            fine[y0:y1+1,x0:x1+1][mask] = (nf @ lateral, nf @ up, nf @ normal)
            zbuf[y0:y1+1,x0:x1+1][mask] = d[mask]
        # Box filter: linear albedo and normals averaged over covered samples only.
        def box(x, w=width, r=rows):
            step = hw//w
            return x.reshape(r, step, w, step, *x.shape[2:]).sum(axis=(1, 3))
        weight = box(cover)
        safe = np.maximum(weight, 1e-9)[:, :, None]
        colour = box(albedo*cover[:, :, None])/safe
        ntile_lin = box(fine*cover[:, :, None], nw, nr)
        ntile_lin /= np.maximum(np.linalg.norm(ntile_lin, axis=2, keepdims=True), 1e-9)
        tile = result[:, view*width:(view+1)*width]
        ntile = normals[:, view*nw:(view+1)*nw]
        tile[:, :, :3] = lin_to_srgb(colour)
        tile[:, :, 3] = weight/supersample**2
        ntile[:] = np.where(box(cover, nw, nr)[:, :, None] > 0, ntile_lin, 0)
        # Edge dilation carries albedo and normals into transparent texels for filtering, not coverage.
        for image, filled in ((tile, weight > 0), (ntile, np.linalg.norm(ntile, axis=2) > .5)):
            for _ in range(3):
                grown = filled.copy()
                for axis in (0,1):
                    for shift in (-1,1):
                        other = np.roll(image, shift, axis=axis)
                        m = (~grown)&np.roll(filled, shift, axis=axis)
                        image[m,:3] = other[m,:3]
                        grown |= m
                filled = grown
        empty = np.linalg.norm(ntile, axis=2) < .5
        ntile[empty] = (0, 0, 1)
    return palette(result, normals)


def palette(result, normals, directions=128):
    """Lossless-friendly atlases: normals snap to a hemisphere codebook (spherical Fibonacci,
    under 11 degrees from any direction) and alpha to the 0.5 cutoff the material applies anyway.
    The crown's albedo already has fewer than 256 distinct 8-bit values. Few distinct values let
    lossless WebP use its colour-index transform; lossy WebP blurs the normals and darkens the
    cards' shadowed side by up to 43% (measured)."""
    i = np.arange(directions)+.5
    z = 1-i/directions
    phi = i*math.pi*(3-math.sqrt(5))
    book = np.column_stack([np.sqrt(1-z*z)*np.cos(phi), np.sqrt(1-z*z)*np.sin(phi), z])
    flat = normals.reshape(-1, 3)
    pick = np.concatenate([np.argmax(flat[k:k+65536] @ book.T, axis=1) for k in range(0, len(flat), 65536)])
    normals = book[pick].reshape(normals.shape).astype(np.float32)
    result[:, :, 3] = result[:, :, 3] >= .5
    return result, normals

def build(g, ident):
    fir = ident.endswith('fir')
    if ident not in _CACHE:
        _CACHE[ident] = authored(fir, True)
    high = _CACHE[ident]
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
        pixels, normals = atlas(*SOURCE[ident], high[3], high[4], g['lin_to_srgb'])
        image = bpy.data.images.new(ident+'-authored-views',width=pixels.shape[1],height=pixels.shape[0],alpha=True)
        image.pixels.foreach_set(pixels.ravel()); image.pack()
        nt = leaf.node_tree; bsdf = nt.nodes.get('Principled BSDF')
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image=image
        nt.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
        cut = nt.nodes.new('ShaderNodeMath'); cut.operation='GREATER_THAN';cut.inputs[1].default_value=.5
        nt.links.new(tex.outputs['Alpha'],cut.inputs[0]);nt.links.new(cut.outputs[0],bsdf.inputs['Alpha'])
        leaf.surface_render_method='DITHERED'
        # Opposing faces have separate z-buffer projections and signed tangent frames.
        # A back face keeps U/V but reverses N; it must never reuse the front normal tile.
        rgba = np.concatenate([normals*.5+.5, np.ones((*normals.shape[:2], 1))], axis=2).astype(np.float32)
        nimage = bpy.data.images.new(ident+'-authored-normals', width=normals.shape[1], height=normals.shape[0], alpha=False)
        nimage.colorspace_settings.name = 'Non-Color'
        nimage.pixels.foreach_set(rgba.ravel()); nimage.pack()
        ntex = nt.nodes.new('ShaderNodeTexImage'); ntex.image = nimage
        ntex.interpolation = 'Closest'
        nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.uv_map = 'UVMap'
        nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
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
                    uv.data[li].uv=((view + (3 if poly.index == 1 else 0) + u)/6,v)
            g['finish'](ob,ob.name,leaf,custom_uv=True)
    g['attachments'].append({'name':'foliage','position':[0,h/2,0],'material':name})


def record_source(ident, merged):
    """Capture the actual High geometry, all material albedos and per-vertex AO after export transforms."""
    vertices, faces, albedo = [], [], []
    for ob in merged:
        mesh = ob.data
        mesh.calc_loop_triangles()
        start = len(vertices)
        vertices.extend((v.co.x, -v.co.y, v.co.z) for v in mesh.vertices)
        faces.extend(tuple(start+i for i in tri.vertices) for tri in mesh.loop_triangles)
        # Needles use a constant physical albedo; bark uses its same procedural mean swatch.
        colour = COLOUR if ob.data.materials[0].name.endswith('-needles') else np.array((.052,.039,.025))
        albedo.extend(tuple(colour*np.array(c.color[:3])) for c in mesh.color_attributes['AO'].data)
    SOURCE[ident] = (np.array(vertices), faces, np.array(albedo))

"""Street, floodlight, temporary stand, marina and hill pit furniture, in author Z-up metres."""
import math
import bpy

SPECS = [('street-block', 4), ('street-fence', 4), ('street-fence-end', 0),
         ('floodlight-mast', 0), ('lighting-truss', 4), ('temporary-grandstand', 8),
         ('marina-office', 0), ('marina-hotel', 0), ('marina-pavilion', 0),
         ('hill-pit-garage', 6)]


def build(g, ident):
    box, rod, prism = g['box'], g['rod'], g['prism_profile']
    steel, dark, concrete = g['steel'], g['dark_steel'], g['concrete']
    lod, attachments = g['lod'], g['attachments']
    def mat(name, *args, **kwargs):
        return bpy.data.materials.get(name) or g['material'](name, *args, **kwargs)
    if ident.startswith('street-'):
        if ident == 'street-block':
            profile = [(-.4, 0), (.4, 0), (.4, .18), (.22, .55), (.18, 1.15), (-.18, 1.15), (-.22, .55), (-.4, .18)]
            prism('precast', profile, -2, 2, concrete)
            box('painted-cap', (0, 0, 1.15), (.36, 4, .025), g['face'], bevel=0)
            if lod < 2:
                for y in (-1.3, 1.3):
                    box('lift-recess', (.185, y, .93), (.012, .15, .08), dark, bevel=0)
                    box('foot-slot', (.4, y, .09), (.012, .3, .12), dark, bevel=0)
            attachments.append({'name': 'fence', 'position': [-.12, 1.15, 0]})
        elif ident == 'street-fence':
            g['fence'](length=4, height=2.6, z_base=1.15, overhang=.55, overhang_rise=.45)
            box('socket', (0, -2, .58), (.16, .16, 1.15), dark, bevel=0)
        else:
            rod('terminal-post', (0, 0, 0), (0, 0, 3.75), .065, steel)
            rod('terminal-arm', (0, 0, 3.75), (.55, 0, 4.2), .045, steel)
            box('socket', (0, 0, .58), (.16, .16, 1.15), dark, bevel=0)
    elif ident in ('floodlight-mast', 'lighting-truss'):
        lamp = mat('floodlight-emitter', (1, .82, .60), .32, emission=5)
        if ident == 'floodlight-mast':
            box('ballast', (0, 0, .2), (1.5, 1.5, .4), concrete)
            g['tapered_rod']('mast', (0, 0, .4), (0, 0, 13), .17, .08, steel)
            box('service-door', (.17, 0, 1), (.03, .22, .65), dark)
            rod('head-crossarm', (0, -1.5, 12.8), (0, 1.5, 12.8), .065, steel)
            points = [(0, y, 13) for y in (-1, 0, 1)]
        else:
            for x in (-.3, .3):
                for z in (0, .6):
                    rod('chord', (x, -2, z + .05), (x, 2, z + .05), .045, steel)
                for y in (-2, -1, 0, 1):
                    rod('diagonal', (x, y, .05), (x, y+1, .65), .022, steel)
            for y in (-2, -1, 0, 1, 2):
                rod('cross-tie', (-.3, y, .65), (.3, y, .65), .022, steel)
            points = [(0, y, .4) for y in (-1, 1)]
            attachments.extend([{'name': 'support-left', 'position': [0, 0, -2]}, {'name': 'support-right', 'position': [0, 0, 2]}])
        for i, (x, y, z) in enumerate(points):
            box('lamp-yoke', (x+.15, y, z), (.5, .65, .09), dark)
            box('lamp-case', (x+.25, y, z+.15), (.24, .64, .48), dark)
            box('lamp-panel', (x+.38, y, z+.15), (.025, .55, .38), lamp, bevel=0)
            if lod == 0:
                for h in (-.12, 0, .12):
                    box('heat-sink', (x+.10, y, z+.15+h), (.12, .6, .025), steel, bevel=0)
            attachments.append({'name': f'lamp-{i}', 'position': [x+.4, z+.15, y], 'material': 'floodlight-emitter', 'direction': [1, -.7, 0]})
    elif ident == 'temporary-grandstand':
        for r in range(8):
            x, h = 3.2-r*.8, .8+r*.42
            box('aluminium-tread', (x, 0, h), (.82, 8, .10), steel, bevel=0)
            box('bench', (x-.12, -.35, h+.38), (.35, 6.5, .08), g['seat'], bevel=0)
            for y in (-3.8, 0, 3.8):
                rod('scaffold-upright', (x, y, 0), (x, y, h), .045, steel)
                box('sole-board', (x, y, .025), (.32, .32, .05), concrete, bevel=0)
            if lod < 2:
                for y in (-3.8, 3.8):
                    rod('side-brace', (x, y, .1), (x-.8, y, h+.42), .025, dark)
            # Separate stair aisle, two risers for each seating tier.
            for s in range(2):
                box('aisle-step', (x+.2-s*.4, 3.35, h-.21+s*.21), (.4, .75, .1), steel, bevel=0)
            attachments.append({'name': f'crowd-row-{r}', 'position': [x-.12, h+.42, -3.35], 'axis': [0, 0, 1], 'spacing': .55, 'count': 12})
        for y in (-3.9, 3.9):
            rod('side-guard', (3.6, y, 1.8), (-2.8, y, 5.16), .032, steel)
            for r in range(8):
                x, h = 3.2-r*.8, .8+r*.42
                rod('guard-post', (x, y, h), (x, y, h+1.1), .028, steel)
        for h in (4.2, 4.75):
            rod('rear-guard', (-2.8, -4, h), (-2.8, 4, h), .032, steel)
        if lod < 2:
            for y in (-3.8, 0):
                rod('rear-cross-brace', (-2.4, y, .1), (-2.4, y+3.8, 3.7), .035, dark)
        # The tiers step back from the front edge, so the ground footprint (sole boards at
        # x = -2.4 .. 3.2 plus their pads) is centred 0.4 m forward: shift geometry and
        # attachments together so the pivot sits at the footprint centre.
        for ob in g['objects']:
            ob.location.x -= .4
        bpy.context.view_layer.update()
        for anchor in attachments:
            anchor['position'][0] -= .4
    elif ident.startswith('marina-'):
        variant = ('marina-office', 'marina-hotel', 'marina-pavilion').index(ident)
        width, depth, floors = [(18, 10, 7), (14, 12, 9), (22, 12, 2)][variant]
        cladding = mat('facade-mineral', (.18, .21, .23), .85, tex_kind='grain')
        windows = mat('window-emissive-mask', (.44, .32, .17), .35, emission=.8)
        box('podium', (0, 0, .35), (depth+1, width+1, .7), concrete)
        box('facade', (0, 0, floors*1.4+.7), (depth, width, floors*2.8), cladding)
        # Lit and dark panes share simple geometry, deterministic occupancy on all four faces.
        for f in range(floors):
            z = 2+f*2.8
            for side in (-1, 1):
                for j in range(int(width/2)):
                    y = -width/2+1+j*2
                    pane = windows if (j*13+f*7+variant)%5 < 2 else g['glass']
                    facade_panel(g, (side*(depth/2+.02), y, z), 1.35, 1.6, pane, False)
                for j in range(int(depth/2)):
                    x = -depth/2+1+j*2
                    pane = windows if (j*11+f*3)%5 < 2 else g['glass']
                    facade_panel(g, (x, side*(width/2+.02), z), 1.35, 1.6, pane, True)
            if lod < 2 or variant == 2:
                box('floor-band', (0, 0, z+1.1), (depth+.18, width+.18, .14), concrete, bevel=0)
        box('roof-coping', (0, 0, floors*2.8+.85), (depth+.3, width+.3, .25), concrete)
        box('plant-room', (-depth*.2, 0, floors*2.8+1.6), (depth*.4, width*.4, 1.3), dark)
        attachments.append({'name': 'window-mask', 'position': [0, 0, 0], 'material': 'window-emissive-mask'})
    elif ident == 'hill-pit-garage':
        g['pit']()
        # Cool overcast complex: deep canopy, horizontal cladding and service roof.
        for ob in g['objects']:
            if ob.data.materials[0] == g['paint']:
                ob.data.materials[0] = steel
        box('cantilever-canopy', (6, 0, 4.65), (3, 6, .18), steel)
        for y in (-2.8, 2.8):
            rod('canopy-stay', (4.7, y, 6.7), (7.3, y, 4.75), .045, dark)
        if lod < 2:
            for z in (5.1, 5.5, 5.9, 6.3):
                box('rear-cladding-seam', (-5.01, 0, z), (.025, 6, .03), dark, bevel=0)
        box('roof-service', (-2.5, 0, 7.6), (2.5, 3.5, 1), steel)


def facade_panel(g, pos, width, height, material, side):
    x, y, z = pos
    verts = [(x+u if side else x, y if side else y+u, z+v)
             for u, v in [(-width/2,-height/2),(width/2,-height/2),(width/2,height/2),(-width/2,height/2)]]
    mesh = bpy.data.meshes.new('window-pane')
    mesh.from_pydata(verts, [], [(0,1,2,3) if (pos[1] < 0 if side else pos[0] > 0) else (3,2,1,0)])
    ob = bpy.data.objects.new('window-pane', mesh)
    bpy.context.collection.objects.link(ob)
    g['finish'](ob, 'window-pane', material)

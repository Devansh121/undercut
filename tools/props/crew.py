"""Close pit personnel: tailored garment lofts, articulated gloves and footwear, sculpted heads.
Only High uses these surfaces; crowd and distant personnel retain the small meshes.
"""
import math

import bpy
from mathutils import Vector


def build(pose, mechanic, finish, cloth, fabric, rubber, skin, glass, glasses=False, objects=None):
    garments = []

    def mesh(name, verts, faces, mat):
        data = bpy.data.meshes.new(name)
        data.from_pydata(verts, [], faces)
        ob = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(ob)
        finish(ob, name, mat, smooth=True)
        if name in ('overall-hips', 'overall-torso', 'overall-trouser'):
            garments.append(ob)
        return ob

    def rings(name, sections, mat, n=16):
        # Each section: centre, forward/back half-depth, lateral half-width.
        verts = []
        for centre, rx, ry in sections:
            for i in range(n):
                t = 2 * math.pi * i / n
                verts.append(tuple(Vector(centre) + Vector((rx * math.cos(t), ry * math.sin(t), 0))))
        faces = [(j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i)
                 for j in range(len(sections)-1) for i in range(n)]
        faces += [tuple(reversed(range(n))), tuple((len(sections)-1)*n+i for i in range(n))]
        return mesh(name, verts, faces, mat)

    def sweep(name, points, radii, mat, n=12, folds=False):
        verts = []
        for j, point in enumerate(points):
            tangent = (Vector(points[min(j+1, len(points)-1)]) - Vector(points[max(j-1, 0)])).normalized()
            side = tangent.cross(Vector((0, 1, 0))).normalized()
            across = tangent.cross(side).normalized()
            for i in range(n):
                t = 2*math.pi*i/n
                ripple = 1 + (.10*math.sin(t*3+j*1.7) if folds else 0)
                offset = side * (math.cos(t)*radii[j][0]) + across * (math.sin(t)*radii[j][1])
                verts.append(tuple(Vector(point) + offset*ripple))
        faces = [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
                 for j in range(len(points)-1) for i in range(n)]
        faces += [tuple(reversed(range(n))), tuple((len(points)-1)*n+i for i in range(n))]
        return mesh(name, verts, faces, mat)

    def seam(name, points, mat=fabric, radius=.003):
        return sweep(name, points, [(radius, radius)]*len(points), mat, n=5)

    def ellipsoid(name, pos, scale, mat):
        sections = []
        for j in range(1, 10):
            t = math.pi*j/10
            sections.append(((pos[0], pos[1], pos[2]+scale[2]*math.cos(t)), scale[0]*math.sin(t), scale[1]*math.sin(t)))
        return rings(name, sections, mat, n=16)

    seated = pose == 'seated'
    crouched = pose == 'crouched'
    hip = Vector((-.10, 0, .54) if crouched else (0, 0, .50 if seated else .88))
    shoulder = hip + Vector((.20 if crouched else -.02, 0, .42 if crouched else .51))
    torso_axis = shoulder - hip
    legs = cloth if mechanic else fabric
    # Hips in the trouser cloth, closing to a rounded crotch inside the thigh tops: no flat
    # bottom or rim. The lowest section sets the seat contact level with the simple LODs (0.424 m).
    if seated:
        # Seated: full-width hips down to a flat seat at the contact level (hidden by the chair).
        hips = [(-.148,.07,.115,0),(-.135,.092,.145,0),(-.10,.106,.157,0),(-.05,.11,.16,0),(0,.11,.158,0),
                (.06,.104,.150,0),(.10,.096,.140,0)]
    elif crouched:
        # The lower back tapers into the crotch rather than bulging into a separate pouch.
        hips = [(-.26,.018,.025,0),(-.20,.046,.075,0),(-.13,.070,.115,0),
                (-.07,.089,.140,0),(0,.103,.151,0),(.07,.106,.151,0),(.10,.109,.153,0)]
    else:
        # Standing: the thigh tops form the seat; the hips stay inside them below the waist.
        hips = [(-.13,.012,.02,0),(-.10,.05,.08,0),(-.05,.085,.13,0),(0,.104,.152,0),(.06,.11,.156,0),
                (.10,.102,.146,0)]
    rings('overall-hips', [(hip+torso_axis*t+Vector((cx,0,0)), d, w) for t, d, w, cx in hips], legs)
    # Continuous tailored torso above the belt, narrowing at the waist and neck.
    sections = []
    for t, depth, width in [(.03,.100,.145),(.07,.106,.151),(.10,.109,.153),(.18,.10,.145),
                            (.24,.112,.158),(.40,.125,.174),(.62,.132,.19),(.79,.125,.205),
                            (.90,.11,.20),(1,.085,.16),(1.04,.065,.092)]:
        sections.append((hip+torso_axis*t, depth, width))
    rings('overall-torso', sections, cloth)
    # Waist gathering and belt follow the garment, without a separate rectangular pelvis.
    if not mechanic:
        # Engineers wear a slim belt over shirt and trousers. A one-piece pit overall has no belt
        # and no gather: it runs smooth from chest to thigh.
        rings('belt-webbing', [(hip+torso_axis*t, .114, .159) for t in (.045,.085)], fabric)
    # Raised collar, zip placket and shaped chest pocket seams.
    neck_base = shoulder + Vector((.004,0,.018))
    rings('collar', [(neck_base,.067,.079),(neck_base+Vector((.006,0,.05)),.060,.072)], cloth)
    seam('zipper', [tuple(hip+torso_axis*t+Vector((d,0,0))) for t,d in [(0,.122),(.3,.125),(.6,.139),(.9,.113)]], fabric, .004)
    for side in (-1,1):
        c = hip+torso_axis*.67
        seam('chest-pocket', [(c.x+.125,side*.045,c.z+.015),(c.x+.128,side*.115,c.z+.015),
                              (c.x+.125,side*.115,c.z-.065),(c.x+.125,side*.045,c.z-.065)], cloth)
        seam('shoulder-piping', [(shoulder.x+.04,side*.075,shoulder.z+.005),
                                 (shoulder.x+.07,side*.15,shoulder.z-.015),
                                 (shoulder.x+.02,side*.203,shoulder.z-.05)], fabric)

    def limb(name, a, joint, b, widths, mat, top=.9, lead=()):
        # Closely spaced uneven rings bunch at the bent knee/elbow, loose smooth fabric elsewhere.
        # The tapered top ring starts inside the body so no tube end shows at the hip or shoulder;
        # optional lead rings start deeper inside and turn the tube out of the body (shoulder cap).
        points = [tuple(p) for p, r in lead]
        radii = [(r, r*.94) for p, r in lead]
        for t, scale in [(0,top),(.18,1.03),(.40,1),(.67,.96),(.83,1.13),(.91,.94),(1,1.06)]:
            points.append(tuple(Vector(a).lerp(Vector(joint),t)))
            r = widths[0]*(1-t)+widths[1]*t
            radii.append((r*scale,r*scale*.94))
        for t, scale in [(.08,.9),(.17,1.12),(.27,.95),(.48,1.03),(.75,.94),(1,.85)]:
            points.append(tuple(Vector(joint).lerp(Vector(b),t)))
            r = widths[1]*(1-t)+widths[2]*t
            radii.append((r*scale,r*scale*.94))
        sweep(name, points, radii, mat, folds=True)

    for side in (-1,1):
        y = side*.105
        if crouched:
            knee = Vector((.24,y,.44) if side==1 else (.04,y,.22))
            ankle = Vector((.14,y,.11) if side==1 else (-.16,y,.11))
        elif seated:
            knee, ankle = Vector((.36,y,.46)), Vector((.36,y,.11))
        else:
            knee, ankle = Vector((.025,y,.47)), Vector((0,y,.11))
        # Seated thighs leave the hips higher so the seat contact stays level with the simple LODs.
        a = hip+Vector((-.005,y*.82,.04 if seated else 0))
        limb('overall-trouser', a,knee,ankle,(.096,.073,.061), legs, top=.85)
        # Shaped boot: a broad toe, narrower heel, ankle shaft and distinct rubber sole.
        footprint = [(-.08,-.047),(.10,-.055),(.165,-.036),(.18,0),(.165,.036),(.10,.055),(-.08,.047),(-.10,0)]
        verts=[]
        for z, scale in [(0,1),(.024,1),(.045,.96),(.075,.84)]:
            verts.extend([(ankle.x+x*scale,ankle.y+yy*scale,z) for x,yy in footprint])
        faces=[(j*8+i,j*8+(i+1)%8,(j+1)*8+(i+1)%8,(j+1)*8+i) for j in range(3) for i in range(8)]
        faces += [tuple(reversed(range(8))),tuple(24+i for i in range(8))]
        mesh('boot-toe-and-sole',verts,faces,rubber)
        rings('boot-ankle', [((ankle.x-.015,y,z),rx,ry) for z,rx,ry in [(.05,.09,.047),(.10,.064,.05),(.18,.055,.047)]], rubber)
        seam('boot-stitch',[(ankle.x+.03,y-.044,.066),(ankle.x+.13,y-.03,.065),(ankle.x+.15,y,.06),
                            (ankle.x+.13,y+.03,.065),(ankle.x+.03,y+.044,.066)],fabric,.0025)
        # The sleeve grows out of the torso through a lead ring near the neck, so the shoulder
        # cap is one continuous surface rather than a separate deltoid lump.
        sh=shoulder+Vector((0,side*.168,-.072))
        if crouched:
            elbow,wrist=Vector((.24,side*.22,.74)),Vector((.42,side*.14,.66))
        elif seated:
            elbow,wrist=hip+Vector((.08,side*.22,.26)),hip+Vector((.24,side*.14,.14))
        else:
            elbow,wrist=hip+Vector((.025,side*.22,.27)),hip+Vector((.07,side*.21,.07))
        limb('overall-sleeve',sh,elbow,wrist,(.077,.058,.039),cloth,top=.98,
             lead=[(shoulder+Vector((0,side*.10,-.045)),.06)])
        direction=(wrist-elbow).normalized()
        cuff=wrist-direction*.035
        sweep('sleeve-cuff',[cuff,wrist],[(.045,.043),(.041,.040)],fabric)
        palm=wrist+direction*.04
        # Mechanics wear gloves; pit-wall engineers have bare hands. One material per hand.
        hand=rubber if mechanic else skin
        ellipsoid('glove-palm' if mechanic else 'hand-palm',palm,(.035,.034,.058),hand)
        # Four curled fingers and a separate opposing thumb give a readable grasp.
        for finger in range(4):
            f=palm+Vector((.022,(finger-1.5)*.015,-.018))
            sweep('finger',[f,f+Vector((.018,0,-.029)),f+Vector((.008,0,-.047))],[(.009,.008),(.01,.009),(.006,.006)],hand,n=6)
        sweep('thumb',[palm+Vector((.005,-side*.03,.008)),palm+Vector((.035,-side*.037,-.013)),palm+Vector((.036,-side*.02,-.028))],[(.012,.012),(.012,.011),(.008,.008)],hand,n=6)
        if mechanic:
            seam('glove-stitch',[tuple(palm+Vector((-.027,-.022,z))) for z in (-.025,0,.025)],cloth,.002)

    head=shoulder+Vector((.06 if crouched else .025,0,.225))
    # Mechanics wear a fire-resistant balaclava under the helmet.
    rings('neck',[(head+Vector((0,0,-.16)),.047,.051),(head+Vector((0,0,-.075)),.052,.052)],fabric if mechanic else skin)
    if mechanic:
        # Sculpted shell sections: a projecting chin bar, cheek transition, rounded crown.
        profiles=[(-.115,.072,.080,.04),(-.095,.115,.105,.025),(-.06,.129,.121,.008),
                  (-.015,.132,.130,0),(.04,.129,.131,-.007),(.09,.111,.113,-.016),
                  (.13,.076,.085,-.02),(.151,.025,.031,-.023),(.154,.004,.005,-.023)]
        rings('helmet-shell',[(head+Vector((cx,0,z)),rx,ry) for z,rx,ry,cx in profiles],cloth,n=24)
        # Wrapped visor band follows the shell; no rectangular visor block.
        verts=[]
        visor=[(-.045,.137,.131),(-.012,.140,.135),(.022,.139,.135),(.055,.128,.130)]
        for z,rx,ry in visor:
            for i in range(17):
                t=-1.18+2.36*i/16
                verts.append(tuple(head+Vector((rx*math.cos(t),ry*math.sin(t),z))))
        mesh('helmet-visor',verts,[(r*17+i,r*17+i+1,(r+1)*17+i+1,(r+1)*17+i) for r in range(len(visor)-1) for i in range(16)],glass)
        # Seals run along the visor's own edges and stop at its ends.
        for z,rx,ry in (visor[0],visor[-1]):
            seam('visor-seal',[tuple(head+Vector(((rx+.002)*math.cos(t),(ry+.002)*math.sin(t),z))) for t in [-1.15+i*2.30/16 for i in range(17)]],rubber,.0035)
        # The shell drops lower at the nape than at the chin, as a real full-face shell does.
        ellipsoid('helmet-nape',head+Vector((-.04,0,-.08)),(.07,.10,.05),cloth)
        for side in (-1,1):
            ellipsoid('visor-pivot',head+Vector((.046,side*.127,.01)),(.017,.005,.017),rubber)
            seam('chin-vent',[tuple(head+Vector((.145,side*y,-.078))) for y in (.018,.037,.058)],rubber,.005)
        seam('crown-vent',[tuple(head+Vector((x,0,z))) for x,z in [(.065,.121),(.03,.145),(-.012,.156)]],rubber,.004)
    else:
        # Anatomical jaw, cheekbones and cranium, with a face plane and nose silhouette.
        profiles=[(-.105,.047,.048,.020),(-.087,.068,.072,.015),(-.05,.079,.084,.005),
                  (0,.086,.091,0),(.035,.088,.089,-.005),(.073,.075,.077,-.014),(.105,.044,.051,-.02),(.115,.004,.006,-.02)]
        rings('head',[(head+Vector((cx,0,z)),rx,ry) for z,rx,ry,cx in profiles],skin,n=20)
        # Features sized to read at 3 to 5 m: brow ridge over recessed eyes, a full nose, chin.
        for side in (-1,1):
            ellipsoid('ear',head+Vector((-.008,side*.09,-.012)),(.021,.016,.035),skin)
            ellipsoid('brow-ridge',head+Vector((.079,side*.033,.033)),(.013,.03,.011),skin)
            seam('brow',[tuple(head+Vector((.089,side*y,z))) for y,z in [(.012,.04),(.034,.045),(.056,.037)]],fabric,.0055)
            if glasses:
                ellipsoid('sunglass-lens',head+Vector((.095,side*.033,.014)),(.007,.027,.018),glass)
                seam('sunglass-arm',[tuple(head+Vector(v)) for v in [(.09,side*.06,.02),(.05,side*.088,.02),(-.005,side*.093,.01)]],rubber,.0025)
            else:
                ellipsoid('eye',head+Vector((.083,side*.033,.013)),(.006,.013,.0075),rubber)
        if glasses:
            seam('sunglass-bridge',[tuple(head+Vector((.1,y,.02))) for y in (-.01,0,.01)],rubber,.003)
        mesh('nose',[tuple(head+Vector(v)) for v in [(.081,-.011,.03),(.081,.011,.03),(.128,0,-.018),
                                                    (.093,-.022,-.042),(.093,.022,-.042),(.107,0,-.048)]],
             [(0,1,2),(0,2,3),(1,4,2),(2,5,3),(2,4,5)],skin)
        ellipsoid('chin',head+Vector((.072,0,-.09)),(.03,.04,.022),skin)
        seam('mouth',[tuple(head+Vector((.093,y,-.064))) for y in (-.024,-.008,.008,.024)],rubber,.003)
        # Hair cap is fitted to the skull, with a temple line, rather than a sphere head.
        # Hairline sits high at the forehead and low at the nape.
        rings('hair',[(head+Vector((cx,0,z)),rx,ry) for z,rx,ry,cx in
                      [(-.085,.03,.045,-.05),(-.075,.05,.07,-.05),(-.045,.07,.086,-.03),(-.01,.082,.094,-.016),
                       (.03,.09,.093,-.01),(.07,.08,.082,-.012),(.10,.055,.06,-.015),(.12,.02,.025,-.015),
                       (.125,.003,.004,-.015)]],fabric,n=20)
        # Team cap in the clothing material (team tint) with a curved brim: it reads at distance.
        rings('cap-crown',[(head+Vector((cx,0,z)),rx,ry) for z,rx,ry,cx in
                           [(.03,.095,.099,-.008),(.07,.090,.093,-.01),(.10,.067,.072,-.012),
                            (.122,.032,.036,-.013),(.13,.003,.004,-.013)]],cloth,n=20)
        ellipsoid('cap-button',head+Vector((-.013,0,.131)),(.008,.008,.004),cloth)
        top, bottom = [], []
        for i in range(13):
            t=-1.05+2.1*i/12
            inner=Vector((.093*math.cos(t)-.008,.097*math.sin(t),0))
            outer=inner+Vector((math.cos(t),math.sin(t),0))*(.075*math.cos(t)**1.5)+Vector((0,0,-.012))
            top.extend([tuple(head+inner+Vector((0,0,.036))),tuple(head+outer+Vector((0,0,.036)))])
            bottom.extend([tuple(head+inner+Vector((0,0,.029))),tuple(head+outer+Vector((0,0,.029)))])
        verts=top+bottom
        n=len(top)
        faces=[]
        for i in range(12):
            a,b,c,d=2*i,2*i+1,2*i+3,2*i+2
            faces.append((a,b,c,d))
            faces.append((n+d,n+c,n+b,n+a))
            faces.append((b,n+b,n+c,c))
        mesh('cap-brim',verts,faces,cloth)
    if crouched:
        # Union the intersecting garment panels and thigh roots. This removes both internal
        # caps and the horizontal seam under the lower back; boots, seams and skin stay separate.
        bpy.ops.object.select_all(action='DESELECT')
        for ob in garments:
            ob.select_set(True)
            objects.remove(ob)
        bpy.context.view_layer.objects.active = garments[0]
        bpy.ops.object.join()
        body = bpy.context.object
        body.name = 'continuous-overall'
        body.data.remesh_voxel_size = .009
        bpy.ops.object.voxel_remesh()
        smooth = body.modifiers.new('cloth-transition', 'SMOOTH')
        smooth.factor = .65
        smooth.iterations = 4
        bpy.ops.object.modifier_apply(modifier=smooth.name)
        body.data.calc_loop_triangles()
        reduce = body.modifiers.new('garment-budget', 'DECIMATE')
        reduce.ratio = min(1, 6000 / max(1, len(body.data.loop_triangles)))
        bpy.ops.object.modifier_apply(modifier=reduce.name)
        for polygon in body.data.polygons:
            polygon.use_smooth = True
        objects.append(body)
    return tuple(head)

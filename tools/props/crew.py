"""Close pit personnel: tailored garment lofts, articulated gloves and footwear, sculpted heads.
Only High uses these surfaces; crowd and distant personnel retain the small meshes.
"""
import math

import bpy
from mathutils import Vector


def build(pose, mechanic, finish, cloth, fabric, rubber, skin, glass):
    def mesh(name, verts, faces, mat):
        data = bpy.data.meshes.new(name)
        data.from_pydata(verts, [], faces)
        ob = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(ob)
        return finish(ob, name, mat, smooth=True)

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
    # Continuous tailored torso, narrowing at the waist and neck, with rounded deltoids.
    sections = []
    for t, depth, width in [(-.14,.105,.145),(0,.115,.162),(.10,.108,.152),(.18,.10,.145),
                            (.24,.112,.158),(.40,.125,.174),(.62,.132,.19),(.79,.125,.205),
                            (.90,.11,.20),(1,.085,.16),(1.04,.065,.092)]:
        sections.append((hip+torso_axis*t, depth, width))
    rings('overall-torso', sections, cloth)
    # Waist gathering and belt follow the garment, without a separate rectangular pelvis.
    rings('waist-gather', [(hip+torso_axis*t, .116+e, .162+e) for t,e in [(0,.002),(.025,.009),(.05,.003),(.075,.007)]], cloth)
    rings('belt-webbing', [(hip+torso_axis*t, .121, .169) for t in (.04,.085)], fabric)
    # Raised collar, zip placket and shaped chest pocket seams.
    neck_base = shoulder + Vector((.004,0,.018))
    rings('collar', [(neck_base,.067,.079),(neck_base+Vector((.006,0,.04)),.061,.074)], cloth)
    seam('zipper', [tuple(hip+torso_axis*t+Vector((d,0,0))) for t,d in [(0,.122),(.3,.125),(.6,.139),(.9,.113)]], fabric, .004)
    for side in (-1,1):
        c = hip+torso_axis*.67
        seam('chest-pocket', [(c.x+.125,side*.045,c.z+.015),(c.x+.128,side*.115,c.z+.015),
                              (c.x+.125,side*.115,c.z-.065),(c.x+.125,side*.045,c.z-.065)], cloth)
        seam('shoulder-piping', [(shoulder.x+.04,side*.075,shoulder.z+.005),
                                 (shoulder.x+.07,side*.15,shoulder.z-.015),
                                 (shoulder.x+.02,side*.203,shoulder.z-.05)], fabric)

    def limb(name, a, joint, b, widths, mat):
        # Closely spaced uneven rings bunch at the bent knee/elbow, loose smooth fabric elsewhere.
        points, radii = [], []
        for t, scale in [(0,.9),(.18,1.03),(.40,1),(.67,.96),(.83,1.13),(.91,.94),(1,1.06)]:
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
        a = hip+Vector((0,y,-.025))
        limb('overall-trouser', a,knee,ankle,(.096,.073,.061), cloth if mechanic else fabric)
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
        sh=shoulder+Vector((0,side*.178,-.025))
        if crouched:
            elbow,wrist=Vector((.24,side*.22,.74)),Vector((.42,side*.14,.66))
        elif seated:
            elbow,wrist=hip+Vector((.08,side*.22,.26)),hip+Vector((.24,side*.14,.14))
        else:
            elbow,wrist=hip+Vector((.025,side*.22,.27)),hip+Vector((.07,side*.21,.07))
        limb('overall-sleeve',sh,elbow,wrist,(.077,.058,.039),cloth)
        direction=(wrist-elbow).normalized()
        cuff=wrist-direction*.035
        sweep('sleeve-cuff',[cuff,wrist],[(.045,.043),(.041,.040)],fabric)
        palm=wrist+direction*.04
        ellipsoid('glove-palm',palm,(.035,.034,.058),rubber if mechanic else fabric)
        # Four curled fingers and a separate opposing thumb give a readable grasp.
        for finger in range(4):
            f=palm+Vector((.022,(finger-1.5)*.015,-.018))
            sweep('glove-finger',[f,f+Vector((.018,0,-.029)),f+Vector((.008,0,-.047))],[(.009,.008),(.01,.009),(.006,.006)],rubber,n=6)
        sweep('glove-thumb',[palm+Vector((.005,-side*.03,.008)),palm+Vector((.035,-side*.037,-.013)),palm+Vector((.036,-side*.02,-.028))],[(.012,.012),(.012,.011),(.008,.008)],rubber,n=6)
        seam('glove-stitch',[tuple(palm+Vector((-.027,-.022,z))) for z in (-.025,0,.025)],cloth,.002)

    head=shoulder+Vector((.06 if crouched else .025,0,.24))
    rings('neck',[(head+Vector((0,0,-.17)),.047,.051),(head+Vector((0,0,-.075)),.052,.052)],skin)
    if mechanic:
        # Sculpted shell sections: a projecting chin bar, cheek transition, rounded crown.
        profiles=[(-.115,.072,.080,.04),(-.095,.115,.105,.025),(-.06,.129,.121,.008),
                  (-.015,.132,.130,0),(.04,.129,.131,-.007),(.09,.111,.113,-.016),
                  (.13,.076,.085,-.02),(.151,.025,.031,-.023),(.154,.004,.005,-.023)]
        rings('helmet-shell',[(head+Vector((cx,0,z)),rx,ry) for z,rx,ry,cx in profiles],cloth,n=24)
        # Wrapped visor band follows the shell; no rectangular visor block.
        verts=[]
        for z,rx,ry in [(-.025,.138,.133),(.015,.139,.135),(.058,.128,.130)]:
            for i in range(17):
                t=-1.18+2.36*i/16
                verts.append(tuple(head+Vector((rx*math.cos(t),ry*math.sin(t),z))))
        mesh('helmet-visor',verts,[(r*17+i,r*17+i+1,(r+1)*17+i+1,(r+1)*17+i) for r in range(2) for i in range(16)],glass)
        for z in (-.029,.061):
            seam('visor-seal',[tuple(head+Vector((.14*math.cos(t),.137*math.sin(t),z))) for t in [-1.18+i*2.36/16 for i in range(17)]],rubber,.004)
        for side in (-1,1):
            ellipsoid('visor-pivot',head+Vector((.046,side*.127,.01)),(.017,.005,.017),rubber)
            seam('chin-vent',[tuple(head+Vector((.145,side*y,-.078))) for y in (.018,.037,.058)],rubber,.005)
        seam('crown-vent',[tuple(head+Vector((x,0,z))) for x,z in [(.065,.121),(.03,.145),(-.012,.156)]],rubber,.004)
    else:
        # Anatomical jaw, cheekbones and cranium, with a face plane and nose silhouette.
        profiles=[(-.105,.047,.048,.020),(-.087,.068,.072,.015),(-.05,.079,.084,.005),
                  (0,.086,.091,0),(.035,.088,.089,-.005),(.073,.075,.077,-.014),(.105,.044,.051,-.02),(.115,.004,.006,-.02)]
        rings('head',[(head+Vector((cx,0,z)),rx,ry) for z,rx,ry,cx in profiles],skin,n=20)
        for side in (-1,1):
            ellipsoid('ear',head+Vector((-.008,side*.09,-.012)),(.021,.016,.035),skin)
            seam('brow',[tuple(head+Vector((.081,side*y,z))) for y,z in [(.014,.032),(.038,.037),(.061,.027)]],fabric,.004)
            seam('eye',[tuple(head+Vector((.087,side*y,.014))) for y in (.022,.04,.054)],rubber,.002)
        mesh('nose',[tuple(head+Vector(v)) for v in [(.08,-.014,.025),(.08,.014,.025),(.121,0,-.022),(.091,-.018,-.038),(.091,.018,-.038)]],[(0,1,2),(0,2,3),(1,4,2),(2,4,3)],skin)
        seam('mouth',[tuple(head+Vector((.091,y,-.062))) for y in (-.023,0,.023)],fabric,.002)
        # Hair cap is fitted to the skull, with a temple line, rather than a sphere head.
        rings('hair',[(head+Vector((-.02,0,z)),rx,ry) for z,rx,ry in [(.048,.087,.087),(.077,.074,.076),(.108,.044,.05),(.118,.003,.005)]],fabric,n=20)
    return tuple(head)

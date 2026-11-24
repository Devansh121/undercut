import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  type InstancedMesh,
  type Light,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { PropRegistry, type Reflected } from '../src/props/registry';
import {
  MirrorCamera,
  REFLECT_LAYER,
  SLOPE_RANGE,
  markReflected,
  waveSlopes,
} from '../src/world/water';

describe('water waves', () => {
  const n = 64;
  const s = waveSlopes(n);
  const at = (i: number, j: number, c: number): number =>
    s[((((j % n) + n) % n) * n + (((i % n) + n) % n)) * 3 + c] as number;

  it('tiles without a seam: across the edge the slopes change no more than inside the tile', () => {
    let inside = 0;
    let edge = 0;
    for (let j = 0; j < n; j++) {
      for (let c = 0; c < 2; c++) {
        inside = Math.max(inside, Math.abs(at(n / 2, j, c) - at(n / 2 - 1, j, c)));
        edge = Math.max(edge, Math.abs(at(0, j, c) - at(n - 1, j, c)));
      }
    }
    expect(edge).toBeLessThan(inside * 1.5);
  });

  it('keeps the slopes inside the stored range and averages them to level water', () => {
    let sx = 0;
    let sz = 0;
    let out = 0;
    for (let p = 0; p < n * n; p++) {
      const x = s[p * 3] as number;
      const z = s[p * 3 + 1] as number;
      sx += x;
      sz += z;
      if (Math.abs(x) > SLOPE_RANGE || Math.abs(z) > SLOPE_RANGE) out++;
    }
    expect(Math.abs(sx / (n * n))).toBeLessThan(0.02);
    expect(Math.abs(sz / (n * n))).toBeLessThan(0.02);
    // Clipping at the range may touch the odd extreme texel, no more.
    expect(out / (n * n)).toBeLessThan(0.005);
  });

  it('stores slopes that are the derivative of the stored height', () => {
    // Central difference of the height (per tile unit) against the stored slope.
    let err = 0;
    let mag = 0;
    for (let j = 0; j < n; j += 7) {
      for (let i = 0; i < n; i += 5) {
        const dh = ((at(i + 1, j, 2) - at(i - 1, j, 2)) * n) / 2;
        err += Math.abs(dh - at(i, j, 0));
        mag += Math.abs(at(i, j, 0));
      }
    }
    expect(err / mag).toBeLessThan(0.25);
  });
});

describe('water reflection', () => {
  it('draws a point above the water where the eye sees its mirror image in the water', () => {
    const main = new PerspectiveCamera(50, 16 / 9, 0.1, 5000);
    main.position.set(12, 9, -30);
    main.lookAt(60, 0.5, 40);
    main.updateMatrixWorld();
    main.updateProjectionMatrix();
    const level = 1.2;
    const mirror = new MirrorCamera();
    mirror.update(main, level);
    const tower = new Vector3(80, 40, 90);
    // The eye sees the tower's reflection where the ray to its mirror image meets the water.
    const image = tower.clone().setY(2 * level - tower.y);
    const eye = main.position;
    const t = (eye.y - level) / (eye.y - image.y);
    const onWater = eye.clone().lerp(image, t);
    const screen = onWater.clone().project(main);
    // The reflection target's uv of the water point (the shader's lookup) is the tower's uv in
    // the mirrored camera's image.
    const tc = onWater.clone().applyMatrix4(mirror.texture);
    const towerInMirror = tower.clone().project(mirror.camera);
    expect(tc.x).toBeCloseTo(towerInMirror.x * 0.5 + 0.5, 4);
    expect(tc.y).toBeCloseTo(towerInMirror.y * 0.5 + 0.5, 4);
    // The reflection's image is the frame mirrored left to right: whatever water is on screen
    // is inside it, so the target covers every visible water point.
    expect(tc.x).toBeCloseTo(1 - (screen.x * 0.5 + 0.5), 4);
    expect(tc.y).toBeCloseTo(screen.y * 0.5 + 0.5, 4);
  });

  it('clips everything under the water out of the reflection', () => {
    const main = new PerspectiveCamera(60, 1.5, 0.1, 3000);
    main.position.set(0, 6, 0);
    main.lookAt(0, 0, 100);
    main.updateMatrixWorld();
    const mirror = new MirrorCamera();
    mirror.update(main, 0);
    const depth = (p: Vector3): number => p.clone().project(mirror.camera).z;
    // Above the water: inside the depth range. Below it: in front of the near plane.
    expect(Math.abs(depth(new Vector3(0, 3, 80)))).toBeLessThan(1);
    expect(depth(new Vector3(0, -3, 80))).toBeLessThan(-1);
  });

  /** A scene as the view builds it: flagged objects, unflagged ones, a prop kind, the lights. */
  function scene(): { scene: Scene; byName: (n: string) => Object3D; lights: Light[] } {
    const sc = new Scene();
    const geo = new BoxGeometry();
    const mat = new MeshBasicMaterial();
    const mesh = (name: string, reflect?: Reflected): Mesh => {
      const m = new Mesh(geo, mat);
      m.name = name;
      if (reflect) m.userData.reflect = reflect;
      return m;
    };
    const track = new Group();
    track.name = 'track';
    track.userData.reflect = 'scenery';
    track.add(mesh('track-road'));
    sc.add(
      mesh('sky', 'skyline'),
      mesh('world:buildings', 'skyline'),
      mesh('world:stands', 'skyline'),
      mesh('world:bridge-struct-0', 'skyline'),
      mesh('world:ground', 'scenery'),
      mesh('world:water-0'),
      mesh('car'),
      track,
    );
    const props = new PropRegistry(1000, 200);
    const kinds: [string, Reflected | undefined][] = [
      ['temporary-stand', 'skyline'],
      ['backdrop-marina-hotel', 'skyline'],
      ['tree-wood', 'scenery'],
      ['floodlight-mast', 'scenery'],
      ['crowd-0', undefined],
    ];
    for (const [id, reflect] of kinds) {
      props.define({ id, reflect, lods: [{ geometry: geo, material: mat, maxDistance: 400 }] });
      props.place(id, { x: 0, y: 0, z: 0, s: 10 });
    }
    props.build();
    sc.add(props.group);
    // The sun (CSM: one directional light per cascade, each with its target), the pooled lamps,
    // the fill.
    const lights: Light[] = [];
    for (let i = 0; i < 3; i++) {
      const sun = new DirectionalLight();
      sc.add(sun, sun.target);
      lights.push(sun);
    }
    for (let i = 0; i < 8; i++) lights.push(new PointLight());
    lights.push(new HemisphereLight(), new AmbientLight());
    for (const l of lights.slice(3)) sc.add(l);
    const byName = (n: string): Object3D => {
      const o = sc.getObjectByName(n);
      if (!o) throw new Error(`no ${n}`);
      return o;
    };
    return { scene: sc, byName, lights };
  }
  const mirror = new PerspectiveCamera();
  mirror.layers.set(REFLECT_LAYER);
  const seen = (o: Object3D): boolean => o.layers.test(mirror.layers);

  it('reflects the sky and the skyline everywhere, the circuit and trees only with scenery', () => {
    for (const scenery of [false, true]) {
      const { scene: sc, byName } = scene();
      markReflected(sc, scenery);
      const skyline = ['sky', 'world:buildings', 'world:stands', 'world:bridge-struct-0'];
      for (const n of [...skyline, 'prop:temporary-stand', 'prop:backdrop-marina-hotel'])
        expect(seen(byName(n)), n).toBe(true);
      for (const n of [
        'world:ground',
        'track',
        'track-road',
        'prop:tree-wood',
        'prop:floodlight-mast',
      ])
        expect(seen(byName(n)), `${n} scenery ${scenery}`).toBe(scenery);
      for (const n of ['world:water-0', 'car', 'prop:crowd-0'])
        expect(seen(byName(n)), n).toBe(false);
    }
  });

  it('lights the reflection with every light the view itself has', () => {
    const { scene: sc, lights } = scene();
    markReflected(sc, false);
    const main = new PerspectiveCamera();
    // three.js collects a camera's lights by its layers: both passes must collect the same set,
    // so a reflected material is lit as it is in the frame and needs no second program.
    const lit = (cam: PerspectiveCamera): number => {
      let n = 0;
      sc.traverse((o) => {
        if ((o as Light).isLight && o.layers.test(cam.layers)) n++;
      });
      return n;
    };
    expect(lit(main)).toBe(lights.length);
    expect(lit(mirror)).toBe(lit(main));
    for (const l of lights) {
      const target = (l as DirectionalLight).target;
      if (target) expect(seen(target)).toBe(true);
    }
    // Every prop instance mesh of a reflected kind is marked, whatever its chunk or level.
    const stands = sc.children
      .flatMap((c) => c.children)
      .filter((c) => c.name === 'prop:temporary-stand') as InstancedMesh[];
    expect(stands.length).toBeGreaterThan(0);
    for (const m of stands) expect(seen(m)).toBe(true);
  });
});

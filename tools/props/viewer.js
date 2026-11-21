/* global window, document, createImageBitmap */
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Environment } from '../../packages/render/src/environment.ts';
import { MONZA_AFTERNOON } from '../../packages/render/src/lighting/time-of-day.ts';
import { QUALITY } from '../../packages/render/src/quality.ts';

const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1600, 1000);
renderer.toneMapping = T.NeutralToneMapping;
renderer.toneMappingExposure = MONZA_AFTERNOON.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
document.body.append(renderer.domElement);
const scene = new T.Scene();
const camera = new T.PerspectiveCamera(35, 1.6, 0.05, 2000);
const index = await (await fetch('/assets/index.json')).json();
const meta = index.skies[MONZA_AFTERNOON.sky];
const image = await createImageBitmap(await (await fetch(`/assets/${meta.hi}`)).blob());
const env = new Environment(scene, camera, MONZA_AFTERNOON, { meta, image }, QUALITY.high);
env.bake(renderer);
const ground = new T.Mesh(
  new T.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
  new T.MeshStandardMaterial({ color: '#62615b', roughness: 0.95 }),
);
ground.position.y = -0.01;
ground.receiveShadow = true;
scene.add(ground);
env.register(ground);
const decoder = new DRACOLoader().setDecoderPath(
  '/node_modules/three/examples/jsm/libs/draco/gltf/',
);
const loader = new GLTFLoader().setDRACOLoader(decoder);
const car = (await loader.loadAsync('/assets/car/car_mobile.glb')).scene;
car.traverse((o) => {
  if (o.isMesh) {
    o.castShadow = true;
    o.receiveShadow = true;
  }
});
env.register(car);
const catalog = await (await fetch('/packages/render/data/props.catalog.json')).json();
window.catalog = catalog;
let active = [];
const at = new T.Vector3();
function frame(prop, angle, aspect, elevation = 0.48) {
  const b = prop.bounds;
  at.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  const size = b.max.map((v, i) => v - b.min[i]);
  const radius = Math.max(Math.hypot(...size) * 0.5, 0.8);
  camera.aspect = aspect;
  const halfVertical = T.MathUtils.degToRad(camera.fov / 2);
  const halfAngle = Math.min(halfVertical, Math.atan(Math.tan(halfVertical) * aspect));
  const distance = (radius / Math.sin(halfAngle)) * 1.08;
  camera.position
    .copy(at)
    .add(
      new T.Vector3(Math.cos(angle), elevation, Math.sin(angle))
        .normalize()
        .multiplyScalar(distance),
    );
  camera.lookAt(at);
  camera.updateProjectionMatrix();
  env.update(camera, at, true);
}
window.inspect = async (id, mode) => {
  for (const o of active) {
    scene.remove(o);
    o.traverse((n) => {
      if (n.isMesh) {
        n.geometry.dispose();
        for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
          for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
          m.dispose();
        }
      }
    });
  }
  active = [];
  scene.remove(car);
  const prop = catalog.props.find((p) => p.id === id);
  for (const l of [0, 2]) {
    const o = (await loader.loadAsync(`/${prop.lods[l].file}`)).scene;
    o.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = true;
        n.receiveShadow = true;
      }
    });
    scene.add(o);
    env.register(o);
    active.push(o);
  }
  renderer.setScissorTest(true);
  if (mode === 'sheet') {
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 4; col++) {
        active[0].visible = row === 0;
        active[1].visible = row === 1;
        renderer.setViewport(col * 400, (1 - row) * 500, 400, 500);
        renderer.setScissor(col * 400, (1 - row) * 500, 400, 500);
        frame(prop, Math.PI / 4 + (col * Math.PI) / 2, 0.8);
        renderer.render(scene, camera);
      }
  } else if (mode === 'close') {
    // High LOD only, front three-quarter and back three-quarter, near eye height.
    active[0].visible = true;
    active[1].visible = false;
    for (let col = 0; col < 2; col++) {
      renderer.setViewport(col * 800, 0, 800, 1000);
      renderer.setScissor(col * 800, 0, 800, 1000);
      frame(prop, -Math.PI / 5 + col * Math.PI, 0.8, 0.18);
      renderer.render(scene, camera);
    }
  } else {
    active[0].visible = true;
    active[1].visible = false;
    scene.add(car);
    const cx = prop.bounds.max[0] + 3.6;
    car.position.set(cx, 0, 0);
    const combined = {
      bounds: {
        min: [Math.min(prop.bounds.min[0], cx - 2.9), 0, Math.min(prop.bounds.min[2], -1.1)],
        max: [
          Math.max(prop.bounds.max[0], cx + 2.9),
          Math.max(prop.bounds.max[1], 1.1),
          Math.max(prop.bounds.max[2], 1.1),
        ],
      },
    };
    renderer.setViewport(0, 0, 1600, 1000);
    renderer.setScissor(0, 0, 1600, 1000);
    frame(combined, Math.PI / 4, 1.6);
    renderer.render(scene, camera);
  }
  renderer.setScissorTest(false);
};
window.ready = true;

// Inspection assembly only: placement in the game belongs to the dressing slice.
window.corridor = async () => {
  for (const o of active) scene.remove(o);
  scene.remove(car);
  const group = new T.Group();
  scene.add(group);
  const cache = new Map();
  const placed = new Map();
  const load = async (id) => {
    if (!cache.has(id)) {
      const prop = catalog.props.find((p) => p.id === id);
      cache.set(id, (await loader.loadAsync(`/${prop.lods[0].file}`)).scene);
    }
    return cache.get(id);
  };
  const place = async (id, x, z, yaw = 0, y = 0) => {
    const o = (await load(id)).clone(true);
    o.position.set(x, y, z);
    o.rotation.y = yaw;
    o.updateMatrixWorld(true);
    group.add(o);
    if (!placed.has(id)) placed.set(id, []);
    placed.get(id).push(o);
    return o;
  };
  for (let z = -30; z < 170; z += 4) {
    for (const side of [-1, 1]) {
      await place('concrete-wall', side * 7.5, z, side === -1 ? 0 : Math.PI);
      await place('catch-fence', side * 7.7, z, side === -1 ? 0 : Math.PI);
    }
  }
  const rows = catalog.props.find((p) => p.id === 'grandstand-roof').attachments;
  const seats = [];
  for (let z = -20; z < 180; z += 10) {
    const stand = await place('grandstand-roof', -17.5, z);
    for (const row of rows)
      for (let i = 0; i < row.count; i++) {
        if ((i + Math.round(z) + row.count) % 13 === 0) continue;
        const p = new T.Vector3(...row.position);
        p.z += i * row.spacing;
        p.y -= 0.5;
        stand.localToWorld(p);
        seats.push(p);
      }
    if (z < 90) await place('pit-garage', 22, z, Math.PI);
    await place('hoarding', -6.9, z, 0);
  }
  const palette = ['#b13628', '#d5c9ae', '#2675a5', '#d29b32', '#315944', '#443f42'];
  const template = await load('crowd-seated-0');
  template.updateMatrixWorld(true);
  template.traverse((o) => {
    if (!o.isMesh) return;
    const mesh = new T.InstancedMesh(o.geometry, o.material, seats.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const transform = new T.Matrix4();
    for (let i = 0; i < seats.length; i++) {
      transform.makeTranslation(seats[i].x, seats[i].y, seats[i].z).multiply(o.matrixWorld);
      mesh.setMatrixAt(i, transform);
      if (o.material.name === 'clothing')
        mesh.setColorAt(i, new T.Color(palette[(i * 17 + Math.floor(i / 16)) % palette.length]));
    }
    group.add(mesh);
  });
  await place('start-gantry', 0, 30, Math.PI / 2);
  await place('bridge-banner', 0, 100, Math.PI / 2);
  await place('camera-tower', -12, 70);
  await place('screen-tower', -24, 10, Math.PI / 2);
  for (let z = -20; z < 80; z += 4) {
    const wall = await place('pit-wall', 10, z, Math.PI);
    const anchors = catalog.props
      .find((p) => p.id === 'pit-wall')
      .attachments.filter((a) => a.role === 'engineer');
    for (const anchor of anchors) {
      const p = wall.localToWorld(new T.Vector3(...anchor.position));
      await place('crew-engineer-standing', p.x, p.z, Math.PI);
    }
  }
  for (let z = -20; z < 90; z += 6) {
    await place('crew-mechanic-standing', 15.6, z, Math.PI);
    await place('crew-mechanic-crouched', 14.4, z + 1, Math.PI);
  }
  const road = new T.Mesh(
    new T.PlaneGeometry(14, 240).rotateX(-Math.PI / 2),
    new T.MeshStandardMaterial({ color: '#333536', roughness: 0.95 }),
  );
  road.position.set(0, 0.005, 70);
  road.receiveShadow = true;
  group.add(road);
  scene.add(car);
  car.position.set(0, 0, -18);
  car.rotation.y = -Math.PI / 2;
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  env.register(group);
  renderer.setViewport(0, 0, 1600, 1000);
  camera.aspect = 1.6;
  camera.fov = 42;
  camera.position.set(4, 2.2, -42);
  camera.lookAt(-1, 4.8, 35);
  camera.updateProjectionMatrix();
  env.update(camera, new T.Vector3(0, 0, 20), true);
  renderer.render(scene, camera);
  window.corridorStats = {
    figures: seats.length,
    modules: 20,
    standLength: 200,
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  };
};

window.artwork = async (id) => {
  await window.inspect(id, 'sheet');
  active[0].visible = true;
  active[1].visible = false;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#b52b20';
  ctx.fillRect(0, 0, 350, 512);
  ctx.fillStyle = '#e8e5d9';
  ctx.fillRect(350, 0, 324, 512);
  ctx.fillStyle = '#17589b';
  ctx.fillRect(674, 0, 350, 512);
  ctx.fillStyle = '#101318';
  ctx.font = 'bold 90px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('LEFT  >  27', 512, 300);
  const texture = new T.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = T.SRGBColorSpace;
  active[0].traverse((o) => {
    if (o.isMesh && o.material.name === (id === 'screen-tower' ? 'glazing' : 'board-face')) {
      o.material.map = texture;
      o.material.color.set('#ffffff');
      o.material.needsUpdate = true;
    }
  });
  const prop = catalog.props.find((p) => p.id === id);
  const anchor = prop.attachments.find((a) => a.uv);
  const center = new T.Vector3(...anchor.position);
  const distance =
    (Math.max(anchor.size[0] / 1.6, anchor.size[1]) /
      (2 * Math.tan(T.MathUtils.degToRad(35 / 2)))) *
    1.2;
  camera.aspect = 1.6;
  camera.fov = 35;
  camera.position.copy(center).add(new T.Vector3(distance, 0, 0));
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  renderer.setViewport(0, 0, 1600, 1000);
  env.update(camera, center, true);
  renderer.render(scene, camera);
};

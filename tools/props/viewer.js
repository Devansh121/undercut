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
function frame(prop, angle, aspect) {
  const b = prop.bounds;
  at.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  const radius = Math.max(...b.max.map((v, i) => v - b.min[i]), 1.5) * 0.75;
  camera.aspect = aspect;
  camera.position
    .copy(at)
    .add(
      new T.Vector3(Math.cos(angle) * radius * 2.6, radius * 1.25, Math.sin(angle) * radius * 2.6),
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
  } else {
    active[0].visible = true;
    active[1].visible = false;
    scene.add(car);
    car.position.set(prop.bounds.max[0] + 3.5, 0, 0);
    renderer.setViewport(0, 0, 1600, 1000);
    renderer.setScissor(0, 0, 1600, 1000);
    frame(prop, Math.PI / 4, 1.6);
    camera.position.multiplyScalar(1.3);
    camera.lookAt(at);
    env.update(camera, at, true);
    renderer.render(scene, camera);
  }
  renderer.setScissorTest(false);
};
window.ready = true;

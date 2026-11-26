/** Small isolated WebGL scene: real glass and cars, no circuit, post stack or shadow maps. */
import {
  Color,
  Group,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { CockpitMirrors } from '../../../packages/render/src/car/mirrors';
import { Environment } from '../../../packages/render/src/environment';
import { MONZA_AFTERNOON } from '../../../packages/render/src/lighting/time-of-day';
import { QUALITY } from '../../../packages/render/src/quality';

export async function run() {
  const renderer = new WebGLRenderer();
  renderer.setSize(960, 600);
  const scene = new Scene();
  const eye = new Vector3(0.24, 0.805, 0);
  const main = new PerspectiveCamera(74, 960 / 600, 0.05, 500);
  main.position.copy(eye);
  main.lookAt(eye.clone().add(new Vector3(1, -0.07, 0)));
  const body = new Group();
  scene.add(body);
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 64, 32);
  gradient.addColorStop(0, '#285ab5');
  gradient.addColorStop(1, '#dbbf88');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 32);
  const image = await createImageBitmap(canvas);
  const environment = new Environment(
    scene,
    main,
    { ...MONZA_AFTERNOON, sunScale: 0, sunFallback: 0 },
    {
      image,
      meta: {
        hi: '',
        lo: '',
        scale: 1,
        sun: {
          present: false,
          elevationDeg: 48,
          u: 0.5,
          irradiance: [0, 0, 0],
          solidAngleSr: 0.000068,
        },
        skyIrradiance: [1, 1, 1],
      },
    },
    QUALITY.lite,
  );
  const decoder = new DRACOLoader().setDecoderPath('/assets/draco/');
  const loader = new GLTFLoader().setDRACOLoader(decoder);
  const asset = (await loader.loadAsync('/assets/car/car_high.glb')).scene;
  const glass: Mesh[] = [];
  asset.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.visible = !Array.isArray(o.material) && o.material.name === 'mirror_glass';
    if (o.visible) glass.push(o);
  });
  body.add(asset);
  const mirrors = new CockpitMirrors(QUALITY.high, environment.skyUniforms, eye, body);
  for (const mesh of glass) mesh.material = mirrors.material;

  // Independently sample triangle interiors with the shader's interpolated normal. Every ray
  // must lie beyond the shader's 3 % fade border, including the damped eye's travel corners.
  body.updateMatrixWorld(true);
  const rotation = new Matrix3().setFromMatrix4(mirrors.camera.matrixWorldInverse);
  const p = mirrors.camera.projectionMatrix.elements;
  const coverage = [0, 0];
  const totals = [0, 0];
  for (const mesh of glass) {
    const pos = mesh.geometry.getAttribute('position');
    const norm = mesh.geometry.getAttribute('normal');
    const index = mesh.geometry.index!;
    const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let t = 0; t < index.count; t += 3) {
      const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      for (let a = 0; a <= 4; a++)
        for (let b = 0; b <= 4 - a; b++) {
          const weights = [a / 4, b / 4, 1 - (a + b) / 4];
          const point = new Vector3(),
            normal = new Vector3();
          ids.forEach((id, i) => {
            point.addScaledVector(new Vector3().fromBufferAttribute(pos, id), weights[i]!);
            normal.addScaledVector(new Vector3().fromBufferAttribute(norm, id), weights[i]!);
          });
          point.applyMatrix4(mesh.matrixWorld);
          normal.applyMatrix3(normalMatrix).normalize();
          for (const dx of [-0.02, 0.02])
            for (const dy of [-0.02, 0.02])
              for (const dz of [-0.02, 0.02]) {
                const ray = point
                  .clone()
                  .sub(eye.clone().add(new Vector3(dx, dy, dz)))
                  .normalize()
                  .reflect(normal)
                  .applyMatrix3(rotation);
                const u = ((p[0]! * ray.x) / -ray.z - p[8]!) * 0.5 + 0.5;
                const v = ((p[5]! * ray.y) / -ray.z - p[9]!) * 0.5 + 0.5;
                const side = point.z < 0 ? 0 : 1;
                totals[side]!++;
                if (ray.z < -0.05 && u > 0.03 && u < 0.97 && v > 0.03 && v < 0.97)
                  coverage[side]!++;
              }
        }
    }
  }

  // Identifiable red and green cars behind and to either side. These are actual car meshes,
  // not coloured pixels inserted into the target: they must survive capture and glass lookup.
  const cars: Group[] = [];
  for (const side of [-1, 1]) {
    const car = (await loader.loadAsync('/assets/car/car_mobile.glb')).scene;
    car.position.set(-7, 0, side * 9.5);
    const material = new MeshBasicMaterial({ color: side < 0 ? 0xff0000 : 0x00ff00 });
    car.traverse((o) => {
      if (o instanceof Mesh) o.material = material;
    });
    scene.add(car);
    cars.push(car);
  }
  const frame = new WebGLRenderTarget(960, 600);
  const draw = () => {
    renderer.setRenderTarget(frame);
    renderer.render(scene, main);
    const pixels = new Uint8Array(960 * 600 * 4);
    renderer.readRenderTargetPixels(frame, 0, 0, 960, 600, pixels);
    return pixels;
  };
  // Isolate the visible glass mask, then require traffic pixels inside that mask on each side.
  const sky = scene.getObjectByName('sky')!;
  sky.visible = false;
  cars.forEach((c) => (c.visible = false));
  scene.background = new Color(0, 0, 0);
  const white = new MeshBasicMaterial({ color: 0xffffff, side: mirrors.material.side });
  glass.forEach((m) => (m.material = white));
  const mask = draw();
  glass.forEach((m) => (m.material = mirrors.material));
  cars.forEach((c) => (c.visible = true));
  sky.visible = true;
  scene.updateMatrixWorld(true);
  mirrors.render(renderer, scene);
  const pixels = draw();
  const traffic = [0, 0];
  for (let i = 0; i < pixels.length; i += 4) {
    if (mask[i]! < 240) continue;
    const r = pixels[i]!,
      g = pixels[i + 1]!,
      b = pixels[i + 2]!;
    if ((i / 4) % 960 < 480 && r > 100 && g < 30 && b < 30) traffic[0]!++;
    if ((i / 4) % 960 >= 480 && g > 100 && r < 30 && b < 30) traffic[1]!++;
  }

  renderer.setRenderTarget(null);
  renderer.render(scene, main);
  const trafficImage = renderer.domElement.toDataURL();

  // Move and rotate the camera's car far from the origin. The production sky callback must
  // produce the same image as an unparented camera at that exact world pose.
  asset.visible = false;
  cars.forEach((c) => (c.visible = false));
  body.position.set(-628, 2.4, 904);
  body.rotation.set(0.02, 1.1, -0.03);
  scene.updateMatrixWorld(true);
  const standalone = new PerspectiveCamera();
  standalone.projectionMatrix.copy(mirrors.camera.projectionMatrix);
  mirrors.camera.getWorldPosition(standalone.position);
  mirrors.camera.getWorldQuaternion(standalone.quaternion);
  standalone.updateMatrixWorld(true);
  const skyFrame = new WebGLRenderTarget(64, 32);
  const skyPixels = (camera: PerspectiveCamera) => {
    renderer.setRenderTarget(skyFrame);
    renderer.render(scene, camera);
    const px = new Uint8Array(64 * 32 * 4);
    renderer.readRenderTargetPixels(skyFrame, 0, 0, 64, 32, px);
    return px;
  };
  const parented = skyPixels(mirrors.camera);
  const skyDistance = sky.position.distanceTo(standalone.position);
  const unparented = skyPixels(standalone);
  let skyError = 0;
  for (let i = 0; i < parented.length; i++)
    skyError = Math.max(skyError, Math.abs(parented[i]! - unparented[i]!));
  const result = {
    trafficImage,
    coverage: coverage.map((n, i) => n / totals[i]!),
    traffic,
    skyDistance,
    skyError,
  };
  mirrors.dispose();
  environment.dispose();
  decoder.dispose();
  frame.dispose();
  skyFrame.dispose();
  white.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  image.close();
  return result;
}

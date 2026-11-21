/* global document, window, location, innerWidth, innerHeight, addEventListener, requestAnimationFrame */
// Standalone car viewer: environment generated in code, ground with contact shadow, ACES tone
// mapping, a shadowed key light; applies a team livery and poses the animated nodes from the
// query string. Not part of the game build.
//
// Query: team=<id> driver=0|1 lod=high|mobile|far view=<station> steer=<deg> drs=0..1
//        travel=<m> spin=<deg> glow=0..1 rain=0..1 compound=soft|medium|hard anim=1
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

import { loadCars, TYRE_RADIUS } from './car-rig.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
const teamId = q.get('team') ?? 'calder';
const lod = q.get('lod') ?? 'high';
const view = q.get('view') ?? 'front34';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exposure', 0.95);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1b1d21');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
scene.environmentIntensity = 0.6;

// ground: dark asphalt-grey, receives the key light's shadow
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: '#3a3c40', roughness: 0.95, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const sun = new THREE.DirectionalLight('#fff4e6', 3.2);
sun.position.set(3.5, 7.0, -4.5);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -4;
sc.right = 4;
sc.top = 4;
sc.bottom = -4;
sc.near = 1;
sc.far = 20;
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.01;
sun.shadow.radius = 3;
scene.add(sun);
scene.add(new THREE.HemisphereLight('#c9d6e6', '#1a1a1a', 0.35));

// contact shadow: depth seen from below, blurred, laid on the ground
function contactShadow(width, depth) {
  const size = 512;
  const group = new THREE.Group();
  group.position.y = 0.002;
  const rt = new THREE.WebGLRenderTarget(size, size);
  rt.texture.generateMipmaps = false;
  const rtBlur = new THREE.WebGLRenderTarget(size, size);
  rtBlur.texture.generateMipmaps = false;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: rt.texture,
      opacity: 0.85,
      transparent: true,
      depthWrite: false,
    }),
  );
  plane.renderOrder = 1;
  plane.scale.y = -1;
  group.add(plane);
  const cam = new THREE.OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 0, 0.6);
  cam.rotation.x = Math.PI / 2;
  group.add(cam);
  const depthMat = new THREE.MeshDepthMaterial();
  depthMat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace(
      'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * 1.0 );',
    );
  };
  depthMat.depthTest = false;
  depthMat.depthWrite = false;
  const blurPlane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth).rotateX(Math.PI / 2));
  blurPlane.visible = false;
  group.add(blurPlane);
  const hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
  const vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
  hBlur.depthTest = vBlur.depthTest = false;
  function blur(amount) {
    blurPlane.visible = true;
    blurPlane.material = hBlur;
    hBlur.uniforms.tDiffuse.value = rt.texture;
    hBlur.uniforms.h.value = amount / 256;
    renderer.setRenderTarget(rtBlur);
    renderer.render(blurPlane, cam);
    blurPlane.material = vBlur;
    vBlur.uniforms.tDiffuse.value = rtBlur.texture;
    vBlur.uniforms.v.value = amount / 256;
    renderer.setRenderTarget(rt);
    renderer.render(blurPlane, cam);
    blurPlane.visible = false;
  }
  group.update = () => {
    const bg = scene.background;
    scene.background = null;
    scene.overrideMaterial = depthMat;
    plane.visible = false;
    renderer.setClearAlpha(0);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    scene.overrideMaterial = null;
    blur(1.2);
    blur(0.5);
    renderer.setRenderTarget(null);
    renderer.setClearAlpha(1);
    plane.visible = true;
    scene.background = bg;
  };
  return group;
}
const shadow = contactShadow(7.0, 3.2);
scene.add(shadow);

// cameras: three.js frame, +X forward, +Y up, +Z right
const STATIONS = {
  front34: { eye: [6.9, 1.55, -4.3], at: [0.25, 0.36, 0], fov: 27 },
  rear34: { eye: [-6.6, 1.75, -4.1], at: [-0.35, 0.4, 0], fov: 27 },
  side: { eye: [0.2, 0.62, -18], at: [0.2, 0.42, 0], fov: 12.5 },
  top: { eye: [0.2, 18, 0.0001], at: [0.2, 0, 0], fov: 12.5, up: [0, 0, -1] },
  front: { eye: [16, 0.62, 0], at: [0, 0.45, 0], fov: 8.2 },
  rear_ortho: { eye: [-16, 0.7, 0], at: [0, 0.48, 0], fov: 8.2 },
  wing: { eye: [4.4, 0.62, -1.35], at: [2.55, 0.18, -0.35], fov: 40 },
  cockpit: { eye: [1.75, 1.45, -1.05], at: [0.3, 0.7, 0], fov: 38 },
  low: { eye: [4.6, 0.18, 2.4], at: [0.6, 0.25, 0], fov: 50 },
  // standard stations added in M2: straight behind, and a chase camera 6 m back and 2 m up
  rear: { eye: [-9.0, 0.8, 0], at: [0, 0.5, 0], fov: 27 },
  rearwing: { eye: [-3.7, 1.35, -1.7], at: [-2.25, 0.72, 0], fov: 34 },
  bodywork: { eye: [0.3, 1.55, -2.5], at: [-0.75, 0.52, -0.35], fov: 36 },
  wheel: { eye: [2.85, 0.5, -1.95], at: [1.8, 0.36, -0.8], fov: 30 },
  chase: { eye: [-6.0, 2.0, 0], at: [1.2, 0.45, 0], fov: 50 },
};
const strip = view === 'strip';
const st = STATIONS[view] ?? STATIONS.front34;
const camera = new THREE.PerspectiveCamera(
  strip ? 30 : st.fov,
  innerWidth / innerHeight,
  0.05,
  400,
);
if (!strip) {
  camera.position.fromArray(st.eye);
  if (st.up) camera.up.fromArray(st.up);
  camera.lookAt(new THREE.Vector3().fromArray(st.at));
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const ASSETS = '/apps/web/public/assets/car';
const lods = strip ? ['high', 'mobile', 'far'] : [lod];
const [cars, liveries, teams, compounds] = await Promise.all([
  loadCars(
    lods.map((l) => `${ASSETS}/car_${l}.glb`),
    { dracoPath: '/node_modules/three/examples/jsm/libs/draco/gltf/' },
  ),
  fetch(`${ASSETS}/livery/index.json`).then((r) => r.json()),
  fetch('/design/teams.json').then((r) => r.json()),
  fetch('/design/compounds.json').then((r) => r.json()),
  document.fonts.load('700 64px "Barlow Semi Condensed"'),
]);

const team = teams.teams.find((t) => t.id === teamId) ?? teams.teams[0];
const liv = liveries.teams[team.id];
const mask = await new THREE.TextureLoader().loadAsync(`${ASSETS}/${liv.mask}`);
mask.colorSpace = THREE.NoColorSpace;
mask.flipY = false;
mask.anisotropy = 8;
const driver = team.drivers[num('driver', 0)];
const lum = (hex) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};
const light = lum(liv.primary) < 0.35;
const compound =
  compounds.compounds.find((c) => c.id === (q.get('compound') ?? 'medium')) ??
  compounds.compounds[1];

const deg = THREE.MathUtils.degToRad;
const pose = {
  spin: deg(num('spin', 0)),
  steer: deg(num('steer', 0)),
  wheelTurn: deg(num('steer', 0)) * 9,
  drs: num('drs', 0),
  travel: Object.fromEntries(['FL', 'FR', 'RL', 'RR'].map((c) => [c, num('travel', 0)])),
  glow: Object.fromEntries(['FL', 'FR', 'RL', 'RR'].map((c) => [c, num('glow', 0)])),
  rain: num('rain', 0),
  headYaw: deg(num('head', 0)),
};
const SPACING = 7.0;
cars.forEach(({ root, rig }, i) => {
  rig.setLivery(mask, liv);
  rig.setMarkings({
    number: driver.number,
    code: driver.code,
    fill: light ? '#f2f0eb' : '#121316',
    outline: light ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.25)',
    font: '"Barlow Semi Condensed"',
  });
  rig.setCompound(compound, compounds.tyreMarking);
  rig.setPose(pose);
  if (strip) root.position.z = (i - 1) * SPACING;
  scene.add(root);
});
const rig = cars[0].rig;

// LOD transition strip: the three levels side by side at the distance where the car's bounding
// sphere (radius 3 m) projects to `px` pixels of radius, then each one magnified
let overlay = null;
const BOUND_R = 3.0;
if (strip) {
  const px = num('px', 160);
  const zoom = num('zoom', px < 100 ? 3 : 1);
  const d = (BOUND_R * innerHeight) / (2 * px * Math.tan(deg(camera.fov) / 2));
  const dir = new THREE.Vector3(-0.78, 0.32, -0.54).normalize();
  camera.position.copy(dir.multiplyScalar(d)).add(new THREE.Vector3(0, 0.5, 0));
  camera.lookAt(0, 0.5, 0);
  scene.remove(shadow);
  sc.left = sc.bottom = -16;
  sc.right = sc.top = 16;
  sc.updateProjectionMatrix();
  renderer.domElement.style.display = 'none';
  overlay = document.createElement('canvas');
  overlay.width = innerWidth;
  overlay.height = innerHeight;
  document.body.appendChild(overlay);
  overlay.draw = () => {
    const g = overlay.getContext('2d');
    g.fillStyle = '#1b1d21';
    g.fillRect(0, 0, overlay.width, overlay.height);
    g.imageSmoothingEnabled = false;
    const box = Math.round(px * 2.3);
    const names = ['High', 'Mobile', 'Far'];
    cars.forEach(({ root }, i) => {
      const p = new THREE.Vector3(0, 0.5, root.position.z).project(camera);
      const cx = Math.round((p.x * 0.5 + 0.5) * innerWidth);
      const cy = Math.round((-p.y * 0.5 + 0.5) * innerHeight);
      const sx = cx - box / 2;
      const sy = cy - box / 2;
      const slot = innerWidth / 3;
      // actual size, top row
      g.drawImage(renderer.domElement, sx, sy, box, box, slot * i + (slot - box) / 2, 40, box, box);
      // magnified, bottom row
      const mb = Math.min(box * zoom, slot - 20, innerHeight - box - 110);
      g.drawImage(
        renderer.domElement,
        sx,
        sy,
        box,
        box,
        slot * i + (slot - mb) / 2,
        box + 80,
        mb,
        mb,
      );
      g.fillStyle = '#c9c7c2';
      g.font = '600 18px "Barlow Semi Condensed"';
      g.textAlign = 'center';
      g.fillText(names[i], slot * i + slot / 2, 26);
    });
    g.textAlign = 'left';
    g.fillText(
      `bounding-sphere radius ${px} px at ${innerHeight} px tall, top row 1:1, bottom row x${zoom}`,
      16,
      innerHeight - 14,
    );
  };
}

const animate = q.get('anim') === '1';
const clock = new THREE.Clock();
let frames = 0;
function frame() {
  if (animate) {
    const t = clock.getElapsedTime();
    const speed = 20; // m/s
    pose.spin = (-speed / TYRE_RADIUS) * t;
    pose.steer = deg(18) * Math.sin(t * 0.8);
    pose.wheelTurn = pose.steer * 9;
    pose.drs = 0.5 + 0.5 * Math.sin(t * 0.6);
    for (const c of ['FL', 'FR', 'RL', 'RR']) pose.travel[c] = 0.02 * Math.sin(t * 2.1 + c.length);
    rig.setPose(pose);
  }
  if (!strip) shadow.update();
  renderer.render(scene, camera);
  if (overlay) overlay.draw();
  frames += 1;
  if (frames === 3) window.__ready = true;
  requestAnimationFrame(frame);
}
frame();
window.__stats = () => ({
  calls: renderer.info.render.calls,
  triangles: renderer.info.render.triangles,
});

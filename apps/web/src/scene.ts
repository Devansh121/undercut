import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from 'three';

/**
 * Proof that the render path works: a lit ground plane under a hazy sky. Replaced by
 * the real circuit renderer in M1. World frame is three.js native: +Y up, +X east,
 * +Z south.
 */
export interface StageView {
  /** Draw a frame. `time` is interpolated sim time in seconds. */
  render(time: number): void;
  dispose(): void;
}

const SKY = new Color('#b9c6cf');
const GROUND = new Color('#5b5e5c');

export function createStage(canvas: HTMLCanvasElement): StageView {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new Scene();
  scene.background = SKY;
  scene.fog = new Fog(SKY, 60, 900);

  scene.add(new HemisphereLight('#dfe8ee', '#3d3a33', 1.4));
  const sun = new DirectionalLight('#fff4e0', 2.2);
  sun.position.set(-120, 90, -60);
  scene.add(sun);

  const ground = new Mesh(
    new PlaneGeometry(4000, 4000),
    new MeshStandardMaterial({ color: GROUND, roughness: 0.92, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Eye height of a driver in an open-wheel car is about 1 m.
  const camera = new PerspectiveCamera(55, 1, 0.1, 5000);
  camera.position.set(0, 1.1, 0);

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  return {
    render(time) {
      // A slow pan so a stalled loop is visible at a glance.
      const yaw = Math.sin(time * 0.05) * 0.35;
      camera.rotation.set(-0.06, yaw, 0, 'YXZ');
      renderer.render(scene, camera);
    },
    dispose() {
      observer.disconnect();
      renderer.dispose();
    },
  };
}

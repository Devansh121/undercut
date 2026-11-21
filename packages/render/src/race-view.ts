import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { CarPose } from '@undercut/sim';
import type { Track } from '@undercut/track';
import { CameraRig, type CameraName } from './cameras';
import { CarModel, type CarGeometry, type Livery } from './car/car-model';
import { Environment, MONZA_AFTERNOON, type LightingPreset } from './environment';
import { QUALITY, type Quality, type QualityName } from './quality';
import { TrackView } from './track-view';

/**
 * The page's one WebGL renderer. Sessions come and go but the renderer (and its GL context and
 * state cache) lives as long as the page: a second WebGLRenderer on the same canvas gets the
 * same context with pixel-store state the new renderer does not know about.
 */
export function createRenderer(canvas: HTMLCanvasElement, quality: QualityName): WebGLRenderer {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: QUALITY[quality].antialias,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  return renderer;
}

export interface RaceViewOptions {
  /** The page's renderer from `createRenderer`; the view uses it and never disposes it. */
  renderer: WebGLRenderer;
  track: Track;
  quality: QualityName;
  livery: Livery;
  car: CarGeometry;
  lighting?: LightingPreset;
}

/** Everything the view needs for one frame, already interpolated by the game loop. */
export interface ViewFrame {
  pose: CarPose;
  /** Ghost pose, or null when no ghost is on track. */
  ghost: CarPose | null;
  /** DRS flap position, 0 closed to 1 open. */
  drs: number;
  speed: number;
  longG: number;
  latG: number;
  /** Real seconds since the last frame; 0 while paused freezes the cameras. */
  dt: number;
  /** Running time for camera shake, s. */
  time: number;
  lookBack: boolean;
}

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ViewStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  pixelRatio: number;
  width: number;
  height: number;
}

/**
 * The 3D view of a session: a WebGL 2 renderer set up for physically based lighting (sRGB
 * output, AgX filmic tone mapping, soft sun shadows, the sky as image-based light), the circuit,
 * the player's car and the ghost, and the camera rig.
 */
export class RaceView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 9000);
  readonly rig = new CameraRig();
  readonly quality: Quality;
  private readonly canvas: HTMLCanvasElement;
  private readonly environment: Environment;
  private readonly trackView: TrackView;
  private readonly car: CarModel;
  private readonly ghostCar: CarModel;
  private readonly focus = new Vector3();
  private readonly observer: ResizeObserver;
  private width = 0;
  private height = 0;
  /** Screen rectangle (CSS px) the chase cameras keep the car clear of, e.g. the HUD cluster. */
  private avoid: ScreenRect | null = null;
  /** Current upward shift of the image, CSS px, smoothed. */
  private lift = 0;
  private readonly points: Vector3[] = [];

  constructor(canvas: HTMLCanvasElement, options: RaceViewOptions) {
    this.canvas = canvas;
    this.quality = QUALITY[options.quality];
    const q = this.quality;
    this.renderer = options.renderer;
    const lighting = options.lighting ?? MONZA_AFTERNOON;
    this.renderer.toneMappingExposure = lighting.exposure;
    this.width = 0;
    this.height = 0;

    this.environment = new Environment(this.scene, lighting, q);
    this.environment.bakeEnvironment(this.renderer, this.scene);
    this.trackView = new TrackView(options.track, q);
    this.scene.add(this.trackView.group);
    this.car = new CarModel(options.car, options.livery, q);
    this.ghostCar = new CarModel(options.car, options.livery, q, true);
    this.ghostCar.root.visible = false;
    this.ghostCar.root.renderOrder = 2;
    this.scene.add(this.car.root, this.ghostCar.root);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  /** Match the drawing buffer to the canvas size, capped at the preset's pixel ratio. */
  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap);
    if (w === this.width && h === this.height && this.renderer.getPixelRatio() === ratio) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get cameraName(): CameraName {
    return this.rig.current;
  }

  setCamera(name: CameraName): void {
    this.rig.set(name);
  }

  nextCamera(): CameraName {
    return this.rig.next();
  }

  /** Jump cameras to steady state (after a reset or teleport). */
  snapCamera(): void {
    this.rig.snap();
  }

  /** Keep the car clear of `rect` (CSS px, viewport space) in the chase cameras; null for none. */
  setAvoidRect(rect: ScreenRect | null): void {
    this.avoid = rect;
  }

  /** The player's car's projected bounding box in CSS pixels, with the current framing. */
  carScreenRect(): ScreenRect {
    this.camera.updateMatrixWorld();
    const out = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const p of this.car.boundingPoints(this.points)) {
      p.project(this.camera);
      const x = ((p.x + 1) / 2) * this.width;
      const y = ((1 - p.y) / 2) * this.height;
      out.left = Math.min(out.left, x);
      out.right = Math.max(out.right, x);
      out.top = Math.min(out.top, y);
      out.bottom = Math.max(out.bottom, y);
    }
    return out;
  }

  /**
   * Shift the image up (a projection offset, so perspective and scale are unchanged) far enough
   * that the car clears the avoid rectangle. Only chase cameras are reframed; the shift eases in
   * and out over about 0.25 s so a camera switch does not jump.
   */
  private frame(chase: boolean, dt: number): void {
    const cam = this.camera;
    const w = this.width;
    const h = this.height;
    let target = 0;
    if (chase && this.avoid) {
      const car = this.carScreenRect();
      const a = this.avoid;
      const margin = 10;
      if (car.left < a.right && a.left < car.right && car.bottom + margin > a.top) {
        // Never lift the car's top out of the frame.
        target = Math.max(0, Math.min(car.bottom + margin - a.top, car.top - 8));
      }
    }
    this.lift = dt > 0 ? target + (this.lift - target) * Math.exp(-dt / 0.25) : this.lift;
    if (this.lift < 0.5) return;
    const dy = this.lift;
    const fullH = h + 2 * dy;
    // Same vertical scale: widen the field of view over the taller virtual frame.
    cam.fov = (2 * Math.atan((Math.tan((cam.fov * Math.PI) / 360) * fullH) / h) * 180) / Math.PI;
    cam.aspect = w / fullH;
    cam.setViewOffset(w, fullH, 0, 2 * dy, w, h);
  }

  render(frame: ViewFrame): void {
    // The rig sets field of view and aspect from scratch each frame; start unshifted.
    this.camera.clearViewOffset();
    this.camera.aspect = this.width / Math.max(1, this.height);
    this.car.apply(frame.pose, frame.drs);
    if (frame.ghost) {
      this.ghostCar.apply(frame.ghost, 0);
      this.ghostCar.root.visible = true;
    } else {
      this.ghostCar.root.visible = false;
    }
    const mode = this.rig.update(
      {
        pose: frame.pose,
        speed: frame.speed,
        longG: frame.longG,
        latG: frame.latG,
        dt: frame.dt,
        time: frame.time,
        car: this.car,
      },
      this.camera,
      frame.lookBack,
    );
    this.car.setHelmetVisible(mode.helmet);
    this.frame(mode.name === 'chase-near' || mode.name === 'chase-far', frame.dt);
    if (frame.ghost) {
      const dx = frame.ghost.x - this.camera.position.x;
      const dz = frame.ghost.z - this.camera.position.z;
      this.ghostCar.setGhostFade(Math.hypot(dx, dz));
    }
    this.focus.set(frame.pose.x, frame.pose.y, frame.pose.z);
    // Bias the shadow box ahead of the car, where the camera looks.
    const ahead = Math.min(this.quality.shadowExtent * 0.5, 4 + frame.speed * 0.25);
    this.focus.x += Math.cos(frame.pose.yaw) * ahead;
    this.focus.z -= Math.sin(frame.pose.yaw) * ahead;
    this.environment.follow(this.focus);
    this.renderer.render(this.scene, this.camera);
  }

  stats(): ViewStats {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
      width: this.width,
      height: this.height,
    };
  }

  dispose(): void {
    this.observer.disconnect();
    this.trackView.dispose();
    this.car.dispose();
    this.ghostCar.dispose();
    this.environment.dispose();
    this.scene.environment = null;
    this.scene.clear();
    // Drop the render lists that still reference this scene's objects; the renderer stays.
    this.renderer.renderLists.dispose();
  }
}

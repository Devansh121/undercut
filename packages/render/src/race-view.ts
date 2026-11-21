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

export interface RaceViewOptions {
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

  constructor(canvas: HTMLCanvasElement, options: RaceViewOptions) {
    this.canvas = canvas;
    this.quality = QUALITY[options.quality];
    const q = this.quality;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: q.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    const lighting = options.lighting ?? MONZA_AFTERNOON;
    this.renderer.toneMappingExposure = lighting.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

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

  render(frame: ViewFrame): void {
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
    this.renderer.dispose();
  }
}

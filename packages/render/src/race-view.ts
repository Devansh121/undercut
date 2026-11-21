import type { Mesh } from 'three';
import {
  DataArrayTexture,
  FloatType,
  HalfFloatType,
  NeutralToneMapping,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import type { CarPose } from '@undercut/sim';
import type { Track } from '@undercut/track';
import { AssetLoader, type AssetIndex, type Progress } from './assets/loader';
import { CameraRig, type CameraName } from './cameras';
import { CarAssets, type CarLivery } from './car/car-assets';
import { CarModel, type CarGeometry } from './car/car-model';
import { ContactShadows } from './car/contact-shadows';
import { CarFleet } from './car/fleet';
import { Environment } from './environment';
import type { LocalLight } from './lighting/light-pool';
import { nextLift } from './framing';
import { MONZA_AFTERNOON, type SkyMeta, type TimeOfDay } from './lighting/time-of-day';
import { disposeSet, pbrSet, type PbrSet } from './materials/surface';
import { DynamicResolution } from './pipeline/dynamic-resolution';
import { GpuTimer } from './pipeline/gpu-timer';
import { RenderPipeline, type ToneMap } from './pipeline/post';
import { PropRegistry } from './props/registry';
import { QUALITY, type Quality, type QualityName } from './quality';
import { TRACK_TEXTURE_IDS, TrackView, type TrackTextureId } from './track-view';

/**
 * The page's one WebGL renderer. Sessions come and go but the renderer (and its GL context and
 * state cache) lives as long as the page. It is preset-independent: anti-aliasing happens in the
 * pipeline's own targets, so a session can change preset without a new context.
 */
export function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.type = PCFShadowMap;
  return renderer;
}

export interface RaceViewOptions {
  /** The page's renderer from `createRenderer`; the view uses it and never disposes it. */
  renderer: WebGLRenderer;
  track: Track;
  quality: QualityName;
  livery: CarLivery;
  car: CarGeometry;
  timeOfDay?: TimeOfDay;
  /** Local lights (floodlights) for a night time of day. */
  localLights?: readonly LocalLight[];
  /** Racing-line lateral offset per lap sample (m), for the rubbered line. */
  racingLine?: ArrayLike<number> | null;
  /** Liveries the other cars may wear (mask patterns are loaded for these). */
  fleetLiveries?: readonly CarLivery[];
  /** URL of the assets folder (ending in /) and of the Draco decoder folder. */
  assetsBase: string;
  dracoPath: string;
  toneMap?: ToneMap;
  onProgress?: (p: Progress) => void;
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
  /** Brake pedal as applied, 0..1 (brake-disc glow). */
  brake: number;
  /** Real seconds since the last frame; 0 while paused freezes the cameras. */
  dt: number;
  /** Running time for camera shake, s. */
  time: number;
  lookBack: boolean;
  /** For the steering-wheel display: gear and rev lights lit (0–15, 16 at the limiter). */
  gear: number;
  revLights: number;
  /** Real milliseconds since the previous animation frame (dynamic resolution). */
  frameMs?: number;
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
  /** Estimated GPU memory held by textures and render targets, MiB. */
  textureMiB: number;
  pixelRatio: number;
  renderScale: number;
  gpuMs: number | null;
  width: number;
  height: number;
  cars: number;
}

/** Everything a session fetches before it can draw, for one preset. */
export interface SessionAssets {
  index: AssetIndex;
  sky: { meta: SkyMeta; image: ImageBitmap };
  sets: Record<TrackTextureId, PbrSet>;
  car: CarAssets;
}

/**
 * The 3D view of a session: the circuit under its time-of-day lighting, the player's car, the
 * ghost, other cars (instanced), the cameras and the render pipeline (docs/render.md).
 */
export class RaceView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.05, 9000);
  readonly rig = new CameraRig();
  readonly quality: Quality;
  readonly props: PropRegistry;
  readonly environment: Environment;
  private readonly canvas: HTMLCanvasElement;
  private readonly trackView: TrackView;
  private readonly car: CarModel;
  private readonly ghostCar: CarModel;
  private readonly fleet: CarFleet;
  private readonly contact: ContactShadows | null;
  private readonly pipeline: RenderPipeline;
  private readonly assets: SessionAssets;
  private readonly dynamic: DynamicResolution;
  private readonly gpu: GpuTimer;
  private readonly fleetLiveries: readonly CarLivery[];
  private readonly track: Track;
  private readonly focus = new Vector3();
  private readonly observer: ResizeObserver;
  private width = 0;
  private height = 0;
  private avoid: ScreenRect | null = null;
  private lift = 0;
  private readonly points: Vector3[] = [];
  private readonly heat = new Float64Array(4);
  private headYaw = 0;
  private lastYaw = 0;
  /** Milliseconds spent building each part of the view (start-up budget checks). */
  readonly loadTimes: Record<string, number>;

  /** Fetch what the session needs (progress by bytes), then build the view. */
  static async load(canvas: HTMLCanvasElement, options: RaceViewOptions): Promise<RaceView> {
    const t0 = performance.now();
    const assets = await RaceView.fetchAssets(options);
    const t1 = performance.now();
    const view = new RaceView(canvas, options, assets);
    view.loadTimes.fetch = t1 - t0;
    return view;
  }

  static async fetchAssets(options: RaceViewOptions): Promise<SessionAssets> {
    const q = QUALITY[options.quality];
    const tod = options.timeOfDay ?? MONZA_AFTERNOON;
    const loader = new AssetLoader(options.assetsBase);
    loader.onProgress = options.onProgress ?? null;
    const index = await loader.json<AssetIndex>('index.json');
    const skyMeta = index.skies[tod.sky] as SkyMeta | undefined;
    if (!skyMeta) throw new Error(`no sky ${tod.sky} in the asset index`);
    const tier = q.textureTier;
    // Declare everything first so the progress bar knows the total from the start.
    loader.expect(skyMeta[q.skyTier], index.files[skyMeta[q.skyTier]]);
    for (const id of TRACK_TEXTURE_IDS) {
      const t = index.textures[id];
      if (!t) throw new Error(`no texture set ${id} in the asset index`);
      for (const f of Object.values(t[tier])) loader.expect(f, index.files[f]);
    }
    const patterns = [
      ...new Set([options.livery.pattern, ...(options.fleetLiveries ?? []).map((l) => l.pattern)]),
    ];
    const skyP = loader.image(skyMeta[q.skyTier]);
    const setP = Promise.all(
      TRACK_TEXTURE_IDS.map(async (id) => {
        const t = index.textures[id] as AssetIndex['textures'][string];
        const files = t[tier];
        const [diff, nor, arm] = await Promise.all([
          loader.image(files.diff as string),
          loader.image(files.nor as string),
          loader.image(files.arm as string),
        ]);
        return [id, { diff, nor, arm, sizeM: t.sizeM }] as const;
      }),
    );
    const carP = CarAssets.load(loader, q, patterns, options.dracoPath);
    const [skyImage, setImages, car] = await Promise.all([skyP, setP, carP]);
    const sets = {} as Record<TrackTextureId, PbrSet>;
    for (const [id, img] of setImages) sets[id] = pbrSet(img, img.sizeM, q.anisotropy);
    return { index, sky: { meta: skyMeta, image: skyImage }, sets, car };
  }

  constructor(canvas: HTMLCanvasElement, options: RaceViewOptions, assets: SessionAssets) {
    this.canvas = canvas;
    this.quality = QUALITY[options.quality];
    this.track = options.track;
    this.assets = assets;
    this.fleetLiveries = options.fleetLiveries ?? [];
    const q = this.quality;
    this.renderer = options.renderer;
    const tod = options.timeOfDay ?? MONZA_AFTERNOON;
    this.renderer.toneMapping = q.post ? NoToneMapping : NeutralToneMapping;
    this.renderer.shadowMap.enabled = q.shadow.cascades > 0;
    this.renderer.shadowMap.needsUpdate = true;
    this.dynamic = new DynamicResolution(q.dynamicResolution);
    this.gpu = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);

    const t0 = performance.now();
    this.environment = new Environment(this.scene, this.camera, tod, assets.sky, q);
    this.environment.bake(this.renderer);
    if (options.localLights) this.environment.setLocalLights(options.localLights);
    const t1 = performance.now();
    this.trackView = new TrackView({
      track: options.track,
      quality: q,
      sets: assets.sets,
      racingLine: options.racingLine ?? null,
    });
    this.scene.add(this.trackView.group);
    const t2 = performance.now();
    this.car = new CarModel(assets.car, q.playerLod, options.livery, q, options.car, 'player');
    this.ghostCar = new CarModel(
      assets.car,
      q.carLods[q.carLods.length - 1] ?? 'far',
      options.livery,
      q,
      options.car,
      'ghost',
    );
    this.ghostCar.root.visible = false;
    this.ghostCar.root.renderOrder = 2;
    this.fleet = new CarFleet(assets.car, q, options.car);
    this.scene.add(this.car.root, this.ghostCar.root, this.fleet.group);
    this.contact = q.contactShadow
      ? new ContactShadows(32, q.shadow.cascades > 0 ? 0.35 : 0.6)
      : null;
    if (this.contact) this.scene.add(this.contact.mesh);
    this.props = new PropRegistry(options.track.length);
    this.scene.add(this.props.group);
    this.environment.register(this.scene);
    this.pipeline = new RenderPipeline(
      this.renderer,
      q,
      this.scene,
      this.camera,
      options.toneMap ?? 'neutral',
    );
    this.loadTimes = { environment: t1 - t0, track: t2 - t1, cars: performance.now() - t2 };

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  /** Match the drawing buffer to the canvas, capped by the preset, scaled by dynamic resolution. */
  resize(force = false): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const ratio =
      Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap) * this.dynamic.scale;
    if (!force && w === this.width && h === this.height && this.renderer.getPixelRatio() === ratio)
      return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.pipeline.setSize(Math.round(w * ratio), Math.round(h * ratio));
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

  /**
   * Place the trackside camera (world position, vertical field of view in degrees), framing the
   * player's car or, with `aim`, a fixed world point.
   */
  setTvCamera(
    x: number,
    y: number,
    z: number,
    fov: number,
    aim?: { x: number; y: number; z: number },
  ): void {
    this.rig.tv.position.set(x, y, z);
    this.rig.tv.fov = fov;
    this.rig.tv.target = aim ? new Vector3(aim.x, aim.y, aim.z) : null;
    this.rig.set('tv');
  }

  setAvoidRect(rect: ScreenRect | null): void {
    this.avoid = rect;
  }

  get dashboard(): { gear: string; speed: string; revs: number } | null {
    return this.car.dashboard;
  }

  /**
   * Put static cars on the grid slots (not the one the player's car is nearest), each in one of
   * the given liveries, for the grid station and the full-field performance run. `count` 0
   * clears them.
   */
  setGridCars(count: number, playerPose: CarPose): void {
    this.fleet.clear();
    if (count <= 0 || this.fleetLiveries.length === 0) return;
    const slots = this.track.gridSlots;
    let skip = -1;
    let best = Infinity;
    slots.forEach((s, i) => {
      const d = Math.hypot(s.x - playerPose.x, s.z - playerPose.z);
      if (d < best) {
        best = d;
        skip = i;
      }
    });
    const pose = { ...playerPose, wheelY: new Float64Array(4), wheelAngle: new Float64Array(4) };
    let placed = 0;
    for (let i = 0; i < slots.length && placed < count; i++) {
      if (i === skip && best < 3) continue;
      const s = slots[i];
      if (!s) continue;
      pose.x = s.x;
      pose.z = s.z;
      pose.yaw = s.yaw;
      pose.y = s.y + 0.045;
      pose.pitch = -0.008;
      pose.roll = 0;
      pose.steerAngle = 0;
      for (let k = 0; k < 4; k++) {
        pose.wheelY[k] = s.y + 0.353;
        pose.wheelAngle[k] = (i * 1.7 + k * 0.9) % (2 * Math.PI);
      }
      const livery = this.fleetLiveries[placed % this.fleetLiveries.length] as CarLivery;
      this.fleet.add(livery, pose);
      placed++;
    }
    this.environment.register(this.fleet.group);
  }

  /** Place one static car anywhere (stations: pit lane close-up). */
  addStaticCar(pose: CarPose, liveryIndex: number): void {
    const livery = this.fleetLiveries[liveryIndex % Math.max(1, this.fleetLiveries.length)];
    if (!livery) return;
    this.fleet.add(livery, pose);
    this.environment.register(this.fleet.group);
  }

  /** A static car parked in pit box `box`, nose out (stations). */
  addPitCar(
    box: number,
    liveryIndex: number,
  ): { x: number; y: number; z: number; yaw: number } | null {
    const b = this.track.pit.boxes[box];
    if (!b) return null;
    const pose = {
      x: b.x,
      y: b.y + 0.045,
      z: b.z,
      yaw: b.yaw,
      pitch: -0.008,
      roll: 0,
      steerAngle: 0.12,
      wheelY: new Float64Array([b.y + 0.353, b.y + 0.353, b.y + 0.353, b.y + 0.353]),
      wheelAngle: new Float64Array([0.3, 1.1, 2.0, 2.9]),
    };
    this.addStaticCar(pose, liveryIndex);
    return { x: b.x, y: b.y, z: b.z, yaw: b.yaw };
  }

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
        target = Math.max(0, Math.min(car.bottom + margin - a.top, car.top - 8));
      }
    }
    this.lift = nextLift(this.lift, target, dt);
    if (this.lift < 0.5) return;
    const dy = this.lift;
    const fullH = h + 2 * dy;
    cam.fov = (2 * Math.atan((Math.tan((cam.fov * Math.PI) / 360) * fullH) / h) * 180) / Math.PI;
    cam.aspect = w / fullH;
    cam.setViewOffset(w, fullH, 0, 2 * dy, w, h);
  }

  /** Brake discs heat with braking power and cool exponentially; fronts take more. */
  private updateHeat(frame: ViewFrame): void {
    const dt = frame.dt;
    if (dt <= 0) return;
    const power = (frame.brake * Math.max(0, frame.speed)) / 80;
    for (let i = 0; i < 4; i++) {
      const share = i < 2 ? 1 : 0.7;
      const h = this.heat[i] as number;
      this.heat[i] = Math.min(1, Math.max(0, h + (power * share * 0.9 - h * 0.35) * dt));
    }
  }

  render(frame: ViewFrame): void {
    const dt = frame.dt;
    if (frame.frameMs !== undefined && this.dynamic.update(this.gpu.latest ?? frame.frameMs))
      this.resize(true);
    this.camera.clearViewOffset();
    this.camera.aspect = this.width / Math.max(1, this.height);
    this.updateHeat(frame);
    // Head turns into the corner: steer plus yaw rate, smoothed.
    if (dt > 0) {
      let dy = frame.pose.yaw - this.lastYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const target = Math.max(-0.4, Math.min(0.4, frame.pose.steerAngle * 1.8 + (dy / dt) * 0.18));
      this.headYaw += (target - this.headYaw) * (1 - Math.exp(-dt / 0.25));
    }
    this.lastYaw = frame.pose.yaw;
    const glow = this.heat.map((h) => Math.max(0, (h - 0.2) / 0.8));
    this.car.apply(frame.pose, { drs: frame.drs, glow, rain: 0, headYaw: this.headYaw });
    if (frame.ghost) {
      this.ghostCar.apply(frame.ghost, { drs: 0, glow: [0, 0, 0, 0], rain: 0, headYaw: 0 });
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
        dt,
        time: frame.time,
        car: this.car,
      },
      this.camera,
      frame.lookBack,
    );
    this.car.setHelmetVisible(mode.helmet);
    if (mode.name === 'cockpit')
      this.car.setDashboard(frame.gear, frame.speed * 3.6, frame.revLights);
    this.frame(mode.name === 'chase-near' || mode.name === 'chase-far', dt);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    if (frame.ghost) {
      this.ghostCar.setGhostFade(
        Math.hypot(frame.ghost.x - this.camera.position.x, frame.ghost.z - this.camera.position.z),
      );
    }
    this.focus.set(frame.pose.x, frame.pose.y, frame.pose.z);
    this.environment.update(this.camera, this.focus, true);
    this.fleet.update(this.camera.position);
    this.props.update(this.camera.position);
    if (this.contact) {
      this.contact.begin();
      const ground = (p: CarPose): number =>
        ((p.wheelY[0] as number) + (p.wheelY[3] as number)) / 2 - 0.355;
      this.contact.add(frame.pose.x, ground(frame.pose), frame.pose.z, frame.pose.yaw);
      this.contact.end();
    }
    const speedBlur = Math.min(1, Math.max(0, (frame.speed - 45) / 45));
    // Count every pass of the frame (shadow cascades, AO, post), not only the last draw.
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.gpu.begin();
    this.pipeline.render(this.scene, this.camera, {
      exposure: this.environment.exposure,
      speedBlur:
        mode.name === 'chase-near' ||
        mode.name === 'chase-far' ||
        mode.name === 'tcam' ||
        mode.name === 'cockpit'
          ? speedBlur
          : 0,
      time: frame.time,
    });
    this.gpu.end();
  }

  /** Estimated GPU memory of textures and targets in use, bytes (mipmaps counted as 4/3). */
  textureBytes(): number {
    const seen = new Set<Texture>();
    this.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const v of Object.values(m as Material)) if (v instanceof Texture) seen.add(v);
        const u = (m as { uniforms?: Record<string, { value: unknown }> }).uniforms;
        if (u) for (const x of Object.values(u)) if (x.value instanceof Texture) seen.add(x.value);
        const su = (m as Material).userData.surfaceUniforms as
          Record<string, { value: unknown }> | undefined;
        if (su)
          for (const x of Object.values(su)) if (x.value instanceof Texture) seen.add(x.value);
      }
    });
    if (this.scene.environment) seen.add(this.scene.environment);
    let bytes = 0;
    for (const t of seen) {
      const img = t.image as { width?: number; height?: number; depth?: number } | null;
      const w = img?.width ?? 0;
      const h = img?.height ?? 0;
      const layers = t instanceof DataArrayTexture ? (img?.depth ?? 1) : 1;
      const bpp = t.type === HalfFloatType ? 8 : t.type === FloatType ? 16 : 4;
      bytes += w * h * layers * bpp * (t.generateMipmaps ? 4 / 3 : 1);
    }
    // Render targets: HDR colour + depth (MSAA multiplies), shadow maps.
    const px = this.renderer.getDrawingBufferSize(new Vector2());
    const samples = Math.max(1, this.quality.msaa);
    if (this.quality.post) bytes += px.x * px.y * (8 + 4) * samples + px.x * px.y * 8;
    const sm = this.quality.shadow;
    bytes += sm.cascades * sm.mapSize * sm.mapSize * 4;
    return bytes;
  }

  stats(): ViewStats {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      textureMiB: +(this.textureBytes() / 1048576).toFixed(1),
      pixelRatio: this.renderer.getPixelRatio(),
      renderScale: this.dynamic.scale,
      gpuMs: this.gpu.latest === null ? null : +this.gpu.latest.toFixed(2),
      width: this.width,
      height: this.height,
      cars: 1 + this.fleet.size,
    };
  }

  dispose(): void {
    this.observer.disconnect();
    this.gpu.dispose();
    this.pipeline.dispose();
    this.trackView.dispose();
    this.car.dispose();
    this.ghostCar.dispose();
    this.fleet.dispose();
    this.contact?.dispose();
    this.props.dispose();
    this.environment.dispose();
    for (const s of Object.values(this.assets.sets)) disposeSet(s);
    this.assets.car.dispose();
    this.scene.environment = null;
    this.scene.clear();
    this.renderer.renderLists.dispose();
  }
}

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
  type ToneMapping,
} from 'three';
import type { CarPose } from '@undercut/sim';
import type { Track } from '@undercut/track';
import { AssetLoader, type AssetIndex, type Progress } from './assets/loader';
import { CameraRig, type CameraName } from './cameras';
import { CarAssets, type CarLivery } from './car/car-assets';
import { CarModel, type CarExtras, type CarGeometry } from './car/car-model';
import { ContactShadows, contactShadowOpacity } from './car/contact-shadows';
import { CarFleet } from './car/fleet';
import { MEDIUM_COMPOUND, type CompoundLook } from './car/livery';
import { Environment } from './environment';
import { unregisteredLitMaterials } from './lighting/registration';
import type { LocalLight } from './lighting/light-pool';
import { nextLift } from './framing';
import { MONZA_AFTERNOON, type SkyMeta, type TimeOfDay } from './lighting/time-of-day';
import { disposeSet, pbrSet, type PbrSet } from './materials/surface';
import { DynamicResolution } from './pipeline/dynamic-resolution';
import { FramePacer, webglFences } from './pipeline/frame-pacer';
import { GpuTimer } from './pipeline/gpu-timer';
import { RenderPipeline, type GradeFrame, type ToneMap } from './pipeline/post';
import { PropRegistry } from './props/registry';
import {
  QUALITY,
  effectiveQuality,
  type Quality,
  type QualityName,
  type RenderCapabilities,
} from './quality';
import {
  DrivingLineRibbon,
  type DrivingLineMode,
  type DrivingLineSource,
  type DrivingLineState,
} from './driving-line';
import { estimateRacingLine } from './racing-line';
import { GRASS_COLOUR, TRACK_TEXTURE_IDS, TrackView, type TrackTextureId } from './track-view';
import { isDressingFile, type DressingFile } from './world/dressing';
import { PropKitAssets, isPropCatalog, worldCatalogPropIds } from './props/catalog';
import type { BrandSpec } from './world/brands';
import type { GarageTeam } from './world/pit-building';
import { CircuitWorld } from './world/world';

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

const GHOST_EXTRAS: CarExtras = Object.freeze({ drs: 0, glow: [0, 0, 0, 0], rain: 0, headYaw: 0 });

/** Exposure multiplier for the cockpit camera (+0.4 EV). */
const COCKPIT_EXPOSURE = 2 ** 0.4;

/** Ground height under a car: mean of a front and a rear wheel centre less the tyre radius. */
function groundUnder(p: CarPose): number {
  return ((p.wheelY[0] as number) + (p.wheelY[3] as number)) / 2 - 0.355;
}

/** What the page's renderer can do (see `effectiveQuality`). */
export function renderCapabilities(renderer: WebGLRenderer): RenderCapabilities {
  const ext = renderer.extensions;
  return {
    floatTargets: ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'),
  };
}

export interface RaceViewOptions {
  /** The page's renderer from `createRenderer`; the view uses it and never disposes it. */
  renderer: WebGLRenderer;
  track: Track;
  quality: QualityName;
  livery: CarLivery;
  car: CarGeometry;
  timeOfDay?: TimeOfDay;
  /** Tyre compound on every car (design/compounds.json); Medium when absent. */
  compound?: CompoundLook;
  /**
   * Development check: before rendering, now and then, report any lit material in the scene that
   * is not registered with the cascaded shadows (it would be lit once per cascade).
   */
  checkRegistration?: boolean;
  /** Local lights (floodlights) for a night time of day. */
  localLights?: readonly LocalLight[];
  /** Racing-line lateral offset per lap sample (m), for the rubbered line. */
  racingLine?: ArrayLike<number> | null;
  /** Live cue source for the on-track driving-line assist ribbon. */
  drivingLine?: DrivingLineSource | null;
  /** Initial display mode of the driving-line assist ('off' when absent). */
  drivingLineMode?: DrivingLineMode;
  /** Liveries the other cars may wear (mask patterns are loaded for these). */
  fleetLiveries?: readonly CarLivery[];
  /** URL of the assets folder (ending in /) and of the Draco decoder folder. */
  assetsBase: string;
  dracoPath: string;
  toneMap?: ToneMap;
  onProgress?: (p: Progress) => void;
  /**
   * URL of the circuit's dressing file (packages/render/data/<id>.dressing.json): the terrain,
   * woods, buildings and stands around it. Without it the circuit sits on the track package's
   * own ground grid.
   */
  dressingUrl?: string | null;
  /** Team names/codes/colours for garage boards, pit-wall canopies and pit crew. */
  garageTeams?: readonly GarageTeam[];
  /** Invented brands for trackside hoardings and bridge banners. */
  brands?: readonly BrandSpec[];
  /**
   * The prop catalogue (packages/render/data/props.catalog.json) when the build has one: its
   * models replace the world's procedural stand-ins kind by kind. Absent or invalid: stand-ins.
   */
  propCatalog?: unknown;
  /**
   * 'lite' gives any preset the Lite preset's world, which loads no dressing (the track
   * package's own ground): for software-WebGL tests of other things than the world.
   */
  worldDetail?: 'preset' | 'lite';
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
  /** The steering-wheel display's speed unit; default km/h. */
  speedUnit?: 'kmh' | 'mph';
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
  /** 'hdr': half-float target and post-processing; 'direct': straight to the canvas. */
  renderPath: 'hdr' | 'direct';
  environmentBakes: number;
  /** Frames this view has drawn (an animation frame skips its draw while the GPU is behind). */
  drawnFrames: number;
  /** Frames that skipped their draw because the GPU was still two frames behind. */
  skippedDraws: number;
  /** Frames drawn anyway after a second waiting on the GPU (FramePacer). */
  forcedDraws: number;
  /** Frame pacing switched off for the session: GPU fences stopped completing. */
  pacingDisabled: boolean;
}

/** Everything a session fetches before it can draw, for one preset. */
export interface SessionAssets {
  index: AssetIndex;
  sky: { meta: SkyMeta; image: ImageBitmap };
  sets: Record<TrackTextureId, PbrSet>;
  car: CarAssets;
  dressing: DressingFile | null;
  propKit: PropKitAssets | null;
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
  /** The place around the circuit, when the session has a dressing file. */
  world: CircuitWorld | null = null;
  private readonly drivingLine: DrivingLineRibbon;
  private readonly car: CarModel;
  private readonly ghostCar: CarModel;
  private readonly fleet: CarFleet;
  /** Team and number of each remote car in the fleet, in fleet order. */
  private remoteKeys: string[] = [];
  private readonly contact: ContactShadows | null;
  private readonly pipeline: RenderPipeline;
  private readonly toneMap: ToneMap;
  private readonly assets: SessionAssets;
  private readonly dynamic: DynamicResolution;
  private readonly gpu: GpuTimer;
  /** At most two frames queued on the GPU (see FramePacer). */
  private readonly pacer: FramePacer<WebGLSync>;
  /** Frame time since the last drawn frame, ms: dynamic resolution's sample when draws skip. */
  private sinceDrawMs = 0;
  private drawnFrames = 0;
  /** Real time between the last two drawn frames, ms (a skipped draw makes it longer). */
  private drawIntervalMs = 0;
  private contextLost = false;
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
  private readonly checkRegistration: boolean;
  private framesToCheck = 0;
  private readonly reported = new WeakSet<Material>();
  /** Per-frame inputs reused every frame (no garbage in the render loop). */
  private readonly extras: CarExtras & { glow: Float64Array } = {
    drs: 0,
    glow: new Float64Array(4),
    rain: 0,
    headYaw: 0,
  };
  private readonly grade: GradeFrame = { exposure: 1, speedBlur: 0, time: 0 };
  private headYaw = 0;
  private lastYaw = 0;
  /** Milliseconds spent building each part of the view (start-up budget checks). */
  readonly loadTimes: Record<string, number>;

  /** Fetch what the session needs (progress by bytes), then build the view cooperatively. */
  static async load(canvas: HTMLCanvasElement, options: RaceViewOptions): Promise<RaceView> {
    const t0 = performance.now();
    const assets = await RaceView.fetchAssets(options);
    const t1 = performance.now();
    const view = new RaceView(canvas, options, assets, true);
    try {
      await view.finishWorldAsync(options, assets);
    } catch (error) {
      // A failed world build must not leave the half-built view's GPU objects behind.
      view.dispose();
      throw error;
    }
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
    const teams = [
      ...new Set([options.livery.team, ...(options.fleetLiveries ?? []).map((l) => l.team)]),
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
    const carP = CarAssets.load(loader, q, teams, options.dracoPath);
    // Lite (and `worldDetail: 'lite'`) loads no dressing: the track package's own ground.
    const worldQ = options.worldDetail === 'lite' ? QUALITY.lite.world : q.world;
    const dressingUrl = worldQ.enabled ? options.dressingUrl : null;
    const dressingP = dressingUrl
      ? loader.json<unknown>(dressingUrl).then((d) => {
          if (!isDressingFile(d)) throw new Error('not a dressing file');
          return d;
        })
      : Promise.resolve(null);
    // The prop kit is only placed with the structures.
    const kitP =
      dressingUrl && worldQ.structures && isPropCatalog(options.propCatalog)
        ? PropKitAssets.load(
            loader,
            options.propCatalog,
            q,
            options.dracoPath,
            worldCatalogPropIds(options.track.id, { world: worldQ }),
          )
        : Promise.resolve(null);
    // Settle all of them before deciding: a car that finishes after another file failed is
    // released here, never left behind.
    const [skyR, setR, carR, dressingR, kitR] = await Promise.allSettled([
      skyP,
      setP,
      carP,
      dressingP,
      kitP,
    ]);
    const failure = [skyR, setR, carR, dressingR, kitR].find((r) => r.status === 'rejected');
    if (failure) {
      if (carR.status === 'fulfilled') carR.value.dispose();
      if (kitR.status === 'fulfilled') kitR.value?.dispose();
      throw (failure as PromiseRejectedResult).reason;
    }
    const skyImage = (skyR as PromiseFulfilledResult<ImageBitmap>).value;
    const setImages = (setR as PromiseFulfilledResult<Awaited<typeof setP>>).value;
    const car = (carR as PromiseFulfilledResult<CarAssets>).value;
    const sets = {} as Record<TrackTextureId, PbrSet>;
    for (const [id, img] of setImages) sets[id] = pbrSet(img, img.sizeM, q.anisotropy);
    const dressing = (dressingR as PromiseFulfilledResult<DressingFile | null>).value;
    const propKit = (kitR as PromiseFulfilledResult<PropKitAssets | null>).value;
    return { index, sky: { meta: skyMeta, image: skyImage }, sets, car, dressing, propKit };
  }

  constructor(
    canvas: HTMLCanvasElement,
    options: RaceViewOptions,
    assets: SessionAssets,
    deferWorld = false,
  ) {
    this.canvas = canvas;
    // The preset as this GPU can run it (no renderable half float: the direct path).
    const preset = effectiveQuality(QUALITY[options.quality], renderCapabilities(options.renderer));
    this.quality =
      options.worldDetail === 'lite'
        ? Object.freeze({ ...preset, world: QUALITY.lite.world })
        : preset;
    this.track = options.track;
    this.assets = assets;
    this.fleetLiveries = options.fleetLiveries ?? [];
    const q = this.quality;
    this.renderer = options.renderer;
    const tod = options.timeOfDay ?? MONZA_AFTERNOON;
    this.renderer.toneMapping = q.post ? NoToneMapping : NeutralToneMapping;
    this.renderer.shadowMap.enabled = q.shadow.cascades > 0;
    this.renderer.shadowMap.needsUpdate = true;
    // Above the cap only up to the screen's own pixel ratio: the buffer never exceeds the screen.
    const dpr = window.devicePixelRatio || 1;
    this.dynamic = new DynamicResolution({
      ...q.dynamicResolution,
      max: Math.max(
        1,
        Math.min(q.dynamicResolution.max ?? 1, dpr / Math.min(dpr, q.pixelRatioCap)),
      ),
    });
    this.gpu = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.pacer = new FramePacer(webglFences(this.renderer.getContext() as WebGL2RenderingContext));

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
      terrain: assets.dressing === null,
    });
    this.scene.add(this.trackView.group);
    this.props = new PropRegistry(options.track.length, 200, (root) =>
      this.environment.register(root),
    );
    const tw = performance.now();
    if (!deferWorld && assets.dressing) {
      this.world = new CircuitWorld({
        track: options.track,
        dressing: assets.dressing,
        quality: q,
        drivable: this.trackView.drivable,
        grass: assets.sets.grass,
        grassColour: GRASS_COLOUR,
        props: this.props,
        garageTeams: options.garageTeams,
        brands: options.brands,
        propKit: assets.propKit,
      });
      this.scene.add(this.world.group);
    }
    const lineOffsets =
      options.racingLine && options.racingLine.length === options.track.lap.count
        ? options.racingLine
        : estimateRacingLine(options.track);
    this.drivingLine = new DrivingLineRibbon(options.track, lineOffsets);
    this.drivingLine.setSource(options.drivingLine ?? null);
    this.drivingLine.setMode(options.drivingLineMode ?? 'off');
    this.scene.add(this.drivingLine.mesh);
    const t2 = performance.now();
    const compound = options.compound ?? MEDIUM_COMPOUND;
    this.car = new CarModel(
      assets.car,
      q.playerLod,
      options.livery,
      q,
      options.car,
      'player',
      compound,
    );
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
    this.fleet = new CarFleet(assets.car, q, options.car, compound);
    this.scene.add(this.car.root, this.ghostCar.root, this.fleet.group);
    // A footprint under every car where the shadow map does not cover it: always on Mobile and
    // Lite, and on any preset when no key light casts shadows (night under floodlights).
    const contactOpacity = contactShadowOpacity(q, this.environment.csm !== null);
    this.contact = contactOpacity > 0 ? new ContactShadows(32, contactOpacity) : null;
    if (this.contact) this.scene.add(this.contact.mesh);
    this.checkRegistration = options.checkRegistration ?? false;
    this.pipeline = new RenderPipeline(
      this.renderer,
      q,
      this.scene,
      this.camera,
      (this.toneMap = options.toneMap ?? 'neutral'),
    );
    this.loadTimes = {
      environment: t1 - t0,
      track: tw - t1,
      world: t2 - tw,
      cars: performance.now() - t2,
    };
    if (!deferWorld) {
      this.finalizeWorldScene();
    }

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    canvas.addEventListener('webglcontextlost', this.onContextLost);
  }

  private finalizeWorldScene(): void {
    this.props.build();
    this.scene.add(this.props.group);
    this.environment.register(this.scene);
    // No upfront renderer.compile: three.js deletes a program's shaders on its first use, so
    // programs compiled for objects that are never drawn (levels of detail not reached, a
    // session quit early) would leave their shaders behind (lifecycle test).
  }

  private async finishWorldAsync(options: RaceViewOptions, assets: SessionAssets): Promise<void> {
    if (assets.dressing) {
      const tw = performance.now();
      const world = await CircuitWorld.buildAsync({
        track: options.track,
        dressing: assets.dressing,
        quality: this.quality,
        drivable: this.trackView.drivable,
        grass: assets.sets.grass,
        grassColour: GRASS_COLOUR,
        props: this.props,
        garageTeams: options.garageTeams,
        brands: options.brands,
        propKit: assets.propKit,
      });
      // The view may have been released while the world was building (a lost context).
      if (this.disposed) {
        world.dispose();
        // The caller listens for context loss only after load resolves: fail the load so its
        // retry path builds a fresh view instead of keeping a released one.
        throw new Error('The view was released while its world was building (lost context)');
      }
      this.world = world;
      this.scene.add(world.group);
      this.loadTimes.world = performance.now() - tw;
      if (this.world.buildTimes.maxSlice !== undefined) {
        this.loadTimes.worldMaxSlice = this.world.buildTimes.maxSlice;
      }
    }
    this.finalizeWorldScene();
  }

  /**
   * The GPU dropped the context: stop drawing and release everything now. While the context is
   * lost every GL call is a silent no-op, so releasing here detaches three.js's per-object hooks
   * for the dead context; released later (after a restore) they would delete handles that belong
   * to the dead context. The owner builds a new view when the context is restored, from the
   * page's cached downloads.
   */
  private readonly onContextLost = (): void => {
    this.contextLost = true;
    this.gpu.abandon();
    this.pacer.abandon();
    this.dispose();
  };

  /** True once the WebGL context was lost under this view. */
  get lost(): boolean {
    return this.contextLost;
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

  /** Frames drawn so far (an animation frame may skip its draw). Per frame: no allocation. */
  get drawnCount(): number {
    return this.drawnFrames;
  }

  /** Real time between the last two drawn frames, ms: what the player saw, not rAF. */
  get lastDrawIntervalMs(): number {
    return this.drawIntervalMs;
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
    this.dynamic.rewarm();
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

  /** Set the on-track driving-line assist display mode ('off' | 'braking' | 'full'). */
  setDrivingLine(mode: DrivingLineMode): void {
    this.drivingLine.setMode(mode);
  }

  /** Attach or detach the cue source for the on-track driving line. */
  setDrivingLineSource(source: DrivingLineSource | null): void {
    this.drivingLine.setSource(source);
  }

  /** Latest state of the on-track driving-line ribbon (for diagnostics and tests). */
  get drivingLineState(): Readonly<DrivingLineState> {
    return this.drivingLine.snapshot();
  }

  get dashboard(): { gear: string; speed: string; revs: number; unit: string } | null {
    return this.car.dashboard;
  }

  /**
   * Put static cars on the grid slots (not the one the player's car is nearest), each in one of
   * the given liveries, for the grid station and the full-field performance run. `count` 0
   * clears them.
   */
  setGridCars(count: number, playerPose: CarPose): void {
    this.fleet.clear();
    this.remoteKeys = [];
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

  /**
   * Other players' cars, drawn in the fleet: their poses this frame and opacity (1 opaque, fading
   * to 0). The fleet is rebuilt only when the set of cars or their liveries changes; otherwise
   * this just moves them. Replaces any grid or static cars.
   */
  setRemoteCars(cars: readonly { livery: CarLivery; pose: CarPose; opacity: number }[]): void {
    const keys = cars.map((c) => `${c.livery.team}:${c.livery.number}`);
    if (keys.length !== this.remoteKeys.length || keys.some((k, i) => k !== this.remoteKeys[i])) {
      this.fleet.clear();
      for (const c of cars) this.fleet.add(c.livery, c.pose);
      this.remoteKeys = keys;
      if (cars.length > 0) this.environment.register(this.fleet.group);
    }
    cars.forEach((c, i) => {
      this.fleet.setPose(i, c.pose);
      this.fleet.setOpacity(i, c.opacity);
    });
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
    this.sinceDrawMs += frame.frameMs ?? 0;
    // Draw only while the GPU is at most a frame behind (FramePacer); the CPU side below runs
    // every frame either way, so cameras, poses and screen-space queries stay current.
    const draw = !this.contextLost && this.pacer.ready(frame.frameMs ?? 0);
    if (draw) {
      // GPU time where the browser measures it (CPU-side stalls are not GPU load), else the time
      // since the last drawn frame (the frame time, unless the GPU made this frame wait).
      const sample = this.gpu.available
        ? this.gpu.latest
        : frame.frameMs === undefined
          ? null
          : this.sinceDrawMs;
      this.drawIntervalMs = this.sinceDrawMs;
      this.sinceDrawMs = 0;
      if (sample !== null && this.dynamic.update(sample, this.gpu.available)) this.resize(true);
    }
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
    const ex = this.extras;
    for (let i = 0; i < 4; i++) ex.glow[i] = Math.max(0, ((this.heat[i] as number) - 0.2) / 0.8);
    ex.drs = frame.drs;
    ex.headYaw = this.headYaw;
    this.car.apply(frame.pose, ex);
    if (frame.ghost) {
      this.ghostCar.apply(frame.ghost, GHOST_EXTRAS);
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
    if (mode.name === 'cockpit') {
      const mph = frame.speedUnit === 'mph';
      this.car.setDashboard(
        frame.gear,
        frame.speed * (mph ? 3600 / 1609.344 : 3.6),
        frame.revLights,
        mph ? 'MPH' : 'KM/H',
      );
    }
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
    this.fleet.update(this.camera.position, this.camera.fov, this.height, dt);
    this.props.update(this.camera.position);
    this.world?.update(frame.time, this.camera.position);
    if (this.contact) {
      const c = this.contact;
      c.begin();
      c.add(frame.pose.x, groundUnder(frame.pose), frame.pose.z, frame.pose.yaw);
      for (let i = 0; i < this.fleet.size; i++) {
        const p = this.fleet.poseAt(i);
        if (p && this.fleet.opacityAt(i) >= 0.5) c.add(p.x, groundUnder(p), p.z, p.yaw);
      }
      c.end();
    }
    const exposure = this.environment.exposure * (mode.name === 'cockpit' ? COCKPIT_EXPOSURE : 1);
    this.drivingLine.update(frame.pose.x, frame.pose.z, frame.speed, exposure);
    const speedBlur = Math.min(1, Math.max(0, (frame.speed - 45) / 45));
    // Without a context, or with the GPU behind, only the CPU side runs (cameras, poses), so
    // screen-space queries such as carScreenRect stay right; nothing touches GL.
    if (!draw) return;
    if (this.checkRegistration && --this.framesToCheck <= 0) {
      this.framesToCheck = 120;
      for (const m of unregisteredLitMaterials(this.scene, (x) =>
        this.environment.isRegistered(x),
      )) {
        if (this.reported.has(m)) continue;
        this.reported.add(m);
        console.error(
          `Material "${m.name || m.type}" is lit but not registered with the cascaded shadows: add it through Environment.register (or the prop registry).`,
        );
      }
    }
    // Count every pass of the frame (shadow cascades, AO, post), not only the last draw.
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.gpu.begin();
    const g = this.grade;
    // An onboard camera exposes for what fills its frame: +0.4 EV in the cockpit.
    g.exposure = exposure;
    g.speedBlur =
      mode.name === 'chase-near' ||
      mode.name === 'chase-far' ||
      mode.name === 'tcam' ||
      mode.name === 'cockpit'
        ? speedBlur
        : 0;
    g.time = frame.time;
    if (this.skyProbePath && this.skyProbeScene) {
      const r = this.renderer;
      if (this.skyProbePath === 'direct') {
        r.toneMapping = NeutralToneMapping;
        r.toneMappingExposure = g.exposure;
        r.setRenderTarget(null);
        r.render(this.skyProbeScene, this.camera);
      } else if (this.skyProbePipeline) {
        r.toneMapping = NoToneMapping;
        const size = r.getDrawingBufferSize(new Vector2());
        this.skyProbePipeline.setSize(size.x, size.y);
        this.skyProbePipeline.render(this.skyProbeScene, this.camera, {
          exposure: g.exposure,
          speedBlur: 0,
          time: 0,
        });
      }
      this.gpu.end();
      this.pacer.submitted();
      this.drawnFrames++;
      return;
    }
    this.pipeline.render(this.scene, this.camera, g);
    this.gpu.end();
    this.pacer.submitted();
    this.drawnFrames++;
  }

  private skyProbePath: 'hdr' | 'direct' | null = null;
  private skyProbeScene: Scene | null = null;
  private skyProbePipeline: RenderPipeline | null = null;
  private skyProbeSavedTone: { toneMapping: ToneMapping; exposure: number } | null = null;

  /**
   * Render-path check (tests): draw only the sky dome through one render path until cleared with
   * `null`. 'direct' uses the renderer's tone map and sRGB output straight to the canvas; 'hdr'
   * renders into a half-float target and through the final pass (no AO, bloom, grain or vignette).
   * Reading the composited canvas avoids synchronous gl.readPixels stalls.
   */
  setSkyProbe(path: 'hdr' | 'direct' | null): void {
    const r = this.renderer;
    this.skyProbePipeline?.dispose();
    this.skyProbePipeline = null;
    this.skyProbeScene?.clear();
    this.skyProbeScene = null;
    if (path === null) {
      this.skyProbePath = null;
      if (this.skyProbeSavedTone) {
        r.toneMapping = this.skyProbeSavedTone.toneMapping;
        r.toneMappingExposure = this.skyProbeSavedTone.exposure;
        this.skyProbeSavedTone = null;
      }
      return;
    }
    this.skyProbeSavedTone ??= {
      toneMapping: r.toneMapping,
      exposure: r.toneMappingExposure,
    };
    this.skyProbePath = path;
    this.skyProbeScene = this.environment.skyOnlyScene();
    if (path === 'hdr') {
      const q: Quality = {
        ...QUALITY.mobile,
        post: true,
        msaa: 0,
        smaa: false,
        ao: { ...QUALITY.mobile.ao, enabled: false },
        bloom: { ...QUALITY.mobile.bloom, enabled: false },
        grainVignette: false,
        grain: 0,
        speedBlur: false,
      };
      this.skyProbePipeline = new RenderPipeline(
        r,
        q,
        this.skyProbeScene,
        this.camera,
        this.toneMap,
      );
    }
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
      renderPath: this.quality.post ? 'hdr' : 'direct',
      environmentBakes: this.environment.bakes,
      drawnFrames: this.drawnFrames,
      skippedDraws: this.pacer.skipped,
      forcedDraws: this.pacer.forcedDraws,
      pacingDisabled: this.pacer.disabled,
    };
  }

  private disposed = false;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.observer.disconnect();
    this.setSkyProbe(null);
    this.gpu.dispose();
    this.pacer.dispose();
    this.pipeline.dispose();
    this.trackView.dispose();
    this.drivingLine.dispose();
    this.car.dispose();
    this.ghostCar.dispose();
    this.fleet.dispose();
    this.contact?.dispose();
    this.props.dispose();
    this.world?.dispose();
    this.environment.dispose();
    for (const s of Object.values(this.assets.sets)) disposeSet(s);
    this.assets.car.dispose();
    this.assets.propKit?.dispose();
    this.scene.environment = null;
    this.scene.clear();
    this.renderer.renderLists.dispose();
  }
}

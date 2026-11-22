/**
 * The drive screen: a time-trial session at Monza in the browser. Loaded on demand from the
 * launch screen so the first paint does not wait for three.js and the track. Wires the pure
 * session and loop (game/) to the renderer (@undercut/render), the HUD and menus (ui/), the
 * input layer, storage and the audio seam.
 */
import { Track } from '@undercut/track';
import {
  ErsMode,
  computeMass,
  createCarPose,
  interpolateCarPose,
  type CarPose,
  type CarTelemetry,
  type ControlInput,
} from '@undercut/sim';
import type { InputSystem } from '@undercut/input';
import { mountTouchOverlay, type TouchOverlay } from '@undercut/input/dom';
import {
  AssetError,
  CAMERA_LABELS,
  CAMERA_ORDER,
  MONZA_AFTERNOON,
  PLAYER_QUALITIES,
  TIMES_OF_DAY,
  floodlightsAlong,
  QUALITY,
  RaceView,
  benchmarkPick,
  createRenderer,
  type CameraName,
  type CarLivery,
  type CompoundLook,
  type QualityName,
  type ToneMap,
} from '@undercut/render';
import {
  DRIVING_LINE_SCALE,
  DrivingLine,
  buildPlan,
  decodeEnvelope,
  type EnvelopeArtefact,
} from '@undercut/ai';
import teams from '../../../design/teams.json';
import compounds from '../../../design/compounds.json';
import monza from '@undercut/track/data/monza.json';
// The AI's racing line, for the rubbered line on the asphalt (offsets in 0.1 mm per 2 m sample).
// The AI's racing line and measured vehicle envelope, for the rubbered line and the driving
// line's advised speeds (braking help).
import monzaLine from '../../../packages/ai/data/monza-low.line.json';
import monzaEnvelope from '../../../packages/ai/data/monza-low.envelope.json';
import { defaultCarState } from '@undercut/audio';
import { silentAudio, type CarAudioSink } from './game/audio-seam';
import { ImpactEvents, toAudioCarState } from './game/audio-map';
import type { AudioSettingKey } from './game/audio-settings';
import {
  AutopilotControlSource,
  InputControlSource,
  CLUMSY_PILOT,
  KeyboardAutopilot,
  ScriptedControlSource,
} from './game/autopilot';
import { GameLoop, MAX_TIME_SCALE, type ControlSource } from './game/loop';
import { buildMinimap } from './game/minimap';
import type { RecordStore } from './game/records';
import {
  DriveSession,
  TIME_TRIAL_FUEL,
  type QuickRaceOptions,
  type SessionEvent,
} from './game/session';
import { Hud, type HudMessage, type HudState } from './ui/hud';
import { controlsHint, takeFirstStartHint } from './ui/controls-help';
import { PauseMenu } from './ui/pause';
import { ResultsStrip } from './ui/results';
import { mountLoadingScreen, type LoadingScreen } from './ui/loading';
import { debugEnabled } from './debug';
import { saveQuality } from './game/quality-setting';

/** The team whose colours the player's car wears in M1. */
const TEAM_ID = 'kestrel';
const REV_START = 10500;
const REV_FULL = 12200;
const REV_FLASH = 12350;
const ERS_MODE_LABEL: Record<number, string> = {
  [ErsMode.None]: 'Off',
  [ErsMode.Balanced]: 'Balanced',
  [ErsMode.Overtake]: 'Overtake',
};
const FRAME_LOG = 7200;

/** The page's renderer, created by the first session and reused by every later one. */
let pageRenderer: ReturnType<typeof createRenderer> | null = null;

/** Live GPU resources of the page's renderer, for the lifecycle test (0s before any session). */
export function rendererInfo(): { geometries: number; textures: number; programs: number } {
  const info = pageRenderer?.info;
  return {
    geometries: info?.memory.geometries ?? 0,
    textures: info?.memory.textures ?? 0,
    programs: info?.programs?.length ?? 0,
  };
}

/** What the drive screen needs from the page's audio: lifecycle and the volume sliders. */
export interface DriveAudio {
  /** A session is driving (true) or paused, hidden or gone (false). */
  setActive(active: boolean): void;
  readonly volumes: Readonly<Record<AudioSettingKey, number>>;
  setVolume(key: AudioSettingKey, value: number): void;
}

export interface DriveOptions {
  canvas: HTMLCanvasElement;
  host: HTMLElement;
  input: InputSystem;
  records: RecordStore;
  quality: QualityName;
  touch: boolean;
  seed: number;
  today: string;
  quickRace?: QuickRaceOptions;
  onQuit(): void;
  /** Quick Race: start the same race again from the grid (the page rebuilds the session). */
  onRestartRace?(): void;
  /** The player's car's sound (see game/audio-seam.ts); silent when absent. */
  onCarAudioState?: CarAudioSink;
  /** A short note for the pause menu about sound ('' when sound works). */
  soundNote?: () => string;
  /** Session lifecycle and volumes for the page's audio engine; absent for no audio. */
  audio?: DriveAudio;
  /** No saved or requested preset: benchmark the first seconds and pick one. */
  autoQuality?: boolean;
  /** A mode on top of the drive screen (online racing). */
  extension?: DriveExtension;
}

/**
 * A mode layered on the drive screen without changing it: online racing. It places the car,
 * can hold it (wrapping the control source), hears the session's events, runs once a frame
 * before drawing, and adds its own overlay. With an extension the screen keeps no records and
 * shows no ghost, and the pause menu has no lap restart.
 */
export interface DriveExtension {
  /** Loading screen detail, e.g. "Online race". */
  label: string;
  /** Start standing at lap (s, d) instead of the rolling start. */
  startAt?: { s: number; d: number };
  /** The player's car's look; default the first team's. */
  livery?: CarLivery;
  /** Pause menu quit label. */
  quitLabel?: string;
  wrapControl?(source: ControlSource): ControlSource;
  /** Before fixed ticks: elapsed wall time accepted by this frame. */
  beforeFrame?(elapsed: number): void;
  attach?(ctx: DriveExtensionContext): void;
  /** Scene and first-frame shaders are ready. */
  ready?(): void;
  events?(events: readonly SessionEvent[]): void;
  /** Each frame after the sim stepped and before drawing; returns other cars for the map. */
  frame?(f: { dt: number; pose: CarPose; paused: boolean }): HudState['others'];
  detach?(): void;
}

export interface DriveExtensionContext {
  session: DriveSession;
  loop: GameLoop;
  /** The current view (it is rebuilt on a quality switch or a context restore). */
  view(): RaceView;
  host: HTMLElement;
  say(message: HudMessage, seconds?: number): void;
}

/** Thrown when the player backs out of a failed load; the launch screen comes back. */
export class LoadCancelled extends Error {
  constructor() {
    super('Loading cancelled');
    this.name = 'LoadCancelled';
  }
}

/** Every driver's car look, from design/teams.json: the player's team first. */
function liveries(first: string): CarLivery[] {
  const out: CarLivery[] = [];
  const ordered = [...teams.teams].sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : 0));
  for (const t of ordered) {
    for (const d of t.drivers) {
      out.push({
        team: t.id,
        primary: t.colours.primary,
        secondary: t.colours.secondary,
        accent: t.colours.accent,
        number: d.number,
        code: d.code,
      });
    }
  }
  return out;
}

/** A compound's look on the tyre, from design/compounds.json (the HUD reads the same file). */
function compoundLook(id: string): CompoundLook {
  const c = compounds.compounds.find((k) => k.id === id) ?? compounds.compounds[0];
  if (!c) throw new Error('design/compounds.json has no compounds');
  return {
    colour: c.colour,
    slots: c.slots,
    groupsPerSidewall: compounds.tyreMarking.groupsPerSidewall,
    slotSpacingU: compounds.tyreMarking.slotSpacingU,
  };
}

/** `?tonemap=agx|aces|neutral` (render comparisons); Khronos PBR Neutral otherwise. */
function toneMapParam(): ToneMap {
  const t = new URLSearchParams(window.location.search).get('tonemap');
  return t === 'aces' || t === 'agx' ? t : 'neutral';
}

function racingLineOffsets(count: number): Float64Array | null {
  const raw = monzaLine as { count: number; offsetTenthMm: number[] };
  if (raw.count !== count) return null;
  return Float64Array.from(raw.offsetTenthMm, (c) => c / 1e4);
}

export interface DriveHandle {
  readonly session: DriveSession;
  readonly loop: GameLoop;
  readonly view: RaceView;
  /** The render preset in use, and a switch to another (rebuilds the view, keeps the session). */
  readonly quality: QualityName;
  /** Views built for this session (the first, quality switches, context restores). */
  readonly viewBuilds: number;
  setQuality(name: QualityName): Promise<void>;
  /** Static cars on the grid slots in every livery (0 clears them). */
  gridCars(count: number): void;
  readonly records: RecordStore;
  /** Frame times in ms, most recent last. */
  frameTimes(): number[];
  resetFrameTimes(): void;
  telemetry(): CarTelemetry;
  setCamera(name: CameraName): void;
  pause(): void;
  resume(): void;
  restartLap(): void;
  resetToTrack(): void;
  teleport(s: number, d: number, speed: number): void;
  /** Hold a scripted ControlInput (null: back to the player's devices). */
  drive(control: Partial<ControlInput> | null): void;
  autopilot(on: boolean): void;
  /** The clumsy keyboard autopilot with mistakes from `seed` (drivability tests). */
  clumsyPilot(seed: number): void;
  events(): SessionEvent[];
  hudText(): Record<string, string>;
  quit(): void;
  /** Start-up phase times, ms. */
  loadTimes(): Record<string, number>;
  /**
   * Back to a known state without reloading, for tests that share one session: running,
   * player's devices, real time, near chase, rolling start, no strip or message showing.
   */
  resetForTest(): void;
}

export async function startDrive(o: DriveOptions): Promise<DriveHandle> {
  const loadStart = performance.now();
  const track = Track.fromJSON(monza);
  const records = o.records;
  const record = await records.load(track.id);
  const line = racingLineOffsets(track.lap.count);
  const drivingLine = line
    ? new DrivingLine(
        buildPlan(track, line, decodeEnvelope(monzaEnvelope as EnvelopeArtefact), {
          scale: DRIVING_LINE_SCALE,
        }),
      )
    : null;
  const session = new DriveSession({
    track,
    seed: o.seed,
    record,
    today: o.today,
    ...(o.quickRace ? { quickRace: o.quickRace } : {}),
    ...(drivingLine ? { guide: drivingLine } : {}),
  });
  const params = session.params;
  const mass = computeMass(session.car.state.model, TIME_TRIAL_FUEL, {
    total: 0,
    sprung: 0,
    a: 0,
    b: 0,
    sprungA: 0,
    sprungB: 0,
    yawInertia: 0,
  });
  const ext = o.extension;
  const all = liveries(TEAM_ID);
  const playerLivery = ext?.livery ?? all[0];
  if (!playerLivery) throw new Error('design/teams.json has no teams');
  pageRenderer ??= createRenderer(o.canvas);
  const renderer = pageRenderer;
  const carGeometry = {
    wheelbase: params.geometry.wheelbase,
    axleFront: mass.a,
    trackFront: params.geometry.trackFront,
    trackRear: params.geometry.trackRear,
    tyreRadius: params.tyre.rollingRadius,
  };
  const loadView = async (quality: QualityName, screen: LoadingScreen): Promise<RaceView> => {
    for (;;) {
      try {
        return await RaceView.load(o.canvas, {
          renderer,
          track,
          quality,
          livery: playerLivery,
          fleetLiveries: all,
          car: carGeometry,
          racingLine: line,
          assetsBase: 'assets/',
          toneMap: toneMapParam(),
          checkRegistration: import.meta.env.DEV || debugEnabled(),
          compound: compoundLook('medium'),
          timeOfDay: tod,
          localLights: tod.localLightSlots > 0 ? floodlightsAlong(track, 36) : [],
          dracoPath: new URL('assets/draco/', document.baseURI).href,
          onProgress: (p) => screen.progress(p.loaded, p.total),
        });
      } catch (error) {
        console.warn('Loading failed', error);
        const what =
          error instanceof AssetError
            ? `Could not download ${error.path}.`
            : 'Could not prepare the track and car.';
        const choice = await screen.fail(`${what} Check the connection and try again.`);
        if (choice === 'back') throw new LoadCancelled();
        screen.reset();
      }
    }
  };
  // `?tod=overcast-day|night-floodlit` (render tests); Monza's afternoon otherwise.
  const tod =
    TIMES_OF_DAY[new URLSearchParams(window.location.search).get('tod') ?? ''] ?? MONZA_AFTERNOON;
  let quality = o.quality;
  const modeLabel = ext?.label ?? (session.quickRace ? 'Quick Race' : 'Time trial');
  const loading = mountLoadingScreen(o.host, track.name, modeLabel);
  let view: RaceView;
  try {
    view = await loadView(quality, loading);
  } finally {
    loading.remove();
  }

  const input = o.input;
  const human = new InputControlSource(input);
  const scripted = new ScriptedControlSource(input);
  const pilot = new AutopilotControlSource(
    input,
    new KeyboardAutopilot(track, params),
    () => session.car.state,
  );
  const wrap = (source: ControlSource): ControlSource => ext?.wrapControl?.(source) ?? source;
  if (ext?.startAt) session.teleport(ext.startAt.s, ext.startAt.d, 0);
  const loop = new GameLoop(session, wrap(human));
  // Barrier impacts for the audio seam, from the hardest strike of each frame.
  const impacts = new ImpactEvents();

  // UI.
  const plan = buildMinimap(track, 208, 150, 8);
  const hud = new Hud(plan, modeLabel);
  const results = new ResultsStrip();
  let quitting = false;
  const restartLap = (): void => {
    onEvents(loop.restartLap());
    pilot.pilot.reset();
    resume();
  };
  // In a Quick Race the restart is the whole race, from the grid; a lap restart would teleport
  // the player out of the race.
  const restartRace = (): void => {
    if (o.onRestartRace) o.onRestartRace();
    else quit();
  };
  const actions = {
    resume: () => resume(),
    ...(ext
      ? {}
      : session.quickRace
        ? { restartLap: restartRace, restartLabel: 'Restart race' }
        : { restartLap }),
    resetToTrack: () => {
      onEvents(loop.resetToTrack());
      resume();
    },
    quit: () => quit(),
    ...(ext?.quitLabel ? { quitLabel: ext.quitLabel } : {}),
  };
  const levels = [
    { value: 0, label: 'Off' },
    { value: 1, label: 'Low' },
    { value: 2, label: 'Med' },
    { value: 3, label: 'High' },
  ];
  const pause = new PauseMenu(
    actions,
    [
      {
        id: 'camera',
        label: 'Camera',
        choices: CAMERA_ORDER.map((c) => ({
          value: c,
          label: CAMERA_LABELS[c].replace(' chase', ''),
        })),
        get: () => view.cameraName,
        set: (v) => view.setCamera(v as CameraName),
      },
      {
        id: 'quality',
        label: 'Graphics',
        choices: PLAYER_QUALITIES.map((q) => ({ value: q, label: QUALITY[q].label })),
        get: () => quality,
        set: (v) => {
          saveQuality(v as QualityName);
          void setQuality(v as QualityName);
        },
      },
      {
        id: 'tc',
        label: 'Traction control',
        description: 'Reduces engine drive when the rear tyres slip.',
        choices: levels,
        get: () => session.assists.tractionControl,
        set: (v) => session.setAssist('tractionControl', Number(v)),
      },
      {
        id: 'abs',
        label: 'ABS',
        description: 'Eases braking to prevent wheel locking.',
        choices: [
          { value: 0, label: 'Off' },
          { value: 2, label: 'On' },
        ],
        get: () => (session.assists.abs > 0 ? 2 : 0),
        set: (v) => session.setAssist('abs', Number(v)),
      },
      {
        id: 'stability',
        label: 'Stability help',
        description: 'Brakes one wheel and trims the engine when the car starts to slide or push.',
        choices: [
          { value: 0, label: 'Off' },
          { value: 1, label: 'On' },
        ],
        get: () => session.assists.stability ?? 0,
        set: (v) => session.setAssist('stability', Number(v)),
      },
      {
        id: 'braking',
        label: 'Braking help',
        description:
          'Brakes for you when you arrive at a corner faster than the driving line. On by default for keys (Low) and touch (Medium).',
        choices: levels,
        get: () => session.assists.braking,
        set: (v) => session.setAssist('braking', Number(v)),
      },
      {
        id: 'gears',
        label: 'Gears',
        description: 'Shifts automatically at the engine speed limits.',
        choices: [
          { value: 'auto', label: 'Auto' },
          { value: 'manual', label: 'Manual' },
        ],
        get: () => (session.assists.autoGears ? 'auto' : 'manual'),
        set: (v) => session.setAssist('autoGears', v === 'auto'),
      },
      {
        id: 'steering',
        label: 'Steering help',
        description: 'Reduces analog steering lock as speed rises. Keys use their own ramps.',
        choices: levels,
        get: () => session.assists.steering,
        set: (v) => session.setAssist('steering', Number(v)),
      },
    ],
    () =>
      `Monza · ${session.device === 'touch' ? 'Touch' : session.device === 'gamepad' ? 'Gamepad' : 'Keyboard'} assists${records.persistent ? '' : ' · Records last until the page closes'}${o.soundNote?.() ? ` · ${o.soundNote()}` : ''}`,
    o.audio
      ? (
          [
            ['master', 'Volume'],
            ['engine', 'Engine'],
            ['effects', 'Effects'],
          ] as const
        ).map(([id, label]) => ({
          id,
          label,
          get: () => o.audio?.volumes[id] ?? 0,
          set: (v: number) => o.audio?.setVolume(id, v),
        }))
      : [],
    { bindings: () => input.profile.bindings, device: () => input.activeDevice },
  );
  o.host.replaceChildren(hud.root, results.root, pause.root);
  // The chase cameras keep the car clear of the driver cluster (it sits bottom centre on a
  // phone). Measured when the layout changes, not every frame.
  const cluster = hud.root.querySelector<HTMLElement>('.hud-drive');
  const measureCluster = (): void => {
    if (!cluster) return;
    const r = cluster.getBoundingClientRect();
    view.setAvoidRect(
      r.width > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null,
    );
  };
  const clusterObserver = new ResizeObserver(measureCluster);
  if (cluster) clusterObserver.observe(cluster);
  window.addEventListener('resize', measureCluster);
  measureCluster();
  document.documentElement.dataset.screen = 'drive';

  let overlay: TouchOverlay | null = null;
  if (o.touch) {
    document.documentElement.dataset.touch = '';
    overlay = mountTouchOverlay(document.body, input);
  }

  // Messages: one at a time, each for a short real-time span.
  let message: HudMessage | null = null;
  let messageLeft = 0;
  const say = (m: HudMessage, seconds = 2): void => {
    message = m;
    messageLeft = seconds;
  };
  // The storage warning goes first; the first-start controls hint follows it.
  let queued: HudMessage | null = takeFirstStartHint()
    ? {
        tag: 'Controls',
        text: controlsHint(input.profile.bindings, input.activeDevice),
        tone: 'info',
      }
    : null;
  if (!records.persistent)
    say({ tag: 'Storage', text: 'Records last until the page closes', tone: 'info' }, 5);

  const log: SessionEvent[] = [];
  let lastLap: { time: number; cls: HudState['lastClass'] } | null = null;
  function onEvents(events: readonly SessionEvent[]): void {
    for (const e of events) {
      log.push(e);
      if (log.length > 200) log.shift();
      switch (e.type) {
        case 'lap':
          results.show(e.result);
          lastLap = { time: e.result.time, cls: e.result.class };
          break;
        case 'record':
          if (ext) break;
          void records.save(e.circuit, e.update).then(() => {
            if (!records.persistent)
              say({ tag: 'Storage', text: 'Record kept until the page closes', tone: 'info' }, 4);
          });
          break;
        case 'notice':
          say({ tag: e.tag, text: e.text, tone: e.tone }, 4);
          break;
        case 'invalidated':
          // The flag shows an invalid lap for as long as it lasts; a message as well showed the
          // same words twice.
          hud.setInvalidReason(e.reason === 'limits' ? 'Track limits' : 'Reset to track');
          break;
        case 'reset':
          view.snapCamera();
          if (e.reason === 'restart') results.hide();
          break;
        default:
          break;
      }
    }
    ext?.events?.(events);
  }

  function openPause(): void {
    o.audio?.setActive(false);
    if (!pause.open) {
      input.setContext('menu');
      pause.show();
      document.documentElement.dataset.paused = '';
    }
  }
  function doPause(): void {
    loop.pause();
    openPause();
  }
  function resume(): void {
    pause.hide();
    delete document.documentElement.dataset.paused;
    input.setContext('driving');
    loop.resume();
    o.audio?.setActive(true);
    last = null;
  }

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') doPause();
  };
  document.addEventListener('visibilitychange', onVisibility);
  // The GPU can drop the context (driver reset, memory pressure): stop the session until it is
  // back; the view restores its own GPU state.
  const onContextLost = (): void => {
    if (session.phase === 'running') doPause();
  };
  // Back: build a fresh view from the cached downloads (the old one released everything when the
  // context went). The session stays paused for the player.
  const onContextRestored = (): void => {
    void rebuildView('Restoring graphics');
  };
  o.canvas.addEventListener('webglcontextlost', onContextLost);
  o.canvas.addEventListener('webglcontextrestored', onContextRestored);

  // Frame loop.
  const pose = createCarPose();
  const ghostPose = createCarPose();
  const fleetPoses = Array.from({ length: session.quickRace ? 19 : 0 }, createCarPose);
  const fleetDrs = new Array<number>(fleetPoses.length).fill(0);
  // The AI cars on the minimap, in their team's colour.
  const fleetDots = fleetPoses.map((_, i) => ({
    x: 0,
    z: 0,
    colour: (all[(i + 1) % all.length] ?? playerLivery).primary,
    opacity: 1,
  }));
  const raceStatus = document.createElement('div');
  raceStatus.className = 'panel';
  raceStatus.dataset.testid = 'race-status';
  raceStatus.style.cssText =
    'padding:8px 16px;white-space:pre-line;text-align:center;max-height:60vh;overflow:auto;pointer-events:auto';
  // After the player's flag: the field is still finishing; skip runs the race to its end at
  // the fastest time scale.
  const skipResults = document.createElement('button');
  skipResults.type = 'button';
  skipResults.className = 'button';
  skipResults.dataset.testid = 'skip-results';
  skipResults.textContent = 'Skip to results';
  skipResults.hidden = true;
  skipResults.style.pointerEvents = 'auto';
  let skippingToResults = false;
  skipResults.addEventListener('click', () => {
    skippingToResults = true;
    loop.timeScale = MAX_TIME_SCALE;
    skipResults.hidden = true;
  });
  if (session.quickRace) {
    const control = hud.root.querySelector('.hud-control') ?? o.host;
    control.append(raceStatus, skipResults);
    hud.root.dataset.mode = 'race';
  }

  const audioState = defaultCarState();
  const sink = o.onCarAudioState ?? silentAudio;
  const frameLog: number[] = [];
  let last: number | null = null;
  let clock = 0;
  let handle = 0;
  let lookBack = false;
  const hudState: HudState = {
    circuit: track.name,
    lengthKm: (track.length / 1000).toFixed(3),
    speed: 0,
    gear: 0,
    rpm: 0,
    revLights: 0,
    lap: 0,
    running: false,
    valid: true,
    lapTime: 0,
    liveDelta: null,
    sectors: [],
    last: null,
    lastClass: null,
    best: null,
    record: null,
    ers: 0,
    ersLap: 1,
    ersMode: 'Balanced',
    drs: 'off',
    carX: 0,
    carZ: 0,
    ghostX: null,
    ghostZ: null,
    message: null,
  };

  const frame = (): void => {
    const now = performance.now();
    if (quitting) return;
    const dt = last === null ? 0 : Math.min(0.25, (now - last) / 1000);
    if (last !== null) {
      frameLog.push(now - last);
      if (frameLog.length > FRAME_LOG) frameLog.shift();
    }
    last = now;

    if (session.phase === 'running') {
      ext?.beforeFrame?.(dt);
      const r = loop.frame(dt);
      impacts.observe(r.wallImpact, dt);
      onEvents(r.events);
      lookBack = r.lookBack;
      for (const action of r.actions) {
        if (action === 'nextCamera') {
          const name = view.nextCamera();
          say({ tag: 'Camera', text: CAMERA_LABELS[name], tone: 'info' }, 1.4);
        }
      }
      if (loop.paused) openPause();
    } else if (session.phase === 'paused') {
      const f = input.sample(dt, 0);
      // A focused button already clicked on the keyboard's Enter or Space; do not press it twice.
      const native = f.device === 'keyboard' && document.activeElement instanceof HTMLButtonElement;
      for (const e of f.events) {
        if (e.type !== 'action') continue;
        if (e.action === 'menuAccept' && native) continue;
        if (pause.navigate(e.action)) continue;
        if (e.action === 'pause' || e.action === 'menuBack') resume();
      }
      lookBack = false;
    }

    const playing = session.phase === 'running';
    const realDt = playing ? dt : 0;
    clock += realDt;
    if (message) {
      messageLeft -= dt;
      if (messageLeft <= 0) message = null;
    }
    if (!message && queued) {
      say(queued, 6);
      queued = null;
    }
    results.tick(dt);

    const car = session.car;
    interpolateCarPose(car.previousPose, car.pose, loop.alpha, pose);
    const t = session.readTelemetry();
    const renderTime = loop.renderTime;
    const ghostOn = !ext && session.ghostPoseAt(renderTime, ghostPose);
    const others = ext?.frame?.({ dt, pose, paused: !playing });
    const revLights =
      t.engineRpm >= REV_FLASH
        ? 16
        : Math.max(
            0,
            Math.min(15, Math.ceil(((t.engineRpm - REV_START) / (REV_FULL - REV_START)) * 15)),
          );
    if (session.quickRace) {
      fleetPoses.forEach((p, i) => {
        const c = session.race.worldCar(i + 1);
        interpolateCarPose(c.previousPose, c.pose, loop.alpha, p);
        fleetDrs[i] = c.state.drsPosition;
        const dot = fleetDots[i]!;
        dot.x = p.x;
        dot.z = p.z;
      });
      view.setRaceCars(fleetPoses, fleetDrs);
      const c = session.race.control;
      const row = c.standings().find((r) => r.car === 0);
      const totalLaps = o.quickRace?.laps ?? 5;
      const lap = Math.max(1, Math.min(session.timer.lap, totalLaps));
      const gapText =
        row && row.position > 1
          ? row.lapsDown > 0
            ? ` · +${row.lapsDown}L`
            : row.gap !== null
              ? ` · +${row.gap.toFixed(1)}s`
              : ''
          : '';
      skipResults.hidden = !session.playerFinished || session.result !== null || skippingToResults;
      if (session.result && skippingToResults) {
        skippingToResults = false;
        loop.timeScale = 1;
      }
      raceStatus.textContent = session.result
        ? 'Race result\n' +
          session.result.entries
            .map((e) => {
              const g =
                e.gap === null
                  ? ''
                  : 'laps' in e.gap
                    ? `  +${e.gap.laps}L`
                    : `  +${e.gap.time.toFixed(3)}s`;
              return `${e.position}  ${e.code}  ${e.status}${g}`;
            })
            .join('\n')
        : session.playerFinished
          ? `Chequered flag · P${row?.position ?? 20} · provisional\n` +
            c
              .standings()
              .map((r) => {
                const code = session.race.entrants[r.car]?.code ?? '';
                const state =
                  r.status === 'running'
                    ? `racing, lap ${Math.min(r.lap, totalLaps)}`
                    : r.status === 'finished'
                      ? 'finished'
                      : r.status;
                return `${r.position}  ${code}  ${state}`;
              })
              .join('\n')
          : c.phase === 'grid'
            ? `Quick Race · 20 cars · ${totalLaps} ${totalLaps === 1 ? 'lap' : 'laps'}`
            : c.phase === 'lights'
              ? Array.from({ length: 5 }, (_, i) => (i < c.lightsCount ? '●' : '○')).join('  ')
              : `P${row?.position ?? 20} / 20${gapText} · Lap ${lap} / ${totalLaps}`;
    }
    view.render({
      pose,
      ghost: ghostOn ? ghostPose : null,
      drs: t.drs,
      speed: t.speed,
      longG: t.longG,
      latG: t.latG,
      brake: t.brake,
      frameMs: dt * 1000,
      dt: realDt,
      time: clock,
      lookBack,
      gear: t.gear,
      revLights,
    });

    // HUD.
    const timer = session.timer;
    const h = hudState;
    h.speed = t.speed;
    h.gear = t.gear;
    h.rpm = t.engineRpm;
    h.revLights = revLights;
    h.lap = timer.lap;
    h.running = timer.running;
    h.valid = timer.valid;
    h.lapTime = session.lapTimeAt(renderTime);
    h.liveDelta = session.liveDelta();
    const done = timer.currentSectors;
    const classes = timer.currentSectorClasses;
    const ref = timer.bestSectors;
    h.sectors = [0, 1, 2].map((i) => {
      if (i < done.length) {
        const time = done[i] as number;
        const r = ref?.[i];
        return { state: classes[i] ?? 'slower', time, delta: r === undefined ? null : time - r };
      }
      if (timer.running && i === timer.sector) return { state: 'run', time: null, delta: null };
      return { state: 'none', time: null, delta: null };
    });
    h.last = lastLap?.time ?? null;
    h.lastClass = lastLap?.cls ?? null;
    h.best = timer.bestLap;
    h.record = timer.record.lap;
    if (session.quickRace) {
      // A race has no out lap, no lap invalidation (track limits are strikes, shown as notices)
      // and no time-trial record.
      h.lap = Math.max(1, Math.min(timer.lap, o.quickRace?.laps ?? 5));
      h.valid = true;
      h.record = null;
      h.liveDelta = null;
    }
    h.ers = Math.max(0, Math.min(1, t.ersStore / params.ers.storeWindow));
    h.ersLap = Math.max(0, Math.min(1, 1 - t.ersDeployLap / params.ers.deployPerLap));
    h.ersMode = ERS_MODE_LABEL[t.ersMode] ?? 'Balanced';
    h.drs = t.drs > 0.5 ? 'open' : session.drsAvailable ? 'available' : 'off';
    h.carX = pose.x;
    h.carZ = pose.z;
    h.ghostX = ghostOn ? ghostPose.x : null;
    h.ghostZ = ghostOn ? ghostPose.z : null;
    h.message = message;
    if (others) h.others = others;
    else if (session.quickRace) h.others = fleetDots;
    hud.update(h);
    overlay?.update();

    // Engine and road sound, through the audio seam.
    toAudioCarState(
      {
        state: car.state,
        telemetry: t,
        surface: session.world.surface,
        impactSpeed: impacts.speed,
        impactSerial: impacts.serial,
        pitLimiter: car.input.pitLimiter,
        kerbRoughness: session.kerbUnderWheels(),
      },
      audioState,
    );
    const camera = view.cameraName;
    sink(
      audioState,
      !playing || document.visibilityState === 'hidden',
      camera === 'cockpit' || camera === 'tcam' ? camera : camera === 'tv' ? 'trackside' : 'chase',
    );

    ext?.ready?.();
    handle = requestAnimationFrame(frame);
  };

  ext?.attach?.({
    session,
    loop,
    view: () => view,
    host: o.host,
    say: (m, seconds) => say(m, seconds),
  });
  input.setContext('driving');
  loop.start();
  o.audio?.setActive(true);
  const loadTimes: Record<string, number> = {
    ...view.loadTimes,
    beforeFirstFrame: performance.now() - loadStart,
  };
  // The first frame compiles every shader; time it too.
  requestAnimationFrame(() => {
    const t = performance.now();
    requestAnimationFrame(() => {
      loadTimes.firstFrames = performance.now() - t;
      loadTimes.total = performance.now() - loadStart;
    });
  });
  handle = requestAnimationFrame(frame);
  document.documentElement.dataset.ready = '';

  /** Views built for this session (1 + quality switches + context restores). */
  let viewBuilds = 1;

  /** A new view at the current preset after a context restore. */
  async function rebuildView(detail: string): Promise<void> {
    if (quitting) return;
    if (switching) await switching;
    const screen = mountLoadingScreen(o.host, track.name, detail);
    try {
      const nv = await loadView(quality, screen);
      const camera = view.cameraName;
      view.dispose();
      view = nv;
      viewBuilds++;
      view.setCamera(camera);
      measureCluster();
    } catch (error) {
      if (!(error instanceof LoadCancelled)) console.warn('Could not restore the 3D view', error);
    } finally {
      screen.remove();
    }
  }

  /** Rebuild the view at another preset; the session waits (paused) while it loads. */
  let switching: Promise<void> | null = null;
  async function setQuality(next: QualityName): Promise<void> {
    if (next === quality || quitting) return;
    if (switching) await switching;
    switching = (async () => {
      const wasRunning = session.phase === 'running';
      if (wasRunning) loop.pause();
      const screen = mountLoadingScreen(o.host, track.name, `Graphics: ${QUALITY[next].label}`);
      try {
        const nv = await loadView(next, screen);
        const camera = view.cameraName;
        view.dispose();
        view = nv;
        viewBuilds++;
        quality = next;
        view.setCamera(camera);
        measureCluster();
      } catch (error) {
        if (!(error instanceof LoadCancelled))
          console.warn('Could not change graphics quality', error);
      } finally {
        screen.remove();
        if (wasRunning && !pause.open) resume();
        pause.sync();
      }
    })();
    await switching;
    switching = null;
  }

  // First run without a saved preset: time a few seconds of driving and settle on a preset.
  if (o.autoQuality) {
    const measured = quality;
    window.setTimeout(() => {
      if (quitting) return;
      const startAt = frameLog.length;
      window.setTimeout(() => {
        if (quitting) return;
        const times = frameLog.slice(startAt).sort((a, b) => a - b);
        if (times.length < 30) return;
        const median = times[Math.floor(times.length / 2)] as number;
        const gpu = view.stats().gpuMs;
        const pick = benchmarkPick(measured, { gpuMs: gpu, frameMs: median }, o.touch);
        saveQuality(pick);
        if (pick !== quality) void setQuality(pick);
      }, 3000);
    }, 2500);
  }

  function quit(): void {
    if (quitting) return;
    quitting = true;
    o.audio?.setActive(false);
    cancelAnimationFrame(handle);
    document.removeEventListener('visibilitychange', onVisibility);
    o.canvas.removeEventListener('webglcontextlost', onContextLost);
    o.canvas.removeEventListener('webglcontextrestored', onContextRestored);
    clusterObserver.disconnect();
    window.removeEventListener('resize', measureCluster);
    loop.quit();
    ext?.detach?.();
    overlay?.destroy();
    view.dispose();
    input.setContext('menu');
    delete document.documentElement.dataset.ready;
    delete document.documentElement.dataset.paused;
    delete document.documentElement.dataset.screen;
    o.host.replaceChildren();
    o.onQuit();
  }

  let source: 'human' | 'script' | 'pilot' | 'clumsy' = 'human';
  let clumsy: AutopilotControlSource | null = null;
  const setSource = (next: typeof source): void => {
    if (source === 'pilot' && next !== 'pilot') pilot.release();
    if (source === 'clumsy' && next !== 'clumsy') clumsy?.release();
    source = next;
    loop.setSource(
      wrap(
        next === 'human'
          ? human
          : next === 'script'
            ? scripted
            : next === 'clumsy' && clumsy
              ? clumsy
              : pilot,
      ),
    );
  };

  return {
    session,
    loop,
    get view() {
      return view;
    },
    get quality() {
      return quality;
    },
    get viewBuilds() {
      return viewBuilds;
    },
    setQuality,
    gridCars: (count) => view.setGridCars(count, pose),
    records,
    frameTimes: () => frameLog.slice(),
    resetFrameTimes: () => {
      frameLog.length = 0;
    },
    telemetry: () => {
      const t = session.readTelemetry();
      return {
        ...t,
        wheelLoad: Float64Array.from(t.wheelLoad),
        slipRatio: Float64Array.from(t.slipRatio),
        slipAngle: Float64Array.from(t.slipAngle),
        wheelAngle: Float64Array.from(t.wheelAngle),
        wheelSpeed: Float64Array.from(t.wheelSpeed),
        suspensionTravel: Float64Array.from(t.suspensionTravel),
      };
    },
    setCamera: (name) => view.setCamera(name),
    pause: doPause,
    resume,
    restartLap: () => {
      if (!ext && !session.quickRace) restartLap();
    },
    resetToTrack: actions.resetToTrack,
    teleport: (s, d, speed) => {
      onEvents(session.teleport(s, d, speed));
      pilot.pilot.reset();
    },
    drive: (control) => {
      if (control === null) setSource('human');
      else {
        scripted.set(control);
        setSource('script');
      }
    },
    autopilot: (on) => {
      if (session.quickRace) session.scriptedRaceDriver = on;
      else setSource(on ? 'pilot' : 'human');
    },
    clumsyPilot: (seed) => {
      if (source === 'clumsy') setSource('human');
      clumsy = new AutopilotControlSource(
        input,
        new KeyboardAutopilot(track, params, { ...CLUMSY_PILOT, clumsy: { seed } }),
        () => session.car.state,
      );
      setSource('clumsy');
    },
    events: () => log.slice(),
    hudText: () => {
      const q = (id: string): string =>
        (hud.root.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').trim();
      return {
        speed: q('speed'),
        gear: q('gear'),
        lapTime: q('lap-time'),
        last: q('last-lap'),
        best: q('best-lap'),
        drs: hud.root.querySelector<HTMLElement>('[data-testid="drs"]')?.dataset.state ?? '',
        message: q('hud-message'),
      };
    },
    quit,
    loadTimes: () => ({ ...loadTimes }),
    resetForTest: () => {
      // Drop any key or touch press that arrived after the previous test's last frame.
      input.setContext('menu');
      input.releaseAll();
      input.sample(0, 0);
      if (session.phase === 'paused') resume();
      setSource('human');
      loop.timeScale = 1;
      view.setSkyProbe(null);
      view.setCamera('chase-near');
      if (!ext && !session.quickRace) restartLap();
      results.hide();
      message = null;
    },
  };
}

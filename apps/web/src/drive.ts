/**
 * The drive screen: a time-trial session at Monza in the browser. Loaded on demand from the
 * launch screen so the first paint does not wait for three.js and the track. Wires the pure
 * session and loop (game/) to the renderer (@undercut/render), the HUD and menus (ui/), the
 * input layer, storage and the audio seam.
 */
import { Track } from '@undercut/track';
import {
  ErsMode,
  SurfaceKind,
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
  type DrivingLineMode,
  type QualityName,
  type ToneMap,
} from '@undercut/render';
import {
  DRIVING_LINE_SCALE,
  LineCue,
  DrivingLine,
  buildPlan,
  decodeEnvelope,
  type EnvelopeArtefact,
} from '@undercut/ai';
import teams from '../../../design/teams.json';
import brandsData from '../../../design/brands.json';
import compounds from '../../../design/compounds.json';
/** Each circuit's dressing (stands, buildings, woods), when it has one; fetched by the view. */
const DRESSINGS = import.meta.glob<string>('../../../packages/render/data/*.dressing.json', {
  query: '?url',
  import: 'default',
  eager: true,
});

/**
 * The prop catalogue, when this build has one (packages/render/data/props.catalog.json, written by
 * the prop kit's build). Globbed so its arrival is a data change: no file, procedural stand-ins.
 */
const propCatalog: unknown = Object.values(
  import.meta.glob('../../../packages/render/data/props.catalog.json', {
    eager: true,
    import: 'default',
  }),
)[0];
// The AI's racing line and measured vehicle envelope are loaded per circuit below, for the
// rubbered line, the driving-line assist, and the driving line's advised speeds (braking help).
import { defaultCarState } from '@undercut/audio';
import { silentAudio, type CarAudioSink } from './game/audio-seam';
import { ImpactEvents, toAudioCarState } from './game/audio-map';
import { AUDIO_DEFAULTS } from './game/audio-settings';
import type { AudioSettingKey } from './game/audio-settings';
import {
  AutopilotControlSource,
  InputControlSource,
  CLUMSY_PILOT,
  KeyboardAutopilot,
  ScriptedControlSource,
} from './game/autopilot';
import { GameLoop, type ControlSource } from './game/loop';
import { buildMinimap } from './game/minimap';
import type { RecordStore } from './game/records';
import { DriveSession, TIME_TRIAL_FUEL, type SessionEvent } from './game/session';
import { Hud, type HudIdentity, type HudMessage, type HudState } from './ui/hud';
import { setGlyphContext } from './ui/kit/glyph';
import { controlsHint, takeFirstStartHint } from './ui/controls-help';
import { PauseMenu, type PauseCommand } from './ui/pause';
import { ResultsStrip } from './ui/results';
import { mountLoadingScreen, type LoadingScreen } from './ui/loading';
import { debugEnabled } from './debug';
import {
  OFFLINE_PRESET,
  autoSwitchAllowed,
  loadAutoPick,
  saveAutoPick,
  saveQuality,
} from './game/quality-setting';
import { assistsFor, type AssistConfig } from './game/assists';
import type { DeviceKind } from '@undercut/input';
import { S } from './ui/strings';
import { physicsDt } from './frame-timing';
import { speedUnit, setSpeedUnit } from './ui/player-settings';
import { Onboarding } from './ui/onboarding';
import { phoneSession } from './ui/phone-session';

/** The team whose colours the player's car wears when the menu chose none. */
const DEFAULT_TEAM = 'calder';
const REV_START = 10500;
const REV_FULL = 12200;
const REV_FLASH = 12350;
const ERS_MODE_LABEL: Record<number, string> = {
  [ErsMode.None]: S.hud.ersModes.off,
  [ErsMode.Balanced]: S.hud.ersModes.balanced,
  [ErsMode.Overtake]: S.hud.ersModes.overtake,
};
const FRAME_LOG = 7200;

/** The page's renderer, created by the first session and reused by every later one. */
let pageRenderer: ReturnType<typeof createRenderer> | null = null;

/** Live GPU resources of the page's renderer, for the lifecycle test (0s before any session). */
export function rendererInfo(): {
  geometries: number;
  textures: number;
  programs: number;
  programRefs: number;
} {
  const info = pageRenderer?.info;
  return {
    geometries: info?.memory.geometries ?? 0,
    textures: info?.memory.textures ?? 0,
    programs: info?.programs?.length ?? 0,
    // Materials holding the programs: a program is freed when its last material is disposed.
    programRefs: (info?.programs ?? []).reduce((n, p) => n + p.usedTimes, 0),
  };
}

/** The page renderer's live programs: shader name, cache key (shortened) and materials using it. */
export function rendererPrograms(): {
  name: string;
  key: string;
  used: number;
  uniforms: string;
}[] {
  const gl = pageRenderer?.getContext();
  return (pageRenderer?.info.programs ?? []).map((p) => {
    // The program's own uniforms (three's built-ins left out) say whose shader it is.
    const names: string[] = [];
    const n = gl ? (gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS) as number) : 0;
    for (let i = 0; i < n; i++) {
      const u = gl?.getActiveUniform(p.program, i);
      if (u && (p.usedTimes > 1 || /^u[A-Z]/.test(u.name)))
        names.push(u.name.replace(/\[0\]$/, ''));
    }
    return {
      name: p.name,
      key:
        p.cacheKey.length > 200
          ? `${p.cacheKey.slice(0, 40)}…${p.cacheKey.slice(-160)}`
          : p.cacheKey,
      used: p.usedTimes,
      uniforms: names.join(' '),
    };
  });
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
  onQuit(): void;
  /** The player's car's sound (see game/audio-seam.ts); silent when absent. */
  onCarAudioState?: CarAudioSink;
  /** A short note for the pause menu about sound ('' when sound works). */
  soundNote?: () => string;
  /** Session lifecycle and volumes for the page's audio engine; absent for no audio. */
  audio?: DriveAudio;
  /** No saved or requested preset: benchmark the first seconds and pick one. */
  autoQuality?: boolean;
  /** Circuit id (packages/track/data); Monza when absent. */
  circuit?: string;
  /** The player's team (design/teams.json id) and driver (0 or 1). */
  team?: string;
  driver?: 0 | 1;
  /** Time-of-day preset id (render TIMES_OF_DAY); `?tod=` in the URL wins. */
  timeOfDay?: string;
  /** The player's assist choices on top of the device preset. */
  assists?: Partial<AssistConfig>;
  /** An assist changed in the pause menu (to remember it for that device). */
  onAssist?: <K extends keyof AssistConfig>(
    device: DeviceKind,
    key: K,
    value: NonNullable<AssistConfig[K]>,
  ) => void;
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

/** Every driver's car look, from design/teams.json: the player's car first. */
function liveries(first: string, driver: 0 | 1): CarLivery[] {
  const out: CarLivery[] = [];
  const ordered = [...teams.teams].sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : 0));
  for (const t of ordered) {
    const drivers = t.id === first && driver === 1 ? [...t.drivers].reverse() : t.drivers;
    for (const d of drivers) {
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

/** `?world=lite`: no dressing on any preset, the track's own ground (software-WebGL tests). */
function worldDetailParam(): 'preset' | 'lite' {
  return new URLSearchParams(window.location.search).get('world') === 'lite' ? 'lite' : 'preset';
}

/** Every circuit's track file, each its own chunk, fetched when a session there starts. */
const TRACK_FILES = import.meta.glob<unknown>('../../../packages/track/data/*.json', {
  import: 'default',
});

async function loadTrack(id: string): Promise<Track> {
  const load =
    TRACK_FILES[`../../../packages/track/data/${id}.json`] ??
    TRACK_FILES['../../../packages/track/data/monza.json'];
  if (!load) throw new Error('no track files in the build');
  return Track.fromJSON(await load());
}

/** The AI's racing lines and measured envelopes per circuit and trim, fetched with a session. */
const AI_LINES = import.meta.glob<unknown>('../../../packages/ai/data/*.line.json', {
  import: 'default',
});
const AI_ENVELOPES = import.meta.glob<unknown>('../../../packages/ai/data/*.envelope.json', {
  import: 'default',
});

/**
 * The circuit's racing line (lateral offset per lap sample, m) for the rubbered line, and the
 * driving line for braking help. The guide's advised speeds come from the envelope of the car
 * the line was built for, so it is used only when that is the player's trim (low downforce).
 */
async function racingLine(
  track: Track,
): Promise<{ offsets: Float64Array; guide: EnvelopeArtefact | null } | null> {
  const prefix = `../../../packages/ai/data/${track.id}-`;
  const key = Object.keys(AI_LINES).find((k) => k.startsWith(prefix));
  const load = key ? AI_LINES[key] : undefined;
  if (!key || !load) return null;
  const raw = (await load()) as { count: number; offsetTenthMm: number[] };
  if (raw.count !== track.lap.count) return null;
  const offsets = Float64Array.from(raw.offsetTenthMm, (c) => c / 1e4);
  const envelope = key.endsWith('-low.line.json')
    ? AI_ENVELOPES[key.replace('.line.json', '.envelope.json')]
    : undefined;
  return { offsets, guide: envelope ? ((await envelope()) as EnvelopeArtefact) : null };
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
  setHudVisible(on: boolean): void;
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
  const track = await loadTrack(o.circuit ?? 'monza');
  const records = o.records;
  const record = await records.load(track.id);
  const ai = await racingLine(track);
  const line = ai?.offsets ?? null;
  const drivingLine =
    ai && ai.guide
      ? new DrivingLine(
          buildPlan(track, ai.offsets, decodeEnvelope(ai.guide), { scale: DRIVING_LINE_SCALE }),
        )
      : null;
  const session = new DriveSession({
    track,
    seed: o.seed,
    record,
    today: o.today,
    device: o.touch ? 'touch' : 'keyboard',
    ...(drivingLine ? { guide: drivingLine } : {}),
  });
  for (const [key, value] of Object.entries(o.assists ?? {}) as [keyof AssistConfig, never][]) {
    session.setAssist(key, value);
  }
  /** Change an assist from the pause menu and remember it for the device in use. */
  const setAssist = <K extends keyof AssistConfig>(
    key: K,
    value: NonNullable<AssistConfig[K]>,
  ): void => {
    session.setAssist(key, value);
    o.onAssist?.(session.device, key, value);
  };
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
  const teamId = teams.teams.some((t) => t.id === o.team) ? (o.team as string) : DEFAULT_TEAM;
  const all = liveries(teamId, o.driver ?? 0);
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
  /** `quiet`: a failure throws instead of asking the player to retry (Auto's own changes). */
  const loadView = async (
    quality: QualityName,
    screen: LoadingScreen,
    quiet = false,
  ): Promise<RaceView> => {
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
          dressingUrl: DRESSINGS[`../../../packages/render/data/${track.id}.dressing.json`] ?? null,
          propCatalog,
          garageTeams: teams.teams.map((t) => ({
            name: t.name,
            code: t.code,
            primary: t.colours.primary,
            secondary: t.colours.secondary,
          })),
          brands: brandsData.brands,
          drivingLine,
          drivingLineMode: session.assists.racingLine ?? 'off',
          assetsBase: 'assets/',
          toneMap: toneMapParam(),
          worldDetail: worldDetailParam(),
          checkRegistration: import.meta.env.DEV || debugEnabled(),
          compound: compoundLook('medium'),
          timeOfDay: tod,
          localLights: tod.localLightSlots > 0 ? floodlightsAlong(track, 36) : [],
          dracoPath: new URL('assets/draco/', document.baseURI).href,
          onProgress: (p) => screen.progress(p.loaded, p.total),
        });
      } catch (error) {
        console.warn('Loading failed', error);
        if (quiet) throw error;
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
  // `?tod=overcast-day|night-floodlit` (render tests), else the menu's choice, else the afternoon.
  const tod =
    TIMES_OF_DAY[new URLSearchParams(window.location.search).get('tod') ?? ''] ??
    TIMES_OF_DAY[o.timeOfDay ?? ''] ??
    MONZA_AFTERNOON;
  let quality = o.quality;
  const loading = mountLoadingScreen(o.host, track.name, ext?.label ?? S.loading.timeTrial);
  let view: RaceView;
  try {
    // Auto's saved pick may be a preset the offline cache does not hold: fall back to that one.
    const fallback = (o.autoQuality ?? false) && quality !== OFFLINE_PRESET;
    try {
      view = await loadView(quality, loading, fallback);
    } catch (error) {
      if (!fallback) throw error;
      quality = OFFLINE_PRESET;
      loading.reset();
      view = await loadView(quality, loading);
    }
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
  const teamInfo = teams.teams.find((t) => t.id === playerLivery.team) ?? teams.teams[0];
  const mediumInfo = compounds.compounds.find((c) => c.id === 'medium') ?? compounds.compounds[0];
  const hudIdentity: HudIdentity | undefined =
    teamInfo && mediumInfo
      ? {
          teamColour: teamInfo.colours.tower,
          driverCode: playerLivery.code,
          driverNumber: playerLivery.number,
          compoundCode: mediumInfo.code,
          compoundColour: mediumInfo.colour,
          compoundSlots: mediumInfo.slots,
        }
      : undefined;
  const hud = new Hud(plan, hudIdentity, ext?.label ?? S.hud.timeTrial);
  const results = new ResultsStrip();
  let quitting = false;
  let hudVisible = true;
  const restartLap = (): void => {
    onEvents(loop.restartLap());
    pilot.pilot.reset();
    resume();
  };
  const intro = new Onboarding({
    bindings: () => input.profile.bindings,
    device: () => input.activeDevice,
  });
  let autoQuality = o.autoQuality ?? false;
  // Rows at the end of the pause settings, so Resume, Restart and Reset stay in view.
  const commands: PauseCommand[] = [
    {
      id: 'skip-intro',
      label: S.intro.row,
      button: S.intro.skip,
      run: () => intro.finish(),
      visible: () => intro.active,
    },
    {
      id: 'replay-intro',
      label: S.intro.row,
      button: S.intro.replay,
      run: () => {
        intro.replay();
        resume();
      },
      visible: () => !intro.active,
    },
    ...(o.touch
      ? [
          {
            id: 'fullscreen',
            label: S.intro.display,
            button: S.intro.fullscreen,
            run: () => {
              void document.documentElement.requestFullscreen?.().catch(() => {});
            },
            // Absent on iPhone Safari; pointless once fullscreen.
            visible: () =>
              Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen) &&
              !document.fullscreenElement,
          },
        ]
      : []),
    {
      id: 'reset-settings',
      label: S.pause.defaults,
      button: S.pause.resetDefaults,
      run: () => {
        for (const [key, value] of Object.entries(assistsFor(session.device, {})) as [
          keyof AssistConfig,
          never,
        ][])
          setAssist(key, value);
        view.setDrivingLine(session.assists.racingLine ?? 'off');
        setSpeedUnit('kmh');
        for (const key of ['master', 'engine', 'effects', 'ui', 'ambience'] as const)
          o.audio?.setVolume(key, AUDIO_DEFAULTS[key]);
        chooseAuto();
      },
    },
  ];
  const actions = {
    resume: () => resume(),
    ...(ext ? {} : { restartLap }),
    resetToTrack: () => {
      onEvents(loop.resetToTrack());
      resume();
    },
    quit: () => quit(),
    ...(ext?.quitLabel ? { quitLabel: ext.quitLabel } : {}),
  };
  // The same labels as the main menu's session settings.
  const levels = [
    { value: 0, label: S.setup.levels.off },
    { value: 1, label: S.setup.levels.low },
    { value: 2, label: S.setup.levels.medium },
    { value: 3, label: S.setup.levels.high },
  ];
  const pause = new PauseMenu(
    actions,
    [
      {
        id: 'units',
        label: S.pause.units,
        choices: [
          { value: 'kmh', label: S.hud.kmh },
          { value: 'mph', label: S.pause.mph },
        ],
        get: speedUnit,
        set: (v) => setSpeedUnit(v as 'kmh' | 'mph'),
      },
      {
        id: 'camera',
        label: S.pause.camera,
        choices: CAMERA_ORDER.map((c) => ({
          value: c,
          label: CAMERA_LABELS[c].replace(' chase', ''),
        })),
        get: () => view.cameraName,
        set: (v) => view.setCamera(v as CameraName),
      },
      {
        id: 'quality',
        label: S.pause.graphics,
        choices: [
          { value: 'auto', label: S.pause.autoGraphics },
          ...PLAYER_QUALITIES.map((q) => ({ value: q, label: QUALITY[q].label })),
        ],
        get: () => (autoQuality ? 'auto' : quality),
        set: (v) => {
          if (v === 'auto') {
            chooseAuto();
            return;
          }
          autoQuality = false;
          saveQuality(v as QualityName);
          void setQuality(v as QualityName);
        },
      },
      {
        id: 'tc',
        label: S.setup.tractionControl,
        description: S.setup.help.tractionControl,
        choices: levels,
        get: () => session.assists.tractionControl,
        set: (v) => setAssist('tractionControl', Number(v)),
      },
      {
        id: 'abs',
        label: S.setup.abs,
        description: S.setup.help.abs,
        choices: [
          { value: 0, label: S.setup.off },
          { value: 2, label: S.setup.on },
        ],
        get: () => (session.assists.abs > 0 ? 2 : 0),
        set: (v) => setAssist('abs', Number(v)),
      },
      {
        id: 'stability',
        label: S.setup.stability,
        description: S.setup.help.stability,
        choices: [
          { value: 0, label: S.setup.off },
          { value: 1, label: S.setup.on },
        ],
        get: () => session.assists.stability ?? 0,
        set: (v) => setAssist('stability', Number(v)),
      },
      {
        id: 'braking',
        label: S.setup.braking,
        description: S.setup.help.braking,
        choices: levels,
        // Braking help follows the driving line, which exists at Monza only for now.
        disabled: () => drivingLine === null,
        hint: S.setup.brakingNoLine,
        get: () => session.assists.braking,
        set: (v) => setAssist('braking', Number(v)),
      },
      {
        id: 'gears',
        label: S.setup.gears,
        description: S.setup.help.gears,
        choices: [
          { value: 'auto', label: S.setup.gearChoices.auto },
          { value: 'manual', label: S.setup.gearChoices.manual },
        ],
        get: () => (session.assists.autoGears ? 'auto' : 'manual'),
        set: (v) => setAssist('autoGears', v === 'auto'),
      },
      {
        id: 'steering',
        label: S.setup.steering,
        description: S.setup.help.steering,
        choices: levels,
        // The keyboard shapes its own steering; as in the main menu, the help is for sticks and touch.
        disabled: () => session.device === 'keyboard',
        hint: S.setup.steeringKeyboard,
        get: () => session.assists.steering,
        set: (v) => setAssist('steering', Number(v)),
      },
      {
        id: 'line',
        label: S.setup.drivingLine,
        description: S.setup.help.drivingLine,
        choices: [
          { value: 'off', label: S.setup.lineChoices.off },
          { value: 'braking', label: S.setup.lineChoices.braking },
          { value: 'full', label: S.setup.lineChoices.full },
        ],
        get: () => session.assists.racingLine ?? 'off',
        set: (v) => setAssist('racingLine', v as DrivingLineMode),
      },
    ],
    () =>
      `${S.pause.assistsNote(track.name, S.menu.deviceNames[session.device])}${records.persistent ? '' : ` · ${S.pause.recordsNote}`}${o.soundNote?.() ? ` · ${o.soundNote()}` : ''}`,
    o.audio
      ? (
          [
            ['master', S.pause.volume],
            ['engine', S.pause.engine],
            ['effects', S.pause.effects],
            ['ui', S.pause.uiAudio],
            ['ambience', S.pause.ambience],
          ] as const
        ).map(([id, label]) => ({
          id,
          label,
          get: () => o.audio?.volumes[id] ?? 0,
          set: (v: number) => o.audio?.setVolume(id, v),
        }))
      : [],
    { bindings: () => input.profile.bindings, device: () => input.activeDevice },
    commands,
  );
  o.host.replaceChildren(hud.root, results.root, pause.root, intro.root);
  const phone = o.touch ? phoneSession(doPause) : null;
  if (phone) o.host.append(phone.root);
  // The chase cameras keep the car clear of the driver cluster (it sits bottom centre on a
  // phone). Measured when the layout changes, not every frame.
  const cluster = hud.root.querySelector<HTMLElement>('.hud-drive');
  const tower = hud.root.querySelector<HTMLElement>('.hud-tower');
  const measureCluster = (): void => {
    // The coach sits under the timing tower, clear of the lap timer and the invalid-lap flag.
    const t = tower?.getBoundingClientRect();
    if (t && t.height > 0)
      intro.root.style.setProperty('--coach-top', `${Math.round(t.bottom + 8)}px`);
    if (!cluster) return;
    const r = cluster.getBoundingClientRect();
    view.setAvoidRect(
      r.width > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null,
    );
  };
  const clusterObserver = new ResizeObserver(measureCluster);
  if (cluster) clusterObserver.observe(cluster);
  if (tower) clusterObserver.observe(tower);
  window.addEventListener('resize', measureCluster);
  measureCluster();
  document.documentElement.dataset.screen = 'drive';
  // The preset running now (Auto shows only "auto" in the menu): support and offline tests.
  document.documentElement.dataset.quality = quality;

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
  let queued: HudMessage | null =
    takeFirstStartHint() && intro.root.hidden
      ? {
          tag: S.controls.hintTag,
          text: controlsHint(input.profile.bindings, input.activeDevice),
          tone: 'info',
        }
      : null;
  if (!records.persistent)
    say({ tag: S.hud.storage, text: S.hud.recordsUntilClose, tone: 'info' }, 5);

  const log: SessionEvent[] = [];
  let lastLap: { time: number; cls: HudState['lastClass'] } | null = null;
  /** Laps completed this session (the coach finishes on the first one after it starts). */
  let lapsDone = 0;
  let invalidReason: string = S.hud.trackLimits;
  function onEvents(events: readonly SessionEvent[]): void {
    for (const e of events) {
      log.push(e);
      if (log.length > 200) log.shift();
      switch (e.type) {
        case 'lap':
          results.show(e.result);
          lastLap = { time: e.result.time, cls: e.result.class };
          lapsDone++;
          invalidReason = S.hud.trackLimits;
          break;
        case 'record':
          if (ext) break;
          void records.save(e.circuit, e.update).then(() => {
            if (!records.persistent)
              say({ tag: S.hud.storage, text: S.hud.recordKept, tone: 'info' }, 4);
          });
          break;
        case 'invalidated':
          invalidReason = e.reason === 'reset' ? S.hud.resetToTrack : S.hud.trackLimits;
          break;
        case 'reset':
          view.snapCamera();
          if (e.reason === 'restart') {
            results.hide();
            invalidReason = S.hud.trackLimits;
          }
          break;
        default:
          break;
      }
    }
    ext?.events?.(events);
  }

  function openPause(): void {
    o.audio?.setActive(false);
    phone?.active(false);
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
    if (o.touch && innerHeight > innerWidth) return;
    phone?.active(true);
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
  const trackTangent = { x: 0, y: 0, z: 0 };
  const audioState = defaultCarState();
  const sink = o.onCarAudioState ?? silentAudio;
  const frameLog: number[] = [];
  /** Intervals between drawn frames (the pacer may skip draws while rAF keeps time), ms. */
  const drawLog: number[] = [];
  let drawnSeen = -1;
  let last: number | null = null;
  let clock = 0;
  let handle = 0;
  let lookBack = false;
  let lastHudDevice: DeviceKind = input.activeDevice;
  setGlyphContext(lastHudDevice, input.profile.bindings);
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
    invalidReason: S.hud.trackLimits,
    lapTime: 0,
    liveDelta: null,
    sectors: [
      { state: 'none', time: null, delta: null },
      { state: 'none', time: null, delta: null },
      { state: 'none', time: null, delta: null },
    ],
    last: null,
    lastClass: null,
    best: null,
    record: null,
    ghost: false,
    ers: 0,
    ersLap: 1,
    ersMode: S.hud.ersModes.balanced,
    drs: 'off',
    carX: 0,
    carZ: 0,
    ghostX: null,
    ghostZ: null,
    wrongWay: false,
    stopped: false,
    message: null,
  };

  const frame = (): void => {
    const now = performance.now();
    if (quitting) return;
    const elapsedMs = last === null ? 0 : now - last;
    const dt = physicsDt(elapsedMs);
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
          say({ tag: S.hud.camera, text: CAMERA_LABELS[name], tone: 'info' }, 1.4);
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

    if (input.activeDevice !== lastHudDevice) {
      lastHudDevice = input.activeDevice;
      setGlyphContext(lastHudDevice, input.profile.bindings);
    }

    if (intro.active) {
      const car = session.car.state;
      intro.update({
        dt,
        running: session.phase === 'running',
        driving:
          car.throttleApplied > 0.1 || car.brakeApplied > 0.1 || Math.abs(car.steerAngle) > 0.02,
        cue: drivingLine?.cueAt(session.s, Math.abs(car.vx)) === LineCue.Brake,
        braking: car.brakeApplied > 0.1,
        invalid: !session.timer.valid,
        paused: session.phase === 'paused',
        laps: lapsDone,
      });
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
    view.setDrivingLine(session.assists.racingLine ?? 'off');
    view.render({
      pose,
      ghost: ghostOn ? ghostPose : null,
      drs: t.drs,
      speed: t.speed,
      longG: t.longG,
      latG: t.latG,
      brake: t.brake,
      // Real time, not the capped physics step: frame pacing and dynamic resolution count it.
      frameMs: elapsedMs,
      dt: realDt,
      time: clock,
      lookBack,
      gear: t.gear,
      revLights,
      speedUnit: speedUnit(),
    });
    const drawnNow = view.drawnCount;
    if (drawnNow !== drawnSeen) {
      // A new view (another preset) starts its count again; its first interval is not a frame.
      if (drawnSeen >= 0 && drawnNow > drawnSeen) {
        drawLog.push(view.lastDrawIntervalMs);
        if (drawLog.length > FRAME_LOG) drawLog.shift();
      }
      drawnSeen = drawnNow;
    }

    // HUD.
    if (hudVisible) {
      const timer = session.timer;
      const h = hudState;
      h.speed = t.speed;
      h.gear = t.gear;
      h.rpm = t.engineRpm;
      h.revLights = revLights;
      h.lap = timer.lap;
      h.running = timer.running;
      h.valid = timer.valid;
      h.invalidReason = invalidReason;
      h.lapTime = session.lapTimeAt(renderTime);
      h.liveDelta = session.liveDelta();
      const done = timer.currentSectors;
      const classes = timer.currentSectorClasses;
      const ref = timer.bestSectors;
      for (let i = 0; i < 3; i++) {
        const slot = h.sectors[i]!;
        if (i < done.length) {
          const time = done[i] as number;
          const r = ref?.[i];
          slot.state = classes[i] ?? 'slower';
          slot.time = time;
          slot.delta = r === undefined ? null : time - r;
        } else if (timer.running && i === timer.sector) {
          slot.state = 'run';
          slot.time = null;
          slot.delta = null;
        } else {
          slot.state = 'none';
          slot.time = null;
          slot.delta = null;
        }
      }
      h.last = lastLap?.time ?? null;
      h.lastClass = lastLap?.cls ?? null;
      h.best = timer.bestLap;
      h.record = timer.record.lap;
      h.ghost = session.ghost !== null;
      h.ers = Math.max(0, Math.min(1, t.ersStore / params.ers.storeWindow));
      h.ersLap = Math.max(0, Math.min(1, 1 - t.ersDeployLap / params.ers.deployPerLap));
      h.ersMode = ERS_MODE_LABEL[t.ersMode] ?? S.hud.ersModes.balanced;
      h.drs = t.drs > 0.5 ? 'open' : session.drsAvailable ? 'available' : 'off';
      h.carX = pose.x;
      h.carZ = pose.z;
      h.ghostX = ghostOn ? ghostPose.x : null;
      h.ghostZ = ghostOn ? ghostPose.z : null;
      if (t.speed > 3) {
        track.tangentAt(session.s, trackTangent);
        const dot = Math.cos(pose.yaw) * trackTangent.x - Math.sin(pose.yaw) * trackTangent.z;
        h.wrongWay = dot < -0.35;
      } else {
        h.wrongWay = false;
      }
      h.stopped =
        playing &&
        session.world.time > 2 &&
        t.speed < 1.5 &&
        session.surfaceUnderCar() !== SurfaceKind.Asphalt;
      h.message = message;
      if (others) h.others = others;
      hud.update(h);
    }
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
  phone?.active(true);
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
  let switching: Promise<boolean> | null = null;
  /** `quiet`: on failure keep the current preset without asking (Auto). Resolves true if `next` is running. */
  async function setQuality(next: QualityName, quiet = false): Promise<boolean> {
    if (quitting) return false;
    if (switching) await switching;
    if (next === quality) return true;
    switching = (async () => {
      const wasRunning = session.phase === 'running';
      if (wasRunning) loop.pause();
      const screen = mountLoadingScreen(o.host, track.name, `Graphics: ${QUALITY[next].label}`);
      try {
        const nv = await loadView(next, screen, quiet);
        const camera = view.cameraName;
        view.dispose();
        view = nv;
        viewBuilds++;
        quality = next;
        document.documentElement.dataset.quality = next;
        view.setCamera(camera);
        measureCluster();
        return true;
      } catch (error) {
        if (!(error instanceof LoadCancelled))
          console.warn('Could not change graphics quality', error);
        return false;
      } finally {
        screen.remove();
        if (wasRunning && !pause.open) resume();
        pause.sync();
      }
    })();
    const done = await switching;
    switching = null;
    return done;
  }

  /** Auto settles on `pick`, saving it only once it runs (offline it stays put; see autoSwitchAllowed). */
  async function applyAutoPick(pick: QualityName): Promise<void> {
    if (!autoQuality || quitting) return;
    if (pick !== quality && !autoSwitchAllowed(pick, quality, navigator.onLine)) return;
    if ((await setQuality(pick, true)) && autoQuality) saveAutoPick(pick);
  }

  /** Auto chosen in the pause menu (or by Reset settings): measure again from the current preset. */
  function chooseAuto(): void {
    autoQuality = true;
    saveQuality('auto');
    saveAutoPick(null);
    benchmark();
  }

  // Auto without a saved pick: time a few seconds of driving and settle on a preset, once.
  function benchmark(): void {
    const measured = quality;
    window.setTimeout(() => {
      if (quitting) return;
      drawLog.length = 0;
      const startAt = 0;
      window.setTimeout(() => {
        if (quitting) return;
        // Drawn frames, not animation frames: with the GPU behind, rAF holds 60 Hz while the
        // pacer skips draws, and only the drawn interval shows how slow the preset is.
        const times = drawLog.slice(startAt).sort((a, b) => a - b);
        if (times.length < 30) return;
        const median = times[Math.floor(times.length / 2)] as number;
        const gpu = view.stats().gpuMs;
        const pick = benchmarkPick(measured, { gpuMs: gpu, frameMs: median }, o.touch);
        void applyAutoPick(pick);
      }, 3000);
    }, 2500);
  }

  if (autoQuality && loadAutoPick() === null) benchmark();

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
    phone?.destroy();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    view.dispose();
    input.setContext('menu');
    delete document.documentElement.dataset.ready;
    delete document.documentElement.dataset.paused;
    delete document.documentElement.dataset.screen;
    delete document.documentElement.dataset.drs;
    delete document.documentElement.dataset.quality;
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
    setQuality: async (name) => {
      await setQuality(name);
    },
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
      if (!ext) restartLap();
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
    autopilot: (on) => setSource(on ? 'pilot' : 'human'),
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
    setHudVisible: (on) => {
      hudVisible = on;
      hud.setVisible(on);
    },
    quit,
    loadTimes: () => ({ ...loadTimes }),
    resetForTest: () => {
      autoQuality = false;
      // Drop any key or touch press that arrived after the previous test's last frame.
      input.setContext('menu');
      input.releaseAll();
      input.sample(0, 0);
      if (session.phase === 'paused') resume();
      hudVisible = true;
      hud.setVisible(true);
      setSource('human');
      loop.timeScale = 1;
      session.resetAssists();
      view.setDrivingLine(session.assists.racingLine ?? 'off');
      view.setSkyProbe(null);
      view.setCamera('chase-near');
      if (!ext) restartLap();
      results.hide();
      message = null;
    },
  };
}

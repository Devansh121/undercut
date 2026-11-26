import type { SessionResult } from '@undercut/race';
/**
 * The drive screen: a time trial or a Quick Race at any circuit in the browser. Loaded on demand from the
 * launch screen so the first paint does not wait for three.js and the track. Wires the pure
 * session and loop (game/) to the renderer (@undercut/render), the HUD and menus (ui/), the
 * input layer, storage and the audio seam.
 */
import { Track } from '@undercut/track';
import {
  COMPOUNDS,
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
  startLightMask,
  type CameraName,
  type CarLivery,
  type CompoundLook,
  type DrivingLineMode,
  type QualityName,
  type ToneMap,
  type RaceViewOptions,
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
import { RaceAudioScene, voicesFor } from './game/audio-scene';
import { silentAudio, type CarAudioSink } from './game/audio-seam';
import { ImpactEvents, toAudioCarState } from './game/audio-map';
import { Haptics, padCanRumble, phoneCanVibrate } from './game/haptics';
import { carStopped } from './game/stopped';
import { AUDIO_DEFAULTS } from './game/audio-settings';
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
import { formatRaceStatus } from './game/format';
import { raceLineFile } from './game/race-line';
import {
  DriveSession,
  TIME_TRIAL_FUEL,
  raceTrim,
  type QuickRaceOptions,
  type RaceArtefacts,
  type SessionEvent,
} from './game/session';
import { NoticeQueue } from './game/notices';
import {
  Hud,
  type HudIdentity,
  type HudMessage,
  type HudRaceState,
  type HudState,
  type HudTyres,
} from './ui/hud';
import { RaceDisplayModel, type RaceEntrantDisplay } from './ui/hud/race-display-model';
import type { TowerRow } from './ui/hud/tower';
import { setGlyphContext } from './ui/kit/glyph';
import { controlsHint, takeFirstStartHint } from './ui/controls-help';
import { PauseMenu, type PauseCommand } from './ui/pause';
import { ResultsStrip } from './ui/results';
import { classificationTable, orderedTeams, sessionName, stopsText } from './ui/classification';
import { el } from './ui/dom';
import { button, setButtonLabel } from './ui/kit/components';
import { mountLoadingScreen, type LoadingScreen } from './ui/loading';
import { debugEnabled } from './debug';
import {
  autoSwitchAllowed,
  launchFallback,
  loadAutoPick,
  saveAutoPick,
  saveQuality,
} from './game/quality-setting';
import { assistsFor, type AssistConfig } from './game/assists';
import type { DeviceKind } from '@undercut/input';
import { S } from './ui/strings';
import { BACKUP_STEP_MS, physicsDt, stepWithoutFrame } from './frame-timing';
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
/** Simulating the rest of a session: sim time per frame, ms, and the 3D view every Nth frame. */
const SIMULATE_BUDGET_MS = 40;
const SIMULATE_DRAW_EVERY = 10;
/** A retired car fades out of the scene and off the map over this long, s. */
const RETIRED_FADE_S = 3;
/** A car that is a ghost for holding up traffic is drawn at this opacity. */
const BLOCKING_GHOST_OPACITY = 0.5;

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
    const program = p.program as WebGLProgram;
    // The program's own uniforms (three's built-ins left out) say whose shader it is.
    const names: string[] = [];
    const n = gl ? (gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number) : 0;
    for (let i = 0; i < n; i++) {
      const u = gl?.getActiveUniform(program, i);
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
  quickRace?: QuickRaceOptions;
  onSessionComplete?: (result: SessionResult) => void;
  onPitLimiter?: (automatic: boolean) => void;
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
  /** The player's haptics setting (menu prefs `settings.haptics`); on when absent. */
  haptics?: { get(): boolean; set(on: boolean): void };
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
  /** Use the circuit's race aero trim and load its racing line / envelope artefacts. */
  raceTrim?: boolean;
  /** Start standing at lap (s, d) instead of the rolling start. */
  startAt?: { s: number; d: number } | ((track: Track) => { s: number; d: number });
  /** The player's car's look; default the first team's. */
  livery?: CarLivery;
  /** Pause menu quit label. */
  quitLabel?: string;
  wrapControl?(source: ControlSource): ControlSource;
  /** Before fixed ticks: elapsed wall time accepted by this frame. */
  beforeFrame?(elapsed: number): void;
  /** After each 240 Hz fixed sim step (for online car-to-car contact and host AI stepping). */
  afterStep?(dt: number): void;
  attach?(ctx: DriveExtensionContext): void;
  /** Scene and first-frame shaders are ready. */
  ready?(): void;
  events?(events: readonly SessionEvent[]): void;
  /** Each frame after the sim stepped and before drawing; returns other cars for the map. */
  frame?(f: { dt: number; pose: CarPose; paused: boolean }): HudState['others'];
  /** Override HUD fields (race lap timer, tower rows) right before the HUD paints. */
  updateHud?(state: HudState, renderTime: number): void;
  detach?(): void;
}

export interface DriveExtensionContext {
  session: DriveSession;
  loop: GameLoop;
  /** The circuit's racing line and measured envelope, when loaded for race trim / AI fill. */
  artefacts: RaceArtefacts | null;
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
 * The circuit's racing line (lateral offset per lap sample, m) for the rubbered line, the
 * driving line for braking help, and for a race the line and envelope the AI field drives on.
 * The guide's advised speeds come from the envelope of the car the line was built for, so it is
 * used only when that is the player's car: a race runs every car in the line's trim, time trial
 * the low-drag car.
 */
async function racingLine(
  track: Track,
  race: boolean,
): Promise<{
  offsets: Float64Array;
  trim: string;
  guide: EnvelopeArtefact | null;
  artefacts: RaceArtefacts | null;
} | null> {
  // The rule the menus use too (game/race-line.ts), so the trim the card names is the one raced.
  const key = raceLineFile(track.id, Object.keys(AI_LINES));
  const load = key ? AI_LINES[key] : undefined;
  if (!key || !load) return null;
  const raw = (await load()) as { count: number; trim: string; offsetTenthMm: number[] };
  if (raw.count !== track.lap.count) return null;
  const offsets = Float64Array.from(raw.offsetTenthMm, (c) => c / 1e4);
  const loadEnvelope = AI_ENVELOPES[key.replace('.line.json', '.envelope.json')];
  const playerTrim = race ? raw.trim : 'low';
  const envelope = loadEnvelope && (race || raw.trim === playerTrim) ? await loadEnvelope() : null;
  return {
    offsets,
    trim: raw.trim,
    guide: envelope && raw.trim === playerTrim ? (envelope as EnvelopeArtefact) : null,
    artefacts: race && envelope ? { line: raw, envelope } : null,
  };
}

export interface DriveHandle {
  readonly closed: boolean;
  readonly session: DriveSession;
  readonly loop: GameLoop;
  readonly view: RaceView;
  /** The time of day the session is lit for (`TIMES_OF_DAY` id). */
  readonly timeOfDay: string;
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
  /**
   * Download (and decode) what a session here would on `quality`, then release it: the first
   * race's requests on a preset without drawing it (the budget's request-log test on High).
   */
  prefetch(quality: QualityName): Promise<void>;
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
  /** Current 3D start-gantry bitmask applied to the scene (bits 0..4 red). */
  readonly startLightsMask: number;
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
  const ext = o.extension;
  const ai = await racingLine(track, o.quickRace !== undefined || ext?.raceTrim === true);
  const line = ai?.offsets ?? null;
  const drivingLine =
    ai && ai.guide
      ? new DrivingLine(
          buildPlan(track, ai.offsets, decodeEnvelope(ai.guide), { scale: DRIVING_LINE_SCALE }),
        )
      : null;
  const teamId = teams.teams.some((t) => t.id === o.team) ? (o.team as string) : DEFAULT_TEAM;
  const all = liveries(teamId, o.driver ?? 0);
  // The driver in each car, by the livery it wears (car i wears `all[i]`, the player's first).
  const drivers = all.slice(0, 20).map((l) => {
    const d = teams.teams.flatMap((t) => t.drivers).find((x) => x.code === l.code);
    return { name: d ? `${d.first} ${d.last}` : l.code, code: l.code };
  });
  const extTrim = !o.quickRace && ext?.raceTrim && ai?.trim ? raceTrim(ai.trim) : undefined;
  const session = new DriveSession({
    track,
    seed: o.seed,
    record,
    today: o.today,
    ...(o.quickRace ? { quickRace: o.quickRace, drivers } : {}),
    ...((o.quickRace || o.extension?.raceTrim) && ai?.artefacts
      ? { raceArtefacts: ai.artefacts }
      : {}),
    ...(extTrim ? { trim: extTrim } : {}),
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
  /** The view's options on a preset: what a session there downloads and builds. */
  const viewOptions = (quality: QualityName): RaceViewOptions => ({
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
  });
  const loadView = async (
    quality: QualityName,
    screen: LoadingScreen,
    quiet = false,
  ): Promise<RaceView> => {
    for (;;) {
      try {
        return await RaceView.load(o.canvas, {
          ...viewOptions(quality),
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
  const modeLabel = ext?.label ?? (session.quickRace ? S.loading.quickRace : S.loading.timeTrial);
  const loading = mountLoadingScreen(o.host, track.name, modeLabel);
  let view: RaceView;
  /** The player's preset when it could not load offline (this session runs on the cached one). */
  let fellBackFrom: QualityName | null = null;
  try {
    // Auto's saved pick, or offline the player's own choice, may be a preset the offline cache
    // does not hold: fall back to the one it does.
    const fallback = launchFallback(quality, o.autoQuality ?? false, navigator.onLine);
    try {
      view = await loadView(quality, loading, fallback !== null);
    } catch (error) {
      if (fallback === null) throw error;
      if (!o.autoQuality) fellBackFrom = quality;
      quality = fallback;
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
  if (ext?.startAt) {
    const at = typeof ext.startAt === 'function' ? ext.startAt(track) : ext.startAt;
    session.teleport(at.s, at.d, 0);
  }
  const loop = new GameLoop(
    session,
    wrap(human),
    ext?.afterStep ? (dt) => ext.afterStep!(dt) : undefined,
  );
  // Barrier impacts for the audio seam, from the hardest strike of each frame.
  const impacts = new ImpactEvents();
  // Kerbs and contacts as gamepad rumble, or phone vibration on touch controls.
  let hapticsOn = o.haptics?.get() ?? true;
  const haptics = new Haptics(
    {
      device: () => input.activeDevice,
      rumble: (strong, weak, duration) => input.rumble(strong, weak, duration),
      stopRumble: () => {
        input.stopRumble();
        if (input.activeDevice === 'touch') navigator.vibrate?.(0);
      },
      vibrate: (ms) => navigator.vibrate?.(ms),
    },
    () => hapticsOn,
  );

  // UI.
  const raceSectorCount = session.quickRace ? session.race.control.flags.sectorCount : 0;
  const plan = buildMinimap(
    track,
    208,
    150,
    8,
    6,
    raceSectorCount,
    session.quickRace ? session.race.circuit.timingLine : track.timingLine,
  );
  const raceTeams = orderedTeams(teamId);
  const forwardFrom = (from: number, to: number): number => {
    const d = (to - from) % track.length;
    return d < 0 ? d + track.length : d;
  };
  const raceDisplay = session.quickRace
    ? new RaceDisplayModel({
        entrants: drivers.map((d, i): RaceEntrantDisplay => {
          const livery = all[i] ?? playerLivery;
          const team =
            raceTeams.find((t) => t.id === livery.team) ??
            raceTeams[Math.floor(i / 2)] ??
            raceTeams[0];
          return {
            id: i === 0 ? 'player' : `ai-${i}`,
            name: d.name,
            code: d.code,
            teamColour: team?.colours.tower ?? '#626c74',
            teamName: team?.name ?? '',
            initialCompound: o.quickRace?.compound ?? 'medium',
          };
        }),
        playerCar: 0,
        sessionKind: session.race.control.strategy.kind,
        totalLaps: session.race.control.strategy.laps,
        marshalSectorCount: session.race.control.flags.sectorCount,
        timingSectorBoundaries: session.race.circuit.sectorLines
          .slice(1)
          .map((s) => forwardFrom(session.race.circuit.timingLine, s)),
        trackLength: session.race.circuit.length,
      })
    : null;
  const TOWER_PERIOD = 0.2;
  let towerClock = TOWER_PERIOD;
  let towerRowsCache: TowerRow[] = [];
  let gantryMask = 0;
  let gantryView: RaceView | null = null;
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
  const hud = new Hud(
    plan,
    hudIdentity,
    ext?.label ??
      (session.quickRace
        ? o.quickRace?.session
          ? sessionName(o.quickRace.session.kind)
          : S.hud.quickRace
        : S.hud.timeTrial),
    raceDisplay
      ? () => {
          raceDisplay.toggleGapMode();
          towerClock = TOWER_PERIOD;
        }
      : undefined,
  );
  const results = new ResultsStrip();
  let quitting = false;
  let hudVisible = true;
  const restartLap = (): void => {
    onEvents(loop.restartLap());
    pilot.pilot.reset();
    resume();
  };
  // In a Quick Race the restart is the whole race, from the grid; a lap restart would teleport
  // the player out of the race.
  const restartRace = (): void => {
    if (session.result && o.onSessionComplete) quit();
    else if (o.onRestartRace) o.onRestartRace();
    else quit();
  };
  const intro = new Onboarding(
    {
      bindings: () => input.profile.bindings,
      device: () => input.activeDevice,
    },
    session.quickRace,
  );
  let autoQuality = o.autoQuality ?? false;
  // Rows at the end of the pause settings, so Resume, Restart and Reset stay in view.
  const commands: PauseCommand[] = [
    {
      id: 'pit-manual',
      label: 'Pit limiter: automatic',
      button: 'Use manual',
      visible: () => session.quickRace && session.automaticLimiter,
      run: () => {
        session.automaticLimiter = false;
        o.onPitLimiter?.(false);
      },
    },
    {
      id: 'pit-auto',
      label: 'Pit limiter: manual',
      button: 'Use automatic',
      visible: () => session.quickRace && !session.automaticLimiter,
      run: () => {
        session.automaticLimiter = true;
        o.onPitLimiter?.(true);
      },
    },
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
        hapticsOn = true;
        o.haptics?.set(true);
        for (const key of ['master', 'engine', 'effects', 'ui', 'ambience'] as const)
          o.audio?.setVolume(key, AUDIO_DEFAULTS[key]);
        chooseAuto();
      },
    },
  ];
  const actions = {
    resume: () => resume(),
    ...(ext
      ? {}
      : session.quickRace
        ? { restartLap: restartRace, restartLabel: S.pause.restartRace }
        : { restartLap }),
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
        id: 'haptics',
        label: S.pause.haptics,
        description: S.pause.hapticsHelp,
        choices: [
          { value: 1, label: S.setup.on },
          { value: 0, label: S.setup.off },
        ],
        get: () => (hapticsOn ? 1 : 0),
        set: (v) => {
          hapticsOn = Number(v) === 1;
          o.haptics?.set(hapticsOn);
        },
        // A phone shows it (greyed where the browser has no vibration, as on an iPhone), and so
        // does a pad that can rumble; a keyboard-only desktop has nothing for it to act on.
        visible: () => o.touch || padCanRumble(),
        disabled: () => !((o.touch && phoneCanVibrate()) || padCanRumble()),
        hint: S.pause.hapticsUnavailable,
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
        // Braking help follows the driving line, which exists where the player's car has one.
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
    {
      bindings: () => input.profile.bindings,
      device: () => input.activeDevice,
      padConnected: () => input.gamepad.connected,
      touchCapable: () => o.touch,
    },
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
    // When a 20-car tower at large text or HUD scale reaches the bottom edge, dock the coach
    // beside the tower instead of pushing it past the viewport.
    const t = tower?.getBoundingClientRect();
    const r = cluster?.getBoundingClientRect();
    if (t && t.height > 0) {
      const cr = intro.root.getBoundingClientRect();
      const ch = cr.height || 140;
      const cw = cr.width || 320;
      const margin = 12;
      const maxTop = Math.max(margin, window.innerHeight - ch - margin);
      if (t.bottom + 8 <= maxTop) {
        intro.root.style.setProperty('--coach-top', `${Math.round(t.bottom + 8)}px`);
        intro.root.style.removeProperty('--coach-left');
      } else {
        const besideLimit =
          r && r.width > 0 && r.top < maxTop + ch && r.left > t.right
            ? Math.min(window.innerWidth - margin, r.left - 12)
            : window.innerWidth - margin;
        intro.root.style.setProperty('--coach-top', `${Math.round(maxTop)}px`);
        if (t.right + 12 + cw <= besideLimit) {
          intro.root.style.setProperty('--coach-left', `${Math.round(t.right + 12)}px`);
        } else {
          intro.root.style.removeProperty('--coach-left');
        }
      }
    }
    if (!cluster || !r) return;
    view.setAvoidRect(
      r.width > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null,
    );
  };
  const clusterObserver = new ResizeObserver(measureCluster);
  if (cluster) clusterObserver.observe(cluster);
  if (tower) clusterObserver.observe(tower);
  clusterObserver.observe(intro.root);
  const rootObserver = new MutationObserver(measureCluster);
  rootObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'data-text'],
  });
  window.addEventListener('resize', measureCluster);
  measureCluster();
  document.documentElement.dataset.screen = 'drive';
  // The preset running now (Auto shows only "auto" in the menu): support and offline tests.
  document.documentElement.dataset.quality = quality;

  let overlay: TouchOverlay | null = null;
  if (o.touch) {
    document.documentElement.dataset.touch = '';
    overlay = mountTouchOverlay(document.body, input, { haptics: () => hapticsOn });
  }
  // iOS Safari zooms on a pinch whatever the viewport says; two thumbs on the controls must not.
  const noPinch = (event: Event): void => event.preventDefault();
  document.addEventListener('gesturestart', noPinch, { passive: false });

  // Messages: one at a time, each for a short real-time span. At the start the storage
  // warning goes first, then the offline-graphics note, then the first-start controls hint.
  const notices = new NoticeQueue<HudMessage>();
  const say = (m: HudMessage, seconds = 2): void => notices.say(m, seconds);
  if (!records.persistent)
    say({ tag: S.hud.storage, text: S.hud.recordsUntilClose, tone: 'info' }, 5);
  if (fellBackFrom)
    notices.queue(
      {
        tag: S.hud.graphics,
        text: S.hud.offlinePreset(QUALITY[fellBackFrom].label, QUALITY[quality].label),
        tone: 'info',
      },
      6,
    );
  if (takeFirstStartHint() && intro.root.hidden)
    notices.queue(
      {
        tag: S.controls.hintTag,
        text: controlsHint(input.profile.bindings, input.activeDevice),
        tone: 'info',
      },
      6,
    );

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
        case 'notice':
          if (!raceDisplay) say({ tag: e.tag, text: e.text, tone: e.tone }, 4);
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
    haptics.stop();
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
  const fleetPoses = Array.from({ length: session.quickRace ? 19 : 0 }, createCarPose);
  const fleetDrs = new Array<number>(fleetPoses.length).fill(0);
  // A retired car is a ghost parked out of the race: it fades out of the scene and off the map.
  const fleetOpacity = new Array<number>(fleetPoses.length).fill(1);
  let playerWasGhost = false;
  // The AI cars on the minimap, in their team's colour.
  const fleetDots = fleetPoses.map((_, i) => ({
    x: 0,
    z: 0,
    colour: (all[(i + 1) % all.length] ?? playerLivery).primary,
    opacity: 1,
  }));
  const raceStatus = document.createElement('div');
  raceStatus.className = 'panel race-status';
  raceStatus.dataset.testid = 'race-status';
  // After the player's flag: the field is still finishing; skip runs the race to its end at
  // the fastest time scale.
  const skipResults = button({ label: S.pause.skipToResults });
  skipResults.classList.add('hud-action');
  skipResults.dataset.testid = 'skip-results';
  skipResults.hidden = true;
  skipResults.style.pointerEvents = 'auto';
  let skippingToResults = false;
  // The race readout is text that changes a few times a second at most: rebuilt at 4 Hz (and at
  // once when the result comes in), not every frame.
  const STATUS_PERIOD = 0.25;
  let statusClock = STATUS_PERIOD;
  let statusHadResult = false;
  let statusPhase = '';
  skipResults.addEventListener('click', () => {
    skippingToResults = true;
    loop.timeScale = MAX_TIME_SCALE;
    skipResults.hidden = true;
  });
  // Practice and qualifying: once the player has a time (any time in practice), the car can go
  // back to its box and the rest of the session runs on as fast as the machine allows.
  const simulateSession = button({ label: 'Simulate to end of session' });
  simulateSession.classList.add('hud-action');
  simulateSession.dataset.testid = 'simulate-session';
  simulateSession.hidden = true;
  simulateSession.style.pointerEvents = 'auto';
  let simulating = false;
  let simulateFrames = 0;
  // While simulating: a progress module in place of the button (the session's clock, then the
  // last laps after the flag).
  const simulateProgress = el('div', 'panel sim-progress');
  simulateProgress.dataset.testid = 'simulate-progress';
  simulateProgress.hidden = true;
  const simulateLabel = el('span', 'label', 'Simulating to the flag');
  const simulateLeft = el('b', 'num sim-progress__left');
  const simulateBar = el('div', 'sim-progress__bar');
  const simulateFill = el('i');
  simulateBar.append(simulateFill);
  simulateBar.setAttribute('role', 'progressbar');
  simulateBar.setAttribute('aria-valuemin', '0');
  simulateBar.setAttribute('aria-valuemax', '100');
  const simulateHead = el('div', 'sim-progress__head');
  simulateHead.append(simulateLabel, simulateLeft);
  simulateProgress.append(simulateHead, simulateBar);
  simulateSession.addEventListener('click', () => {
    const events = session.returnToGarage();
    if (!events) return;
    onEvents(events);
    simulating = true;
    simulateFrames = 0;
    loop.timeScale = MAX_TIME_SCALE;
    simulateSession.hidden = true;
    simulateProgress.hidden = false;
  });
  function showSimulateProgress(): void {
    const c = session.race.control;
    const duration = c.strategy.duration ?? 0;
    const left = Math.max(0, duration - (session.world.time - (c.greenTime ?? 0)));
    // The clock fills the bar to 85 %; after the flag the cars taking it fill the rest (the
    // last laps take a third or more of the wait, and the bar should not stand still).
    const n = c.cars.length;
    let home = 0;
    for (const car of c.cars) if (car.status !== 'running' || car.finishTime !== null) home++;
    const clock = duration > 0 ? Math.min(1, 1 - left / duration) : 1;
    const done = 0.85 * clock + 0.15 * (left > 0 ? 0 : home / Math.max(1, n));
    const pct = Math.round(done * 100);
    simulateFill.style.width = `${pct}%`;
    simulateBar.setAttribute('aria-valuenow', String(pct));
    simulateLeft.textContent =
      left > 0
        ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} left`
        : `Last laps · ${home} / ${n} in`;
  }
  function canSimulateSession(): boolean {
    const kind = session.race.control.strategy.kind;
    if (simulating || session.result || !session.race.control.racing(0)) return false;
    if (kind === 'practice') return true;
    return kind === 'qualifying' && session.timer.bestLap !== null;
  }
  const pitPanel = document.createElement('div');
  pitPanel.className = 'pit-panel panel';
  pitPanel.dataset.testid = 'pit-panel';
  const pitMessage = document.createElement('div');
  pitMessage.setAttribute('role', 'status');
  const boxButton = button({ label: 'Box this lap', glyph: 'boxThisLap' });
  boxButton.dataset.testid = 'box-this-lap';
  boxButton.addEventListener('click', () => callBox());
  const compoundButton = button({ label: 'Next tyres', glyph: 'nextCompound' });
  compoundButton.dataset.testid = 'next-compound';
  compoundButton.addEventListener('click', () => session.cycleCompound());
  const limiterButton = button({ label: 'Pit limiter', glyph: 'pitLimiter' });
  limiterButton.dataset.testid = 'pit-limiter';
  limiterButton.addEventListener('click', () => {
    session.automaticLimiter = !session.automaticLimiter;
    o.onPitLimiter?.(session.automaticLimiter);
  });
  const continueButton = button({ label: 'Continue weekend', variant: 'primary' });
  continueButton.dataset.testid = 'continue-weekend';
  continueButton.hidden = true;
  continueButton.addEventListener('click', () => quit());
  const restartRaceButton = button({ label: S.pause.restartRace, variant: 'primary' });
  restartRaceButton.dataset.testid = 'results-restart';
  restartRaceButton.hidden = true;
  restartRaceButton.addEventListener('click', () => restartRace());
  const resultsMenuButton = button({ label: S.pause.quit });
  resultsMenuButton.dataset.testid = 'results-menu';
  resultsMenuButton.hidden = true;
  resultsMenuButton.addEventListener('click', () => quit());
  const resultsActions = el('div', 'race-results-actions');
  resultsActions.dataset.testid = 'race-results-actions';
  resultsActions.hidden = true;
  resultsActions.style.pointerEvents = 'auto';
  resultsActions.append(continueButton, restartRaceButton, resultsMenuButton);
  const pitHead = el('div', 'pit-panel__head');
  pitHead.append(el('span', 'label', 'Pit wall'), pitMessage);
  const pitActions = el('div', 'pit-panel__actions');
  pitActions.append(boxButton, compoundButton, limiterButton);
  pitPanel.append(pitHead, pitActions);
  /** The flag is out (or the session over) for the player: no pit call to make. */
  function pitCallsClosed(): boolean {
    const phase = session.race.control.phase;
    return (
      session.result !== null ||
      session.playerFinished ||
      phase === 'chequered' ||
      phase === 'finished'
    );
  }
  function callBox(): void {
    if (pitCallsClosed() || session.race.control.held(0)) return;
    const requested = session.boxThisLap();
    const text = requested ? `Box this lap · ${session.nextCompound} tyres` : 'Pit call cancelled';
    if (raceDisplay) raceDisplay.pushMessage('Pit wall', text, 'info', 4);
    else say({ tag: 'Pit crew', text, tone: 'info' }, 4);
  }
  let resultDelivered = false;
  if (session.quickRace) {
    const control = hud.root.querySelector('.hud-control') ?? o.host;
    control.append(raceStatus, resultsActions, skipResults, simulateSession, simulateProgress);
    // Desktop: in the right-hand column under the map, 8 px apart like the other modules.
    (hud.root.querySelector('.hud-right') ?? hud.root).append(pitPanel);
    hud.root.dataset.mode = 'race';
  }

  const trackTangent = { x: 0, y: 0, z: 0 };
  const audioState = defaultCarState();
  const audioScene = new RaceAudioScene(tod.id);
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
  // The player's tyres and fuel for the HUD, refreshed in place each frame (a race only).
  const hudTyres: HudTyres = {
    compound: 'medium',
    temp: new Float64Array(4),
    wear: new Float64Array(4),
    low: 0,
    high: 0,
  };
  const hudRaceState: HudRaceState | null = raceDisplay
    ? {
        lap: 1,
        totalLaps: session.race.control.strategy.laps,
        rows: towerRowsCache,
        ...raceDisplay.snapshot(3),
      }
    : null;
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
    race: hudRaceState,
  };

  /** The race readout as lines, and which line is the player's own (−1: none). */
  /**
   * The readout, one element per line, rebuilt only when it changes. In the standings the
   * player's own row is marked and kept in view (a landscape phone shows eight rows); a fade at
   * the bottom edge says there are more.
   */
  let statusKey = '';
  let statusPlayer = -1;
  let statusResult: SessionResult | null = null;
  function showRaceStatus(): void {
    const hideForLights =
      session.race.control.strategy.kind === 'race' &&
      (session.race.control.phase === 'grid' || session.race.control.phase === 'lights') &&
      !session.playerFinished &&
      session.result === null;
    const hideStatus =
      hideForLights ||
      (session.race.control.strategy.kind === 'race' &&
        !session.playerFinished &&
        session.result === null);
    if (raceStatus.hidden !== hideStatus) raceStatus.hidden = hideStatus;
    if (hideForLights) return;
    if (hideStatus) {
      // Keep the legacy readout current without rebuilding rows or measuring hidden layout.
      const key = raceStatusLines().lines.join('\n');
      if (key !== statusKey) {
        statusKey = key;
        raceStatus.textContent = key;
      }
      return;
    }
    if (session.result) {
      // The classification: a table with a heading, the player's row marked and in view.
      if (statusResult !== session.result) {
        statusResult = session.result;
        statusKey = '';
        const kind = session.result.kind;
        const table = classificationTable(session.result, {
          points: kind === 'race',
          rowClass: 'race-status__row',
          teams: raceTeams,
        });
        raceStatus.replaceChildren(
          el('div', 'race-status__head', `${sessionName(kind)} result`),
          table,
        );
        raceStatus.dataset.table = '';
        const row = table.querySelector<HTMLElement>('.is-player');
        if (row) {
          // (A row's offset is from its table.)
          const bottom = table.offsetTop + row.offsetTop + row.offsetHeight;
          if (bottom > raceStatus.clientHeight)
            raceStatus.scrollTop = bottom - raceStatus.clientHeight + 8;
        }
      }
    } else {
      delete raceStatus.dataset.table;
      showRaceStatusLines();
    }
    if (!raceStatus.hidden) {
      const more = raceStatus.scrollTop + raceStatus.clientHeight < raceStatus.scrollHeight - 2;
      if (raceStatus.hasAttribute('data-more') !== more)
        raceStatus.toggleAttribute('data-more', more);
    }
  }
  function showRaceStatusLines(): void {
    const { lines, player } = raceStatusLines();
    const key = lines.join('\n');
    if (key !== statusKey) {
      statusKey = key;
      raceStatus.replaceChildren(
        ...lines.map((text, i) => {
          const div = document.createElement('div');
          div.className = i === 0 && lines.length > 1 ? 'race-status__head' : 'race-status__row';
          if (i === player) div.classList.add('is-player');
          div.textContent = text;
          return div;
        }),
      );
      // Into view once per standings (when the player's row moves), not against the reader's
      // own scrolling every rebuild.
      if (player > 0 && player !== statusPlayer) {
        const rowEl = raceStatus.children[player] as HTMLElement | undefined;
        if (rowEl) {
          // Just into view, under the heading (which stays put).
          const head = (raceStatus.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
          const bottom = rowEl.offsetTop + rowEl.offsetHeight - raceStatus.clientHeight + 8;
          const top = rowEl.offsetTop - head - 8;
          if (raceStatus.scrollTop < bottom) raceStatus.scrollTop = bottom;
          else if (raceStatus.scrollTop > top) raceStatus.scrollTop = Math.max(0, top);
        }
      }
      statusPlayer = player;
    }
  }

  function raceStatusLines(): { lines: string[]; player: number } {
    const c = session.race.control;
    const standings = c.standings();
    const row = standings.find((r) => r.car === 0);
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
    if (session.playerFinished) {
      return {
        lines: [
          `Chequered flag · P${row?.position ?? 20} · provisional`,
          ...standings.map((r) => {
            const name = session.race.entrants[r.car]?.name ?? '';
            const state =
              r.status === 'running'
                ? `racing, lap ${Math.min(r.lap, totalLaps)}`
                : r.status === 'finished'
                  ? 'finished'
                  : formatRaceStatus(r.status).toLowerCase();
            return `${r.position}  ${name}  ${state}`;
          }),
        ],
        player: 1 + standings.findIndex((r) => r.car === 0),
      };
    }
    if (c.strategy.kind === 'practice' || c.strategy.kind === 'qualifying') {
      const left = Math.max(
        0,
        (c.strategy.duration ?? 0) - (session.world.time - (c.greenTime ?? 0)),
      );
      return {
        lines: [
          `${c.strategy.kind === 'practice' ? 'Practice' : 'Qualifying'} · ${Math.ceil(left / 60)} min remaining · P${row?.position ?? 20} / 20`,
        ],
        player: -1,
      };
    }
    const line =
      c.phase === 'grid'
        ? `Quick Race · 20 cars · ${totalLaps} ${totalLaps === 1 ? 'lap' : 'laps'}`
        : c.phase === 'lights'
          ? Array.from({ length: 5 }, (_, i) => (i < c.lightsCount ? '●' : '○')).join('  ')
          : `P${row?.position ?? 20} / 20${gapText} · Lap ${lap} / ${totalLaps}`;
    return { lines: [line], player: -1 };
  }

  const setElHidden = (node: HTMLElement, hidden: boolean): void => {
    if (node.hidden !== hidden) node.hidden = hidden;
  };
  const setBoolAttr = (node: Element, attr: string, on: boolean): void => {
    if (node.hasAttribute(attr) !== on) node.toggleAttribute(attr, on);
  };

  /** One frame's worth of a running session: input, fixed sim steps, events and actions. */
  const stepRunning = (dt: number): void => {
    ext?.beforeFrame?.(dt);
    const r = loop.frame(dt);
    impacts.observe(r.wallImpact, dt);
    haptics.update({
      dt,
      speed: Math.hypot(session.car.state.vx, session.car.state.vy),
      kerb: session.kerbUnderWheels(),
      wallImpact: r.wallImpact,
      carImpact: r.carImpact,
    });
    onEvents(r.events);
    // Simulating the rest of a timed session: more steps in this frame, within a budget that
    // keeps the page responsive.
    if (simulating && !session.result) {
      // The car is in its box and the view is mostly skipped (below), so most of the frame
      // goes to the simulation; 40 ms keeps the page answering input.
      const until = performance.now() + SIMULATE_BUDGET_MS;
      while (performance.now() < until && session.phase === 'running' && !session.result)
        onEvents(loop.frame(1 / 30).events);
      showSimulateProgress();
    }
    if (raceDisplay) {
      const fresh = session.drainRaceEvents();
      if (fresh.length > 0) {
        raceDisplay.ingest(fresh, session.race.control.standings());
        towerClock = TOWER_PERIOD;
      }
    }
    lookBack = r.lookBack;
    for (const action of r.actions) {
      if (action === 'boxThisLap') callBox();
      if (action === 'nextCompound') session.cycleCompound();
      if (action === 'nextCamera') {
        const name = view.nextCamera();
        say({ tag: S.hud.camera, text: CAMERA_LABELS[name], tone: 'info' }, 1.4);
      }
    }
    if (loop.paused) openPause();
  };

  // Online only: keep the sim, car contact and snapshots going when animation frames are late
  // (frame-timing.ts). The timer runs a frame's CPU work without drawing or touching the HUD.
  let lastFrameAt: number | null = null;
  let lateTimer: ReturnType<typeof setTimeout> | null = null;
  const stepLate = (): void => {
    lateTimer = null;
    if (quitting || !ext) return;
    const now = performance.now();
    if (
      session.phase === 'running' &&
      stepWithoutFrame(now, lastFrameAt, document.visibilityState === 'visible')
    ) {
      const dt = physicsDt(last === null ? 0 : now - last);
      last = now;
      stepRunning(dt);
      if (session.phase === 'running') {
        interpolateCarPose(session.car.previousPose, session.car.pose, loop.alpha, pose);
        ext.frame?.({ dt, pose, paused: false });
      }
    }
    lateTimer = setTimeout(stepLate, BACKUP_STEP_MS);
  };

  const frame = (): void => {
    const now = performance.now();
    if (quitting) return;
    const elapsedMs = last === null ? 0 : now - last;
    const dt = physicsDt(elapsedMs);
    // The frame log is animation-frame intervals, whatever stepped in between.
    if (lastFrameAt !== null) {
      frameLog.push(now - lastFrameAt);
      if (frameLog.length > FRAME_LOG) frameLog.shift();
    }
    lastFrameAt = now;
    last = now;
    if (ext && lateTimer === null) lateTimer = setTimeout(stepLate, BACKUP_STEP_MS);

    if (session.phase === 'running') {
      stepRunning(dt);
    } else if (session.phase === 'paused') {
      const f = input.sample(dt, 0);
      // The controls list follows the device before that device's first press is read.
      pause.controls?.sync();
      // A focused button already clicked on the keyboard's Enter or Space; do not press it twice.
      const native = f.device === 'keyboard' && document.activeElement instanceof HTMLButtonElement;
      for (const e of f.events) {
        if (e.type !== 'action') continue;
        if (e.action === 'menuAccept' && native) continue;
        if (pause.navigate(e.action)) continue;
        if (e.action === 'pause' || e.action === 'menuBack') resume();
      }
      lookBack = false;
    } else if (session.phase === 'ended' && session.result) {
      const frame = input.sample(dt, 0);
      const native =
        frame.device === 'keyboard' && document.activeElement instanceof HTMLButtonElement;
      for (const e of frame.events) {
        if (e.type !== 'action') continue;
        if (e.action === 'menuBack') {
          quit();
          break;
        }
        if (e.action === 'menuAccept' && !native) {
          if (o.onSessionComplete) quit();
          else restartRace();
          break;
        }
      }
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
        // (In a race the lap events are the race's: its timer counts the laps.)
        laps: session.quickRace ? session.race.control.timer(0).lapsCompleted : lapsDone,
      });
    }
    const playing = session.phase === 'running';
    const realDt = playing ? dt : 0;
    clock += realDt;
    notices.tick(dt);
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
        const status = session.race.control.cars[i + 1]!.status;
        const retired = status === 'dnf' || status === 'dsq';
        // A car that is a ghost for holding up traffic is drawn at half strength while it is
        // one, so the cars passing through it read as the rule they are.
        const goal = retired ? 0 : session.race.blockingGhost(i + 1) ? BLOCKING_GHOST_OPACITY : 1;
        const step = dt / RETIRED_FADE_S;
        const now = fleetOpacity[i]!;
        fleetOpacity[i] = now > goal ? Math.max(goal, now - step) : Math.min(goal, now + step);
        const dot = fleetDots[i]!;
        dot.x = p.x;
        dot.z = p.z;
        dot.opacity = fleetOpacity[i]!;
      });
      view.setRaceCars(fleetPoses, fleetDrs, fleetOpacity);
      // The player's own car: safety indicator + message when it becomes a ghost or solid again.
      const playerGhost = session.race.blockingGhost(0);
      if (playerGhost !== playerWasGhost) {
        playerWasGhost = playerGhost;
        if (raceDisplay) {
          raceDisplay.pushMessage(
            S.hud.ghost,
            playerGhost ? S.hud.blockingGhostOn : S.hud.blockingGhostOff,
            playerGhost ? 'warning' : 'info',
            3.5,
          );
        } else {
          say(
            {
              tag: S.hud.ghost,
              text: playerGhost ? S.hud.blockingGhostOn : S.hud.blockingGhostOff,
              tone: 'info',
            },
            3,
          );
        }
      }
      const pitControl = session.race.control;
      const pitPhase = pitControl.pitPhase(0);
      const pitCar = pitControl.cars[0]!;
      // After the flag there is no stop to call: hide the pit panel so results have the floor.
      const flagOut = pitCallsClosed();
      // In the garage (practice and qualifying, or back in the box to simulate) there is no stop
      // to call: the pit-call controls go.
      const inGarage = pitPhase === 'garage';
      setBoolAttr(document.documentElement, 'data-pit-garage', inGarage);
      setElHidden(pitPanel, flagOut);
      setElHidden(boxButton, flagOut || inGarage);
      setElHidden(compoundButton, flagOut || inGarage);
      setElHidden(limiterButton, flagOut || inGarage);
      const compoundRequired = pitControl.strategy.twoCompoundRule && pitCar.compounds.length < 2;
      const pitActive = pitControl.pitRequested(0) || pitPhase !== 'none';
      const pitHeadHidden = flagOut || (!pitActive && !compoundRequired);
      setElHidden(pitHead, pitHeadHidden);
      setBoolAttr(hud.root, 'data-pit-open', !flagOut && !pitHeadHidden);
      setButtonLabel(
        boxButton,
        pitControl.held(0)
          ? 'In the box'
          : pitControl.pitRequested(0)
            ? 'Cancel pit call'
            : 'Box this lap',
      );
      const boxDisabled = pitControl.held(0) || session.result !== null;
      if (boxButton.disabled !== boxDisabled) boxButton.disabled = boxDisabled;
      setButtonLabel(compoundButton, `Next tyres: ${session.nextCompound}`);
      const compoundDisabled = pitControl.held(0);
      if (compoundButton.disabled !== compoundDisabled) compoundButton.disabled = compoundDisabled;
      setButtonLabel(
        limiterButton,
        `Pit limiter: ${session.automaticLimiter ? 'automatic' : 'manual'}`,
      );
      const remaining = pitControl.pitRemaining(0);
      let nextPitText = pitControl.held(0)
        ? `${pitPhase === 'waitRelease' ? 'Waiting for safe release' : pitPhase === 'garage' ? 'Garage release' : 'Pit service'} · ${remaining.toFixed(1)} s`
        : !pitActive && compoundRequired
          ? `Compound change required · next ${session.nextCompound}`
          : `${pitControl.pitRequested(0) ? `Box confirmed · ${session.nextCompound} tyres · drive into pit lane` : pitPhase === 'released' ? 'Released · pit exit clear' : pitPhase === 'lane' ? 'Pit lane · drive through' : `Pit crew ready · next ${session.nextCompound}`} · ${stopsText(pitCar.pitStops)} · ${pitCar.compounds.join(' / ')}`;
      if (compoundRequired && pitActive) nextPitText = `Compound change required · ${nextPitText}`;
      if (pitMessage.textContent !== nextPitText) pitMessage.textContent = nextPitText;
      const hasResult = session.result !== null;
      setElHidden(resultsActions, !hasResult);
      setElHidden(continueButton, !hasResult || !o.onSessionComplete);
      setElHidden(restartRaceButton, !hasResult || Boolean(o.onSessionComplete));
      setElHidden(resultsMenuButton, !hasResult || Boolean(o.onSessionComplete));
      if (session.result && !resultDelivered) {
        resultDelivered = true;
        o.onSessionComplete?.(session.result);
        input.setContext('menu');
        (o.onSessionComplete ? continueButton : restartRaceButton).focus({ preventScroll: true });
      }
      setElHidden(skipResults, !session.playerFinished || hasResult || skippingToResults);
      setElHidden(simulateSession, !canSimulateSession());
      if (session.result && simulating) {
        simulating = false;
        loop.timeScale = 1;
        setElHidden(simulateProgress, true);
      }
      // After the player's flag, or any final result (a retirement too), the standings take the
      // screen; the driving cluster is done.
      const finished = session.playerFinished || hasResult;
      setBoolAttr(hud.root, 'data-finished', finished);
      setBoolAttr(hud.root, 'data-race-result', hasResult);
      setBoolAttr(document.documentElement, 'data-race-finished', finished);
      setBoolAttr(document.documentElement, 'data-race-result', hasResult);
      if (session.result && skippingToResults) {
        skippingToResults = false;
        loop.timeScale = 1;
      }
      if (raceDisplay && hudRaceState) {
        raceDisplay.tick(realDt);
        raceDisplay.setBlockingGhost(playerGhost);
        const snap = raceDisplay.snapshot(3);
        const mask = startLightMask(snap.startLights.lit);
        if (mask !== gantryMask || view !== gantryView) {
          gantryMask = mask;
          gantryView = view;
          view.world?.setStartLights(mask);
        }
        towerClock += dt;
        if (towerClock >= TOWER_PERIOD || towerRowsCache.length === 0) {
          towerClock = 0;
          const standings = pitControl.standings();
          let fastestCar: number | null = null;
          let fastestLap = Infinity;
          for (const row of standings) {
            if (row.bestLap !== null && row.bestLap < fastestLap) {
              fastestLap = row.bestLap;
              fastestCar = row.car;
            }
          }
          towerRowsCache = raceDisplay.buildTowerRows(standings, {
            cars: pitControl.cars,
            fastestCar,
            phase: pitControl.phase,
          });
        }
        const totalLaps = pitControl.strategy.laps;
        hudRaceState.lap =
          totalLaps !== null
            ? Math.max(1, Math.min(session.timer.lap, totalLaps))
            : Math.max(1, session.timer.lap);
        hudRaceState.totalLaps = totalLaps;
        hudRaceState.rows = towerRowsCache;
        hudRaceState.gapMode = snap.gapMode;
        if (pitControl.strategy.kind === 'race') delete hudRaceState.gapLabel;
        else hudRaceState.gapLabel = 'BEST';
        hudRaceState.startLights = snap.startLights;
        hudRaceState.flags = snap.flags;
        hudRaceState.safety = snap.safety;
        hudRaceState.messages = snap.messages;
      }
      statusClock += dt;
      const phaseChanged = pitControl.phase !== statusPhase;
      if (statusClock >= STATUS_PERIOD || hasResult !== statusHadResult || phaseChanged) {
        statusClock = 0;
        statusHadResult = hasResult;
        statusPhase = pitControl.phase;
        showRaceStatus();
      }
    }
    view.setDrivingLine(session.assists.racingLine ?? 'off');
    // While simulating, the 3D view is drawn every SIMULATE_DRAW_EVERY frames: drawing was most
    // of each frame on a weak device, and the player's car stands in its box.
    if (!simulating || simulateFrames++ % SIMULATE_DRAW_EVERY === 0)
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
        simulationTime: session.world.time,
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
      h.stopped = carStopped({
        playing,
        time: session.world.time,
        speed: t.speed,
        surface: session.surfaceUnderCar(),
        inPit: session.inPit,
      });
      if (session.quickRace) {
        // A race has no out lap, no lap invalidation (track limits are strikes, shown as
        // notices) and no time-trial record or ghost.
        const totalLaps = session.race.control.strategy.laps;
        h.lap =
          totalLaps !== null ? Math.max(1, Math.min(timer.lap, totalLaps)) : Math.max(1, timer.lap);
        h.valid = true;
        h.record = null;
        h.liveDelta = null;
        h.ghost = false;
        // After the flag (or a retirement) the clock stops: the last lap's time stands, and the
        // cooldown lap is not timed.
        if (session.playerFinished || session.result !== null) {
          h.running = timer.lastLap !== null;
          h.lapTime = timer.lastLap ?? 0;
          for (const slot of h.sectors) {
            slot.state = 'none';
            slot.time = null;
            slot.delta = null;
          }
        }
      }
      if (session.quickRace && t.tyreCompound >= 0) {
        const c = COMPOUNDS[t.tyreCompound]!;
        hudTyres.compound = c.id;
        hudTyres.low = c.windowLow;
        hudTyres.high = c.windowHigh;
        (hudTyres.temp as Float64Array).set(t.tyreTemp);
        (hudTyres.wear as Float64Array).set(t.tyreWear);
        h.tyres = hudTyres;
      } else h.tyres = null;
      h.fuel = session.quickRace ? t.fuelMass : null;
      h.message = notices.current;
      if (others) h.others = others;
      else if (session.quickRace) h.others = fleetDots;
      h.tower = null;
      ext?.updateHud?.(h, renderTime);
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
      audioScene.update(session, view.world?.stands, voicesFor(quality)),
    );

    ext?.ready?.();
    handle = requestAnimationFrame(frame);
  };

  ext?.attach?.({
    session,
    loop,
    artefacts: ai?.artefacts ?? null,
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
    haptics.stop();
    cancelAnimationFrame(handle);
    if (lateTimer !== null) clearTimeout(lateTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('gesturestart', noPinch);
    o.canvas.removeEventListener('webglcontextlost', onContextLost);
    o.canvas.removeEventListener('webglcontextrestored', onContextRestored);
    clusterObserver.disconnect();
    rootObserver.disconnect();
    hud.destroy();
    window.removeEventListener('resize', measureCluster);
    loop.quit();
    ext?.detach?.();
    overlay?.destroy();
    document.documentElement.removeAttribute('data-race-finished');
    document.documentElement.removeAttribute('data-race-result');
    document.documentElement.removeAttribute('data-pit-garage');
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
    get closed() {
      return quitting;
    },
    session,
    loop,
    get view() {
      return view;
    },
    timeOfDay: tod.id,
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
    // The preset's whole world, whatever `?world=` the page has.
    prefetch: async (q) =>
      RaceView.releaseAssets(
        await RaceView.fetchAssets({ ...viewOptions(q), worldDetail: 'preset' }),
      ),
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
    setHudVisible: (on) => {
      hudVisible = on;
      hud.setVisible(on);
    },
    quit,
    loadTimes: () => ({ ...loadTimes }),
    get startLightsMask() {
      return gantryMask;
    },
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
      if (!ext && !session.quickRace) restartLap();
      results.hide();
      notices.clear();
    },
  };
}

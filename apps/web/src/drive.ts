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
  type CarTelemetry,
  type ControlInput,
} from '@undercut/sim';
import type { InputSystem } from '@undercut/input';
import { mountTouchOverlay, type TouchOverlay } from '@undercut/input/dom';
import {
  CAMERA_LABELS,
  CAMERA_ORDER,
  RaceView,
  createRenderer,
  type CameraName,
  type QualityName,
} from '@undercut/render';
import teams from '../../../design/teams.json';
import monza from '@undercut/track/data/monza.json';
import { defaultCarState } from '@undercut/audio';
import { silentAudio, type CarAudioSink } from './game/audio-seam';
import { toAudioCarState } from './game/audio-map';
import type { AudioSettingKey } from './game/audio-settings';
import {
  AutopilotControlSource,
  InputControlSource,
  KeyboardAutopilot,
  ScriptedControlSource,
} from './game/autopilot';
import { GameLoop } from './game/loop';
import { buildMinimap } from './game/minimap';
import type { RecordStore } from './game/records';
import { DriveSession, TIME_TRIAL_FUEL, type SessionEvent } from './game/session';
import { Hud, type HudMessage, type HudState } from './ui/hud';
import { PauseMenu } from './ui/pause';
import { ResultsStrip } from './ui/results';

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
  onQuit(): void;
  /** The player's car's sound (see game/audio-seam.ts); silent when absent. */
  onCarAudioState?: CarAudioSink;
  /** A short note for the pause menu about sound ('' when sound works). */
  soundNote?: () => string;
  /** Session lifecycle and volumes for the page's audio engine; absent for no audio. */
  audio?: DriveAudio;
}

export interface DriveHandle {
  readonly session: DriveSession;
  readonly loop: GameLoop;
  readonly view: RaceView;
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
  const session = new DriveSession({ track, seed: o.seed, record, today: o.today });
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
  const team = teams.teams.find((t) => t.id === TEAM_ID) ?? teams.teams[0];
  if (!team) throw new Error('design/teams.json has no teams');
  pageRenderer ??= createRenderer(o.canvas, o.quality);
  const view = new RaceView(o.canvas, {
    renderer: pageRenderer,
    track,
    quality: o.quality,
    livery: team.colours,
    car: {
      wheelbase: params.geometry.wheelbase,
      axleFront: mass.a,
      trackFront: params.geometry.trackFront,
      trackRear: params.geometry.trackRear,
      tyreRadius: params.tyre.rollingRadius,
    },
  });

  const input = o.input;
  const human = new InputControlSource(input);
  const scripted = new ScriptedControlSource(input);
  const pilot = new AutopilotControlSource(
    input,
    new KeyboardAutopilot(track, params),
    () => session.car.state,
  );
  const loop = new GameLoop(session, human);

  // UI.
  const plan = buildMinimap(track, 208, 150, 8);
  const hud = new Hud(plan);
  const results = new ResultsStrip();
  let quitting = false;
  const actions = {
    resume: () => resume(),
    restartLap: () => {
      onEvents(loop.restartLap());
      pilot.pilot.reset();
      resume();
    },
    resetToTrack: () => {
      onEvents(loop.resetToTrack());
      resume();
    },
    quit: () => quit(),
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
        id: 'tc',
        label: 'Traction control',
        choices: levels,
        get: () => session.assists.tractionControl,
        set: (v) => session.setAssist('tractionControl', Number(v)),
      },
      {
        id: 'abs',
        label: 'ABS',
        choices: [
          { value: 0, label: 'Off' },
          { value: 2, label: 'On' },
        ],
        get: () => (session.assists.abs > 0 ? 2 : 0),
        set: (v) => session.setAssist('abs', Number(v)),
      },
      {
        id: 'gears',
        label: 'Gears',
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
          void records.save(e.circuit, e.update).then(() => {
            if (!records.persistent)
              say({ tag: 'Storage', text: 'Record kept until the page closes', tone: 'info' }, 4);
          });
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

  // Frame loop.
  const pose = createCarPose();
  const ghostPose = createCarPose();
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

  const frame = (now: number): void => {
    if (quitting) return;
    const dt = last === null ? 0 : Math.min(0.25, (now - last) / 1000);
    if (last !== null) {
      frameLog.push(now - last);
      if (frameLog.length > FRAME_LOG) frameLog.shift();
    }
    last = now;

    if (session.phase === 'running') {
      const r = loop.frame(dt);
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
      for (const e of f.events) {
        if (e.type !== 'action') continue;
        if (e.action === 'pause' || e.action === 'menuBack') resume();
        else pause.navigate(e.action);
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
    results.tick(dt);

    const car = session.car;
    interpolateCarPose(car.previousPose, car.pose, loop.alpha, pose);
    const t = session.readTelemetry();
    const renderTime = loop.renderTime;
    const ghostOn = session.ghostPoseAt(renderTime, ghostPose);
    const revLights =
      t.engineRpm >= REV_FLASH
        ? 16
        : Math.max(
            0,
            Math.min(15, Math.ceil(((t.engineRpm - REV_START) / (REV_FULL - REV_START)) * 15)),
          );
    view.render({
      pose,
      ghost: ghostOn ? ghostPose : null,
      drs: t.drs,
      speed: t.speed,
      longG: t.longG,
      latG: t.latG,
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
    h.ers = Math.max(0, Math.min(1, t.ersStore / params.ers.storeWindow));
    h.ersLap = Math.max(0, Math.min(1, 1 - t.ersDeployLap / params.ers.deployPerLap));
    h.ersMode = ERS_MODE_LABEL[t.ersMode] ?? 'Balanced';
    h.drs = t.drs > 0.5 ? 'open' : session.drsAvailable ? 'available' : 'off';
    h.carX = pose.x;
    h.carZ = pose.z;
    h.ghostX = ghostOn ? ghostPose.x : null;
    h.ghostZ = ghostOn ? ghostPose.z : null;
    h.message = message;
    hud.update(h);
    overlay?.update();

    // Engine and road sound, through the audio seam.
    toAudioCarState(
      {
        state: car.state,
        telemetry: t,
        pitLimiter: car.input.pitLimiter,
        kerbRoughness: session.kerbUnderWheels(),
      },
      audioState,
    );
    sink(audioState, !playing || document.visibilityState === 'hidden');

    handle = requestAnimationFrame(frame);
  };

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

  function quit(): void {
    if (quitting) return;
    quitting = true;
    o.audio?.setActive(false);
    cancelAnimationFrame(handle);
    document.removeEventListener('visibilitychange', onVisibility);
    clusterObserver.disconnect();
    window.removeEventListener('resize', measureCluster);
    loop.quit();
    overlay?.destroy();
    view.dispose();
    input.setContext('menu');
    delete document.documentElement.dataset.ready;
    delete document.documentElement.dataset.paused;
    delete document.documentElement.dataset.screen;
    o.host.replaceChildren();
    o.onQuit();
  }

  let source: 'human' | 'script' | 'pilot' = 'human';
  const setSource = (next: typeof source): void => {
    if (source === 'pilot' && next !== 'pilot') pilot.release();
    source = next;
    loop.setSource(next === 'human' ? human : next === 'script' ? scripted : pilot);
  };

  return {
    session,
    loop,
    view,
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
    restartLap: actions.restartLap,
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
      view.setCamera('chase-near');
      actions.restartLap();
      results.hide();
      message = null;
    },
  };
}

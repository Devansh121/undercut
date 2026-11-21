import '../../../design/mock/tokens.css';
import './styles/kit.css';
import './styles/menu.css';
import './styles.css';
import { InputSystem } from '@undercut/input';
import {
  WebStorageAdapter,
  attachFocusGuard,
  attachKeyboard,
  navigatorGamepads,
  navigatorRumble,
} from '@undercut/input/dom';
import type { QualityName } from '@undercut/render';
import { CIRCUITS } from 'virtual:undercut/circuits';
import { PageAudio } from './audio';
import { debugEnabled, installDebugApi } from './debug';
import type * as DriveModuleNs from './drive';
import type { DriveHandle } from './drive';
import { RecordStore, durableStorage, memoryStorage } from './game/records';
import { firstGuess, isQuality, loadQuality } from './game/quality-setting';
import { PrefsStore } from './ui/data/prefs';
import { MenuInput } from './ui/menu-input';
import { CircuitSelectScreen } from './ui/screens/circuits';
import { HubScreen, type SessionChoice } from './ui/screens/hub';
import { LaunchScreen } from './ui/screens/launch';
import { Shell } from './ui/shell';

type DriveModule = typeof DriveModuleNs;

const app = document.getElementById('app');
const canvas = document.getElementById('view');
if (!(app instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
  throw new Error('index.html is missing #app or #view');
}

const params = new URLSearchParams(window.location.search);
const touch = navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;
// One record store for the page, so records kept in memory (storage blocked, or ?storage=memory)
// survive quitting to the menu and starting again.
const webStorage = new WebStorageAdapter();
const records = new RecordStore(
  params.get('storage') === 'memory' ? memoryStorage() : durableStorage(webStorage),
);
// What the menus remember (mode, circuit, team, settings), through the same storage port.
const prefs = new PrefsStore(webStorage);
await prefs.load();
// Engine sound for the page: created on the first gesture, saved volumes beside the settings.
const audio = new PageAudio(webStorage);
const input = new InputSystem({
  readGamepads: navigatorGamepads(),
  rumble: navigatorRumble(),
  touchCapable: touch,
});
attachKeyboard(input);
attachFocusGuard(input);
input.setContext('menu');

/** A preset in the URL (tests, stations), else the saved choice, else a default to benchmark. */
function chooseQuality(): { quality: QualityName; auto: boolean } {
  const asked = params.get('quality');
  if (isQuality(asked)) return { quality: asked, auto: false };
  const saved = loadQuality();
  if (saved) return { quality: saved, auto: false };
  return {
    quality: firstGuess(touch, Math.min(window.innerWidth, window.innerHeight)),
    auto: true,
  };
}

let drive: DriveHandle | null = null;
let driveModule: DriveModule | null = null;
let starting: Promise<DriveHandle> | null = null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---- Menus
const shell = new Shell(app);
const menuInput = new MenuInput(input, {
  action: (a, native) => shell.handle(a, native),
  device: (d) => {
    shell.setDevice(d);
    hub.setDevice(d);
  },
});
const hub: HubScreen = new HubScreen({
  circuits: CIRCUITS,
  prefs,
  records,
  device: () => input.activeDevice,
  onStart: (choice) => {
    // The Start press is the gesture that may start audio.
    audio.gesture();
    start(choice).catch(() => undefined);
  },
  onCircuits: () => shell.push(circuits),
  onBack: () => shell.pop(),
});
const circuits = new CircuitSelectScreen(CIRCUITS, prefs, records, () => shell.pop());
const launch = new LaunchScreen(__BUILD_HASH__, () => {
  audio.gesture();
  shell.push(hub);
});

function showMenus(screen: 'launch' | 'hub'): void {
  drive = null;
  shell.mount();
  if (screen === 'launch' || !shell.current) shell.reset(launch);
  if (screen === 'hub') {
    if (shell.current !== hub) shell.push(hub);
    else hub.enter();
  }
  hub.setLoading(false);
  menuInput.start();
}

/** The choice on the main menu now (the debug API starts with it). */
function currentChoice(): SessionChoice {
  const p = prefs.get();
  return {
    mode: 'timeTrial',
    circuit: p.circuit,
    team: p.team,
    driver: p.driver,
    timeOfDay: p.timeOfDay[p.circuit] ?? '',
    assists: p.assists[input.activeDevice] ?? {},
  };
}

async function start(choice: SessionChoice = currentChoice()): Promise<DriveHandle> {
  if (drive) return drive;
  if (starting) return starting;
  hub.setLoading(true);
  menuInput.stop();
  starting = (async () => {
    try {
      driveModule ??= await import('./drive');
      const { startDrive } = driveModule;
      const chosen = chooseQuality();
      const handle = await startDrive({
        canvas: canvas as HTMLCanvasElement,
        host: app as HTMLElement,
        input,
        records,
        audio,
        onCarAudioState: audio.sink,
        soundNote: () => (audio.status === 'silent' ? 'No sound in this browser' : ''),
        quality: chosen.quality,
        autoQuality: chosen.auto,
        touch,
        seed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 1,
        today: today(),
        team: choice.team,
        driver: choice.driver,
        timeOfDay: choice.timeOfDay,
        assists: choice.assists,
        onAssist: (device, key, value) =>
          prefs.update((p) => {
            p.assists[device] = { ...(p.assists[device] ?? {}), [key]: value };
          }),
        onQuit: () => showMenus('hub'),
      });
      drive = handle;
      return handle;
    } catch (error) {
      if (error instanceof Error && error.name === 'LoadCancelled') {
        showMenus('hub');
        throw error;
      }
      hub.setLoading(false);
      menuInput.start();
      document.documentElement.dataset.webgl = 'unavailable';
      console.error('Could not start the session', error);
      throw error;
    } finally {
      starting = null;
    }
  })();
  return starting;
}

showMenus('launch');
if (debugEnabled()) {
  installDebugApi(
    () => drive,
    () => start(),
    () => driveModule?.rendererInfo() ?? { geometries: 0, textures: 0, programs: 0 },
    () => audio.status,
    () => ({ supported: PageAudio.supported, fallback: audio.fallbackReason }),
  );
}

import '../../../design/mock/tokens.css';
import './styles.css';
import { InputSystem, MemoryStorage, type StoragePort } from '@undercut/input';
import {
  WebStorageAdapter,
  attachFocusGuard,
  attachKeyboard,
  navigatorGamepads,
  navigatorRumble,
} from '@undercut/input/dom';
import type { QualityName } from '@undercut/render';
import { debugEnabled, installDebugApi } from './debug';
import type { DriveHandle } from './drive';
import { RecordStore } from './game/records';
import { mountLaunchScreen, type LaunchScreen } from './launch';

const app = document.getElementById('app');
const canvas = document.getElementById('view');
if (!(app instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
  throw new Error('index.html is missing #app or #view');
}

const params = new URLSearchParams(window.location.search);
const touch = navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;
let storage: StoragePort;
try {
  storage = new WebStorageAdapter();
} catch {
  storage = new MemoryStorage();
}
// Storage-blocked runs (and tests that ask for it) keep records in memory only.
if (params.get('storage') === 'memory') storage = new MemoryStorage();
const input = new InputSystem({
  readGamepads: navigatorGamepads(),
  rumble: navigatorRumble(),
  touchCapable: touch,
});
attachKeyboard(input);
attachFocusGuard(input);
input.setContext('menu');

function chooseQuality(): QualityName {
  const asked = params.get('quality');
  if (asked === 'high' || asked === 'mobile') return asked;
  return touch || Math.min(window.innerWidth, window.innerHeight) < 600 ? 'mobile' : 'high';
}

let drive: DriveHandle | null = null;
let launch: LaunchScreen | null = null;
let starting: Promise<DriveHandle> | null = null;
let menuHandle = 0;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function showLaunch(): void {
  drive = null;
  launch = mountLaunchScreen(app as HTMLElement, {
    buildHash: __BUILD_HASH__,
    record: null,
    onStart: () => void start(),
  });
  void new RecordStore(storage).load('monza').then((r) => launch?.setRecord(r?.lap ?? null));
  // Gamepad and keyboard accept on the launch screen, through the input layer's menu context.
  let last: number | null = null;
  const poll = (now: number): void => {
    if (drive || starting) return;
    const dt = last === null ? 0 : (now - last) / 1000;
    last = now;
    const f = input.sample(dt, 0);
    for (const e of f.events) {
      // A focused button already clicks on Enter; gamepads need the accept passed on.
      const native = f.device === 'keyboard' && document.activeElement?.tagName === 'BUTTON';
      if (e.type === 'action' && e.action === 'menuAccept' && !native) launch?.start();
    }
    menuHandle = requestAnimationFrame(poll);
  };
  menuHandle = requestAnimationFrame(poll);
}

async function start(): Promise<DriveHandle> {
  if (drive) return drive;
  if (starting) return starting;
  launch?.setLoading(true);
  cancelAnimationFrame(menuHandle);
  starting = (async () => {
    try {
      const { startDrive } = await import('./drive');
      const handle = await startDrive({
        canvas: canvas as HTMLCanvasElement,
        host: app as HTMLElement,
        input,
        storage,
        quality: chooseQuality(),
        touch,
        seed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 1,
        today: today(),
        onQuit: () => showLaunch(),
      });
      drive = handle;
      return handle;
    } catch (error) {
      document.documentElement.dataset.webgl = 'unavailable';
      launch?.setLoading(false);
      console.error('Could not start the session', error);
      throw error;
    } finally {
      starting = null;
    }
  })();
  return starting;
}

showLaunch();
if (debugEnabled()) installDebugApi(() => drive, start);

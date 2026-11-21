import '../../../design/mock/tokens.css';
import './styles.css';
import './online/race-hud.css';
import { OnlineFlow } from './online/flow';
import { codeFromUrl } from './online/invite';
import type { DriveExtension } from './drive';
import { InputSystem } from '@undercut/input';
import {
  WebStorageAdapter,
  attachFocusGuard,
  attachKeyboard,
  navigatorGamepads,
  navigatorRumble,
} from '@undercut/input/dom';
import type { QualityName } from '@undercut/render';
import { PageAudio } from './audio';
import { debugEnabled, installDebugApi } from './debug';
import type * as DriveModuleNs from './drive';
import type { DriveHandle } from './drive';

type DriveModule = typeof DriveModuleNs;
import { RecordStore, durableStorage, memoryStorage } from './game/records';
import { mountLaunchScreen, type LaunchScreen } from './launch';
import { firstGuess, isQuality, loadQuality } from './game/quality-setting';

const app = document.getElementById('app');
const canvas = document.getElementById('view');
if (!(app instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
  throw new Error('index.html is missing #app or #view');
}

const params = new URLSearchParams(window.location.search);
const touch = navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;
// One record store for the page, so records kept in memory (storage blocked, or ?storage=memory)
// survive quitting to the launch screen and starting again.
const webStorage = new WebStorageAdapter();
const records = new RecordStore(
  params.get('storage') === 'memory' ? memoryStorage() : durableStorage(webStorage),
);
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

let online: OnlineFlow | null = null;
let drive: DriveHandle | null = null;
let driveModule: DriveModule | null = null;
let launch: LaunchScreen | null = null;
let starting: Promise<DriveHandle> | null = null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function showLaunch(): void {
  online = null;
  drive = null;
  launch = mountLaunchScreen(app as HTMLElement, {
    buildHash: __BUILD_HASH__,
    onOnline: () => showOnline(null),
    record: null,
    onStart: () => {
      // The Start click is the gesture that may start audio.
      audio.gesture();
      start().catch(() => undefined);
    },
  });
  void records.load('monza').then((r) => launch?.setRecord(r?.lap ?? null));
}

function pollMenus(): void {
  // Gamepad and keyboard accept on the launch screen, through the input layer's menu context.
  let last: number | null = null;
  const poll = (now: number): void => {
    if (drive || starting) {
      requestAnimationFrame(poll);
      last = now;
      return;
    }
    const dt = last === null ? 0 : (now - last) / 1000;
    last = now;
    const f = input.sample(dt, 0);
    for (const e of f.events) {
      // A focused button already clicks on Enter; gamepads need the accept passed on.
      const native =
        f.device === 'keyboard' &&
        ['BUTTON', 'INPUT', 'A'].includes(document.activeElement?.tagName ?? '');
      if (e.type === 'action' && e.action === 'menuAccept' && !native) {
        if (
          document.activeElement instanceof HTMLElement &&
          document.activeElement !== document.body
        )
          document.activeElement.click();
        else launch?.start();
      }
      if (
        e.type === 'action' &&
        (e.action === 'menuLeft' || e.action === 'menuRight') &&
        f.device === 'gamepad'
      ) {
        const field = document.activeElement;
        if (field instanceof HTMLInputElement && field.type === 'number' && !field.disabled) {
          if (e.action === 'menuRight') field.stepUp();
          else field.stepDown();
          field.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      if (e.type === 'action' && (e.action === 'menuDown' || e.action === 'menuUp')) {
        const buttons = [
          ...app!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a'),
        ];
        const at = buttons.indexOf(document.activeElement as HTMLElement);
        buttons[
          (at + (e.action === 'menuDown' ? 1 : buttons.length - 1)) % buttons.length
        ]?.focus();
      }
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

function showOnline(code: string | null): void {
  launch = null;
  online = new OnlineFlow(
    app as HTMLElement,
    code,
    (extension, quit) => start(extension, quit),
    showLaunch,
  );
}

async function start(extension?: DriveExtension, quit?: () => void): Promise<DriveHandle> {
  if (drive) return drive;
  if (starting) return starting;
  launch?.setLoading(true);

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
        ...(extension ? { extension } : {}),
        onQuit: () => {
          drive = null;
          if (quit) quit();
          else showLaunch();
        },
      });
      drive = handle;
      return handle;
    } catch (error) {
      launch?.setLoading(false);
      if (error instanceof Error && error.name === 'LoadCancelled') {
        showLaunch();
        throw error;
      }
      document.documentElement.dataset.webgl = 'unavailable';
      console.error('Could not start the session', error);
      throw error;
    } finally {
      starting = null;
    }
  })();
  return starting;
}

showLaunch();
pollMenus();
const invite = codeFromUrl(location.href);
if (invite) showOnline(invite);
if (debugEnabled()) {
  installDebugApi(
    () => drive,
    start,
    () => driveModule?.rendererInfo() ?? { geometries: 0, textures: 0, programs: 0 },
    () => audio.status,
    () => ({ supported: PageAudio.supported, fallback: audio.fallbackReason }),
  );
}

if (debugEnabled()) {
  Object.assign(window.__undercut!, {
    online: () => ({
      state: online?.session.state ?? null,
      race: online?.race?.snapshot() ?? null,
    }),
  });
}

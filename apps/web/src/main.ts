import { WeekendProgress } from './game/weekend';
import { WeekendScreen } from './ui/screens/weekend';
import type { SessionResult } from '@undercut/race';
import { registerOffline } from './pwa/register';
import { showHomeScreenHint } from './pwa/home-screen-hint';
import '../../../design/mock/tokens.css';
import './styles/kit.css';
import './styles/menu.css';
import './styles/settings.css';
import './styles.css';
import './online/race-hud.css';
import { OnlineFlow } from './online/flow';
import { codeFromUrl } from './online/invite';
import type { DriveExtension } from './drive';
import { InputSystem, ProfileStore, type DeviceKind, type MenuButton } from '@undercut/input';
import {
  WebStorageAdapter,
  attachFocusGuard,
  attachKeyboard,
  navigatorGamepads,
  navigatorRumble,
} from '@undercut/input/dom';
import type { SettingsPatch } from '@undercut/protocol';
import type { QualityName } from '@undercut/render';
import { CIRCUITS } from 'virtual:undercut/circuits';
import { PageAudio } from './audio';
import { debugEnabled, installDebugApi } from './debug';
import type * as DriveModuleNs from './drive';
import type { DriveHandle } from './drive';
import { RecordStore, durableStorage, memoryStorage } from './game/records';
import {
  firstGuess,
  isQuality,
  loadAutoPick,
  loadQuality,
  saveQuality,
} from './game/quality-setting';
import { applyPlayerSettings } from './ui/apply-settings';
import { PrefsStore } from './ui/data/prefs';
import { MenuInput } from './ui/menu-input';
import { CircuitSelectScreen } from './ui/screens/circuits';
import { HubScreen, type SessionChoice } from './ui/screens/hub';
import { LaunchScreen } from './ui/screens/launch';
import { timeOfDayOf } from './ui/screens/session-settings';
import { SettingsScreen } from './ui/screens/settings';
import { Shell } from './ui/shell';
import { setSpeedUnit, speedUnit } from './ui/player-settings';

type DriveModule = typeof DriveModuleNs;
import type { QuickRaceOptions } from './game/session';

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
applyPlayerSettings(prefs.get().settings, document.documentElement);
// Engine sound for the page: created on the first gesture, saved volumes beside the settings.
const audio = new PageAudio(webStorage);
// The player's controls (bindings and stick, pedal and keyboard feel), rebound in Settings.
const profiles = new ProfileStore(webStorage);
const input = new InputSystem({
  readGamepads: navigatorGamepads(),
  rumble: navigatorRumble(),
  touchCapable: touch,
  profile: (await profiles.load()).profile,
});
attachKeyboard(input);
attachFocusGuard(input);
input.setContext('menu');

/**
 * A preset in the URL (tests, stations), else the saved choice, else Auto: the preset its one
 * benchmark settled on, or a first guess to benchmark from.
 */
function chooseQuality(): { quality: QualityName; auto: boolean } {
  const asked = params.get('quality');
  if (isQuality(asked)) return { quality: asked, auto: false };
  const saved = loadQuality();
  if (saved) return { quality: saved, auto: false };
  return {
    quality: loadAutoPick() ?? firstGuess(touch, Math.min(window.innerWidth, window.innerHeight)),
    auto: true,
  };
}

let online: OnlineFlow | null = null;
let drive: DriveHandle | null = null;
let driveModule: DriveModule | null = null;
let starting: Promise<DriveHandle> | null = null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---- Menus
const shell = new Shell(
  app,
  () => undefined,
  {
    bindings: () => input.profile.bindings,
    device: () => input.activeDevice,
    padConnected: () => input.gamepad.connected,
    touchCapable: () => touch,
  },
  () => shell.push(settingsScreen),
);
shell.setDevice(input.activeDevice);
const menuInput = new MenuInput(input, {
  action: (a, native, device) => {
    if (online) onlineAction(a, device);
    else shell.handle(a, native);
  },
  device: (d) => {
    shell.setDevice(d);
    shell.controls?.sync();
    hub.setDevice(d);
    settingsScreen.setDevice(d);
  },
  captured: (d, control) => settingsScreen.captured(d, control),
});
const hub: HubScreen = new HubScreen({
  circuits: CIRCUITS,
  prefs,
  records,
  device: () => input.activeDevice,
  onStart: (choice) => {
    // The Start press is the gesture that may start audio: the context starts here, silent,
    // so it may play once the session has loaded (iOS Safari allows no later start).
    audio.prime();
    if (choice.mode === 'weekend' || choice.mode === 'championship') void showWeekend(choice);
    else start(choice).catch(() => undefined);
  },
  onOnline: () => {
    // Not primed here: creating the context on this press stalled WebKit's page (the phone-fit
    // sweep's Online step froze one run in six). An online race's sound starts on the first
    // touch release instead (PageAudio.gesture unlocks the context then).
    audio.gesture();
    showOnline(null);
  },
  onCircuits: () => shell.push(circuits),
  onBack: () => shell.pop(),
});
const circuits = new CircuitSelectScreen(CIRCUITS, prefs, records, () => shell.pop());
const settingsScreen = new SettingsScreen({
  prefs,
  profile: () => input.profile,
  device: () => input.activeDevice,
  setProfile: (profile) => {
    input.setProfile(profile);
    menuInput.refreshGlyphs();
    return profiles.save(profile);
  },
  startCapture: (d) => input.startCapture(d),
  cancelCapture: () => input.cancelCapture(),
  volume: (key) => audio.volumes[key],
  setVolume: (key, v) => audio.setVolume(key, v),
  // (A saved preset is never Lite: loadQuality drops it.)
  graphics: () => (loadQuality() as Exclude<QualityName, 'lite'> | null) ?? 'auto',
  setGraphics: (v) => saveQuality(v),
  units: speedUnit,
  setUnits: setSpeedUnit,
  touch,
  page: document.documentElement,
  onCredits: () => {
    // The credits (CREDITS.md and the asset manifest) load only when opened.
    void import('./ui/screens/credits').then(({ CreditsScreen }) => {
      if (shell.current === settingsScreen) shell.push(new CreditsScreen(() => shell.pop()));
    });
  },
  onBack: () => shell.pop(),
});
const launch = new LaunchScreen(__BUILD_HASH__, () => {
  audio.gesture();
  shell.push(hub);
});

function showMenus(screen: 'launch' | 'hub'): void {
  drive = null;
  online = null;
  shell.mount();
  if (screen === 'launch' || !shell.current) shell.reset(launch);
  if (screen === 'hub') {
    if (shell.current !== hub) shell.push(hub);
    else hub.enter();
  }
  hub.setLoading(false);
  menuInput.start();
}

let season: WeekendProgress | null = await WeekendProgress.load(webStorage);
async function showWeekend(choice: SessionChoice): Promise<void> {
  const progress =
    choice.mode === 'championship'
      ? (season ??= new WeekendProgress(choice, choice.laps ?? 5))
      : new WeekendProgress(choice, choice.laps ?? 5);
  // Browser flow fixture: the real timed-session rules with a short clock.
  const testDuration = debugEnabled() ? Number(params.get('weekendDuration')) : NaN;
  if (testDuration > 0 && testDuration <= 1080) progress.weekend.plan.qualifying = testDuration;
  const testPractice = debugEnabled() ? Number(params.get('practiceDuration')) : NaN;
  if (testPractice > 0 && testPractice <= 300 && progress.weekend.plan.practice !== null)
    progress.weekend.plan.practice = testPractice;
  await progress.save(webStorage);
  const screen = new WeekendScreen(
    progress,
    webStorage,
    (nextChoice, options, complete) => {
      // The weekend screen's Start press is the gesture for this session's sound, as on the hub.
      audio.prime();
      start(
        nextChoice,
        undefined,
        () => {
          shell.mount();
          screen.enter();
          menuInput.start();
        },
        options,
        complete,
      ).catch(() => undefined);
    },
    () => {
      shell.pop();
    },
  );
  shell.push(screen);
}

/** The choice on the main menu now (the debug API starts with it). */
function currentChoice(circuit?: string): SessionChoice {
  const p = prefs.get();
  const id = circuit ?? p.circuit;
  const summary = CIRCUITS.find((c) => c.id === id);
  return {
    mode: 'timeTrial',
    circuit: id,
    team: p.team,
    driver: p.driver,
    // The circuit's own sky as the hub would pick it (Spa is overcast), not the default one.
    timeOfDay: summary ? timeOfDayOf(p, summary) : (p.timeOfDay[id] ?? ''),
    assists: p.assists[input.activeDevice] ?? {},
  };
}

/**
 * The online screens (apps/web/src/online) on the shared menu input: the focused control takes
 * accept, up and down step through the screen's buttons and fields, a pad's left and right step a
 * number field. A keyboard's Enter on a button, field or link is already native.
 */
function onlineAction(a: MenuButton, device: DeviceKind): void {
  const active = document.activeElement;
  const nativeKey =
    device === 'keyboard' && ['BUTTON', 'INPUT', 'A'].includes(active?.tagName ?? '');
  if (a === 'menuAccept' && !nativeKey) {
    if (active instanceof HTMLElement && active !== document.body) active.click();
  } else if ((a === 'menuLeft' || a === 'menuRight') && device === 'gamepad') {
    if (active instanceof HTMLInputElement && active.type === 'number' && !active.disabled) {
      if (a === 'menuRight') active.stepUp();
      else active.stepDown();
      active.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } else if (a === 'menuDown' || a === 'menuUp') {
    const controls = [
      ...(app as HTMLElement).querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), a',
      ),
    ].filter((b) => !b.closest('[inert]'));
    const at = controls.indexOf(active as HTMLElement);
    controls[(at + (a === 'menuDown' ? 1 : controls.length - 1)) % controls.length]?.focus();
  }
}

/** Online rooms (lobby, race, results) from the main menu or an invite link. */
function showOnline(code: string | null): void {
  menuInput.start();
  online = new OnlineFlow(
    app as HTMLElement,
    code,
    (extension, quit, launch) =>
      start(
        {
          ...currentChoice(launch.circuit),
          mode: 'timeTrial',
          circuit: launch.circuit,
          timeOfDay: launch.timeOfDay,
        },
        extension,
        quit,
      ),
    () => showMenus('hub'),
  );
}

/** A Quick Race to start again as soon as the current one has quit (Restart race). */
let restartWith: {
  choice: SessionChoice;
  quickRace: QuickRaceOptions;
  quit?: () => void;
  complete?: (result: SessionResult) => void;
} | null = null;

/**
 * Start a session from the menus' choice: a Quick Race (`choice.mode`, or race options from the
 * debug API), an online extension, or a time trial.
 */
async function start(
  choice: SessionChoice = currentChoice(),
  extension?: DriveExtension,
  quit?: () => void,
  raceOptions?: QuickRaceOptions,
  onSessionComplete?: (result: SessionResult) => void,
): Promise<DriveHandle> {
  const quickRace =
    raceOptions ?? (choice.mode === 'quickRace' ? { laps: choice.laps ?? 5 } : undefined);
  if (drive && !drive.closed) return drive;
  drive = null;
  if (starting) {
    await starting.catch(() => undefined);
    return drive ?? start(choice, extension, quit, raceOptions, onSessionComplete);
  }
  if (!extension) hub.setLoading(true);
  menuInput.stop();
  let active = true;
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
        ...(quickRace
          ? {
              quickRace: {
                ...quickRace,
                automaticPitLimiter: prefs.get().race.automaticPitLimiter,
              },
            }
          : {}),
        onPitLimiter: (value) =>
          prefs.update((p) => {
            p.race.automaticPitLimiter = value;
          }),
        ...(onSessionComplete ? { onSessionComplete } : {}),
        ...(quickRace
          ? {
              onRestartRace: () => {
                restartWith = {
                  choice,
                  quickRace,
                  ...(quit ? { quit } : {}),
                  ...(onSessionComplete ? { complete: onSessionComplete } : {}),
                };
                drive?.quit();
              },
            }
          : {}),
        circuit: choice.circuit,
        team: choice.team,
        driver: choice.driver,
        timeOfDay: choice.timeOfDay,
        assists: choice.assists,
        onAssist: (device, key, value) =>
          prefs.update((p) => {
            p.assists[device] = { ...(p.assists[device] ?? {}), [key]: value };
          }),
        ...(extension ? { extension } : {}),
        haptics: {
          get: () => prefs.get().settings.haptics,
          set: (on) =>
            prefs.update((p) => {
              p.settings.haptics = on;
            }),
        },
        onQuit: () => {
          active = false;
          drive = null;
          if (restartWith) {
            const again = restartWith;
            restartWith = null;
            start(again.choice, undefined, again.quit, again.quickRace, again.complete).catch(
              () => undefined,
            );
          } else if (quit) {
            // Back to the online screens, on the menu input.
            menuInput.start();
            quit();
          } else showMenus('hub');
        },
      });
      if (active) drive = handle;
      return handle;
    } catch (error) {
      if (error instanceof Error && error.name === 'LoadCancelled') {
        // Online: the flow leaves the room and shows its screens again.
        if (extension) menuInput.start();
        else showMenus('hub');
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
const invite = codeFromUrl(location.href);
if (invite) showOnline(invite);
if (debugEnabled()) {
  installDebugApi(
    () => drive,
    (o) =>
      o?.quickRace
        ? start(
            { ...currentChoice(o.circuit ?? 'monza'), mode: 'quickRace' },
            undefined,
            undefined,
            o.quickRace,
          )
        : start(),
    () =>
      driveModule?.rendererInfo() ?? { geometries: 0, textures: 0, programs: 0, programRefs: 0 },
    () => driveModule?.rendererPrograms() ?? [],
    () => audio.status,
    () => ({ supported: PageAudio.supported, fallback: audio.fallbackReason }),
  );
}

if (debugEnabled()) {
  Object.assign(window.__undercut!, {
    /** The worklet's processing-time report with `&audioProfile=1`, or null. */
    audioProfile: () => audio.profile,
    online: (includeTrace = false) => ({
      state: online?.session.state ?? null,
      race: online?.race?.snapshot(includeTrace) ?? null,
    }),
    onlineOrder: (serverTime: number) => online?.race?.orderAt(serverTime) ?? null,
    onlineSettings: (patch: SettingsPatch) => online?.session.changeSettings(patch) ?? false,
  });
}

registerOffline();
showHomeScreenHint();

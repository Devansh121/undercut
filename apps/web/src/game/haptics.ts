import type { DeviceKind } from '@undercut/input';

/**
 * Where haptic effects go. `rumble` is a gamepad's dual motors (magnitudes 0–1, seconds),
 * `vibrate` the phone's motor through the Vibration API (milliseconds; Android only, iOS Safari
 * has no web vibration). `stopRumble` silences both.
 */
export interface HapticsPort {
  device(): DeviceKind;
  rumble(strong: number, weak: number, duration: number): void;
  stopRumble(): void;
  vibrate(ms: number): void;
}

/** The browser can drive a phone's vibration motor (the Vibration API; Android, not iOS Safari). */
export function phoneCanVibrate(nav: Navigator | undefined = globalThis.navigator): boolean {
  return typeof nav?.vibrate === 'function';
}

/** A connected gamepad can rumble (the Gamepad haptics API). */
export function padCanRumble(nav: Navigator | undefined = globalThis.navigator): boolean {
  try {
    const pads = nav?.getGamepads?.() ?? [];
    return [...pads].some(
      (p) => p !== null && (p as Gamepad & { vibrationActuator?: unknown }).vibrationActuator,
    );
  } catch {
    return false;
  }
}

/** One rendered frame of what the player's car felt. */
export interface HapticsFrame {
  /** Real frame time, s. */
  dt: number;
  /** Car speed, m/s. */
  speed: number;
  /** Kerb roughness under the wheels, 0–1 (`DriveSession.kerbUnderWheels`). */
  kerb: number;
  /** Hardest barrier (or breakable board) impact this frame, m/s normal speed; 0 for none. */
  wallImpact: number;
  /** Hardest car-to-car closing speed this frame, m/s; 0 for none. */
  carImpact: number;
}

/** Below this speed a kerb is not felt (the car is crawling or stopped on it), m/s. */
export const KERB_MIN_SPEED = 3;
/** Lighter impacts than this are brushes, not hits, m/s. */
export const IMPACT_MIN_SPEED = 1.5;
/** Impact speed that gives the full jolt, m/s. */
const IMPACT_FULL_SPEED = 15;
/** A contact that keeps reporting within this time is the same impact (a scrape), s. */
const IMPACT_MERGE = 0.25;

/** Gamepad kerb buzz: refreshed every PAD_KERB_PERIOD, each pulse a little longer, s. */
const PAD_KERB_PERIOD = 0.1;
const PAD_KERB_PULSE = 0.15;
/** Phone kerb pulses: short taps a few times a second rather than a constant buzz. */
const TOUCH_KERB_PERIOD = 0.25;

const clamp01 = (v: number): number => (v > 1 ? 1 : v > 0 ? v : 0);

/**
 * Kerbs and contacts as force feedback. A gamepad gets a light-motor buzz for as long as the
 * wheels are on a kerb (harder on a rougher one) and a heavy-motor thump per barrier or car
 * impact, scaled by its speed. A phone held on touch controls gets the same as short vibration
 * pulses. A keyboard gets nothing. An impact plays out before the kerb buzz resumes. Every call
 * to the port is guarded: haptics are optional and never stop the game.
 */
export class Haptics {
  private sinceImpact = Number.POSITIVE_INFINITY;
  private lastImpact = 0;
  /** Time left on the current impact jolt, s. */
  private joltLeft = 0;
  /** Time until the next kerb pulse, s. */
  private kerbIn = 0;
  private onKerb = false;
  /** Something may be playing on the port (a stop is owed). */
  private playing = false;

  constructor(
    private readonly port: HapticsPort,
    private readonly enabled: () => boolean,
  ) {}

  update(f: HapticsFrame): void {
    const device = this.port.device();
    if (!this.enabled() || device === 'keyboard') {
      this.stop();
      return;
    }
    const pad = device === 'gamepad';
    this.sinceImpact += f.dt;
    this.joltLeft = Math.max(0, this.joltLeft - f.dt);
    this.kerbIn -= f.dt;

    const impact = Math.max(f.wallImpact, f.carImpact);
    if (impact >= IMPACT_MIN_SPEED) {
      const fresh = this.sinceImpact >= IMPACT_MERGE || impact >= 2 * this.lastImpact;
      this.sinceImpact = 0;
      if (fresh) {
        this.lastImpact = impact;
        const x = clamp01(impact / IMPACT_FULL_SPEED);
        const duration = 0.12 + 0.28 * x;
        if (pad) this.rumble(0.4 + 0.6 * x, 0.2 + 0.4 * x, duration);
        else this.vibrate(Math.round(25 + 75 * x));
        this.joltLeft = duration;
        return;
      }
    }

    const kerb = f.speed >= KERB_MIN_SPEED ? clamp01(f.kerb) : 0;
    if (kerb <= 0) {
      if (this.onKerb && this.joltLeft <= 0) this.silence();
      this.onKerb = false;
      this.kerbIn = 0;
      return;
    }
    this.onKerb = true;
    if (this.joltLeft > 0 || this.kerbIn > 0) return;
    if (pad) {
      this.rumble(0.1 + 0.3 * kerb, 0.25 + 0.55 * kerb, PAD_KERB_PULSE);
      this.kerbIn = PAD_KERB_PERIOD;
    } else {
      this.vibrate(Math.round(8 + 8 * kerb));
      this.kerbIn = TOUCH_KERB_PERIOD;
    }
  }

  /** Silence anything playing and forget the state (pause, quit, setting off). */
  stop(): void {
    if (this.playing) this.silence();
    this.onKerb = false;
    this.kerbIn = 0;
    this.joltLeft = 0;
    this.sinceImpact = Number.POSITIVE_INFINITY;
    this.lastImpact = 0;
  }

  private silence(): void {
    this.playing = false;
    try {
      this.port.stopRumble();
    } catch {
      /* Haptics are optional. */
    }
  }

  private rumble(strong: number, weak: number, duration: number): void {
    this.playing = true;
    try {
      this.port.rumble(clamp01(strong), clamp01(weak), duration);
    } catch {
      /* Haptics are optional. */
    }
  }

  private vibrate(ms: number): void {
    this.playing = true;
    try {
      this.port.vibrate(ms);
    } catch {
      /* Haptics are optional. */
    }
  }
}

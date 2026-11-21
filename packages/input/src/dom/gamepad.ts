import type { GamepadReader, RumblePort } from '../sources/gamepad';

/** Reads pads through `navigator.getGamepads()`; empty where the Gamepad API is missing. */
export function navigatorGamepads(nav: Navigator = navigator): GamepadReader {
  return () => (typeof nav.getGamepads === 'function' ? nav.getGamepads() : []);
}

interface Actuator {
  playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>;
  reset?: () => Promise<unknown>;
}

function actuatorOf(nav: Navigator, padIndex: number): Actuator | null {
  if (typeof nav.getGamepads !== 'function') return null;
  const pad = nav.getGamepads()[padIndex] as (Gamepad & { vibrationActuator?: Actuator }) | null;
  return pad?.vibrationActuator ?? null;
}

/**
 * Dual-rumble through the Gamepad haptics API where the browser has it. Where it does not, or
 * the pad cannot vibrate, every call does nothing.
 */
export function navigatorRumble(nav: Navigator = navigator): RumblePort {
  return {
    play(padIndex, strong, weak, duration) {
      const actuator = actuatorOf(nav, padIndex);
      actuator
        ?.playEffect?.('dual-rumble', {
          startDelay: 0,
          duration: Math.max(0, Math.round(duration * 1000)),
          strongMagnitude: Math.min(1, Math.max(0, strong)),
          weakMagnitude: Math.min(1, Math.max(0, weak)),
        })
        .catch(() => {});
    },
    stop(padIndex) {
      actuatorOf(nav, padIndex)
        ?.reset?.()
        .catch(() => {});
    },
  };
}

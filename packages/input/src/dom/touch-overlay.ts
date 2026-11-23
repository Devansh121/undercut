import { TOUCH_BUTTONS, type Rect, type TouchButton, type TouchLayout } from '../sources/touch';
import type { InputSystem } from '../system';
import { icon, type IconName } from './icons';

/**
 * Touch controls drawn over the game, laid out as in the HUD mock's reserved regions for a
 * landscape phone: steering zone bottom left with gear buttons beside it, brake and throttle
 * bottom right with DRS and overtake beside them, camera and pause top right. Uses the design
 * tokens (the host page loads `tokens.css`) and keeps clear of the safe-area insets.
 */
const STYLE_ID = 'ut-touch-style';

const CSS = `
.ut-touch {
  --ut-l: max(var(--safe, 12px), env(safe-area-inset-left, 0px));
  --ut-r: max(var(--safe, 12px), env(safe-area-inset-right, 0px));
  --ut-t: max(var(--safe, 12px), env(safe-area-inset-top, 0px));
  --ut-b: max(var(--safe, 12px), env(safe-area-inset-bottom, 0px));
  --ut-hit: max(var(--touch-min, 48px), 48px);
  position: fixed; inset: 0; pointer-events: none; touch-action: none;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  font-family: var(--font-ui); color: var(--c-text-1); z-index: 10;
}
.ut-touch > * { position: absolute; pointer-events: auto; touch-action: none; }
.ut-touch__steer {
  left: var(--ut-l); bottom: var(--ut-b); width: 196px; height: 188px;
  border: 1px dashed rgba(242, 240, 235, 0.22); border-radius: var(--r-2);
}
.ut-touch__tag, .ut-touch__pedal span {
  font-size: var(--fs-10); font-weight: 600; font-stretch: var(--wdth-semi);
  letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--c-text-3);
  line-height: var(--lh-tight);
}
.ut-touch__tag { position: absolute; left: 10px; top: 8px; }
.ut-touch__base {
  position: absolute; left: 0; top: 0; width: 128px; height: 128px; border-radius: 50%;
  border: 2px solid rgba(242, 240, 235, 0.35); background: rgba(11, 12, 14, 0.35);
  transform: translate(34px, 42px);
}
.ut-touch__base::before {
  content: ""; position: absolute; left: 50%; top: 50%; width: 92px; height: 1px;
  transform: translate(-50%, -50%); background: rgba(242, 240, 235, 0.18);
}
.ut-touch__knob {
  position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px;
  border-radius: 50%; background: rgba(242, 240, 235, 0.85); box-shadow: var(--e-1);
}
.ut-touch__steer[data-held] .ut-touch__base { border-color: rgba(242, 240, 235, 0.6); }
.ut-touch__btn {
  display: grid; place-items: center; width: var(--ut-hit); height: var(--ut-hit);
  border-radius: var(--r-2); background: rgba(14, 16, 19, 0.78);
  border: 1px solid var(--c-line-strong); color: var(--c-text-1);
  font-weight: 750; font-stretch: var(--wdth-semi); font-size: var(--fs-11);
  letter-spacing: 0.06em; text-transform: uppercase;
  transition: background-color var(--t-instant) var(--ease-out);
}
.ut-touch__btn[data-held] { background: var(--c-ink-4); }
.ut-touch__btn .ut-icon { width: 20px; height: 20px; }
.ut-touch .ut-icon {
  fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: square; stroke-linejoin: miter;
}
.ut-touch__btn--gearUp { left: calc(var(--ut-l) + 208px); bottom: calc(var(--ut-b) + 60px); }
.ut-touch__btn--gearDown { left: calc(var(--ut-l) + 208px); bottom: var(--ut-b); }
.ut-touch__btn--drs {
  right: calc(var(--ut-r) + 172px); bottom: calc(var(--ut-b) + 60px); width: 56px;
  border-color: var(--c-drs); color: var(--c-drs);
}
.ut-touch__btn--overtake {
  right: calc(var(--ut-r) + 172px); bottom: var(--ut-b); width: 56px;
  border-color: var(--c-ers-deploy); color: var(--c-ers-deploy);
}
.ut-touch__btn--camera { right: calc(var(--ut-r) + 136px); top: var(--ut-t); }
.ut-touch__btn--pause { right: calc(var(--ut-r) + 136px); top: calc(var(--ut-t) + 56px); }
.ut-touch__pedal {
  bottom: var(--ut-b); width: 76px; height: 150px; border-radius: var(--r-2);
  background: rgba(14, 16, 19, 0.72); border: 1px solid var(--c-line-strong);
  display: grid; align-content: end; justify-items: center; padding-bottom: 10px;
}
.ut-touch__pedal::before {
  content: ""; position: absolute; left: 12px; right: 12px; top: 12px; bottom: 34px;
  border-radius: var(--r-1);
  background: repeating-linear-gradient(180deg, rgba(242, 240, 235, 0.16) 0 2px, transparent 2px 10px);
}
.ut-touch__fill {
  position: absolute; left: 12px; right: 12px; bottom: 34px; top: 12px; border-radius: var(--r-1);
  transform-origin: bottom; transform: scaleY(0); opacity: 0.85;
}
.ut-touch__pedal--throttle { right: var(--ut-r); height: 172px; }
.ut-touch__pedal--throttle .ut-touch__fill { background: var(--c-time-personal); }
.ut-touch__pedal--brake { right: calc(var(--ut-r) + 86px); }
.ut-touch__pedal--brake .ut-touch__fill { background: var(--c-time-invalid); }
`;

const BUTTONS: Record<TouchButton, { label: string; icon?: IconName; text?: string }> = {
  gearUp: { label: 'Gear up', icon: 'up' },
  gearDown: { label: 'Gear down', icon: 'down' },
  drs: { label: 'DRS', text: 'DRS' },
  overtake: { label: 'Overtake', text: 'OVT' },
  camera: { label: 'Next camera', icon: 'camera' },
  pause: { label: 'Pause', icon: 'pause' },
};

const BASE = 128;

export interface TouchOverlay {
  readonly element: HTMLElement;
  /** Redraw from the input state; call once per animation frame. */
  update(): void;
  /** Re-measure control positions (done automatically on resize). */
  measure(): void;
  destroy(): void;
}

export interface TouchOverlayOptions {
  /** Whether a button press may tap the vibration motor (the player's haptics setting). */
  haptics?: () => boolean;
}

export function mountTouchOverlay(
  host: HTMLElement,
  system: InputSystem,
  options: TouchOverlayOptions = {},
): TouchOverlay {
  const doc = host.ownerDocument;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.append(style);
  }

  const root = doc.createElement('div');
  root.className = 'ut-touch';
  root.dataset.testid = 'touch-overlay';

  const steer = doc.createElement('div');
  steer.className = 'ut-touch__steer';
  steer.dataset.control = 'steer';
  steer.setAttribute('aria-label', 'Steering');
  const tag = doc.createElement('span');
  tag.className = 'ut-touch__tag';
  tag.textContent = 'Steer';
  const base = doc.createElement('div');
  base.className = 'ut-touch__base';
  const knob = doc.createElement('div');
  knob.className = 'ut-touch__knob';
  base.append(knob);
  steer.append(tag, base);
  root.append(steer);

  const buttons = {} as Record<TouchButton, HTMLElement>;
  for (const name of TOUCH_BUTTONS) {
    const spec = BUTTONS[name];
    const el = doc.createElement('div');
    el.className = `ut-touch__btn ut-touch__btn--${name}`;
    el.dataset.control = name;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', spec.label);
    if (spec.icon) el.append(icon(spec.icon, doc));
    else el.textContent = spec.text ?? '';
    buttons[name] = el;
    root.append(el);
  }

  const pedal = (name: 'throttle' | 'brake', label: string): [HTMLElement, HTMLElement] => {
    const el = doc.createElement('div');
    el.className = `ut-touch__pedal ut-touch__pedal--${name}`;
    el.dataset.control = name;
    el.setAttribute('aria-label', label);
    const fill = doc.createElement('div');
    fill.className = 'ut-touch__fill';
    const text = doc.createElement('span');
    text.textContent = label;
    el.append(fill, text);
    root.append(el);
    return [el, fill];
  };
  const [brake, brakeFill] = pedal('brake', 'Brake');
  const [throttle, throttleFill] = pedal('throttle', 'Throttle');

  host.append(root);

  const rel = (el: HTMLElement, origin: DOMRect): Rect => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left - origin.left,
      top: r.top - origin.top,
      width: r.width,
      height: r.height,
    };
  };
  const measure = (): void => {
    const origin = root.getBoundingClientRect();
    const layout: TouchLayout = {
      steer: rel(steer, origin),
      throttle: rel(throttle, origin),
      brake: rel(brake, origin),
      buttons: {},
    };
    for (const name of TOUCH_BUTTONS) layout.buttons[name] = rel(buttons[name], origin);
    system.touch.setLayout(layout);
  };

  const local = (event: PointerEvent): [number, number] => {
    const origin = root.getBoundingClientRect();
    return [event.clientX - origin.left, event.clientY - origin.top];
  };
  const onDown = (event: PointerEvent): void => {
    measure();
    const [x, y] = local(event);
    if (system.touch.pointerDown(event.pointerId, x, y)) {
      event.preventDefault();
      if ((event.target as Element).closest('.ut-touch__btn') && (options.haptics?.() ?? true)) {
        try {
          doc.defaultView?.navigator.vibrate?.(8);
        } catch {
          /* Haptics are optional. */
        }
      }
      const target = event.target;
      if (target instanceof Element) {
        try {
          target.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointers cannot be captured; moves still arrive through the root.
        }
      }
    }
  };
  const onMove = (event: PointerEvent): void => {
    const [x, y] = local(event);
    system.touch.pointerMove(event.pointerId, x, y);
  };
  const onUp = (event: PointerEvent): void => system.touch.pointerUp(event.pointerId);
  const noMenu = (event: Event): void => event.preventDefault();

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('lostpointercapture', onUp);
  root.addEventListener('contextmenu', noMenu);
  const view = doc.defaultView;
  view?.addEventListener('resize', measure);
  measure();

  const update = (): void => {
    const t = system.touch;
    const layout = t.layout;
    const stick = t.stick;
    if (stick.pointer !== null && layout) {
      steer.dataset.held = '';
      const zone = layout.steer;
      const half = BASE / 2;
      const cx = Math.min(Math.max(stick.originX - zone.left, half), zone.width - half);
      const cy = Math.min(Math.max(stick.originY - zone.top, half), zone.height - half);
      base.style.transform = `translate(${cx - half}px, ${cy - half}px)`;
      const radius = system.profile.shaping.touch.stickRadius;
      knob.style.transform = `translateX(${stick.deflection * radius}px)`;
    } else {
      delete steer.dataset.held;
      base.style.transform = '';
      knob.style.transform = '';
    }
    throttleFill.style.transform = `scaleY(${t.throttle.value})`;
    brakeFill.style.transform = `scaleY(${t.brake.value})`;
    for (const name of TOUCH_BUTTONS) {
      if (t.buttons[name] !== null) buttons[name].dataset.held = '';
      else delete buttons[name].dataset.held;
    }
  };

  return {
    element: root,
    update,
    measure,
    destroy() {
      view?.removeEventListener('resize', measure);
      root.remove();
      system.touch.setLayout(null);
    },
  };
}

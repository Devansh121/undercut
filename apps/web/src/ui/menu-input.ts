/**
 * The menus' input loop: while no session is driving, sample the input layer in its menu
 * context every animation frame and pass menu actions on. Keeps the prompt glyphs on the active
 * device. A key that the browser already turns into a click (Enter or Space on a focused button)
 * is reported as native so it is not activated twice.
 */
import type { DeviceKind, InputSystem, MenuButton } from '@undercut/input';
import { setGlyphContext } from './kit/glyph';

const MENU: ReadonlySet<string> = new Set<MenuButton>([
  'menuUp',
  'menuDown',
  'menuLeft',
  'menuRight',
  'menuAccept',
  'menuBack',
  'menuTabPrev',
  'menuTabNext',
]);

export interface MenuInputHandler {
  action(action: MenuButton, nativeAccept: boolean, device: DeviceKind): void;
  device?(device: DeviceKind): void;
}

export class MenuInput {
  private handle = 0;
  private last: number | null = null;
  private running = false;
  private device: DeviceKind;

  constructor(
    private readonly input: InputSystem,
    private readonly handler: MenuInputHandler,
  ) {
    this.device = input.activeDevice;
    setGlyphContext(this.device, input.profile.bindings);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = null;
    this.input.setContext('menu');
    // Drop presses that belong to whatever came before (the drive screen's last frame).
    this.input.releaseAll();
    this.input.sample(0, 0);
    this.handle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  /** Re-read bindings into the glyphs (after a rebinding). */
  refreshGlyphs(): void {
    setGlyphContext(this.device, this.input.profile.bindings);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const dt = this.last === null ? 0 : Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const f = this.input.sample(dt, 0);
    if (f.device !== this.device) {
      this.device = f.device;
      setGlyphContext(f.device, this.input.profile.bindings);
      this.handler.device?.(f.device);
    }
    for (const e of f.events) {
      if (e.type !== 'action' || !MENU.has(e.action)) continue;
      const active = document.activeElement;
      const native =
        f.device === 'keyboard' &&
        e.action === 'menuAccept' &&
        (active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement);
      this.handler.action(e.action as MenuButton, native, f.device);
      if (!this.running) return;
    }
    this.handle = requestAnimationFrame(this.frame);
  };
}

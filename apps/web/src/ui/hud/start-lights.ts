/**
 * On-screen start-lights gantry panel (top centre during grid, five red lights, lights out,
 * and jump-start indication). Built once; writes only changed state.
 */
import { Text, el, setClass, setData } from '../dom';
import type { StartLightsState } from './race-display-model';

export class StartLightsPanel {
  readonly root: HTMLElement;
  private readonly gantry: HTMLElement;
  private readonly pods: HTMLElement[] = [];
  private readonly caption: Text;
  private readonly captionEl: HTMLElement;
  private readonly jumpEl: HTMLElement;
  private readonly jumpText: Text;
  private lastLit = -1;
  private lastAria = '';

  constructor() {
    const root = el('section', 'hud-lights panel');
    root.dataset.testid = 'start-lights';
    root.setAttribute('role', 'status');
    root.hidden = true;
    this.root = root;

    this.gantry = el('div', 'hud-lights__gantry');
    this.gantry.setAttribute('role', 'img');
    this.gantry.setAttribute('aria-label', 'Start lights');
    for (let i = 0; i < 5; i++) {
      const pod = el('div', 'hud-lights__pod');
      pod.dataset.pod = String(i + 1);
      pod.append(el('i', 'hud-lights__lamp'), el('i', 'hud-lights__lamp'));
      this.pods.push(pod);
      this.gantry.append(pod);
    }

    this.captionEl = el('div', 'hud-lights__caption label');
    this.captionEl.dataset.testid = 'start-lights-caption';
    this.caption = new Text(this.captionEl);

    this.jumpEl = el('div', 'hud-lights__jump');
    this.jumpEl.dataset.testid = 'jump-start';
    this.jumpEl.hidden = true;
    const jumpBody = el('span', '');
    this.jumpText = new Text(jumpBody);
    this.jumpEl.append(el('strong', '', 'Jump start'), jumpBody);

    root.append(this.gantry, this.captionEl, this.jumpEl);
  }

  update(s: StartLightsState | null): void {
    const show = s !== null && s.visible;
    if (this.root.hidden !== !show) this.root.hidden = !show;
    if (!show || !s) return;

    if (s.lit !== this.lastLit) {
      this.lastLit = s.lit;
      setData(this.root, 'lights', String(s.lit));
      for (let i = 0; i < 5; i++) {
        setClass(this.pods[i]!, 'is-lit', i < s.lit);
      }
    }
    const state = s.lightsOut ? 'out' : s.phase === 'lights' ? 'lights' : 'grid';
    setData(this.root, 'state', state);

    const aria = s.lightsOut
      ? 'Start lights out'
      : s.phase === 'lights'
        ? `Start lights: ${s.lit} of 5 lit`
        : 'On the starting grid';
    if (aria !== this.lastAria) {
      this.lastAria = aria;
      this.gantry.setAttribute('aria-label', aria);
    }

    const hasCaption = s.caption !== '';
    if (this.captionEl.hidden !== !hasCaption) this.captionEl.hidden = !hasCaption;
    if (hasCaption) this.caption.set(s.caption);

    const hasJump = s.jumpStart !== null;
    if (this.jumpEl.hidden !== !hasJump) this.jumpEl.hidden = !hasJump;
    if (s.jumpStart) {
      setClass(this.jumpEl, 'is-player', s.jumpStart.player);
      this.jumpText.set(
        s.jumpStart.player
          ? `+${s.jumpStart.seconds} s penalty`
          : `${s.jumpStart.code} · +${s.jumpStart.seconds} s`,
      );
    }
  }
}

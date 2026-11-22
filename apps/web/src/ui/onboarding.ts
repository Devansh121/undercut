import type { ControlsSource } from './controls-help';
import { controlRows } from './controls-help';
import { el } from './dom';
import { button } from './kit/components';
import { S } from './strings';

const KEY = 'onboarding.v1';
let finished = false;
function wasFinished(): boolean {
  try {
    return finished || localStorage.getItem(KEY) === 'done';
  } catch {
    return finished;
  }
}

/** A small first-lap coach; driving and all pause controls remain available. */
export class Onboarding {
  readonly root = el('aside', 'onboarding');
  private readonly text = el('p');
  private readonly title = el('strong');
  private step = 0;
  private device = '';
  constructor(private readonly source: ControlsSource) {
    this.root.dataset.testid = 'onboarding';
    this.root.setAttribute('aria-label', S.intro.title);
    const next = button({
      label: S.intro.next,
      action: 'intro-next',
      onClick: () => this.advance(),
    });
    const skip = button({
      label: S.intro.skip,
      variant: 'quiet',
      action: 'intro-skip',
      onClick: () => this.finish(),
    });
    this.root.append(this.title, this.text, next, skip);
    this.root.hidden = wasFinished();
    this.paint();
  }
  replay(): void {
    this.step = 0;
    this.root.hidden = false;
    this.paint();
  }
  private advance(): void {
    if (++this.step >= 4) this.finish();
    else this.paint();
  }
  finish(): void {
    this.root.hidden = true;
    finished = true;
    try {
      localStorage.setItem(KEY, 'done');
    } catch {
      /* Keep the choice for this page. */
    }
  }
  brakingCue(on: boolean): void {
    this.root.classList.toggle('is-braking', on && this.step === 1);
    if (this.step === 1) this.title.textContent = on ? S.intro.brakeNow : `${S.intro.title} · 2/4`;
  }
  update(braking: boolean, invalid: boolean, paused: boolean, lapComplete: boolean): void {
    if (this.root.hidden) return;
    if (lapComplete) {
      this.finish();
      return;
    }
    if (this.device !== this.source.device()) this.paint();
    if ((this.step === 1 && braking) || (this.step === 2 && invalid) || (this.step === 3 && paused))
      this.advance();
  }
  private paint(): void {
    this.device = this.source.device();
    this.title.textContent = `${S.intro.title} · ${this.step + 1}/4`;
    this.text.textContent =
      [
        S.intro.controls(
          ...((['steer', 'brake', 'throttle', 'pause'] as const).map(
            (id) =>
              controlRows(this.source.bindings(), this.source.device()).find((r) => r.id === id)
                ?.input ?? '',
          ) as [string, string, string, string]),
        ),
        S.intro.brake,
        S.intro.limits,
        S.intro.pause,
      ][this.step] ?? '';
  }
}

import { COACH_STEPS, CoachSteps, type CoachFrame } from './coach-steps';
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

/**
 * A small first-lap coach; driving and all pause controls remain available. Each tip moves on
 * by itself (see CoachSteps); the buttons are a shortcut for a mouse, and are hidden on a
 * phone, where the card lets touches through to the controls under it.
 */
export class Onboarding {
  readonly root = el('aside', 'onboarding');
  private readonly text = el('p');
  private readonly title = el('strong');
  private readonly steps = new CoachSteps(wasFinished());
  private device = '';
  private cue = false;
  private shownTitle = '';
  /** `race`: a race, not a lap session: the track-limits tip speaks of strikes and penalties. */
  constructor(
    private readonly source: ControlsSource,
    private readonly race = false,
  ) {
    this.root.dataset.testid = 'onboarding';
    this.root.setAttribute('aria-label', S.intro.title);
    this.root.setAttribute('aria-live', 'polite');
    const next = button({
      label: S.intro.next,
      action: 'intro-next',
      onClick: () => {
        this.steps.advance();
        if (this.steps.done) this.finish();
        else this.paint();
      },
    });
    const skip = button({
      label: S.intro.skip,
      variant: 'quiet',
      action: 'intro-skip',
      onClick: () => this.finish(),
    });
    const actions = el('div', 'onboarding__actions');
    actions.append(next, skip);
    this.root.append(this.title, this.text, actions);
    this.root.hidden = this.steps.done;
    if (!this.steps.done) this.paint();
  }

  /** True while the coach is showing (not finished or skipped). */
  get active(): boolean {
    return !this.steps.done;
  }

  replay(): void {
    this.steps.restart();
    this.cue = false;
    this.root.classList.remove('is-braking');
    this.root.hidden = false;
    this.paint();
  }

  finish(): void {
    this.steps.finish();
    this.root.hidden = true;
    finished = true;
    try {
      localStorage.setItem(KEY, 'done');
    } catch {
      /* Keep the choice for this page. */
    }
  }

  /** Once a frame. Touches the DOM only when something it shows has changed. */
  update(f: CoachFrame): void {
    if (this.steps.done) return;
    const changed = this.steps.update(f);
    if (this.steps.done) {
      this.finish();
      return;
    }
    if (changed || this.device !== this.source.device()) this.paint();
    const cue = f.cue && this.steps.step === 1;
    if (cue !== this.cue) {
      this.cue = cue;
      this.root.classList.toggle('is-braking', cue);
      this.paintTitle();
    }
  }

  private input(id: 'steer' | 'brake' | 'throttle' | 'pause'): string {
    return (
      controlRows(this.source.bindings(), this.source.device()).find((r) => r.id === id)?.input ??
      ''
    );
  }

  private paintTitle(): void {
    const title = `${this.cue ? S.intro.brakeNow : S.intro.title} · ${this.steps.step + 1}/${COACH_STEPS}`;
    if (title === this.shownTitle) return;
    this.shownTitle = title;
    this.title.textContent = title;
  }

  private paint(): void {
    this.device = this.source.device();
    this.paintTitle();
    this.text.textContent =
      [
        () =>
          S.intro.controls(
            this.input('steer'),
            this.input('brake'),
            this.input('throttle'),
            this.input('pause'),
          ),
        () => S.intro.brake(this.input('brake')),
        () => (this.race ? S.intro.limitsRace : S.intro.limits),
        () => S.intro.pause(this.input('pause')),
      ][this.steps.step]?.() ?? '';
  }
}

import { formatDelta, formatLapTime } from '../game/format';
import type { LapResult } from '../game/timing';
import { el } from './dom';

/** How long the strip stays up after a lap, in real seconds. */
const SHOW_FOR = 7;

/**
 * A results strip shown when a lap completes: lap number, time, delta to the previous best,
 * the three sectors in their timing colours, and a tag for a personal best or a record.
 */
export class ResultsStrip {
  readonly root: HTMLElement;
  private readonly lap: HTMLElement;
  private readonly time: HTMLElement;
  private readonly delta: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly sectors: HTMLElement[] = [];
  private left = 0;

  constructor() {
    const root = el('section', 'results');
    root.dataset.testid = 'results';
    root.setAttribute('aria-live', 'polite');
    root.hidden = true;
    this.root = root;
    this.lap = el('span', 'label results__lap');
    this.time = el('b', 'num results__time');
    this.delta = el('span', 'num results__delta');
    this.tag = el('span', 'results__tag');
    const secs = el('div', 'results__sectors');
    for (let i = 0; i < 3; i++) {
      const s = el('span', 'results__sector num');
      secs.append(s);
      this.sectors.push(s);
    }
    root.append(this.lap, this.time, this.delta, secs, this.tag);
  }

  show(r: LapResult): void {
    this.lap.textContent = `Lap ${r.lap}`;
    this.time.textContent = formatLapTime(r.time);
    this.time.dataset.tone = r.class;
    this.delta.textContent = r.deltaToBest === null ? '' : formatDelta(r.deltaToBest);
    this.delta.dataset.tone = r.deltaToBest !== null && r.deltaToBest < 0 ? 'good' : 'bad';
    r.sectors.forEach((t, i) => {
      const s = this.sectors[i];
      if (!s) return;
      s.textContent = formatLapTime(t, true);
      s.dataset.tone = r.sectorClasses[i] ?? '';
    });
    const tag = !r.valid ? 'Invalid' : r.record ? 'Record' : r.personalBest ? 'Session best' : '';
    this.tag.textContent = tag;
    this.tag.dataset.tone = !r.valid ? 'invalid' : r.record ? 'overall' : 'personal';
    this.tag.hidden = tag === '';
    this.root.hidden = false;
    this.left = SHOW_FOR;
  }

  /** Count down in real seconds; hides itself when done. */
  tick(dt: number): void {
    if (this.root.hidden) return;
    this.left -= dt;
    if (this.left <= 0) this.root.hidden = true;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

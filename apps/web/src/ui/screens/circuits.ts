/**
 * Circuit select: one card per circuit whose track data is in this build, with the plan drawn
 * from the track file, its facts and the lap record kept on this device. Choosing one returns to
 * the main menu with it selected.
 */
import { formatLapTime } from '../../game/format';
import type { RecordStore } from '../../game/records';
import { el } from '../dom';
import type { CircuitSummary } from '../data/circuit-summary';
import type { PrefsStore } from '../data/prefs';
import { button } from '../kit/components';
import type { Screen } from '../shell';
import { S } from '../strings';
import { circuitArt, circuitName } from './circuit-art';

export class CircuitSelectScreen implements Screen {
  readonly id = 'circuits';
  readonly crumb = S.circuit.select;
  readonly root: HTMLElement;
  private readonly cards = new Map<string, HTMLButtonElement>();
  private readonly records = new Map<string, HTMLElement>();

  constructor(
    circuits: readonly CircuitSummary[],
    private readonly prefs: PrefsStore,
    private readonly store: RecordStore,
    private readonly done: () => void,
  ) {
    const root = el('div', 'screen circuits');
    this.root = root;
    const grid = el('div', 'circuits__grid');
    grid.dataset.navGroup = '';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', S.circuit.select);
    circuits.forEach((c, i) => {
      const b = el('button', 'ccard');
      b.type = 'button';
      b.dataset.nav = '';
      b.dataset.circuit = c.id;
      b.setAttribute('role', 'radio');
      const art = el('div', 'ccard__art');
      art.append(circuitArt(c.plan));
      const head = el('div', 'ccard__head');
      head.append(
        el('span', 'label', S.circuit.round(i + 1, c.country)),
        circuitName('ccard__name', c.name),
      );
      // No AI racing line here yet: race modes are not available, Time Trial is.
      if (!c.raceReady) head.append(el('span', 'ccard__tag', S.circuit.timeTrialOnly));
      const facts = el('dl', 'ccard__facts');
      const fact = (k: string, v: string): void => {
        const d = el('div', 'ccard__fact');
        d.append(el('dt', 'label', k), el('dd', 'num', v));
        facts.append(d);
      };
      fact(S.circuit.length, `${(c.length / 1000).toFixed(3)} ${S.circuit.km}`);
      fact(S.circuit.turns, String(c.corners));
      fact(
        S.circuit.direction,
        c.direction === 'clockwise' ? S.circuit.clockwise : S.circuit.anticlockwise,
      );
      fact(S.circuit.laps, String(c.raceLaps));
      const rec = el('div', 'ccard__record');
      const recValue = el('b', 'num', S.menu.noRecord);
      rec.append(el('span', 'label', S.circuit.record), recValue);
      this.records.set(c.id, recValue);
      b.append(art, head, facts, rec);
      b.addEventListener('click', () => {
        this.prefs.update((p) => {
          p.circuit = c.id;
        });
        this.done();
      });
      this.cards.set(c.id, b);
      grid.append(b);
    });
    const foot = el('footer', 'actionbar');
    const note = el('div', 'actionbar__summary');
    if (circuits.length < 3) note.append(el('span', 'actionbar__part', S.circuit.onlyOne));
    const btns = el('div', 'actionbar__buttons');
    btns.append(
      button({ label: S.menu.back, glyph: 'menuBack', action: 'back', onClick: () => this.done() }),
    );
    foot.append(note, btns);
    const body = el('div', 'circuits__body');
    body.append(el('h1', 'screen__title', S.circuit.select), grid);
    root.append(body, foot);
  }

  enter(): void {
    const current = this.prefs.get().circuit;
    for (const [id, b] of this.cards) {
      b.setAttribute('aria-checked', String(id === current));
      if (id === current) b.dataset.navDefault = '';
      else delete b.dataset.navDefault;
    }
    void (async () => {
      for (const [id, node] of this.records) {
        const r = await this.store.load(id);
        node.textContent = r ? formatLapTime(r.lap) : S.menu.noRecord;
        node.classList.toggle('is-empty', !r);
      }
    })();
  }

  back(): boolean {
    this.done();
    return true;
  }
}

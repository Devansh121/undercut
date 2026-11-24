import type { SessionResult } from '@undercut/race';
import type { StoragePort } from '@undercut/input';
import type { WeekendProgress } from '../../game/weekend';
import { classificationTable, sessionName } from '../classification';
import type { QuickRaceOptions } from '../../game/session';
import { el } from '../dom';
import { TEAMS } from '../data/teams';
import { button } from '../kit/components';
import type { Screen } from '../shell';
import type { SessionChoice } from './hub';

export class WeekendScreen implements Screen {
  readonly id = 'weekend';
  readonly crumb: string;
  readonly root = el('section', 'weekend-screen');
  constructor(
    readonly progress: WeekendProgress,
    private readonly port: StoragePort,
    private readonly start: (
      choice: SessionChoice,
      options: QuickRaceOptions,
      complete: (result: SessionResult) => void,
    ) => void,
    private readonly backToMenu: () => void,
  ) {
    this.crumb = progress.championship ? 'Championship' : 'Race Weekend';
    this.render();
  }
  enter(): void {
    this.render();
  }
  private render(): void {
    const p = this.progress;
    const w = p.weekend;
    const spec = w.next();
    const circuit = w.plan.circuit;
    const title = el('h1', 'screen-title', this.crumb);
    const summary = el(
      'p',
      'label',
      `${circuit.toUpperCase()} · ${p.laps} laps · 20 cars · two compounds required`,
    );
    const schedule = el('div', 'weekend-schedule');
    w.schedule.forEach((s, i) =>
      schedule.append(
        el(
          'div',
          `card ${i === w.results.length ? 'is-current' : ''}`,
          `${i + 1}  ${sessionName(s.kind)}${s.kind === 'practice' ? ' · 5 min' : s.kind === 'qualifying' ? ' · 18 min' : ''}${i < w.results.length ? ' · Complete' : ''}`,
        ),
      ),
    );
    const actions = el('div', 'weekend-actions');
    if (p.championship?.done)
      actions.append(
        button({
          label: 'New season',
          action: 'new-season',
          onClick: () => {
            p.restartSeason();
            void p.save(this.port);
            this.render();
          },
        }),
      );
    if (spec)
      actions.append(
        button({
          label: `Start ${sessionName(spec.kind)}`,
          variant: 'primary',
          action: 'weekend-start',
          onClick: () => {
            this.start(
              { ...p.choice, circuit },
              { laps: p.laps, session: spec, grid: w.grid(), pitStrategy: true },
              (result) => {
                p.complete(result);
                void p.save(this.port);
              },
            );
          },
        }),
      );
    if (spec?.kind === 'practice')
      actions.append(
        button({
          label: 'Skip Practice',
          action: 'skip-practice',
          onClick: () => {
            p.skipPractice();
            void p.save(this.port);
            this.render();
          },
        }),
      );
    if (w.done && p.championship && !p.championship.done)
      actions.append(
        button({
          label: 'Next circuit',
          variant: 'primary',
          action: 'next-round',
          onClick: () => {
            p.nextRound();
            void p.save(this.port);
            this.render();
          },
        }),
      );
    actions.append(
      button({ label: 'Main menu', action: 'weekend-back', onClick: this.backToMenu }),
    );
    const results = el('div', 'weekend-tables');
    const last = w.results.at(-1);
    if (last) {
      const table = classificationTable(last, { points: last.kind === 'race' });
      table.classList.add('weekend-table');
      table.prepend(el('caption', 'label', `${sessionName(last.kind)} classification`));
      results.append(table);
    }
    if (p.championship?.round) {
      results.append(
        el(
          'h2',
          'card__title',
          `Standings · round ${p.championship.round} / 3${p.championship.done ? ' · Season complete' : ''}`,
        ),
      );
      const names = last ?? p.championship.toJSON().rounds.at(-1)?.result;
      const table = standingsTable('Drivers', 'Driver');
      p.championship.drivers().forEach((s, i) => {
        const name = names?.entries.find((e) => e.id === s.id)?.name ?? s.id;
        table.tBodies[0]!.append(standingsRow(i + 1, name, s.points, s.id === 'player'));
      });
      results.append(table);
      const teamTable = standingsTable('Teams', 'Team');
      const teams = [...TEAMS].sort((a, b) =>
        a.id === p.choice.team ? -1 : b.id === p.choice.team ? 1 : 0,
      );
      p.championship.teams(names?.entries ?? []).forEach((standing, i) => {
        const team = teams[Number(standing.id)];
        teamTable.tBodies[0]!.append(
          standingsRow(
            i + 1,
            team?.name ?? standing.id,
            standing.points,
            Number(standing.id) === 0,
          ),
        );
      });
      results.append(teamTable);
    }
    this.root.replaceChildren(
      title,
      summary,
      ...(p.championship
        ? [el('p', 'label', 'Monza / Spa-Francorchamps / Singapore Marina Bay')]
        : []),
      schedule,
      el(
        'p',
        'weekend-note',
        spec?.kind === 'practice'
          ? 'Practice is optional. Qualifying decides the race grid.'
          : spec?.kind === 'qualifying'
            ? 'Your best valid lap decides the race grid. Untimed cars start at the back.'
            : spec?.kind === 'race'
              ? 'Start on mediums. Use another compound before the finish. No refuelling.'
              : 'Classification includes time penalties. Points use count-back to break ties.',
      ),
      actions,
      ...(!p.durable ? [el('p', '', 'Storage unavailable. Progress lasts for this visit.')] : []),
      results,
    );
  }
}

/** A championship standings table: caption, header row, an empty body. */
function standingsTable(caption: string, who: string): HTMLTableElement {
  const table = el('table', 'classification weekend-table');
  table.append(el('caption', 'label', caption));
  const head = el('tr');
  head.append(el('th', 'num', 'Pos'), el('th', '', who), el('th', 'num', 'Pts'));
  const thead = el('thead');
  thead.append(head);
  table.append(thead, el('tbody'));
  return table;
}

function standingsRow(pos: number, name: string, points: number, player: boolean): HTMLElement {
  const row = el('tr', player ? 'is-player' : '');
  row.append(el('td', 'num', String(pos)), el('td', '', name), el('td', 'num', String(points)));
  return row;
}

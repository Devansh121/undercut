import type { SessionResult } from '@undercut/race';
import type { StoragePort } from '@undercut/input';
import type { WeekendProgress } from '../../game/weekend';
import { formatLapTime } from '../../game/format';
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
          `${i + 1}  ${s.kind === 'practice' ? 'Practice · 5 min' : s.kind === 'qualifying' ? 'Qualifying · 18 min' : 'Race'}${i < w.results.length ? ' · Complete' : ''}`,
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
          label: `Start ${spec.kind}`,
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
          label: 'Skip practice',
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
      const table = el('table', 'weekend-table');
      const caption = el('caption', 'label', `${last.kind} classification`);
      table.append(caption);
      for (const e of last.entries) {
        const row = el('tr', e.car === 0 ? 'is-player' : '');
        for (const v of [
          String(e.position),
          e.name,
          last.kind === 'race'
            ? `${e.status === 'finished' ? `${e.points} pts` : e.status === 'dsq' ? 'Disqualified' : e.status === 'dnf' ? 'Retired' : 'Not classified'} · ${e.pitStops} stops · ${e.compounds.join(' / ')}${e.penaltyTime ? ` · +${e.penaltyTime.toFixed(1)} s penalty` : ''}`
            : formatLapTime(e.bestLap),
        ])
          row.append(el('td', '', v));
        table.append(row);
      }
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
      const table = el('table', 'weekend-table');
      table.append(el('caption', 'label', 'Drivers'));
      p.championship.drivers().forEach((s, i) => {
        const row = el('tr', s.id === 'player' ? 'is-player' : '');
        const name = names?.entries.find((e) => e.id === s.id)?.name ?? s.id;
        for (const v of [String(i + 1), name, `${s.points} pts`]) row.append(el('td', '', v));
        table.append(row);
      });
      results.append(table);
      const teamTable = el('table', 'weekend-table');
      teamTable.append(el('caption', 'label', 'Teams'));
      const teams = [...TEAMS].sort((a, b) =>
        a.id === p.choice.team ? -1 : b.id === p.choice.team ? 1 : 0,
      );
      p.championship.teams(names?.entries ?? []).forEach((standing, i) => {
        const team = teams[Number(standing.id)];
        const row = el('tr', Number(standing.id) === 0 ? 'is-player' : '');
        for (const value of [String(i + 1), team?.name ?? standing.id, `${standing.points} pts`])
          row.append(el('td', '', value));
        teamTable.append(row);
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

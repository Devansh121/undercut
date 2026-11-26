import { el } from './dom';

/** The legacy hidden readout and visible standings have different DOM representations. */
export class RaceStatusReadout {
  private hiddenKey = '';
  private rowsKey = '';

  constructor(private readonly root: HTMLElement) {}

  hiddenText(lines: readonly string[]): void {
    const key = lines.join('\n');
    if (key === this.hiddenKey) return;
    this.hiddenKey = key;
    this.rowsKey = '';
    this.root.textContent = key;
  }

  /** Returns true when rows were rebuilt, so the caller can restore the player's scroll. */
  rows(lines: readonly string[], player: number): boolean {
    const key = `${player}:${lines.join('\n')}`;
    this.hiddenKey = '';
    if (key === this.rowsKey) return false;
    this.rowsKey = key;
    this.root.replaceChildren(
      ...lines.map((text, i) => {
        const row = el(
          'div',
          i === 0 && lines.length > 1 ? 'race-status__head' : 'race-status__row',
          text,
        );
        if (i === player) row.classList.add('is-player');
        return row;
      }),
    );
    return true;
  }

  clear(): void {
    this.hiddenKey = '';
    this.rowsKey = '';
  }
}

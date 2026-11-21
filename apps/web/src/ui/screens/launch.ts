/**
 * The launch screen (design/mock/menu.html#launch): the name set large over the vermilion
 * stripe field, one line about the game, and "press any key". Any key, pad button, click or tap
 * opens the main menu; that first gesture is also the one that may start audio.
 */
import { GAME_NAME } from '@undercut/core';
import { el } from '../dom';
import { DRIVER_COUNT, TEAMS } from '../data/teams';
import { glyph } from '../kit/glyph';
import type { NavAction } from '../kit/nav';
import type { Screen } from '../shell';
import { S } from '../strings';

export class LaunchScreen implements Screen {
  readonly id = 'launch';
  readonly crumb = GAME_NAME;
  readonly bare = true;
  readonly root: HTMLElement;
  private readonly press: HTMLButtonElement;
  private armed = false;

  constructor(
    buildHash: string,
    private readonly go: () => void,
  ) {
    const root = el('main', 'screen launch');
    root.setAttribute('aria-labelledby', 'launch-title');
    this.root = root;
    const stage = el('div', 'launch__stage');
    stage.append(el('div', 'launch__stripe'));
    const title = el('h1', 'launch__title', GAME_NAME);
    title.id = 'launch-title';
    stage.append(title, el('p', 'launch__tagline', S.launch.tagline(TEAMS.length, DRIVER_COUNT)));
    const bar = el('div', 'launch__bar');
    this.press = el('button', 'launch__press');
    this.press.type = 'button';
    this.press.dataset.nav = '';
    this.press.dataset.navDefault = '';
    this.press.dataset.action = 'press-start';
    this.press.append(glyph('menuAccept'), el('span', 'launch__press-text', S.launch.press));
    this.press.addEventListener('click', () => this.open());
    const build = el('span', 'label launch__build');
    build.append(`${S.launch.build} `, el('code', 'num', buildHash));
    bar.append(this.press, build);
    root.append(stage, bar);
    // Any key or tap, not only the bound ones.
    root.addEventListener('pointerup', (e) => {
      if (e.target !== this.press && !this.press.contains(e.target as Node)) this.open();
    });
  }

  enter(): void {
    // Ignore the key that may still be down from the screen before.
    this.armed = false;
    window.setTimeout(() => {
      this.armed = true;
    }, 150);
    window.addEventListener('keydown', this.onKey);
  }

  leave(): void {
    window.removeEventListener('keydown', this.onKey);
  }

  action(a: NavAction): boolean {
    if (a === 'menuBack') return false;
    this.open();
    return true;
  }

  back(): boolean {
    return true;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.key === 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    // Enter and Space on the focused prompt click it natively.
    if (document.activeElement === this.press && (e.key === 'Enter' || e.key === ' ')) return;
    this.open();
  };

  private open(): void {
    if (!this.armed) return;
    this.armed = false;
    this.go();
  }
}

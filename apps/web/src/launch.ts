import { GAME_NAME } from '@undercut/core';

export interface LaunchScreenOptions {
  buildHash: string;
}

/** The M0 launch screen: name, a Drive button that is not live yet, and the build. */
export function mountLaunchScreen(root: HTMLElement, { buildHash }: LaunchScreenOptions): void {
  const screen = el('main', 'launch');
  screen.setAttribute('aria-labelledby', 'launch-title');

  const brand = el('header', 'launch__brand');
  const title = el('h1', 'wordmark', GAME_NAME);
  title.id = 'launch-title';
  brand.append(title, el('p', 'launch__tagline', 'Open-wheel racing'));

  const actions = el('nav', 'launch__actions');
  actions.setAttribute('aria-label', 'Main');
  const drive = el('button', 'button button--primary');
  drive.type = 'button';
  drive.disabled = true;
  drive.dataset.action = 'drive';
  const note = el('span', 'button__note', 'Arrives in M1');
  note.id = 'drive-note';
  drive.setAttribute('aria-describedby', note.id);
  drive.append(el('span', 'button__label', 'Drive'), note);
  actions.append(drive);

  const build = el('footer', 'launch__build');
  build.append('Build ', el('code', '', buildHash));

  screen.append(brand, actions, build);
  root.replaceChildren(screen);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

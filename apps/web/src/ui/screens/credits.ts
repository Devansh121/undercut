/**
 * Credits: the licences of the code, data and assets the game ships, read from CREDITS.md and the
 * asset manifest at build time (this module is loaded only when the screen is opened). Each
 * section is one focus stop, so a pad or the arrow keys scroll through it section by section.
 */
import creditsMarkdown from '../../../../../CREDITS.md?raw';
import manifest from '../../../../../assets/MANIFEST.json';
import { el } from '../dom';
import { button, table } from '../kit/components';
import type { Screen } from '../shell';
import { S } from '../strings';
import {
  groupAssets,
  parseCredits,
  type Block,
  type Inline,
  type ManifestEntry,
} from './credits-model';

/**
 * Links follow with a mouse. On a touch screen they are text: a word-sized link is no touch
 * target, and the name (or the address, where the file gives one) is what matters there.
 */
const LINKS = !(window.matchMedia?.('(pointer: coarse)').matches ?? false);

function inlineNodes(parts: readonly Inline[]): Node[] {
  return parts.map((p) => {
    if (!p.href || !LINKS) return document.createTextNode(p.text);
    const a = el('a', 'credits__link', p.text);
    a.href = p.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  });
}

function cell(parts: readonly Inline[]): HTMLElement {
  const span = el('span');
  span.append(...inlineNodes(parts));
  return span;
}

export class CreditsScreen implements Screen {
  readonly id = 'credits';
  readonly crumb = S.credits.title;
  readonly root: HTMLElement;

  constructor(onBack: () => void) {
    const root = el('div', 'screen credits');
    root.dataset.testid = 'credits';
    this.root = root;
    const scroll = el('div', 'credits__scroll');

    let section: HTMLElement | null = null;
    let heading: string = S.credits.title;
    const open = (title: string, level: 2 | 3): HTMLElement => {
      const s = el('section', `card credits__section credits__section--h${level}`);
      // One focus stop per section: the D-pad and arrows move (and scroll) through them.
      s.dataset.nav = '';
      s.tabIndex = 0;
      s.setAttribute('aria-label', title);
      s.append(el(level === 2 ? 'h2' : 'h3', 'credits__title', title));
      scroll.append(s);
      return s;
    };

    // CREDITS.md's own opening paragraph (the code's licence) goes under this heading.
    const intro = open(S.credits.title, 2);

    const blocks: Block[] = parseCredits(creditsMarkdown);
    for (const b of blocks) {
      if (b.kind === 'heading') {
        heading = b.text;
        section = open(b.text, b.level);
      } else if (b.kind === 'paragraph') {
        const p = el('p', 'credits__p');
        p.append(...inlineNodes(b.parts));
        (section ?? intro).append(p);
      } else {
        const t = table({
          label: heading,
          columns: b.head.map((h, i) => ({
            label: h.map((x) => x.text).join(''),
            cell: (row: Inline[][]) => cell(row[i] ?? []),
          })),
          rows: b.rows,
        });
        const wrap = el('div', 'credits__table');
        wrap.append(t);
        (section ?? intro).append(wrap);
      }
    }

    const assets = open(S.credits.assets, 2);
    const list = el('dl', 'credits__assets');
    for (const g of groupAssets(manifest as ManifestEntry[])) {
      const row = el('div', 'credits__asset');
      row.append(
        el('dt', '', g.author),
        el(
          'dd',
          'num',
          [g.licence, S.credits.files(g.files), ...g.sources].filter(Boolean).join(' · '),
        ),
      );
      list.append(row);
    }
    assets.append(list);

    const foot = el('footer', 'actionbar');
    const btns = el('div', 'actionbar__buttons');
    btns.append(button({ label: S.menu.back, glyph: 'menuBack', action: 'back', onClick: onBack }));
    foot.append(el('div', 'actionbar__summary'), btns);
    root.append(scroll, foot);
  }
}

import type { CircuitPlan } from '../data/circuit-summary';
import { el, svg } from '../dom';

/**
 * A circuit's name as a heading. It may break only between words or after a hyphen
 * ("Spa-" / "Francorchamps"), never inside a word: a name with a long word steps down a size
 * (`data-len="long"`) so that word fits its column.
 */
export function circuitName(className: string, name: string): HTMLElement {
  const node = el('span', className, name);
  const longest = Math.max(...name.split(/[\s-]+/).map((w) => w.length));
  // A long word, or a long name that takes two lines anyway, steps down a size.
  if (longest >= 11 || name.length > 14) node.dataset.len = 'long';
  return node;
}

/**
 * A circuit plan as SVG: a wide dark casing, the line, the start line in the brand colour and
 * the corner numbers. `sectors` colours the three sectors (timing colours on results; plain
 * otherwise).
 */
export function circuitArt(
  plan: CircuitPlan,
  o: { labels?: boolean; sectors?: boolean } = {},
): SVGSVGElement {
  const s = svg('svg', {
    viewBox: `0 0 ${plan.width} ${plan.height}`,
    'aria-hidden': 'true',
    class: 'plan',
  });
  s.append(
    svg('path', { d: plan.path, class: 'plan__casing' }),
    svg('path', { d: plan.path, class: 'plan__line' }),
  );
  if (o.sectors) {
    plan.sectorPaths.forEach((d, i) =>
      s.append(svg('path', { d, class: `plan__sector plan__sector--${i + 1}` })),
    );
  }
  const [x1, y1, x2, y2] = plan.startLine;
  s.append(svg('line', { x1, y1, x2, y2, class: 'plan__start' }));
  if (o.labels !== false) {
    const g = svg('g', { class: 'plan__labels' });
    for (const l of plan.labels) {
      const t = svg('text', {
        x: l.x,
        y: l.y,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
      });
      t.textContent = String(l.n);
      g.append(t);
    }
    s.append(g);
  }
  return s;
}

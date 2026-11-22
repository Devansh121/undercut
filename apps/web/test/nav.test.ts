import { describe, expect, it } from 'vitest';
import { pickInDirection } from '../src/ui/kit/nav';

/** A DOMRect-like box. */
const box = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
  }) as DOMRect;

const el = (name: string): HTMLElement => ({ name }) as unknown as HTMLElement;

describe('spatial navigation', () => {
  // A 2 x 2 grid of cards beside a column of three rows.
  const rows = [el('row1'), el('row2'), el('row3')];
  const cards = [el('a'), el('b'), el('c'), el('d')];
  const items = [
    { el: rows[0]!, rect: box(0, 0, 200, 40) },
    { el: rows[1]!, rect: box(0, 50, 200, 40) },
    { el: rows[2]!, rect: box(0, 100, 200, 40) },
    { el: cards[0]!, rect: box(240, 0, 100, 60) },
    { el: cards[1]!, rect: box(350, 0, 100, 60) },
    { el: cards[2]!, rect: box(240, 70, 100, 60) },
    { el: cards[3]!, rect: box(350, 70, 100, 60) },
  ];
  const from = (name: string): DOMRect =>
    items.find((i) => (i.el as unknown as { name: string }).name === name)!.rect;
  const pick = (name: string, dir: 'up' | 'down' | 'left' | 'right') =>
    (
      pickInDirection(
        from(name),
        items.filter((i) => i.rect !== from(name)),
        dir,
      ) as unknown as { name: string } | null
    )?.name ?? null;

  it('moves within a grid and between columns by position', () => {
    expect(pick('a', 'right')).toBe('b');
    expect(pick('a', 'down')).toBe('c');
    expect(pick('d', 'left')).toBe('c');
    expect(pick('row2', 'right')).toBe('c');
    expect(pick('row1', 'right')).toBe('a');
    expect(pick('c', 'left')).toBe('row3');
    expect(pick('a', 'left')).toBe('row1');
  });

  it('stays put when nothing lies in that direction', () => {
    expect(pick('row1', 'up')).toBeNull();
    expect(pick('row1', 'left')).toBeNull();
    expect(pick('b', 'right')).toBeNull();
  });
});

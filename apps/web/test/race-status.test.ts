import { afterEach, expect, it, vi } from 'vitest';
import { RaceStatusReadout } from '../src/ui/race-status';

// Only the DOM operations used by this readout; children and text replace each other as in DOM.
class Node {
  children: Node[] = [];
  className = '';
  private text = '';
  classList = {
    add: (name: string) => {
      this.className += ` ${name}`;
    },
  };
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  replaceChildren(...nodes: Node[]): void {
    this.text = '';
    this.children = nodes;
  }
}

afterEach(() => vi.unstubAllGlobals());

it('builds visible rows even when the hidden text has exactly the same lines', () => {
  vi.stubGlobal('document', { createElement: () => new Node() });
  const root = new Node();
  const readout = new RaceStatusReadout(root as unknown as HTMLElement);
  const lines = ['Provisional', '1 Player', '2 Driver'];
  readout.hiddenText(lines);
  expect(root.children).toHaveLength(0);
  expect(readout.rows(lines, 1)).toBe(true);
  expect(root.children).toHaveLength(3);
  expect(root.children[1]!.className).toContain('is-player');
  expect(readout.rows(lines, 1)).toBe(false);
  readout.hiddenText(lines);
  expect(root.children).toHaveLength(0);
  expect(readout.rows(lines, 2)).toBe(true);
  expect(root.children[2]!.className).toContain('is-player');
});

/**
 * "Every control's text stays inside its box", as one check for any screen. Run in the page
 * (`page.evaluate(textFitProblems, scope)`), so it must stay self-contained.
 *
 * A box is an element that draws an edge: a background, a border, a shadow, or an overflow
 * other than visible. Three rules, each reported once per element:
 * - each visible run of text lies inside its nearest box (both axes, except along an axis the
 *   box scrolls, where text below the fold is fine);
 * - no text is cut short: it lies inside every ancestor that clips (overflow hidden or clip,
 *   which also covers an ellipsis);
 * - each box that sits in the flow lies inside the box around it, where that box neither clips
 *   nor scrolls (a badge inside its row). A clipping box only hides what spills, and the second
 *   rule already reports any text that hides. Absolutely placed parts (slider thumbs, markers)
 *   are drawn where they are meant to be.
 * Text is measured by its Range, not its element's box, because a grid or flex cell shrinks
 * while its text spills out of it.
 */
export function textFitProblems(scope: string | null = null): string[] {
  const root = (scope ? document.querySelector(scope) : null) ?? document.body;
  const out = new Set<string>();
  const TOLERANCE = 0.5;
  // Layout does not change during the check: read each element's style and box once.
  const styles = new Map<Element, CSSStyleDeclaration>();
  const rects = new Map<Element, DOMRect>();
  const boxes = new Map<Element, boolean>();
  const styleOf = (el: Element): CSSStyleDeclaration => {
    let st = styles.get(el);
    if (!st) styles.set(el, (st = getComputedStyle(el)));
    return st;
  };
  const rectOf = (el: Element): DOMRect => {
    let r = rects.get(el);
    if (!r) rects.set(el, (r = el.getBoundingClientRect()));
    return r;
  };

  const visible = (el: Element): boolean => {
    if (el.closest('[hidden]') || el.getClientRects().length === 0) return false;
    const s = styleOf(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const transparent = (c: string): boolean =>
    c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c.replace(/\s+/g, ' '));
  const isBox = (el: Element): boolean => {
    const known = boxes.get(el);
    if (known !== undefined) return known;
    const result = drawsEdge(el);
    boxes.set(el, result);
    return result;
  };
  function drawsEdge(el: Element): boolean {
    if (el === document.body || el === document.documentElement) return false;
    const s = styleOf(el);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return true;
    if (!transparent(s.backgroundColor) || s.backgroundImage !== 'none') return true;
    if (s.boxShadow !== 'none') return true;
    return ['Top', 'Right', 'Bottom', 'Left'].some(
      (side) =>
        parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
        s.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none',
    );
  }
  const boxOf = (el: Element | null): Element | null => {
    for (let p = el; p && p !== document.body; p = p.parentElement) if (isBox(p)) return p;
    return null;
  };
  const name = (el: Element): string => {
    const label = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 28) ?? '';
    const cls = String(el.className || el.tagName.toLowerCase()).split(' ')[0] ?? '';
    return label ? `${cls} "${label}"` : cls;
  };
  /** How far `r` sticks out of `b`, in px, along the axes where `b` is not `skip`ped. */
  const past = (r: DOMRect, b: Element, skip: (overflow: string) => boolean): number => {
    const s = styleOf(b);
    const box = rectOf(b);
    let worst = 0;
    if (!skip(s.overflowX)) worst = Math.max(worst, box.left - r.left, r.right - box.right);
    if (!skip(s.overflowY)) worst = Math.max(worst, box.top - r.top, r.bottom - box.bottom);
    return worst;
  };
  const scrolls = (o: string): boolean => o === 'auto' || o === 'scroll';
  const clips = (o: string): boolean => o === 'hidden' || o === 'clip';
  // 1 and 2: text against its box, and text cut short by a clipping ancestor.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent?.trim() ?? '';
    if (!text) continue;
    const parent = n.parentElement;
    if (!parent || !visible(parent)) continue;
    const box = boxOf(parent);
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    for (const r of rects) {
      const d = box ? past(r, box, scrolls) : 0;
      if (d > TOLERANCE)
        out.add(
          `text "${text.slice(0, 28)}" runs ${Math.round(d)} px out of ${name(box as Element)}`,
        );
      // Out to the first scroller on each axis: past it, text is brought in by scrolling.
      let x = true;
      let y = true;
      for (
        let p: Element | null = parent;
        p && p !== document.body && (x || y);
        p = p.parentElement
      ) {
        const ps = styleOf(p);
        const box = rectOf(p);
        let c = 0;
        if (x && clips(ps.overflowX)) c = Math.max(c, box.left - r.left, r.right - box.right);
        if (y && clips(ps.overflowY)) c = Math.max(c, box.top - r.top, r.bottom - box.bottom);
        if (c > TOLERANCE) {
          out.add(`text "${text.slice(0, 28)}" is cut ${Math.round(c)} px short by ${name(p)}`);
          break;
        }
        if (scrolls(ps.overflowX)) x = false;
        if (scrolls(ps.overflowY)) y = false;
        // A fixed element (a dialog) escapes the clipping of everything around it.
        if (ps.position === 'fixed') break;
      }
    }
  }

  // 3: boxes in the flow against the box around them.
  for (const el of root.querySelectorAll('*')) {
    if (!isBox(el) || !visible(el)) continue;
    const pos = styleOf(el).position;
    if (pos === 'absolute' || pos === 'fixed') continue;
    const outer = boxOf(el.parentElement);
    if (!outer) continue;
    const d = past(rectOf(el), outer, (o) => o !== 'visible');
    if (d > TOLERANCE) out.add(`${name(el)} runs ${Math.round(d)} px out of ${name(outer)}`);
  }
  return [...out];
}

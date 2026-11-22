# 0009 Plain DOM and CSS tokens for menus and HUD

Status: accepted (M2).

**Decision.** Menus, dialogs, settings and the race HUD are built directly on the DOM with a small
set of typed helpers (`apps/web/src/ui/dom.ts`, `apps/web/src/ui/kit/**`) over the shared CSS
custom properties in `design/mock/tokens.css` and `apps/web/src/styles/kit.css`. No UI framework
(React, Preact, Solid, Vue or Svelte) is added to `apps/web`.

**Shape.**
- **Tokens** live in `design/mock/tokens.css` (surfaces, text, brand, timing semantics, compound
  marks, type scale, spacing, radii, elevation, motion) with overrides in `kit.css` for
  colour-blind-safe timing colours (`[data-cb='on']`), reduced motion (`[data-motion='reduce']` and
  `prefers-reduced-motion: reduce`), and HUD scale (`--hud-scale`).
- **Kit components** (`apps/web/src/ui/kit/components.ts`) are factory functions that return plain
  DOM elements plus tiny imperative controls (`get`, `set`, `setDisabled`). Icons live in one
  inline SVG table (`kit/icons.ts`); prompt glyphs (`kit/glyph.ts`) react to the active input
  device from `@undercut/input`.
- **Navigation** (`kit/nav.ts`) runs spatial navigation over elements carrying `data-nav`, using
  the browser's own focus so pointer, touch, keyboard and gamepad share one focus model.
- **HUD** (`apps/web/src/ui/hud.ts`) builds its nodes once when a session starts and writes only
  changed text nodes, class toggles, data attributes and `transform` styles inside the animation
  loop.

**Why.**
- **Zero-allocation HUD updates.** The HUD updates inside the 60+ Hz render loop beside three.js.
  Direct `Text` node caching and `transform`-only bar updates do no virtual-DOM diffing, no
  per-frame object churn, and no layout thrash.
- **Bundle budget.** The JS transfer budget is 1.50 MiB total across the entire client including
  three.js, physics, audio and netcode; the menus have a few hundred nodes total and do not justify
  a runtime or build-plugin dependency.
- **One input model.** Gamepad D-pad, keyboard arrows, pointer and touch all land on real native
  buttons and `role="slider"` / `role="radio"` / `role="switch"` elements, which keeps focus
  handling, ARIA semantics and Playwright browser tests direct and predictable.

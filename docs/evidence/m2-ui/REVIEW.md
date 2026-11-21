# M2 UI, menus, and HUD — visual review

Captured with `node tools/screenshots/ui-shots.mjs` against the production build (`npm run build`). Every image in this directory was inspected before committing.

## Screens captured

| Screen | Desktop (`1440×900`) | Laptop (`1280×720`) | Phone landscape (`844×390`) |
| --- | --- | --- | --- |
| Launch | `launch-1440x900.png` | — | `launch-844x390.png` |
| Main menu (Time Trial) | `hub-1440x900.png` | `hub-1280x720.png` | `hub-844x390.png` |
| Main menu (unavailable mode notice) | `hub-notice-1440x900.png` | — | — |
| Session settings dialog | inline in `hub-1440x900.png` | inline in `hub-1280x720.png` | `hub-settings-dialog-844x390.png` |
| Circuit select | `circuits-1440x900.png` | — | `circuits-844x390.png` |
| Interface kit gallery | `ui-gallery-1440x900.png` | — | — |
| Time-trial HUD (live straight) | `hud-drive-1440x900.png` | — | `hud-drive-844x390.png` |
| Time-trial HUD (invalid lap banner) | `hud-invalid-1440x900.png` | — | — |
| Pause menu | `pause-1440x900.png` | — | `pause-844x390.png` |

## Defects caught and fixed during visual inspection

1. **Phone device chip stayed on Keyboard on first load (`hub-844x390.png`, `circuits-844x390.png`)**
   - `Shell` initialised its device chip to `'keyboard'` and `MenuInput` only pushed updates when the active device changed, leaving touch-capable phones displaying `Keyboard` until another device fired.
   - Fixed by syncing `shell.setDevice(input.activeDevice)` on startup in `apps/web/src/main.ts`, and syncing `setGlyphContext` from `input.activeDevice` in `apps/web/src/drive.ts`. Verified both phone menu screens now display `Touch` immediately.
2. **Stacked duplicate `LAP INVALID` banners (`hud-invalid-1440x900.png`)**
   - Resetting to track displayed both the persistent invalid-lap flag (`LAP INVALID · TRACK LIMITS`) and a transient toast (`LAP INVALID · RESET TO TRACK`) stacked beneath it.
   - Fixed by passing the actual invalidation reason (`Track limits` or `Reset to track`) onto the single flag banner in `apps/web/src/ui/hud.ts` and removing the redundant toast in `apps/web/src/drive.ts`. Verified a single `LAP INVALID · RESET TO TRACK` banner renders.
3. **Circuit record text wrapped across three lines on phone (`circuits-844x390.png`)**
   - `No lap yet` broke onto three narrow lines inside `.ccard__record`.
   - Fixed with `white-space: nowrap` and `flex-shrink: 0` on `.ccard__record b` and widening the phone landscape circuit grid minimum column width to `300px` in `apps/web/src/styles/menu.css`. Verified single-line rendering.
4. **Phone landscape footer button sat too close to the viewport bottom (`hub-844x390.png`)**
   - Reduced phone landscape `.actionbar` minimum height and button height (`38px`) with balanced vertical padding in `apps/web/src/styles/menu.css`.
5. **Phone landscape pause menu clipped `Effects` and pushed `QUIT TO MENU` below the fold (`pause-844x390.png`)**
   - Switched `.pause__card` on short landscape viewports (`max-height: 500px`) to a fixed-height grid (`auto minmax(0, 1fr) auto`) with a scrollable right settings pane and tightened row height (`30px`) in `apps/web/src/styles.css`. Verified all 9 settings rows and `QUIT TO MENU` fit cleanly at `844×390` with zero clipping and touch glyphs hidden.

6. **Time-trial HUD did not read like a broadcast tower (`hud-drive-1440x900.png`, `hud-drive-844x390.png`)**
   - The top-left panel was a label list (lap, record, ghost) and the map sat bottom left. Rebuilt it as a timing tower: lap counter in the head with the team hairline, a flag banner (green in time trial, which has no other flags), and one row per car on the clock (position, team colour bar, driver code, best lap; the record below it with a dashed purple bar). The map moved to the right column under the lap timing, larger. On a phone the tower stays top left in a compact form (no footer) clear of the steering pad and the top-centre timing.

## HUD frame-time benchmark

Measured at `1440×900`, `high` quality preset, with vsync and frame-rate cap disabled (`--disable-gpu-vsync --disable-frame-rate-limit`), driving Monza on autopilot with the HUD visible vs hidden via `window.__undercut.setHudVisible` (`docs/evidence/m2-ui/report.json`):

| State | Frames | Mean (ms) | Median (ms) | p95 (ms) | p99 (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| HUD on | 2848 | 2.108 | 1.6 | 3.5 | 16.1 |
| HUD off | 2859 | 2.100 | 1.2 | 3.8 | 18.6 |
| **Delta (on − off)** | — | **+0.008** | **+0.4** | **−0.3** | **−2.5** |

Re-measured after the tower layout below; the HUD costs well under a millisecond a frame (noise
dominates at the tails).

Car framing check (`window.__undercut.carScreenRect()` vs `.hud-drive` bounding box): zero overlap on both `1440×900` and `844×390`.

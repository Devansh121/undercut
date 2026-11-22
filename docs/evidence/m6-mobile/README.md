# Phone audit

RTX 4050 laptop, GPU-backed Chromium under the shared GPU lock. Mobile only; High values are unchanged. Five-second samples after three seconds of settling per station. Median is 16.7 ms (60 fps) in every sample. 1% low is 1000 divided by the mean of the slowest 1% of intervals. GPU time is the renderer timer-query snapshot, not a percentile. Draw counts include shadows. Texture MiB estimates GPU texture/target storage; heap bytes are Chromium's coarse estimate. These short laptop runs are not a physical-phone or thermal qualification.

Quick Race is unavailable on this base. Grid includes twenty static cars; corners use a stationary Time Trial car at the sampled centreline position, with sim and render loops running in landscape. Portrait after measurements render while paused by the new orientation guard; they measure portrait rendering, not driving throughput. The baseline portrait sim was running. Use landscape measurements for the driving target.

| View / DPR | Spot | p95 ms before → after | 1% low fps before → after | GPU ms before → after | Calls | Triangles | Texture MiB before → after | Heap MB before → after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 844x390-dpr2 | grid | 18.8 → 17.8 | 42.9 → 48.5 | 5.28 → 5.05 | 277 | 1,328,078 | 132.2 → 120 | 97.4 → 91.7 |
| 844x390-dpr2 | chicane | 18 → 17.3 | 44.2 → 51.3 | 4.49 → 4.52 | 171 | 454,964 | 132.2 → 120 | 97.4 → 91.7 |
| 844x390-dpr2 | lesmo | 17.3 → 18 | 46.8 → 41.7 | 5.01 → 3.84 | 183 | 348,000 | 132.2 → 120 | 97.4 → 91.7 |
| 844x390-dpr2 | parabolica | 16.8 → 16.8 | 58.5 → 58.4 | 5.2 → 4.92 | 254 | 963,836 | 132.2 → 120 | 97.4 → 91.7 |
| 390x844-dpr2 | grid | 16.8 → 16.8 | 57 → 59.5 | 2.31 → 4.88 | 229 | 1,269,382 | 132.2 → 125.3 | 81.4 → 81.4 |
| 390x844-dpr2 | chicane | 16.8 → 16.8 | 56.9 → 59.1 | 3.8 → 3.02 | 139 | 420,220 | 132.2 → 125.3 | 81.4 → 81.4 |
| 390x844-dpr2 | lesmo | 18.6 → 16.8 | 48.5 → 58.4 | 4.11 → 2.99 | 124 | 301,050 | 132.2 → 125.3 | 81.4 → 81.4 |
| 390x844-dpr2 | parabolica | 19.8 → 16.8 | 46 → 58.7 | 5.15 → 5.42 | 205 | 899,468 | 132.2 → 125.3 | 81.4 → 81.4 |
| 844x390-dpr3 | grid | 20.1 → 16.8 | 44.9 → 59.2 | 5.6 → 5.2 | 277 | 1,328,078 | 126.9 → 125.3 | 103 → 86.4 |
| 844x390-dpr3 | chicane | 18.2 → 16.8 | 50.3 → 59.2 | 4.91 → 5.12 | 171 | 454,964 | 126.9 → 125.3 | 103 → 86.4 |
| 844x390-dpr3 | lesmo | 18.1 → 16.8 | 49.4 → 55.8 | 4.34 → 7.39 | 183 | 348,000 | 126.9 → 125.3 | 103 → 86.4 |
| 844x390-dpr3 | parabolica | 18.2 → 16.8 | 45.3 → 57.2 | 5.14 → 4.69 | 254 | 963,836 | 126.9 → 125.3 | 103 → 86.4 |
| 390x844-dpr3 | grid | 18.1 → 16.8 | 47.8 → 58.6 | 5.22 → 4.36 | 229 | 1,269,382 | 132.2 → 125.3 | 97.4 → 81.4 |
| 390x844-dpr3 | chicane | 17.8 → 16.8 | 46.7 → 56.5 | 3.68 → 6.12 | 139 | 420,220 | 132.2 → 125.3 | 97.4 → 81.4 |
| 390x844-dpr3 | lesmo | 16.8 → 16.8 | 59.1 → 58.9 | 7.69 → 6.33 | 124 | 301,050 | 132.2 → 125.3 | 97.4 → 81.4 |
| 390x844-dpr3 | parabolica | 16.8 → 16.8 | 59.4 → 58.4 | 5.39 → 4.34 | 205 | 899,468 | 132.2 → 125.3 | 97.4 → 81.4 |

The cap changes 1.5 → 1.25 CSS-pixel ratio: 30.6% fewer drawing-buffer pixels. The existing dynamic-resolution floor remains 0.6. All measured landscape p95 values after are below 20 ms; pacing and GPU snapshots vary with shared-laptop load, so the observed gain cannot all be attributed to the cap. No geometry, shadow quality, texture assets or High settings were reduced. First-race budget inventory: 3.69 MiB before, 3.70 MiB after on Mobile; 8.87 MiB on High. Debug resource timing totals exclude background offline precaching and differ from the complete compressed inventory.

Validation: 235 input/controls unit tests; 4 analog drivability checks, including the touch spin target; targeted browser run 5 passed / 1 desktop-only skip in 32.3 s, including active simulation, portrait pause, settings reset, manifest/icons, waiting-worker update, old-cache deletion, and offline Mobile Time Trial advancing beyond tick 20. Transfer inventory test also passed separately. Full CI is recorded on the PR.

The coach follows active bindings: controls → brake/line cue → track limits → pause. Next tip skips a step; Skip intro or a completed lap remembers completion. Pause settings replay or skip it with keyboard, touch or gamepad. Storage failures retain page-memory choices. Portrait captures show the rotate banner and paused settings; driving is deliberately unavailable there.

Remaining real-phone work: sustained thermal runs on a mid-range Android and iOS device, actual GPU timing/memory, fullscreen/wake-lock lifecycle, vibration, browser-edge swipe behaviour, offline quota/eviction, and an independent mobile/performance score. A phone needs its own GPU frame under roughly 14 ms plus main-thread headroom for stable 60 fps; older devices can fall toward the existing 30 fps dynamic-resolution floor. No score is assigned from laptop emulation.

## Inspected frames

- Landscape: [onboarding](onboarding-844x390.png), [HUD](hud-844x390.png), [pause](pause-844x390.png), [settings](settings-844x390.png).
- Portrait: [onboarding state](onboarding-390x844.png), [HUD state](hud-390x844.png), [pause](pause-390x844.png), [settings](settings-390x844.png). The first three deliberately show the rotate banner and pause because driving is landscape-only.

The frames were inspected at their captured sizes. The coach leaves the car and road below it visible; narrow portrait settings stack vertically without horizontal overflow, and the landscape action list scrolls to its remaining controls. Images are captured at CSS resolution, with a DPR 3 rendering context.

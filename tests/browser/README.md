# Browser tests

Playwright against the production build (`npm run build && npm run test:browser`), at desktop 1440×900 and landscape phone 844×390, with software WebGL (SwiftShader) so CI and the laptop behave alike and the shared GPU is left alone.

Software WebGL makes a cold load (a few seconds of shader compilation) and every frame (hundreds of milliseconds at full size) expensive, so the suite is arranged to pay for that as little as possible:

- **One cold start per project** (`cold-start.spec.ts`) at the real Mobile preset (shadow map, environment prefilter, full materials), from the Start button to a driving session, with a start-up budget asserted.
- **One shared session per worker** (`fixtures.ts`) for the drive tests in `drive.spec.ts`. They run on the `lite` render preset: a small canvas (pixel ratio 0.4), no shadow map and no environment prefilter. The scene, cameras, HUD and all game logic are identical to the other presets; only the pixels drawn differ. Each test starts from an in-page reset (`__undercut.resetForTest()`: running, player's devices, real time, near chase, rolling start) instead of a reload, and the fixture fails the test on any console error or warning.
- **Fresh pages only where a test needs one**: blocked storage (set before the page loads), audio (a real click on Start must be the gesture that starts sound), and the transfer/fallback checks.
- **Nightly project (`npm run test:browser:nightly`)**: long software-WebGL scenarios (`*.nightly.spec.ts`) run in the nightly workflow rather than on every PR — the five-session Mobile leak soak (`lifecycle.nightly.spec.ts`) and WebGL context loss with full Mobile PMREM rebake (`context-loss.nightly.spec.ts`).

What these tests cannot see is how the frames look; the GPU screenshot stations (`npm run shots -- monza`) cover that at the High and Mobile presets.

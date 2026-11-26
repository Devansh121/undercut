# Mirror review corrections

Both blockers from review 6073675488 are fixed after merging master `e0b7dcf`.

## Reflected coverage and following traffic

The camera projection is fitted once to the shipped glass vertices and normals in body space,
including 0.03 m of head travel and an 8 % border. The shader uses the same off-centre projection.
The existing target dimensions and one-pass-per-three-drawn-frames cadence are retained.
Mobile skips fitting, allocates no mirror target and performs no mirror passes.

`tests/browser/mirrors.spec.ts` bundles a small isolated scene with the production mirror shader,
real shipped glass, and two shipped car models behind the eye: red on the left and green on the
right, at body-frame x = -7 m, z = ±9.5 m. It samples triangle interiors with interpolated normals
at all eight 0.02 m head-travel corners and requires every ray to lie past the shader's fade border.
It also requires coloured traffic pixels inside a separately rendered glass mask on the correct
screen side. This exercises capture and shader lookup, not just camera orientation.

The original implementation fails: neither traffic car is visible (0 / 0 classified pixels).
The correction passes on desktop and phone: 167 / 157 traffic pixels and 100 % of sampled rays
inside the live image beyond its fade border. `following-cars.png` is the isolated rendered scene.

## World-position sky

Both sky-dome callbacks use `getWorldPosition`, then update the dome's world matrix.
The same rendered regression translates the camera's car to (-628, 2.4, 904) m and rotates it
by (0.02, 1.1, -0.03) rad. Its sky must match an unparented camera at that exact world pose.
With the original callback, the dome is 1100.659 m from the eye and the maximum 8-bit pixel error
is 161. With the correction, distance and pixel error are both zero.

## Captures inspected

Fresh muted headless RTX 4050 captures, Monza s = 5180 m by day and Singapore s = 1700 m at night.
Before/after use the same merged scene and assets; only the two review fixes are reverted for
before. High is 1440×900; Mobile is 844×390, DPR 3 with the preset's cap/dynamic resolution.
The comparisons have before on the left and after on the right. Enlarged mirror comparisons
have before above after. These are screenshot crops and resizes with labels, without retouching.

- `monza-high-cockpit.jpg`, `monza-high-mirrors.jpg`: road and scenery now fill both glasses;
  the small scene patches surrounded by fallback are gone.
- `singapore-high-cockpit.jpg`, `singapore-high-mirrors.jpg`: live road, barriers and skyline
  fill the glasses instead of the displaced black sky and small road patches.
- `monza-mobile-cockpit.jpg`, `singapore-mobile-cockpit.jpg`: the static reflection is retained.

All four full before/after pairs were inspected, along with enlarged High mirror crops.

## Performance

Raw run data: `performance.json`. Each pair uses adjacent fresh browsers, a frozen 20-car grid,
an 8 s uncapped sample and the real RTX 4050. Every sample was valid; maximum observed one-minute
machine load was 8.10, below 16. GPU work ran under `timeout 900 flock` and `nice -n 10 taskset -c 0-7`.
No local CPU test/build ran during the timing samples. Every browser and capture server was closed.

Time per frame actually drawn, ms (elapsed time / drawn-frame count, including skipped draws):

| Circuit | Preset | Before, individual runs | After, individual runs | Mean before → after |
| --- | --- | --- | --- | --- |
| monza | high | 8.787 | 9.154 | 8.787 → 9.154 |
| monza | mobile | 2.988 / 3.053 / 3.282 | 2.549 / 3.085 / 3.208 | 3.108 → 2.947 |
| singapore | high | 7.156 | 5.839 | 7.156 → 5.839 |
| singapore | mobile | 2.849 / 2.317 / 2.668 | 2.510 / 2.814 / 2.632 | 2.611 → 2.652 |

Mobile's daytime mean decreases by 0.160 ms; its night mean increases by 0.041 ms. The night
paired differences have mixed signs and the baseline's own spread is 0.532 ms. These samples
show no repeatable Mobile slowdown; they do not prove exact timing equality. Mobile has zero
mirror passes in every run, and identical steady scene calls and triangle counts before/after.
Dynamic resolution varies during the samples; its texture-memory ranges are retained in the raw data.
High has one pair per circuit, sufficient for a cost check but not a precise speedup claim.
Its target dimensions and cadence are unchanged; fitting a wider scene can change capture culling.

## Validation

- `npm run typecheck`: passed across all workspaces.
- `npm run lint`: passed.
- Focused render and car unit suites: 26 files, 193 tests passed.
- Browser mirror, sky and render-fallback suites, desktop and phone, `--workers=1`: 6 passed,
  2 skipped as expected. The mirror regression passes in both projects.
- `npm run build`, `npm run check:assets`, `npm run check:credits`: passed.
- The original source was temporarily restored to verify that the new regression fails on both
  blockers; corrected source was restored and the browser checks rerun successfully.

The WebGL extension interception test only needed its overload annotation widened for the
current DOM types. Its behavior and all existing rendering assertions and tolerances are retained.

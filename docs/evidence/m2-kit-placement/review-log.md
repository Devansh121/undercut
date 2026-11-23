# Circuit kit placement review

Captures use the production build, a muted GPU-backed browser and the shared GPU lock, with CPU affinity 0–1. Desktop stations are 1440×900; phone stations 844×390. Performance uses the existing drive and last-grid-slot stations at 1920×1080 High and 844×390 Mobile, with nineteen other cars in the grid view. Raw runs live under `/home/devansh/.cache/undercut/scratch/m2-kit-placement/`.

## Round 1 — baseline and placement contracts

Viewed `before-monza/stand-straight-1440x900.png`: crowd heads and arms are square blocks; the stand roof is a broad flat slab and the garage facade is a repeated shader pattern. The existing grid, stand and pit-lane stations are retained for direct comparisons. Spa uses grid and paddock stations; Singapore grid and marina helicopter stations.

Changes: catalogue structures at the mapped placements, permanent stand crowd from seat markers, detailed near spectators in the front four rows, temporary scaffold stands retained at Singapore. Corrected the feet-to-seat pivot for seated spectators; pit engineers instead use the kit's grounded pivot and timing-station offsets. Kit banners use the glTF UV direction and one atlas tile per instance. The asset inventory includes all requested models and its provenance hash is updated.

Verification: 38 focused tests passed, followed by five structure/loading/crowd tests including the added gantry light and bridge-crossing checks. Root typecheck and full lint passed before subsequent look adjustments. No new third-party asset or licence.

## Round 2 — human scale

Viewed `round2-monza/stand-straight-1440x900.png` and `pit-lane-1440x900.png`. The detailed figures have proper heads and limbs, and garage shutters, columns and roof rails read as geometry. Rejected the stand fit: blue seat backs are taller than the spectators, risers too deep and guardrails dominate the frame. Scaling a ten-row bank vertically to thirty rows caused this.

Fix: fit deep stands with successive ten-row banks at the kit's original riser height, rising 4.2 m per bank. Keep the roof on the rear bank and extend raised-bank columns and lower fascia down to ground, rather than floating their footings. Small width/depth fitting remains horizontal. Cheap crowd keeps long chunks; only the detailed nearby figures need small grid cells.

## Round 3 — crowd continuity and level cost

Viewed `round3-monza/stand-straight-1440x900.png` and `grid-front-1440x900.png`. Seat/riser scale is now credible and the roof reads as a light steel structure over the rear bank. The fixed selection of four detailed rows leaves nearby block figures between bands of detailed spectators in the elevated TV view.

Fix: let each person's distance choose the closest rows instead of a fixed row index: full detail to 24 m, complementary dither to 32 m, cheap figures beyond. This also works when a TV camera is behind or above the stands. Limit expensive stand levels to roughly 81/270 m while retaining the 3.2 km far silhouette. Add a gantry-facing station to inspect all five lit channels from the grid side; the existing front-grid camera sees the backs of the pods.

Browser verification before this look change: seven tests passed in 2.8 minutes, including all three full Mobile worlds and byte-for-byte transfer inventories plus Singapore High prefetch. No console errors in the GPU comparison captures.

## Round 4 — whole people and actual stand chunks

Viewed `round4-monza/stand-straight-1440x900.png` and the new `round4-monza/gantry-lights-1440x900.png`. All five red lenses are visible on the grid side of the gantry and the kit header carries one readable invented-brand panel. Rejected the crowd's pixel dither: the two silhouettes differ enough that partial bodies look speckled during the handover.

Fix: use one deterministic world-position threshold per spectator through the same 24–32 m band. Both representations choose complementary whole people, and the hidden representation collapses before rasterization. This avoids a marching row boundary and partial bodies.

The first performance run held 60 fps on High at the last grid slot, but submitted 12.70 million triangles (baseline 5.18 million). Found the stand chunking error: every module inherited the stand's single lap coordinate, so a long grandstand was still one large chunk despite a short lap-chunk setting. Stands now use 50 m world-grid cells and a shorter finest-level range; the far silhouette still reaches 3.2 km. Repeating the performance runs after this material and culling change is required; the initial figures are not the final result.


## Final frame verification

Viewed the corrected Monza stand at both viewport sizes, Spa's grid and paddock helicopter frames, and Singapore's grid and marina helicopter frames. The nearest spectators retain whole heads and limbs through the handover; seat/riser dimensions now match the people. Kit garages, trussed bridges and gantry replace broad flat stand-ins. Five red gantry channels are visible from the new grid-side station. Singapore retains its existing scaffold stands, wall runs and lighting trusses.

The permanent stand roof covers its rear ten-row bank. Repeated steel bays, closed garage shutters and cheap far spectators are still evident; these are generic catalogue placements at mapped footprints. Collision barriers remain authoritative under the visual sleeves. No new model, texture or third-party asset was needed.

## Performance controls

The initial final Spa sample was contended: High grid 23.5 fps and Mobile grid 52.1 fps, while the unchanged track build also slowed sharply. At the host check, CPU pressure reported 72% over ten seconds and load average 8.01. These samples remain in the raw evidence. The original Monza baseline also included an unrepresentative 24.90 ms uncapped grid sample during other local validation work.

Declared a single control series rather than choosing the best sample: rebuild the base rendering source at `08950d2` and measure all three circuits, restore the kit rendering source/distribution, then measure Spa and Singapore again with no concurrent local tests or builds. The base Monza grid measured 8.16 ms uncapped instead of the original 24.90 ms. Monza's kit result remains the first final run, not a replacement. Every original and control record is kept in `performance.json`.

Captures use rendering implementation `49b82e0`, render-source tree object `363b9688514e6257634337a1300164ec05e46685`. The later master merge leaves that production rendering source unchanged. Full before/after numbers, loading cost, transfer inventories and the grid chart are in [performance.md](performance.md). The one-pixel upload pass deliberately adds loading work; it does not make the added geometry free.

## Before / after pairs

Each JPEG has the baseline above and the kit below. Desktop panes are 1440×900; phone panes are 844×390 (the DPR-3 captures downsampled to CSS pixels). Raw PNGs and station reports remain in `/home/devansh/.cache/undercut/scratch/m2-kit-placement/`.

- Monza: `before-after/monza-stand-straight-1440x900.jpg`, `monza-grid-front-1440x900.jpg`, `monza-pit-lane-1440x900.jpg`, and the matching `844x390` pairs.
- Spa: `before-after/spa-grid-tv-1440x900.jpg`, `spa-paddock-heli-1440x900.jpg`, and the matching phone pairs.
- Singapore: `before-after/singapore-grid-tv-1440x900.jpg`, `singapore-marina-heli-1440x900.jpg`, and the matching phone pairs.

## Remaining giveaways, ranked

1. Far crowd is still block geometry, especially evident with a long TV lens; near detail is deliberately limited to the closest people.
2. Mid-distance trees remain atlas cards, and Mobile has no near tree geometry.
3. Repeated stand bays and a roof over only the rear bank; closed garage shutters have no working interiors.
4. Singapore's broad facade lighting and window patterns, and flat daytime water without city reflections or waves. Water work was deferred to preserve headroom.

Local focused rendering validation: 42 tests passed; the final seven kit-specific tests passed after the material/culling adjustments. Root typecheck and full lint passed. Browser world/transfer validation passed seven tests in 2.8 minutes before the final look adjustments; the implementation commit's eight CI checks all passed, including the updated world assertions. Final merged-build validation is recorded below after completion.


The control grid averages are 60.0 fps at Monza High/Mobile, 59.6/60.0 at Spa, and 60.0/60.0 at Singapore. Uncapped drawn grid times remain below 16.7 ms on all six cases, but a strict uninterrupted 60 fps claim is not supported by the observed scheduling stalls. The initial contended failures are retained, not retried away. Optional water work remains deferred.

A merged-build unit run exposed an existing timing-sensitive assertion loop: one matcher for every stand/building pair exceeded its unchanged five-second timeout under load. The test now checks every same polygon pair and aggregates colliding stand/feature IDs into one assertion. No coverage, tolerance or timeout changed. The resulting focused run passed all 42 tests. Production rendering source is unchanged by this test-only fix.

The implementation CI browser job passed in 6m16s; master `08950d2` passed that job in 8m57s. Both exceed the five-minute aim on these runs. Lite still requests no dressing, and the new full-world work remains confined to the existing dedicated coverage. CI duration is a remaining budget caveat, not a relaxed threshold.


Final merged-build validation: production build and unchanged transfer budgets passed; full workspace typecheck and lint passed; 42 focused rendering tests passed; all seven browser world/transfer tests passed with one worker in 6.5 minutes. The browser server stopped cleanly.

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

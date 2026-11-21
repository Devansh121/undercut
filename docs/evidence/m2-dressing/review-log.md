# M2 circuit dressing review log

Each round: capture the stations on the RTX 4050 under the GPU lock (`npm run shots -- monza`, investigations with `tools/screenshots/probe.mjs`), open the frames, answer two questions (at thumbnail size, would this pass for a current racing sim; at full size, what gives it away), fix the biggest giveaway, repeat. Final stations are in `stations/` at 1440×900 (High) and 844×390 (Mobile); before and after pairs against `docs/evidence/m2-render/stations/` are in `before-after/` (left before, right after). `perf.json` is the performance run, `report.json` the station run.

## Round 0: the bare circuit (before)

`docs/evidence/m2-render/stations/`: the car, the light and the surfaces are good, the place is not. A ribbon of asphalt on a flat green plane under a hazy sky: no stands, no pit building, no trees, no boards, nothing beyond the barriers. The owner's words: "why track is just track, no building, fans, stands, pit and all that stuff like a traditional track".

## Round 1: first world

Terrain to 6 km from the canopy-filtered Copernicus grid, ground cover from the map (woodland floor, paths, roads, car parks), the woods, tree rows and single trees from OpenStreetMap as instanced impostors, every mapped building extruded, grandstands fitted to their mapped footprints with a crowd.

- Thumbnail: the fast corner (Curva Grande) already passes: a forest corridor on both sides. The start straight reads as a place for the first time.
- Giveaways: (1) the pit building was the mapped footprint extruded into a blank windowed slab; (2) grandstand side and back walls in bright bare concrete; (3) haze grey rather than warm.
- Fixed next: the pit building is built from the pit lane (garages with lit ceilings and team colours, fascia with team boards, glazed hospitality floor, canopy), the mapped footprints under it are dropped; stand concrete darkened.

## Rounds 2 to 8: furniture, brands, light

Pit complex and pit-wall canopies with crew, sloped grandstands with roofs, invented-brand atlas (`design/brands.json`) on hoardings and bridge banners, catch fencing, verge boards, braking and DRS boards, marshal posts, Tecpro blocks at the chicane exits, big screens, camera and truss towers, bridges over the track, the old oval's banking, surface decals (start/finish chequer, grid numbers, pit-lane lines, painted run-off), the start gantry with five addressable lights, and new TV stations (stand over the straight, chicane outside, Lesmo trees, Ascari tower, Parabolica outside, sector 1 from a helicopter). Each round's biggest giveaway, in order: furniture floating or folded across chicane islands (inner-apex and fold guards), catch fence wrapping around barrier steps, bridge decks at the wrong height, tree impostors too flat (more cards, darker crowns), lighting on the shadow side of the car.

## Round 9 (this PR)

- Thumbnail: yes for grid-front, stand-straight, chicane-braking, fast-corner and straight: tall packed stands with a colourful crowd, rows of invented-brand hoardings, catch fencing, a bridge banner over the straight, a forest corridor beyond.
- Giveaways: (1) isolated catch-fence panels standing alone in the first chicane's run-off (`chicane-outside`); (2) found by the direct-path browser test: the old oval's mapped ways share Monza's main straight, and the banking builder raised a 7 m concrete deck along it, right over the start line (a dark slab over the chase camera); (3) one invented brand ("MARETTI, TORREFAZIONE") read one letter away from a famous real brand.
- Fixed: catch fencing is now placed only in continuous runs of at least 24 m; old-oval concrete is built only more than 32 m from the centreline, or as an overpass where a segment actually crosses the circuit; the brand is renamed VASSERO. The prop catalogue from the prop kit (`packages/render/data/props.catalog.json`) is read when the build has one, so the modelled props replace the stand-ins as a data change.

## Remaining giveaways, ranked

1. Tree impostors are painted cards: from the trackside camera near trees show their planes and a speckled, painterly leaf texture. Real geometry or a baked multi-view impostor is next.
2. Stand-in props (hoardings, fences, gantry, towers, crew) are procedural boxes; the modelled kit (PR #27) replaces them as it lands. The kit's hoarding module is 4 m against the stand-in's 6 m spacing, so kit hoardings will sit with 2 m gaps until placement reads `moduleLength`.
3. Haze is still grey-blue at the horizon in the helicopter view; the warm-afternoon grade is not done.
4. The far field beyond the mapped 600 m is open ground to a hard horizon in high views; a distant treeline and skyline ring is not built yet.
5. Large flat paved areas (car parks) read as untextured grey from above.
6. The crowd is low-poly blocks: fine beyond 40 m, blocky close up in the stand-straight station.

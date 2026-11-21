# Visual direction

The target is a frame from a TV broadcast or a current sim: physically lit, dressed like a real circuit, with one quiet UI system on top. Every render and UI change is checked against this page and against the "tells we refuse" list at the end. Mocks: `design/mock/hud.html` and `design/mock/menu.html` (tokens in `design/mock/tokens.css`, grid in `design/teams.json`). Screenshots: `docs/evidence/m0-mocks/`.

## Rendering targets

| | High (desktop) | Mobile preset |
|---|---|---|
| Materials | glTF metallic-roughness PBR on everything, clearcoat on paint and carbon, KTX2 textures | Same materials; clearcoat off, max texture 1k |
| Image-based lighting | HDRI per circuit (see survey), PMREM prefiltered, one sun or floodlight key | Same HDRI at 1k, prefiltered once at load |
| Shadows | Cascaded sun shadows, 3 cascades, 2048 maps, PCF soft; contact shadow under the car | 1 cascade, 1024, car-only near cascade |
| Ambient occlusion | GTAO/SAO at half resolution, plus baked AO in car and trackside textures | Baked AO only |
| Tone map | Khronos PBR Neutral (chosen over AgX and ACES by comparison, `docs/render.md`), exposure per circuit preset, no clipping on white kerbs | Same |
| Anti-aliasing | TAA, or SMAA where TAA ghosts on the HUD-free scene | FXAA plus dynamic resolution (floor 30 fps) |
| Other | Bloom only on emissive (brake glow, floodlights, rain light), mild lens vignette, motion blur on wheels only | No bloom, no motion blur |

Colour pipeline: textures authored in sRGB, lighting in linear, output through AgX. No hand-tuned "contrast" filters. Fog is height-based atmospheric scattering tinted by the sky, never flat grey.

## Circuit palettes and mood

| Circuit | Time and sky | Key light | Palette | Mood notes |
|---|---|---|---|---|
| Monza | Afternoon, partly cloudy, sun ~35° | Warm sun 5200 K | Parkland greens (#3f552d to #6f7d4a), warm grey asphalt, bleached kerbs, sand run-off | Long shadows from tall trees across the straights, haze at distance, dust in the air at the chicanes |
| Spa | Overcast, low cloud on the hills | Soft sky, no hard sun | Deep conifer green (#26331f), wet-dark asphalt, cool grey (#8a9196) | Low contrast, mist in the valley, damp sheen on painted lines, trees dominate the horizon |
| Singapore | Night under floodlights | Floodlight banks 4300 K plus city glow | Asphalt near-black, sodium and LED city tones, white concrete walls, saturated advertising | Bright, even track surface, dark run-off beyond walls, skyline with lit windows, reflections in barriers |

## Trackside dressing (minimum per circuit)

Armco (galvanised, double rail, posts every 4 m), energy-absorbing foam block barriers in invented colours, catch fencing with poles and cables, concrete walls (street circuit), kerbs (red/white and sausage kerbs where the real circuit has them), braking boards (150/100/50), DRS detection and activation boards, light panels at marshal posts, marshal posts with figures, grandstands with crowd impostors, pit building and gantry, start lights gantry, bridges and advertising gantries for invented brands, run-off surfaces (asphalt, gravel, grass) with their own materials, tyre walls, service roads, camera towers, terrain with trees, and a skyline or ridge line behind. Nothing floats; every object has contact shadows or baked AO at its base.

## Camera language

- Chase cams sit low and slightly late: the camera lags the car by spring-damper smoothing (yaw ~0.12 s, pitch ~0.2 s), with small speed-dependent shake and a field of view that widens 4° at top speed. Never glued.
- Cockpit: halo visible, steering wheel display live, head moves with g-load (max 2 cm), not a fixed view.
- T-cam: above the airbox, slight roll with the car.
- TV cams for replays: long lenses (100–300 mm equivalent) from trackside towers, panning with mild operator lag, occasional focus pull. Shots are framed on thirds, with the car entering the frame, not centred statically.

## UI system

**Tokens** live in `design/mock/tokens.css` as CSS custom properties and are the only source for colour, type, spacing, radius, elevation and motion. The game imports them unchanged.

- **Colour.** Warm graphite surfaces (`--c-ink-0` #0b0c0e to `--c-ink-4` #2e3339), warm white text (`--c-text-1` #f2f0eb), one brand colour (`--c-brand` signal vermilion #ff5a1f) used only for selection, focus and the wordmark. Timing colours have fixed meanings and are never decorative: overall best `--c-time-overall` purple, personal best green, slower yellow, invalid red. Flag, tyre compound and temperature scales are separate token groups.
- **Spacing.** 4 px base: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. The HUD keeps a broadcast safe frame of `max(16px, 3vmin)` from every edge.
- **Radius.** 0, 2 px (panels, rows, buttons), 4 px (cards). Pills only for tyre marks and toggles.
- **Elevation.** Opaque panels with a 1 px top hairline and a tight drop shadow (`--e-1`, `--e-2`). HUD panels are 88% opaque graphite so text reads on sky and on asphalt. No backdrop blur, no glow.
- **Type.** Two open-licence families, both SIL OFL 1.1, committed under `design/mock/fonts/` with their licence files:
  - **Archivo** (Omnibus-Type, variable weight 100–900 and width 62–125%) for UI text, labels and headings. Labels are uppercase, 11 px, semi-condensed (87.5%), tracking 0.08em. Headings use the condensed (75%) and wide (112.5%) widths for character, never a third family.
  - **Barlow Semi Condensed** (Jeremy Tribby, weights 500/600/700) for every number: timing, gaps, speed, gear, temperatures. Always with `font-feature-settings: "tnum"` so digits do not jitter when they change.
  - Scale (px): 10 (phone micro), 11, 12, 14, 16, 20, 24, 32, 44, 64 (gear), 88 (title).
- **Icons.** One set drawn for the game on a 24 px grid: 1.75 px strokes, square caps, mitred joins, no fills except state marks, no emoji, no third-party icon font. The mocks carry the first subset (flag, camera, gear shift, pause, stopwatch, weekend, trophy, rooms link, chevron, settings cog, sun, temperature, drop, edit, car plan view).
- **Grid.** 12 columns, 24 px gutters, margins equal to the safe frame on desktop; 8 columns, 12 px gutters on phone landscape. HUD modules anchor to corners and the top centre, never float mid-screen.
- **Motion.** 80 ms for value changes and toggles, 160 ms for hover and focus, 240 ms for panels, 400 ms for screen transitions; ease-out `cubic-bezier(0.2, 0.7, 0.2, 1)`. Tower rows reorder by sliding, never by fading. Numbers change instantly (no counting-up animations on timing). `prefers-reduced-motion` removes all transitions.
- **Copy.** Plain and short: "Start race", "5 s time penalty · Track limits, turn 4". No exclamation marks, no filler, no placeholder text in any build.

**Phone landscape** (checked at 844×390): the tower collapses to the leader plus the cars around the player; lap timing moves to top centre; tyres and minimap shrink into the top-right corner; the driver cluster sits bottom centre between the touch zones. Touch regions are reserved and never covered: steering pad bottom left with gear up/down beside it, brake and throttle pedals bottom right with DRS and overtake buttons beside them, camera and pause top right. Touch targets are at least 48 px. Menus keep the three-column structure, drop secondary text and collapse the settings panel to a one-line summary with an edit button.

## Tells we refuse

Hold any screenshot against this list. One hit is the next task.

- [ ] Any car or scenery part that reads as a box, cylinder or sphere; flat untextured colour; every surface equally shiny.
- [ ] No visible sky reflection on paint and carbon; no shadow under the car or barriers; banding in the sky; flat grey fog.
- [ ] Track on a flat green plane; a building or tree repeated in a visible pattern; missing barriers, boards, marshal posts or stands.
- [ ] A browser-default font, button or form control; emoji; purple gradients; glass blur; glow on UI.
- [ ] Inconsistent gaps between HUD modules (they are 8 px apart and on the safe frame); clipped or wrapping text; digits that change width.
- [ ] Debug text, frame counters or raw numbers without units in a capture.
- [ ] Camera rigidly locked to the car; wheels not matching road speed; no suspension movement.
- [ ] Real team, driver, sponsor or series names, or a livery that copies a real colour-and-pattern combination.
- [ ] Exclamation marks, "Lorem", "TODO" or marketing filler in any visible string.

# Cockpit pass: before and after

Each image: top row before (master at a653b26), bottom row after, at the three cockpit stations
of `npm run shots -- monza --only cockpit,cockpit-chicane,cockpit-lesmo` (Parabolica, braking
for the first chicane, Lesmo), High on 1440x900 and Mobile on 844x390, in the afternoon sun and
under `--query tod=night-floodlit`. Captured on the RTX 4050 under the GPU lock.

| File | Light | Viewport |
| --- | --- | --- |
| `cockpit-day-1440x900-before-after.jpg` | Sun | Desktop, High |
| `cockpit-day-844x390-before-after.jpg` | Sun | Phone, Mobile |
| `cockpit-night-1440x900-before-after.jpg` | Floodlit night | Desktop, High |
| `cockpit-night-844x390-before-after.jpg` | Floodlit night | Phone, Mobile |

What changed, from the driver's seat:

- Steering wheel: bevelled carbon faceplate, the screen in a raised bezel (same `display`
  material and UV contract, 1.6:1 like the 256 x 160 canvas), push buttons, three knurled
  rotary switches, moulded rubber grips with finger ridges.
- Hands: light grey suede gloves closed round the grips, thumbs on the faceplate, gauntlets with
  wrist straps; tapered suit sleeves with an elbow bend.
- Padded coaming round the front of the cockpit opening.
- Halo: the underside and the face towards the driver are bare carbon; the painted top is beyond.
- Mirrors: the glass has its own normals (the old fan shared them with the lip and read as
  facets) and is gently convex, set into a recessed lip.
- Carbon: 2x2 twill with 3 mm tows (was 6 mm) and fibre anisotropy along the tows
  (`KHR_materials_anisotropy` with a direction texture); presets without clear coat drop it.

After the first review (PR #33): the gauntlets are lofted from the actual sleeve ends, with their
closed caps 20 mm inside the sleeve so no cap shows; the thumbs curl round the grip; the faceplate
carries printed control legends and rotary index marks, and the gloves a suede texture with seams
and sparse wear, all inside the existing triangle budgets. The after rows above are from 6151b9b.

Known gaps: on the phone the driver cluster covers the wheel face (a HUD layout choice; the
wheel's buttons are left off the Mobile level for that reason). On Mobile, without the sheen,
the twill on the halo reads as a coarse zigzag at that distance. Belts are the existing straps; no buckle yet. These Mobile items are tracked in `docs/STATUS.md`.

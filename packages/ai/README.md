# @undercut/ai

AI drivers. A racing line and speed profile are computed offline from the same vehicle model the
player drives; drivers follow them and produce only a `ControlInput`. No speed or grip cheats.

## Pipeline (`npm run ai:build`)

1. **Envelope** (`src/envelope/`): drive the car through quasi-steady manoeuvres on flat ground
   (lateral sweeps, threshold stops, full-throttle runs, braking in a turn; at 0.8, 1 and 1.2 g of
   normal load) and tabulate what it can do against speed. About 1 s.
2. **Line** (`src/line/`): the corridor (the legal one of `limits.ts`: the four-wheel track-limit
   rule with the car's footprint and allowances, tyres only on track, kerbs up to their crest and
   asphalt run-off; or the older fixed-margin one),
   the minimum-curvature line (a box-constrained QP on a cyclic pentadiagonal Hessian, a few
   Gauss–Newton steps), then lap-time refinement with smooth C² bumps and the speed profile in the
   loop. About 14 s.
3. **Speed profile** (`src/profile/`): corner limits, forward and backward passes with grade,
   banking and vertical curvature, DRS in the zones, MGU-K deployment within the per-lap budget.
   About 10 ms per line.
4. **Artefacts** (`data/`): `<circuit>-<trim>.envelope.json` and `<circuit>-<trim>.line.json`,
   each with a fingerprint of what produced it.

## Staleness

`npm run ai:build -- --check` and the physics suite recompute the fingerprints and compare them
with the stored ones (about 5 s). A fingerprint is behavioural: a hash of what the code
computes, every number rounded to six significant digits, never of source text. So a comment,
a rename or reformatting anywhere leaves the artefacts current, and any change in behaviour that
reaches them, in the sim, the track or this package, makes them stale.

- Envelope: the envelope is remeasured (about 1 s of driving) and the measurement, with the car's
  parameters, the air and the fuel, is the fingerprint.
- Racing line: a probe run of the pipeline on the real track: the corridor (widths, kerbs, frame
  limits), the minimum-curvature line, its geometry (positions, elevation and slopes from
  `Track.ground`, banking, surface grip under the wheels), its speed profile with the DRS zones, a
  short refinement pass, and the line configuration, skill and envelope fingerprint.

When either is stale the failure says so and what to do: run `npm run ai:build` (about 15–30 s),
then commit `packages/ai/data/<circuit>-<trim>.envelope.json` and `.line.json`. A behaviour change
the probes cannot see (a new input to the line that the probe does not exercise) needs the
`PROCEDURE` constant in `validation/lib/artefacts.ts` bumped with it.

## Driving

`createReferenceDriver({ track, line, envelope, params })` returns a `Driver`. Each tick it reads
`CarTelemetry`, projects the car onto the track and writes steering (preview curvature with
speed-scheduled lateral and course feedback over a yaw-rate loop, held within the front tyres'
peak slip angle), pedals (profile acceleration plus speed feedback, eased on wheelspin, lock-up
and slides), gears (engine-derived shift points, downshifts by road speed), DRS and the overtake
button. `DriverSkill` sets how much of the envelope it plans with, its lag and its errors. One
tick costs about 1.3 µs.

## Validation

`validation/reference-lap.test.ts` (physics job) drives an out-lap and one timed lap at Monza,
timed from the circuit's control line (`CircuitSetup.controlLine`); the ten-lap soak
is `validation/soak/` (nightly). `npm run telemetry -- lap` prints the tables and writes a trace.
Results and the time-loss analysis: `docs/physics-validation.md` section 7.6.

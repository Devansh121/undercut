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
button. `DriverSkill` sets how much of the envelope it plans with, the lag of its hands and feet
and its errors. One tick costs about 1.3 µs.

The reference driver is an **ideal, telemetry-driven reference controller**, a measuring
instrument and not a model of a human. With the car's built-in TC and ABS off, it reads exact
per-wheel slip ratio, slip angle and load and the car's exact sideslip every tick, with no lag
or noise, and from them regulates the pedals (lock and wheelspin thresholds) and recovers from
slides (countersteer, brake release) instantly. That is a driver aid no human has.

**Requirement for race AI.** Race-AI skill parameters must add sensing lag and noise to what the
driver reads (slips, loads, sideslip, position on the line), not only lag and noise to what it
writes (`reaction`, `steerNoise`, `pedalNoise`). An AI that reads the car exactly, as this
controller does, regulates slip better than any player can.

## Racing

`createRaceDriver({ track, line, envelope, params, skill })` returns a `RaceDriver`: the
reference controller underneath (same steering, pedals and gears, same physics, no cheats), on a
plan made with the driver's `RaceSkill` (pace, braking, consistency, reaction, sensing, aggression),
with racecraft on top. The race passes it a `TrafficView` before each tick (`sense`).

- **Sensing limits** (the requirement above): the slip and load it feels lag by `senseLag` and
  carry noise; its position on the track carries an error that drifts with distance driven (up to
  0.15 m); other cars are seen 300 m ahead and 40 m behind, where they were 0.12 s ago, with the
  width they take across the track (more when spun).
- **Gap keeping**: a time gap of 0.15 to 0.3 s on a straight, 0.35 to 0.6 s into braking zones and
  corners (by aggression), never closer than Gipps' safe speed: able to stop to the other car's
  speed if it braked as hard as this car can at the slower of the two speeds, after its perception
  and reaction delay.
- **Lanes**: an offset from the racing line, side by side a car's width and 0.8 m of air from the
  other car, never across it; where there is no room for both, the car further back falls in
  behind. Into a braking zone the car ahead owns the corner unless the other is alongside. Off line
  in a corner it slows for the tighter radius. A lane change checks closing cars behind on that
  side; at speed the lateral room opens before a faster car reaches the rear quarter.
- **Passing**: on a straight, with a pace advantage or after being held up, it moves out to a side
  with room; it gives up if not alongside by the braking zone, unless its inside move can reach
  alongside by turn-in. While attacking on a straight it can use the speed available in a tow
  or with DRS above the solo lap's target, with the normal braking profile restored before the
  braking zone and the traffic ceiling always applied.
- **Defending**: with clear road ahead, one move toward the next corner's inside; the chosen
  side stays fixed as the attacker changes sides. Mirror and side-by-side clearance still apply.
- **Blue flag**: off line to the side away from the car lapping it, held until it is by.
- **Recovery**: facing the wrong way or stuck, it waits on the racing surface for the traffic, turns
  round with forward and reverse lock, and rejoins off line while cars approach.

Decision tests: `test/race-driver.test.ts`; closed loop on the sim: `packages/race/validation`.

## Validation

`validation/reference-lap.test.ts` (physics job) drives an out-lap and one timed lap at Monza,
timed from the circuit's control line (`CircuitSetup.controlLine`); the ten-lap soak
is `validation/soak/` (nightly). `npm run telemetry -- lap` prints the tables and writes a trace.
Results and the time-loss analysis: `docs/physics-validation.md` section 7.6.

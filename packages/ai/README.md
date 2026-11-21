# @undercut/ai

AI drivers. A racing line and speed profile are computed offline from the same vehicle model the
player drives; drivers follow them and produce only a `ControlInput`. No speed or grip cheats.

## Pipeline (`npm run ai:build`)

1. **Envelope** (`src/envelope/`): drive the car through quasi-steady manoeuvres on flat ground
   (lateral sweeps, threshold stops, full-throttle runs, braking in a turn; at 0.8, 1 and 1.2 g of
   normal load) and tabulate what it can do against speed. About 1 s.
2. **Line** (`src/line/`): the track corridor (white lines, half track, margin, optional kerb use),
   the minimum-curvature line (a box-constrained QP on a cyclic pentadiagonal Hessian, a few
   Gauss–Newton steps), then lap-time refinement with smooth C² bumps and the speed profile in the
   loop. About 14 s.
3. **Speed profile** (`src/profile/`): corner limits, forward and backward passes with grade,
   banking and vertical curvature, DRS in the zones, MGU-K deployment within the per-lap budget.
   About 10 ms per line.
4. **Artefacts** (`data/`): `<circuit>-<trim>.envelope.json` and `<circuit>-<trim>.line.json`,
   each with a hash of its inputs. `npm run ai:build -- --check` (and the physics suite) report a
   stale file when the car, the track or the code changed.

## Driving

`createReferenceDriver({ track, line, envelope, params })` returns a `Driver`. Each tick it reads
`CarTelemetry`, projects the car onto the track and writes steering (preview curvature with
speed-scheduled lateral and course feedback over a yaw-rate loop, held within the front tyres'
peak slip angle), pedals (profile acceleration plus speed feedback, eased on wheelspin, lock-up
and slides), gears (engine-derived shift points, downshifts by road speed), DRS and the overtake
button. `DriverSkill` sets how much of the envelope it plans with, its lag and its errors. One
tick costs about 1.3 µs.

## Validation

`validation/reference-lap.test.ts` (physics job) drives one flying lap at Monza; the ten-lap soak
is `validation/soak/` (nightly). `npm run telemetry -- lap` prints the tables and writes a trace.
Results and the time-loss analysis: `docs/physics-validation.md` section 7.6.

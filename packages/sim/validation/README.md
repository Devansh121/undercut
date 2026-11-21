# Physics validation suite

Runs as the `physics` CI job: `npm run test:physics`. Every check drives the real vehicle model
headless at the game's 240 Hz step through scripted manoeuvres in `lib/`, the same code the
telemetry runner (`npm run telemetry`) uses, so a number in a test, in the runner's table and in
`docs/physics-validation.md` (Results) is the same number.

| File | What it checks | Source of the target |
| --- | --- | --- |
| `acceleration.test.ts` | 0–100, 0–200, 0–300 km/h, medium trim, 105 kg, no launch control, best of 5 launches | doc 2.3 |
| `top-speed.test.ts` | Maximum speed, low trim, DRS open, MGU-K deploying, Monza air; DRS and trim effects | doc 2.2 |
| `braking.test.ts` | Seven published braking events (distance, time, 50 ms peak) with the best bias in 52–62 % and the event pedal profile; start and end conditions; the single fit; peak deceleration against speed, monotonic | doc 2.4 |
| `lateral.test.ts` | Sustained (0.5 s) lateral g at constant speed: Pouhon, Parabolica exit, slow corners per trim | doc 2.5 |
| `invariants.test.ts` | Determinism, snapshot round trip, seeded fuzz (no NaN, no runaway), no free energy at rest, coasting loses energy, ERS per-lap limits and store window, standstill on a 10 % grade with 8 % cross-slope, smooth roll-away and creep | brief |
| `handling.test.ts` | Step steer settles; lift-off from 60–95 % of the limit does not spin; traction control and ABS keep the car stable from 85 % of the limit; ABS prevents lock-up and shortens a stop from 300 km/h | brief (keyboard and phone play) |
| `time-base.test.ts` | Sim clock exact over an hour at 1 kHz | M0 |

## Targets, tolerances and gaps

`lib/targets.ts` holds every target with the doc's tolerance as a band. Nothing here loosens a
tolerance. A target the model misses with defensible parameters is listed in `KNOWN_GAPS` with
the value measured when it was recorded and the reason; its test asserts that the gap is still
there and has not moved by more than 5 % of the band's half-width. So the test turns red when
the gap closes (move it to passing) or when it widens (find out why). The Results section of
`docs/physics-validation.md` lists the same gaps.

Five targets are fits, not checks (`FIT_TARGETS` in `lib/targets.ts`, marked `fit` in the
table): the tyre's longitudinal friction and its load slope were fitted to 0–100 km/h and the
Monza T1 2025 and Singapore T7 2025 braking peaks, the lateral friction to the low-trim
slow-corner lateral, and the low-trim drag area to the top speed. A test asserts the marked set is
exactly that list; every other target checks the model. The doc's Results section has the fit
method and the targets used only to choose among estimates.

The published braking events are driven as the source describes them, with one pedal profile for
all of them (`TRAIL_OFF` in `lib/drivers.ts`): full pedal within 80 ms, eased whenever a wheel
passes 10 % slip, and an assumed pedal ceiling over the last 25 % of the speed drop, down to 30 %
at the corner speed. The ceiling's constants are unsupported estimates and it barely acts (the
threshold controller already asks for less); it does not reproduce the trail braking in the
published times. Each run starts within 0.05 km/h of the stated speed after an approach with DRS
open, and the end crossing is interpolated; the suite asserts both.

`npm run telemetry -- calibrate` runs every target here plus the reference lap, its sectors and
corner speeds, for the committed car or a candidate parameter file (`--set`); see
`tools/telemetry/README.md`.

## Reference laps

Doc section 2.1 (the reference lap) and the speed trap of 2.2 are measured by the AI's reference
driver on the circuit surface, so they live in `packages/ai/validation/` (the sim may not import
the AI) and run in the same `physics` job: `reference-lap.test.ts` drives one flying lap at
Monza and judges it with the same target bands and the same recorded-gap rule as this suite.
The ten-lap soak runs nightly (`npm run test:soak`). Results: doc section 7.6.

## Adding a check

1. Add the target to `lib/targets.ts` with the doc's numbers and source.
2. Add or reuse a manoeuvre in `lib/manoeuvres.ts` and a measurement in `lib/measure.ts`.
3. Add it to the runner's `validate` table in `lib/catalogue.ts` and to a test file here.
4. Run `npm run telemetry -- validate` and update the Results section of the doc.

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

One quantity is a fit, not a check: the tyre's peak lateral friction μy was fitted to the Monza
T1 2025 peak deceleration (4.7 g) and came out at 1.80, the doc's own estimate. That target is
marked `fit` in the table (`FIT_TARGET`), and a test asserts it is the only one; every other target
checks the model.

The published braking events are driven as the source describes them, with one pedal profile for
all of them (`TRAIL_OFF` in `lib/drivers.ts`): full pedal within 80 ms, eased whenever a wheel
passes 10 % slip, and trailed off over the last 25 % of the speed drop to 30 % pedal at the
corner speed. Each run starts within 0.05 km/h of the stated speed after an approach with DRS
open, and the end crossing is interpolated; the suite asserts both.

## Reference laps (placeholder)

Doc section 2.1 (lap time within ±5 % at M1 and ±3 % at M4 of the era's pole laps at Monza, Spa
and Singapore) and section 2.2 (sector times and speed traps) need a real circuit surface and a
reference driver. They arrive with the track package and the AI's reference driver, which will
add `reference-lap.test.ts` here using the same harness and target table. There is deliberately
no skipped test standing in for them.

## Adding a check

1. Add the target to `lib/targets.ts` with the doc's numbers and source.
2. Add or reuse a manoeuvre in `lib/manoeuvres.ts` and a measurement in `lib/measure.ts`.
3. Add it to the runner's `validate` table in `lib/catalogue.ts` and to a test file here.
4. Run `npm run telemetry -- validate` and update the Results section of the doc.

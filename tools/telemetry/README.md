# Telemetry runner

Runs scripted manoeuvres headless against `@undercut/sim`, prints result against target and
tolerance, and writes traces and summaries to `artifacts/telemetry/` (git-ignored).

```sh
npm run telemetry -- list              # the manoeuvres
npm run telemetry -- validate          # every doc section 2 target this suite covers
npm run telemetry -- all               # every manoeuvre
npm run telemetry -- braking --speeds 320,280,240
npm run telemetry -- cornering --trim high --speeds 85,150,250
npm run telemetry -- bench             # real-time factor, 1 and 20 cars
npm run telemetry -- lap               # reference driver, flying lap at Monza
npm run telemetry -- lap --laps 10     # ten consecutive laps (fuel for all of them)
npm run telemetry -- lap --circuit spa # the same at Spa (medium trim) or singapore (high trim)
npm run telemetry -- race --circuit monza --cars 20 --laps 5 --seed 1
npm run telemetry -- weekend --cars 20 --laps 5 --qualifying 600 --seed 1
npm run telemetry -- budget            # where each reference lap's time goes (--circuit spa)
npm run telemetry -- calibrate         # every target + the Monza lap, one score
npm run telemetry -- calibrate --set candidate.json [--line rebuild] [--only targets|lap]
```

| Manoeuvre | What it does |
| --- | --- |
| `standing-start` | Launch to 300 km/h, medium trim, 105 kg fuel, driver holds wheelspin; best of 5 (`--slip` for one) |
| `top-speed` | Long flat straight from 200 km/h per trim, DRS open and closed, Monza air |
| `braking` | The published braking events (with the event pedal profile), then threshold stops from `--speeds` in Monza trim |
| `cornering` | Constant-speed sweeps to sustained lateral g per trim (`--trim`, `--speeds`) |
| `step-steer` | Step steer at 80, 150 and 250 km/h: rise time, overshoot, sideslip |
| `lift-off` | Lift the throttle mid-corner at 60–95 % of the lateral limit with the wheel held; pass means no spin |
| `kerbs` | The track file's kerb profiles (flat, exit, chicane) crossed at fixed speed and lateral speed, holding heading: per-wheel load range, contact loss, carcass damping force, largest load step, plank force, yaw; `kerb-*.csv` traces |
| `coast-down` | Neutral from 320 km/h: deceleration against speed |
| `assists` | Full throttle out of a slow corner and full brake in a turn (both at 85 % of the limit) with TC or ABS 0–3; full-pedal straight stop from 300 km/h with ABS 0–3 |
| `validate` | The table of every target: result, stated target, band, verdict (pass, gap, fail) |
| `lap` | The reference driver on the committed racing line (`packages/ai`): an out-lap, then timed lap(s) from the control line at Monza, Spa or Singapore (`--circuit`) in the doc 2.1 conditions; lap, sector, corner, corner-geometry and trap tables against the published figures, driver cost per tick; `lap-<circuit>.csv` (s, speed, target, pedals, steer, gear, rpm, g, DRS, ERS, line and lateral error, sideslip, wheel slip and load) and `lap-<circuit>.json` (`--laps`, `--fuel`, `--every` ticks between trace rows) |
| `budget` | The reference lap's time-loss budget per circuit (docs/physics-validation.md 7.10): driven lap, the driver's plan and the full-envelope plan by sector and by phase (braking, corners, traction exits, straights); what +5 % of lateral, braking, traction or propulsion, −5 % drag, no DRS and no MGU-K are worth; the factor on lateral grip or propulsion alone that reaches each published sector; and the full envelope with lateral grip scaled by the published Pouhon figure. `budget.json` |
| `race` | AI cars race at Monza from a standing start (`packages/race`): `--cars` (20), `--laps` (5), `--seed` (1), `--spread` of skill 0–1 (0.5), `--no-pit` (otherwise one tyre stop each around half distance for races of five laps or more). Prints the classification, the event log (positions, sectors and speed traps counted, everything else listed), per-car first-lap position, slowest point and track-limit figures, the watchdog's findings, the first-lap overlap count (cars are ghosts to each other), the speed and a digest of the result so two runs can be compared; writes `race-monza-c<cars>-l<laps>-s<seed>.json` with the result and every event |
| `weekend` | Qualifying (`--qualifying` seconds, 600; `--practice` seconds to add practice) and then the race on the grid from qualifying, with the same output per session |

`calibrate` is the calibration harness: the 32 component targets (role, result, band, in or out,
miss in band half-widths, the recorded gap), then the Monza lap with a freshly measured envelope
(driven lap, the driver's plan and the full-envelope plan, sectors, corners, the corner-geometry
table and the doc 2.6 reference corner speeds), and a score: the summed misses of every target
and the M1 lap band. About 5 s. `--set` takes a JSON file of parameter values laid out like
`CarParams`, with aero keyed by trim (`{"tyre": {"muY": 2.1}, "aero": {"low": {"clA": 3.9},
"all": {"floorShare": 0.5}}}`); it is applied by rewriting `createCarParams` as params.ts loads,
so the physics manoeuvres, the envelope measurement and the lap runner all build that car, and an
unknown parameter name is an error. The committed racing line is kept unless `--line rebuild`
(about 15 s more). It writes `calibrate.json` (or `--out`); it never edits the repository.

Each run writes `<name>.csv` per trace (40 Hz rows: speed, rpm, gear, pedals, g, per-wheel
load, slip ratio and slip angle, ride heights, pitch, roll, aero forces, DRS, ERS, fuel, yaw
rate, distance) and `<manoeuvre>.json` with the table rows and a summary. Numbers are rounded
to six significant digits so traces diff cleanly between runs.

The manoeuvres themselves live in `packages/sim/validation/lib` and are shared with the physics
suite. `cli.mjs` loads that TypeScript through Vite's module runner and only does file output and
timing (the sim never reads a clock).

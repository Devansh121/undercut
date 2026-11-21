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
```

| Manoeuvre | What it does |
| --- | --- |
| `standing-start` | Launch to 300 km/h, medium trim, 105 kg fuel, driver holds wheelspin; best of 5 (`--slip` for one) |
| `top-speed` | Long flat straight from 200 km/h per trim, DRS open and closed, Monza air |
| `braking` | The published braking events, then threshold stops from `--speeds` in Monza trim |
| `cornering` | Constant-speed sweeps to sustained lateral g per trim (`--trim`, `--speeds`) |
| `step-steer` | Step steer at 80, 150 and 250 km/h: rise time, overshoot, sideslip |
| `lift-off` | Lift the throttle mid-corner with the wheel held; pass means no spin |
| `coast-down` | Neutral from 320 km/h: deceleration against speed |
| `assists` | Full throttle out of a slow corner with TC 0–3, full brake in a turn with ABS 0–3 |
| `validate` | The table of every target: result, stated target, band, verdict (pass, gap, fail) |

Each run writes `<name>.csv` per trace (40 Hz rows: speed, rpm, gear, pedals, g, per-wheel
load, slip ratio and slip angle, ride heights, pitch, roll, aero forces, DRS, ERS, fuel, yaw
rate, distance) and `<manoeuvre>.json` with the table rows and a summary. Numbers are rounded
to six significant digits so traces diff cleanly between runs.

The manoeuvres themselves live in `packages/sim/validation/lib` and are shared with the physics
suite. `cli.mjs` loads that TypeScript through Vite's module runner and only does file output and
timing (the sim never reads a clock).

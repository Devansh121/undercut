# Race Weekend and player pits

All runs use the shipped circuit trim, tyre condition and real car contact. The weekend proof
skips practice, runs the documented 18-minute single qualifying session, uses its classification
for the grid and runs five laps with the two-compound rule. Twenty scripted drivers represent
the player and nineteen opponents. Stop decisions come from the same pit wall as the game.

| Circuit | Seed | Valid qualifying times | Race classified | Compound changes | Watchdog findings |
| --- | --- | --- | --- | --- | --- |
| Monza | 1 | 20 / 20 | 20 / 20 | 20 / 20 | 0 |
| Spa-Francorchamps | 1 | 20 / 20 | 20 / 20 | 20 / 20 | 0 |
| Singapore Marina Bay | 1 | 20 / 20 | 20 / 20 | 20 / 20 | 0 |

Monza and Spa: 2 tests passed, 321.37 s wall time, two workers before the owner's reduced-load
instruction. Singapore: 1 test passed, 356.60 s wall time. The initial six-minute qualifying
fixture left one Singapore driver without a valid lap; the proof now uses the documented
session duration. No classification or watchdog assertion was relaxed.

Player stops run through `DriveSession`, with scripted steering inputs into the lane and the
same crew assist the player uses. Each circuit checks call/cancel, fresh hard tyres, 2.4–3.2 s
of service, zero contact through entry and exit, a bounded loss against an on-track traversal,
and the compound/stop history. An uncalled second visit drives through without service; turning
the automatic limiter off and entering fast produces the speeding offence. Three tests passed
in 45.19 s. Approach through release: Monza 39.542 s, Spa 40.467 s, Singapore 45.108 s.

The two-car pit-entry probes at seeds 3141 and 2718 both enter, service and exit without contact
(2 tests passed, 3.38 s). Full twenty-car five-lap scheduled-stop races on both recorded seeds
also pass: every car classified with one stop, no watchdog findings and no contact at or above
10 m/s anywhere (2 tests passed, 171.27 s, run sequentially with reduced process priority).

A restored automatic-pit session continues bit for bit for 110 s through the stop decision;
its events and final complete snapshot match (1 test passed, 7.65 s). Weekend save/load tests
cover qualifying grids, three rounds of points, duplicate-result rejection and storage failure.

Commands (one long simulation at a time on the shared laptop):

```sh
nice -n 10 npx vitest run --project soak packages/race/validation/weekend-monza.soak.test.ts --maxWorkers=2
nice -n 10 npx vitest run --project soak packages/race/validation/weekend-spa.soak.test.ts --maxWorkers=2
nice -n 10 npx vitest run --project soak packages/race/validation/weekend-singapore.soak.test.ts --maxWorkers=2
nice -n 10 npx vitest run --project soak packages/race/validation/pit-entry.soak.test.ts --maxWorkers=2
nice -n 10 npx vitest run --project physics apps/web/validation/player-pit.test.ts packages/race/validation/pit-entry.test.ts packages/race/validation/strategy-restore.test.ts --maxWorkers=2
```

Browser validation: 6 passed, 4 viewport-specific skips in 54.7 s. Desktop and phone smoke
both cover the real flow and service countdown. The menu clipping sweep passes at 1440×900,
1280×720 and 844×390, and the touch overlay stays clear of the input-lab panels. The screenshots
were inspected: [weekend menu](weekend-desktop.png), [phone after release](pit-release-phone.png).
The driving frame uses the software-rendered Lite world for the browser budget; it is evidence
of controls and HUD placement, not the dressed circuit's visual quality.

Local logs, traces and frames are kept small under
`/home/devansh/.cache/undercut/scratch/m4-race-weekend/`.

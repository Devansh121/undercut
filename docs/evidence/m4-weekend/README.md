# Race Weekend and player pits

All runs use the shipped circuit trim, tyre condition and real car contact.

## Weekend acceptance (nightly soak)

The weekend proof skips practice, runs the documented 18-minute single qualifying session, uses
its classification for the grid and runs five laps with the two-compound rule. Twenty scripted
drivers represent the player and nineteen opponents. Stop decisions come from the same pit wall
as the game. Qualifying and the race are separate tests, each with the soak's 600 s limit.

| Circuit | Seed | Valid qualifying times | Race classified | Compound changes | Watchdog findings |
| --- | --- | --- | --- | --- | --- |
| Monza | 1 | 20 / 20 | 20 / 20 | 20 / 20 | 0 |
| Spa-Francorchamps | 1 | 20 / 20 | 20 / 20 | 20 / 20 | 0 |
| Singapore Marina Bay | 1 | 20 / 20 | 20 / 20 | 20 / 20 | 0 |

These figures are from the run before the split (head c66f062) and the independent review's
rerun; the split changes neither session.

## Pit strategy

- Undercut and extend, per PR (`packages/race/validation/strategy-scenarios.test.ts`, Monza,
  two cars, eight laps): with half-worn tyres close behind a rival on lap 2 the follower is called
  in for an undercut a lap before its planned stop and rejoins without contact; with the rival
  called in on the follower's planned lap the follower stays out (logged `extend`) and stops on
  the next lap. 3 tests with the restore test, 16 s.
- Two stops, nightly (`strategy-two-stop.soak.test.ts`, Monza full distance, three cars, seed 11):
  every car stops on laps 17 to 19 and 35 to 37 and is classified. 132 s. The watchdog records
  22 off-track and standstill findings at full fuel load (docs/STATUS.md, known gaps).

## Pit entry

The per-PR replay of the seed 3141 incident was retired in the weekend follow-ups (docs/STATUS.md):
with the new pit-lane entry, no race on ten seeds has a pit-entry contact with the rule disabled.
`packages/ai/test/race-driver.test.ts` (the Monza entry case) still fails with the rule disabled.

## Player stops

`apps/web/validation/player-pit.test.ts`: call and cancel, fresh hard tyres, 2.4 to 3.2 s of
service, no contact, drive-through and speeding; at the start of service the stopped-car prompt
stays off and Reset to track is ignored. Time lost to a stop, against the same run without one
(scripted racing driver, 700 m before the entry to 600 m after the exit): Monza 34.0 s, Spa 24.3
s, Singapore 32.1 s, bounded per circuit. Most of it is the authored limited zone (511 to 590 m
at 80 km/h); docs/race-rules.md has the breakdown. 6 tests, 125 s.

`apps/web/validation/simulate-session.test.ts`: after a timed qualifying lap the car goes back to
its box, is held there to the flag, and the classification keeps its best lap. 90 s.

## Browser

Weekend smoke on desktop (practice simulated to the flag, the result table, qualifying, the race
with a player stop) and phone (practice skipped), plus the menu clipping sweep: 5 passed, 3
viewport skips, 1.4 min. Frames inspected: [practice result](practice-result-desktop.jpg),
[pit panel under the map](pit-panel-desktop.jpg), [weekend menu](weekend-desktop.png),
[phone after release](pit-release-phone.png). The driving frames use the software-rendered Lite
world for the browser budget; they show controls and HUD placement, not the dressed circuit.

## Commands

One long simulation at a time on the shared laptop:

```sh
nice -n 10 taskset -c 4-7 npx vitest run --project soak packages/race/validation/weekend-monza.soak.test.ts --maxWorkers=2
nice -n 10 taskset -c 4-7 npx vitest run --project soak packages/race/validation/strategy-two-stop.soak.test.ts --maxWorkers=1
nice -n 10 taskset -c 4-7 npx vitest run --project physics apps/web/validation/player-pit.test.ts apps/web/validation/simulate-session.test.ts packages/race/validation/strategy-scenarios.test.ts packages/race/validation/strategy-restore.test.ts --maxWorkers=2
```

## Weekend follow-ups

- Pit time loss (player-pit, field retired): Monza 31.6 s, Spa 23.2 s, Singapore 29.1 s (were
  34.0, 24.3 and 32.1); breakdown in docs/race-rules.md.
- Soaks on the final code, one at a time on two cores: pit-entry 2 passed (188 s), weekend
  Monza 2 passed (298 s), Spa 2 passed (373 s; an earlier version classified 8 of 20, which led to
  the steep-join rule), Singapore 2 passed (323 s), full-distance two-stop 1 passed with no
  watchdog findings (120 s). Physics project: 364 passed with the final bounds. Unit: 1826 passed, 30 expected fail.
- Full-distance fuel, three cars, first 700 s at Monza: 21 off-track excursions at the Parabolica
  before the mass factor, none after.
- Simulate to end of session, a 300 s practice simulated from the start, desktop Lite world:
  86.8 s (was 90.0 s).


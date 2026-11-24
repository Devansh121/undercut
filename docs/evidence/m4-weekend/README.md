# Race Weekend and player pits

Weekend and player-stop runs use the shipped circuit trim, tyre condition and real car contact.
The Spa scheduled-stop regression deliberately keeps the validation runner's defaults: reference
tyres and its constant session fuel, independent of weekend strategy.

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
  every car stops on laps 17 to 19 and 35 to 37 and is classified with no watchdog findings
  after the fuel-mass correction (reviewed head `37f6aba`, 120 s). The earlier pre-correction
  full-fuel run recorded 22 off-track and standstill findings; this is historical
  failure evidence, not the current result.

## Pit entry

The per-PR replay of the seed 3141 incident was retired in the weekend follow-ups (docs/STATUS.md):
with the new pit-lane entry, no race on ten seeds has a pit-entry contact with the rule disabled.
`packages/ai/test/race-driver.test.ts` (the Monza entry case) still fails with the rule disabled.

## Player stops

`apps/web/validation/player-pit.test.ts`: call and cancel, fresh hard tyres, 2.4 to 3.2 s of
service, no contact, drive-through and speeding; at the start of service the stopped-car prompt
stays off and Reset to track is ignored. Time lost to a stop, against the same run without one
(scripted racing driver, 700 m before the entry to 600 m after the exit), at `c00adb4`: Monza
29.50 s, Spa 21.41 s, Singapore 29.58 s. The current limited zones are 418.5 m, 386.2 m and
403.7 m respectively. The unchanged ceilings are 32.6 / 24.2 / 30.1 s; the segment trace and
remaining gaps are in docs/race-rules.md. The older 34.0 / 24.3 / 32.1 s measurements and
511–590 m zones belonged to the pre-follow-up geometry, not the current result.

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

- Pit time loss (player-pit, field retired): Monza 29.50 s, Spa 21.41 s, Singapore 29.58 s (were
  34.0, 24.3 and 32.1); breakdown in docs/race-rules.md.
- Earlier follow-up soaks (reviewed head `37f6aba`), one at a time on two cores: pit-entry 2 passed (188 s), weekend
  Monza 2 passed (298 s), Spa 2 passed (373 s; an earlier version classified 8 of 20, which led to
  the steep-join rule), Singapore 2 passed (323 s), full-distance two-stop 1 passed with no
  watchdog findings (120 s). Physics project: 364 passed with the final bounds. Unit: 1826 passed, 30 expected fail.
- Full-distance fuel, three cars, first 700 s at Monza: 21 off-track excursions at the Parabolica
  before the mass factor, none after.
- Simulate to end of session, a 300 s practice simulated from the start, desktop Lite world:
  86.8 s (was 90.0 s).


### Review regression and pit-loss trace

The first review-fix check at `c00adb4` restored both the reviewed head's pit follower and
its old paths: 25 watchdog findings, 1 failed test (169.28 s). That combined mutation is
historical evidence of the old jam; it did **not** prove protection against the throttle
change alone. The round-2 guard below supersedes that claim. The corrected implementation
uses the original 0.05 throttle floor and 2/s recovery, exit-bend caps and the full
`expectCleanRace` assertions.
No pit-loss ceiling or race assertion was relaxed. The new test is included in the physics
shard weights.

`player-pit.test.ts` now logs entry, box, release, exit and baseline crossings. Its measured
losses are 29.50 / 21.41 / 29.58 s; the detailed reconciliation is in
[the race rules](../../race-rules.md#pit-time-loss). The unchanged ceilings are
32.6 / 24.2 / 30.1 s. Player control returns at the actual lane exit, removing the extra 60 m
of low-speed assisted merging. The approach and merge geometry stay as tested.

The simulate bar reserves its last 15 percent for cars taking the flag and reports how many
are done. Garage pit-call controls are hidden, including on touch; during service the disabled
call button reads “In the box”. Browser assertions cover both states.

First-review local verification at `c00adb4`: 7 physics tests passed in 316.12 s (Spa seed 17 with all clean-race
assertions, plus all six player-pit tests), 2 desktop/phone browser tests passed in 2.1 min,
6 stopped-prompt/weekend unit tests and 4 shard-manifest tests passed. Lint, full typecheck
and build/transfer budgets passed. Logs and frames are in
`/home/devansh/.cache/undercut/scratch/m4-weekend-followups/` (`fixed-physics.log`,
`spa-reviewed-head.log`, `browser-review/`).

### Round-2 isolated throttle guard

Only two expressions in `packages/ai/src/driver/path-follower.ts` were temporarily changed:
the throttle floor from 0.05 to 0.2 and recovery from 2/s to 4/s. The current pit paths stayed
unchanged. The source was restored immediately after each mutation run.

- Focused follower tests: the mutation fails both cases. Sustained wheelspin commands 0.20
  instead of 0.05; after 0.1 s without wheelspin it commands 0.60 instead of 0.25. The correct
  follower passes all six unit tests.
- Spa seed 17, twenty cars, five laps, the runner's default scheduled stops: the isolated
  mutation records 5,691 samples after at least 0.25 s of continuous rear-wheel slip above
  0.12 while in the lane. Its maximum throttle command is 0.20, so the strengthened race
  test fails the 0.05 safety contract (201.11 s).
- With the correct follower restored, the same race passes in 155.15 s: 496 observed samples,
  maximum throttle 0.05, all 20 cars classified, zero watchdog findings and zero stuck cars.
  The focused follower suite passes all six tests; lint, the AI/race typechecks and all four
  shard-manifest tests pass. Logs are `round2-spa-mutated.log`, `round2-spa-fixed.log`,
  `round2-follower-mutated.log` and `round2-follower-fixed.log` in the scratch directory above;
  `round2-isolated-mutation.diff` records the exact two-expression mutation.

The corrected paths can mask the original jam; this guard does not claim that the isolated
mutation still produces 25 findings or seven stuck cars. It checks actual controller commands
in the real race, requires a nonzero observation count, and retains the finisher count, no
watchdog/stuck cars, one stop each and all `expectCleanRace` assertions. The focused tests
also protect recovery independently of whether that race exposes an unsafe recovery spike.

The open-PR snapshot also includes #80 (Singapore tree-swap stability, reflect-flag tests and
night-window filtering). The earlier claim that #57, #76 and #77 were the complete inventory
was incorrect.

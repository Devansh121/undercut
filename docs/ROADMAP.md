# Roadmap

Each milestone ends with something playable merged to master. The slicing may change as we learn; slices stay vertical.

Last updated 23 Nov 2026, at the pause tagged `v0.5.0` (PRs #1 to #53 merged, plus this roadmap). The hosted build follows master after each merge (`docs/DEPLOY.md`).

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 Foundations | Repo, CI, the one-command local run, ADRs for era, stack and netcode. A one-page visual direction with an HTML mock of the HUD and a menu. An asset source survey with licences. The car-model decision. | Done (#1, #2, #3) |
| M1 Drive | One car on one circuit in time trial. Vehicle model v1, the input layer with keyboard, gamepad and basic touch, chase and cockpit cameras, a plain HUD, engine audio v1, the telemetry runner and the validation suite. Reference lap within 5% for now. | Playable and merged (#4 to #10, #14, #17, #19, #26, #29). Open: the Monza reference lap is 84.872 s against the 74.852–82.732 s band (2.14 s outside), recorded as a gap in `docs/physics-validation.md` 7.6 |
| M2 Look | Rendering pipeline, the real car with liveries, a dressed circuit, time-of-day lighting, the broadcast HUD, menus on the design system, quality presets. The screenshot stations pass the thumbnail test. | Mostly done: render pipeline (#16), car (#11, #33), interface kit and menus (#30), dressing for all three circuits (#31, #37, #49, #50), model kits (#27, #40, #47). Open: place the kit's grandstands, gantry, pit building and crowd (in progress), the race HUD |
| M3 Race | Twenty-car AI grid, start procedure, timing, flags, track limits and penalties, collisions and damage, DRS and ERS, results, Quick Race. A scripted race completes, and seeded starts get through turn one cleanly. | Done at Monza (#15, #28, #53). Open AI follow-ups listed below |
| M4 Weekend | Tyre compounds, wear and temperature, fuel, pit stops, qualifying, Race Weekend, Championship, and circuits two and three. Reference laps within 3%. | In progress. Done: Spa and Singapore tracks and racing lines (#18, #32, #38, #41, #42, #44). In review: Quick Race at Spa and Singapore (#52), tyres and fuel (#54), the physics time-loss budget (#55). Not started: Race Weekend and Championship |
| M5 Online | Rooms, lobby, invites, synchronized start, snapshots, host migration, reconnect, rematch. Two-browser tests, and a soak with injected latency, jitter and loss. | Done (#12, #21, #23, #45, #48). Open: restyle the lobby and results on the interface kit |
| M6 Finish | Touch controls and phone performance, an audio pass, onboarding, settings and rebinding, accessibility, installable PWA, credits, and the full acceptance run below. | In progress. Done: controls list (#20), audio (#22, #35, #51), Cloudflare hosting (#25), phone pass, onboarding and PWA (#39, #46). Open: full Settings screen with rebinding and accessibility, credits screen, real-phone acceptance, QUALITY.md scoring |

After v1: pick the weakest scorecard axis and raise it. Candidates are weather and wet tyres, safety car, replays, car setup, more circuits, public matchmaking, wheel support and a career mode.

## Where things stand (pause point, 23 Nov 2026)

### In progress (open PRs and branches)

| Work | Branch / PR | State at the pause |
| --- | --- | --- |
| Quick Race at Spa and Singapore (M4b slice 1) | `m4/quick-race-all-circuits`, #52 | CI green, conflicts with master. Review blocker: a queue of cars rear-ends a stopped car at Spa. Fixed at Bus Stop on every seed tried; Raidillon clean on two of four seeds (recorded as a gap, seed 1). Regression tests being written. Singapore off-track counts rose (Nicoll Highway 142 against 102, turn 13 38 against 13) and need a look before re-review |
| Tyres and fuel (M4b slice 2) | `m4/tyres-fuel`, #54 | CI green, conflicts with master. Review items to fix: AI grip scaling slows it on straights, turn-one regression on cold tyres, stale calibration, Spa and Singapore proof with tyres on, a supplier name to remove, HUD band rounding |
| Physics time-loss budget | `m4/physics-gap-budget`, #55 | Second review asked for changes: phase classification must count the hybrid deployment actually used, and the sector reconciliation must hold at 1 ms (it was loosened to 3 ms; Spa misses by 1.4 ms). Smaller: trim the CLI JSON (52 MB). Fixes being pushed. No game behaviour change |
| Kit structures and crowd in the world | `m2/kit-placement` | Just started: kit grandstands, start gantry, pit building, barriers and near-row crowd at all three circuits, kit levels uploaded at load |

### Next, in order

1. Finish and merge #55, #52, #54 (each: fixes, an independent review, merge, redeploy).
2. M4b slice 3: Race Weekend (practice, qualifying, race with a mandatory compound change, AI one- or two-stop strategy, pit stops through the lane) and Championship over the three circuits, phone-friendly menus. Includes the acceptance test: a scripted Race Weekend against nineteen AI cars on every circuit, headless, no stuck cars.
3. Interface slice 2: race HUD on the race engine's events (twenty-car tower, gaps, flags by sector, start lights, pit and penalty messages), results with classification and penalties, championship standings, the full Settings screen (rebinding per device, accessibility, HUD scale, units), credits screen, lobby and results restyled on the kit.
4. AI follow-ups: turn-one lane changes on seeds 1022 and 7307 (18/20), pit-entry rear-ends (seeds 3141, 2718), a player ghosted 2.5 s after a slow launch, contacts in moving packs, Singapore seed 119 (7/20 with three spins), a 22.4 m/s lap-1 contact on phone seed 4114380179.
5. Physics pace: the downforce shortfall (Spa +8.5 % against pole, Monza 2.14 s outside its band). An owner choice is open: the Monza first-chicane kerb checks block some gains; the default is to keep them.
6. Graphics polish: Singapore water by day, crowd figures, mid-distance trees.
7. Real-phone acceptance: everything provable without a device is in (#66: launch images, safe areas, audio unlock, haptics, iPhone 15 and Pixel 8 tests, ten-minute soak); left is one pass of `docs/real-phone-test.md` on an iPhone and an Android phone. Then the independent QUALITY.md scoring and the final acceptance run.
8. Small leftovers: the update bar over the pause card, desktop pause below the fold, no offline fallback for manual presets, results overlay showing raw `D1`/`notClassified`, Singapore day ambience.

### Done-criteria status

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Public repo, protected master, green CI | Done |
| 2 | M0–M6 merged | M0, M3 (Monza), M5 done; M1, M2, M4, M6 open |
| 3 | Physics validation on all three circuits within tolerance | Singapore inside; Monza and Spa outside, recorded as gaps |
| 4 | Scripted Race Weekend vs nineteen AI on every circuit | Not started (M4b slice 3) |
| 5 | Two-browser online test | Done, in CI |
| 6 | Keyboard, gamepad, touch on desktop and phone | Done in browser tests; real-phone check open |
| 7 | One command starts game and rooms | Done (`./start.sh`) |
| 8 | QUALITY.md scored | Not scored yet |
| 9 | Credits, manifest, no trademarks | In place; final audit open |

## When v1 is done

1. The repo is public, master is protected, and CI on master is green.
2. M0–M6 are merged with their checks passing.
3. The physics validation suite passes on all three circuits within the documented tolerances, sources cited.
4. A scripted Race Weekend (qualifying, then a race with a pit stop) against nineteen AI cars completes on every circuit with no stuck cars.
5. The two-browser online test passes: create, join by invite, synchronized start, the same final order on both sides, rematch, guest leaves, host leaves.
6. Keyboard, gamepad and touch all work; browser tests cover a desktop and a landscape phone viewport.
7. One documented command starts the game and the rooms service from the latest master on this machine, and a phone on the same Wi-Fi can open it and join a room. The game is also hosted on Cloudflare (see `docs/DEPLOY.md`).
8. `docs/QUALITY.md` scores physics, graphics and UI at 4 or more, and audio, AI, netcode, mobile and performance at 3 or more, each with evidence from the current build.
9. Every third-party asset is in the manifest and credits, and nothing real-world is trademarked.

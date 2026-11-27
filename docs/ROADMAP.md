# Roadmap

Each milestone ends with something playable merged to master. The slicing may change as we learn; slices stay vertical.

Last updated 27 Nov 2026 for the owner's Saturday 28 Nov checkpoint. Pre-releases v0.5.0 to v0.18.0 are published; v0.18.0 is the checkpoint build. The hosted build follows master after each merge (`docs/DEPLOY.md`).

## Where things stand (27 Nov 2026)

v1 is playable across all three circuits, with Time Trial, Quick Race, Race Weekend,
Championship and private online rooms. It is not yet accepted as complete: physics pace,
later-lap racecraft, actual-device checks and independent quality scoring remain open.

Merged since 25 Nov: #80, #57, #82, #76, #83, #81, #86, #84, #89, #87, #85 and #90,
in merge order. PR #88 (later-lap passing) is parked as a draft: its review asked for changes, the follow-up commits
have not been re-reviewed, and it is not counted as delivered.
The summaries below follow those PR bodies; pending or historical proof in a body is not
current-build certification. Player-facing changes are in `docs/STATUS.md`.

### Milestones M0–M6

| Milestone | Done | Open |
| --- | --- | --- |
| M0 Foundations | Public repo, protected master, CI, one-command local run, era/stack/netcode ADRs, visual direction and asset/car decisions (#1–#3). Browser CI now balances desktop and phone over two shards without reducing coverage (#89). | Latest-master CI must finish green; no remaining foundation feature gap. |
| M1 Drive | Playable Time Trial, vehicle model, keyboard/gamepad/touch, cameras, HUD, engine audio, telemetry and validation. | Monza reference pace remains outside even the initial ±5 % band. Keyboard/gamepad drivability, kerb/run-off launches and standstill creep remain recorded gaps. |
| M2 Look | Render pipeline, car and liveries, dressed circuits, presets, menus and settings. Kit structures/crowd (#57), tree transitions and distant windows (#80), race lights/tower/flags/results (#82), HUD data/setup (#86), Mobile scenery headroom (#83), sky/grass/night road (#84), cockpit mirrors/gloves/wheel/night shadow (#85) and online kit screens (#90) are merged. | Independent Graphics/UI ≥ 4 acceptance is outstanding. Repeated structures, distant crowd and tree cards remain tells; loading/memory costs and sky encoding remain recorded limitations. |
| M3 Race | Twenty-car Quick Race on all three circuits; starts, timing, flags, limits, penalties, contact/damage, DRS/ERS and results. #76 adds swept lane clearance, opening-lap lane holds, overlap room, defensive/switchback decisions and a guarded lap-two tow. | #76 explicitly does not establish sustained passing after lap one. #88 remains open: target three clean on-track passes per five-lap race, later-lap passes in eight of ten races per circuit, and a browser demonstration without worse safety. |
| M4 Weekend | All three circuits and racing lines, compounds/temperature/wear, fuel, player pit stops, qualifying, Race Weekend and saved Championship progression (#60 and merged follow-ups). Scripted weekends with nineteen opponents and a pit stop complete on every circuit. | Monza and Spa miss the ±3 % reference-lap bands. Tyre warm-up, Monza fuel-mass sensitivity and other recorded model gaps remain (`docs/physics-validation.md` 7.11). |
| M5 Online | Invite rooms, lobby, synchronized starts, snapshots, reconnect, migration and rematch. #81 adds all circuits, live timing/names, bounded contact and host AI fill to twenty; #87 keeps simulation/networking moving under delayed visible frames; #90 restyles entry/lobby/results with keyboard/gamepad/touch navigation. | Independent Netcode rescore and current-build acceptance. Contact remains approximate, migration restarts driver memory, and online uses reference tyres/topped-up fuel rather than offline strategy. Short circuit/contact/takeover tests are completed evidence; long full-field soaks remain an opt-in acceptance run. |
| M6 Finish | Touch/phone layouts, audio and ambience, onboarding, settings/rebinding, accessibility, installable PWA/offline Time Trial, asset manifest and credits. Device emulation and browser tests cover desktop and landscape phone; #83 restores Mobile grid geometry headroom. | Owner's actual iPhone/Android run of `docs/real-phone-test.md`, audio listening, independent `docs/QUALITY.md` scores and final current-build acceptance. Laptop Mobile-preset performance is not a physical-phone result. |

### Physics pace: unchanged after #74

| Circuit | Reference lap | Documented band | Result |
| --- | --- | --- | --- |
| Monza | 84.872 s | M1: 74.852–82.732 s; M4: 76.428–81.156 s | Outside by 2.140 s (M1) and 3.716 s (M4) |
| Spa | 109.072 s | M4: 97.545–103.579 s | Outside by 5.493 s |
| Singapore | 91.817 s | M4: 86.483–91.833 s | Inside by 0.016 s |

PR #74 measured sourced changes to lateral load sensitivity, shifting, drag, downforce and
floor-height sensitivity. Every candidate broke at least one passing check, so it retained
the car and the existing tolerances. Kerb safety blocked Monza gains; Spa drag/downforce
changes hit parked-car avoidance, heavy-fuel running or peak-g limits. Its next-step finding
was fuel-aware reference planning and AI avoidance that holds at higher approach speeds.
See `docs/physics-validation.md` 7.6, 7.8 and 7.12. Passing CI with recorded gaps does not
mean the all-circuit physics done-criterion has been met.

### Quality: historical audit, current rescore open

The latest independent pre-score audit is dated 26 Nov, on master `ed25dfb` after #57.
It did not accept criterion 8. `docs/QUALITY.md` still has no assigned current-build scores.
These are the audit's scores, not new scores for the merged build:

| Axis | Target | 26 Nov audit | Landed since / still needed |
| --- | --- | --- | --- |
| Physics | ≥ 4 | 3 | #74 kept the car unchanged; reference pace and drivability remain open. |
| Graphics | ≥ 4 | 3 | #83 Mobile scenery, #84 sky/grass/night road and #85 cockpit/shadows are merged. Independent frame review/rescore remains. |
| UI | ≥ 4 | 3 | #82 race display, #86 LAST/reference tyres/distance and #90 online screens address the audit's main missing pieces. Independent rescore remains. |
| Audio | ≥ 3 | 3, provisional | Measured renders were clean and level-safe; no listening acceptance yet (`docs/audio.md`). |
| AI | ≥ 3 | 2 | #76 safety subset merged; later-lap passing is deferred to open #88 and still needs proof. |
| Netcode | ≥ 3 | 2 | #81 contact/timing/all circuits/AI fill, #87 slow-frame stepping and #90 screens are merged. Independent rescore remains. |
| Mobile | ≥ 3 | 3 | #83 reduces scenery cost and #82/#86 improve race layout; actual-device heat, battery, gestures, sound and frame pacing remain untested. |
| Performance | ≥ 3 | 3 | Audit measured 58.6–60 fps means under shared-host load, with race 1 % lows of 27–41 fps and a Spa world-build slice of 3.0–3.7 s. Later graphics and Mobile changes need current-build acceptance; do not treat the audit as a new benchmark. |

The audit's projected improvements were conditional, not awarded scores. Its evidence did
not include first-hand physics feel or listening. The scoring playtester must be independent
of the feature builder and attach evidence from the current build.

### Nine done-criteria

| # | Criterion | Status | Reason |
| --- | --- | --- | --- |
| 1 | Public repo, protected master, green CI | Partly | Public visibility and protection verified, and every required check passes on master `c2e7c55`. The nightly soak has not passed since 22 Nov (see Nightly soak below), so CI is not fully green. |
| 2 | M0–M6 merged with passing checks | Partly | Playable milestone features are merged; M1/M4 pace, M2 quality, M3 racecraft and M6 device/quality acceptance remain open. |
| 3 | Physics validation within documented tolerances on all three circuits | Partly | Singapore is inside; Monza and Spa remain outside their reference-lap bands despite passing checks for recorded gaps. |
| 4 | Scripted qualifying and race with a pit stop vs nineteen opponents on every circuit, no stuck cars | Done | #60 and follow-ups provide the three-circuit weekend acceptance (`docs/evidence/m4-weekend/`). |
| 5 | Two-browser invite/start/same results/rematch/guest and host leave test | Done | Existing acceptance is in CI; #81 adds completed short all-circuit, full-grid/takeover and latency/loss contact tests. |
| 6 | Keyboard, gamepad and touch; desktop and landscape-phone browser coverage | Done | Browser coverage includes 1440×900 and 844×390; #89 shards preserve every case. Actual-device acceptance remains an M6 gap. |
| 7 | One documented command starts game and rooms; phone on same Wi-Fi opens and joins | Partly | `./start.sh` starts both and exposes a Wi-Fi address; actual-phone join acceptance still needs the owner/device pass. Hosting is additional, not required for v1. |
| 8 | Independent QUALITY targets with evidence from current build | Open | The 26 Nov pre-score missed Physics/Graphics/UI ≥ 4 and AI/Netcode ≥ 3; current-build scores remain unassigned. |
| 9 | Every asset in manifest/credits; no real-world marks | Done | Licence/credits audits are merged; #84/#85 passed asset and credits checks for their changes, and repository name checks remain in lint. |

### Nightly soak

The nightly workflow (`.github/workflows/nightly.yml`, not a required check) has failed or hit its
60-minute limit every night since 22 Nov. The 26 Nov run, the last one to finish, recorded four failures out of 430 tests:

- `packages/track/validation/drive-fuzz.soak.test.ts`, random driving at Spa: seeds 1045 and 1069
  fail the pose check within three seconds (body 0.655 m and a wheel centre 1.016 m above the ground).
- `packages/ai/validation/soak/ten-laps.soak.test.ts`, Spa: ten reference laps spread over 0.552 s against the 0.5 s bound.
- `packages/race/validation/race.soak.test.ts`, twenty AI cars at Monza over race distance: timed out at 600 s.

On 25 and 27 Nov the whole job hit its 60-minute limit. These are open defects, not flakes, and
the tolerances stay as they are.

### Next

Development by agents is paused from 27 Nov at the owner's request. The order below is the plan when it resumes.


1. Complete and assess #88's later-lap racecraft proof; do not substitute decision tests for racing evidence.
2. Run `docs/real-phone-test.md` on an actual iPhone and Android phone, including room join, sustained frame pacing and sound; record devices and results in STATUS.
3. Independently score the current build in `docs/QUALITY.md`, with a listening pass for Audio and current graphics/UI/netcode evidence.
4. Continue the physics work from #74's measured blockers, preserve existing passing checks and document the remaining pace gap at the checkpoint.
5. Fix the nightly soak failures above (Spa launches, Spa lap repeatability, the Monza race soak's run time), then rerun final acceptance against the build being scored.

After v1: pick the weakest scorecard axis and raise it. Candidates are weather and wet tyres,
safety car, replays, car setup, more circuits, public matchmaking, wheel support and a career mode.

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

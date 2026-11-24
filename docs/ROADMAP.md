# Roadmap

Each milestone ends with something playable merged to master. The slicing may change as we learn; slices stay vertical.

Last updated 24 Nov 2026. Releases v0.5.0 to v0.10.0 are published. The hosted build follows master after each merge (`docs/DEPLOY.md`).

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 Foundations | Repo, CI, the one-command local run, ADRs for era, stack and netcode. A one-page visual direction with an HTML mock of the HUD and a menu. An asset source survey with licences. The car-model decision. | Done (#1, #2, #3) |
| M1 Drive | One car on one circuit in time trial. Vehicle model v1, the input layer with keyboard, gamepad and basic touch, chase and cockpit cameras, a plain HUD, engine audio v1, the telemetry runner and the validation suite. Reference lap within 5% for now. | Playable and merged (#4 to #10, #14, #17, #19, #26, #29). Open: the Monza reference lap is 84.872 s against the 74.852–82.732 s band (2.14 s outside), recorded as a gap in `docs/physics-validation.md` 7.6 |
| M2 Look | Rendering pipeline, the real car with liveries, a dressed circuit, time-of-day lighting, the broadcast HUD, menus on the design system, quality presets. The screenshot stations pass the thumbnail test. | Mostly done: render pipeline (#16), car (#11, #33), interface kit and menus (#30), dressing for all three circuits (#31, #37, #49, #50), model kits (#27, #40, #47), breakable boards (#58), Singapore water and tree relief (#71). Open: the kit's grandstands, gantry, pit building and crowd (#57, in review), the in-race UI layer (start lights, timing tower) |
| M3 Race | Twenty-car AI grid, start procedure, timing, flags, track limits and penalties, collisions and damage, DRS and ERS, results, Quick Race. A scripted race completes, and seeded starts get through turn one cleanly. | Done at Monza (#15, #28, #53). Open AI follow-ups listed below |
| M4 Weekend | Tyre compounds, wear and temperature, fuel, pit stops, qualifying, Race Weekend, Championship, and circuits two and three. Reference laps within 3%. | Done: Spa and Singapore tracks and racing lines (#18, #32, #38, #41, #42, #44), Quick Race at Spa and Singapore (#52, #59), tyres and fuel (#54), the physics time-loss budget (#55), Race Weekend, Championship and player pit stops (#60). In review: the weekend follow-ups (#77). Open: Monza and Spa reference laps outside tolerance |
| M5 Online | Rooms, lobby, invites, synchronized start, snapshots, host migration, reconnect, rematch. Two-browser tests, and a soak with injected latency, jitter and loss. | Done (#12, #21, #23, #45, #48). Open: restyle the lobby and results on the interface kit |
| M6 Finish | Touch controls and phone performance, an audio pass, onboarding, settings and rebinding, accessibility, installable PWA, credits, and the full acceptance run below. | In progress. Done: controls list (#20, #63), audio (#22, #35, #51), Cloudflare hosting (#25), phone pass, onboarding and PWA (#39, #46), real-phone readiness (#66), licence and credits audit (#64, #69), Settings and Credits screens (#72). Open: the real-phone check, QUALITY.md scoring |

After v1: pick the weakest scorecard axis and raise it. Candidates are weather and wet tyres, safety car, replays, car setup, more circuits, public matchmaking, wheel support and a career mode.

## Where things stand (24 Nov 2026)

Releases: v0.5.0 (pause point, 23 Nov), v0.6.0 (Quick Race everywhere, tyres and fuel, breakable
boards), v0.7.0 (phone readiness, fairer starts, polish), v0.8.0 (Race Weekend, Championship and
pit stops), v0.9.0 (Settings and Credits), v0.10.0 (Singapore water and fuller trees).

Merged since the 23 Nov pause: #52, #54, #55, #58 to #75 and #78, plus #79 (CI cache and
retry, merged as `d5766fe`).

### In progress (open PRs)

| Work | PR |
| --- | --- |
| Circuit structures and near crowd from the prop kit | #57 |
| AI racecraft: mirror clearance and on-track moves | #76 |
| Weekend follow-ups: pit time loss, full-distance fuel, pit-entry replay, simulating, pit-wall styling | #77 |

### Next, in order

1. Finish and merge the open PRs above.
2. Open gaps:
   - Physics: the Monza and Spa reference laps are outside tolerance (recorded in
     docs/physics-validation.md).
   - The remaining M1, M2 and M6 items in the table above.
   - AI racecraft beyond #76.
   - Netcode, 2/5 in the QUALITY pre-score: remote cars are ghosts, online is Monza only with
     no AI fill, and the online lap timer stays at 0:00.
   - The in-race UI layer: start lights and timing tower.
3. The owner's real-phone check: one pass of `docs/real-phone-test.md` on an iPhone and an
   Android phone.
4. The independent QUALITY.md scoring, then the final acceptance run.

### Done-criteria status

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Public repo, protected master, green CI | Done |
| 2 | M0–M6 merged | M0, M3 (Monza), M5 done; M1, M2, M4, M6 open |
| 3 | Physics validation on all three circuits within tolerance | Singapore inside; Monza and Spa outside, recorded as gaps |
| 4 | Scripted Race Weekend vs nineteen AI on every circuit | Done (#60; docs/evidence/m4-weekend/) |
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

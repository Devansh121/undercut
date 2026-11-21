# Roadmap

Each milestone ends with something playable merged to master. The slicing may change as we learn; slices stay vertical.

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 Foundations | Repo, CI, the one-command local run, ADRs for era, stack and netcode. A one-page visual direction with an HTML mock of the HUD and a menu. An asset source survey with licences. The car-model decision. | Done (PRs #1, #2, #3) |
| M1 Drive | One car on one circuit in time trial. Vehicle model v1, the input layer with keyboard, gamepad and basic touch, chase and cockpit cameras, a plain HUD, engine audio v1, the telemetry runner and the validation suite. Reference lap within 5% for now. | In progress: playable on master (PRs #4 to #10). Open: reference lap is 89.9 s against the 74.9–82.7 s band; physics calibration under way |
| M2 Look | Rendering pipeline, the real car with liveries, a dressed circuit, time-of-day lighting, the broadcast HUD, menus on the design system, quality presets. The screenshot stations pass the thumbnail test. | Started: car model in progress |
| M3 Race | Twenty-car AI grid, start procedure, timing, flags, track limits and penalties, collisions and damage, DRS and ERS, results, Quick Race. A scripted race completes, and seeded starts get through turn one cleanly. | Not started |
| M4 Weekend | Tyre compounds, wear and temperature, fuel, pit stops, qualifying, Race Weekend, Championship, and circuits two and three. Reference laps within 3%. | Not started |
| M5 Online | Rooms, lobby, invites, synchronized start, snapshots, host migration, reconnect, rematch. Two-browser tests, and a soak with injected latency, jitter and loss. | Started: rooms service and protocol in progress |
| M6 Finish | Touch controls and phone performance, an audio pass, onboarding, settings and rebinding, accessibility, installable PWA, credits, and the full acceptance run below. | Not started |

After v1: pick the weakest scorecard axis and raise it. Candidates are weather and wet tyres, safety car, replays, car setup, more circuits, public matchmaking, wheel support and a career mode.

## When v1 is done

1. The repo is public, master is protected, and CI on master is green.
2. M0–M6 are merged with their checks passing.
3. The physics validation suite passes on all three circuits within the documented tolerances, sources cited.
4. A scripted Race Weekend (qualifying, then a race with a pit stop) against nineteen AI cars completes on every circuit with no stuck cars.
5. The two-browser online test passes: create, join by invite, synchronized start, the same final order on both sides, rematch, guest leaves, host leaves.
6. Keyboard, gamepad and touch all work; browser tests cover a desktop and a landscape phone viewport.
7. One documented command starts the game and the rooms service from the latest master on this machine, and a phone on the same Wi-Fi can open it and join a room. Hosting is not part of v1.
8. `docs/QUALITY.md` scores physics, graphics and UI at 4 or more, and audio, AI, netcode, mobile and performance at 3 or more, each with evidence from the current build.
9. Every third-party asset is in the manifest and credits, and nothing real-world is trademarked.

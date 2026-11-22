# Race rules

What `packages/race` enforces, with every value it uses and where the value comes from. The
values live in one place in code, `packages/race/src/rules.ts` (`DEFAULT_RULES`), and a session
can override any of them. "Estimate" means no published figure was found or checked; the
number is a reasoned default to revisit. Source numbers in brackets refer to
[physics-validation.md section 6](physics-validation.md#6-sources): [2] is the 2025 sporting
regulations, [4] the 2025 Monza circuit map, [8] the 2025 Monza race director's notes.

## Sessions

| Session | Start | Ends | Classified by | Track limits | DRS | Offences |
| --- | --- | --- | --- | --- | --- | --- |
| Time trial | rolling, 160 m before the timing line at 150 km/h | never | best valid lap | lap invalid | free in the zones | none |
| Practice | from the pit boxes, one car every 4 s | chequered flag at the session time (default 30 min) | best valid lap | lap invalid | free in the zones | warnings |
| Qualifying | from the pit boxes, one car every 4 s | chequered flag at the session time (default 18 min), one session, no knockout parts yet | best valid lap, then the time it was set | lap deleted; the next lap too after an offence in the last corner | free in the zones | warnings |
| Race | standing start from the grid | the leader completes the laps (5 to full distance), or the lap on which a time cap runs out | laps, then total time with penalties | strikes and time penalties | race rule | time penalties |

A race weekend runs practice (optional), qualifying and the race; qualifying's classification is
the race grid, cars without a time at the back in entry order. A championship adds race points
across its circuits and breaks ties by count-back (most wins, then most second places, ...).

After the chequered flag each car finishes when it next crosses the timing line (lapped cars
with fewer laps); in timed sessions a car in the pit lane when the flag falls is done. The
session ends when no car is still running (all finished or retired, in any session type and
with or without the flag: a race where every car retires ends there, classified by distance),
or 240 s after the flag.

## Values

| Rule | Value | Source |
| --- | --- | --- |
| Time on the grid before the first light | 2 s | Estimate (formation lap out of scope) |
| Interval between the five lights | 1 s | [2], start procedure |
| Hold after the fifth light, before lights out | uniform 0.2–3.0 s, from the session seed | Estimate: the procedure only says the hold is random |
| Jump start: forward movement before lights out | more than 0.5 m from the grid position | Estimate: transponder sensitivity is not published |
| Jump-start penalty | 5 s time penalty | Estimate: stewards' usual range is 5–10 s or a drive-through |
| AI reaction at lights out | 0.2 s + the driver's lag (0–0.02 s across the field) + uniform 0–0.1 s, seeded | Estimate from published reaction times of 0.2–0.3 s |
| Lap invalid | all four wheels wholly past the white line's outer edge (half tread 0.18 m) | [2], track limits; tread from the car sheet |
| A new excursion counts after | 0.5 s back inside the line | Estimate |
| Race strikes | 1–3 warnings (the 3rd with the black and white flag), 4th a time penalty; repeats (7th black and white, 8th penalty, ...) | Common race-director practice [8]; the exact count is an estimate |
| Track-limits penalty | 5 s | Common race-director practice [8]; estimate |
| Place gained off track | give it back within 15 s, or a 5 s penalty; a place counts as gained off track while off and for 2 s after rejoining; a place still owed at the flag is penalised there, before the classification (both cars compared where they were at the moment it crossed the line, interpolated inside the tick) | Estimate (simple rule; lasting time gained without a place is covered by lap invalidation and strikes) |
| Marshalling sectors for local yellows | lap cut into sectors of about 300 m from the timing line (Monza: 19) | Estimate |
| Yellow: cause | a car on or near the track (within 25 m of the centreline, not in the pit lane) slower than 8 m/s for 1 s, from 4 s after the green | Estimate |
| Yellow: shown in | the car's sector and the one before it, until 3 s after the cause has gone | Estimate |
| Under yellow | DRS disabled in a zone touching a yellow sector; passing a car is a warning | [2] Art. 22.1 (DRS); the no-overtaking rule is a warning only for now |
| Blue flag | a car about to lap another (one lap up or more) within 1 s behind it, measured at mini-sectors | [2]; race director practice |
| Blue flag obligation | let the faster car by within 15 s, or a 5 s penalty | Estimate (the regulation speaks of three flag panels) |
| DRS enabled (race) | when the leader starts lap 3 | The brief's default. Note: [2] Art. 22.1 as summarised in physics-validation 4.6 reads "from one lap after the start"; owner to confirm |
| DRS gap at the detection line | less than 1 s behind the car that crossed it before (any car), times interpolated inside the tick | [2] Art. 22.1 |
| DRS use | from the activation line to the end of the zone; closes on brake (> 0.02) or a lift (throttle < 0.3) until the request is released | [2] Art. 22.1 (brake); lift threshold an estimate |
| Practice, qualifying, time trial DRS | free inside the zones | [2] Art. 22.1 |
| ERS lap | per-lap deploy and harvest counters reset at the timing line | [2]; the sim enforces the energy |
| Pit-lane speed limit | from the track file (Monza 80 km/h) | [2] Art. 34.7 |
| Pit-lane speeding | more than 0.3 m/s (about 1 km/h) over the limit between the lines; race 5 s penalty, otherwise a warning; once per visit | Estimate (the regulation fines speeding; time penalty in a race is the stewards' usual) |
| Stop in the box | within 3 m along and 2.5 m across the box position, slower than 0.3 m/s | Estimate |
| Service time | tyres 2.4 s, plus uniform 0–0.8 s per stop, seeded | Estimate: 2.0–2.5 s stationary times are typical |
| Team-mates sharing a box | the second car waits until the first is serviced | As in the real pit lane |
| Release | waits while a moving car in the lane is between 60 m behind and 5 m ahead of the box (60 m is about 2.7 s at 80 km/h, the time a car needs to leave its box) | Estimate (unsafe-release avoidance); was 20 m, which released cars into the path of cars coming down the lane |
| Penalties | served stationary at the next stop, before service; otherwise added to the race time at the finish. A penalty awarded during a hold is not part of it: it stays outstanding for the next stop or the finish | [2]; the in-hold case is a decision |
| Classified | 90 % of the winner's laps, whether or not the car took the flag | [2] |
| Exact ties in the final classification | the order the cars took the flag (by time, then position before the tick), then the live order; never the car number | Decision |
| Two-compound rule | on by default at full race distance; a finisher on one compound is disqualified | [2]; the sanction is the conservative reading |
| Points | 25, 18, 15, 12, 10, 8, 6, 4, 2, 1; no fastest-lap point | Published scale since 2010; fastest-lap point dropped for 2025 (not re-checked against [2] here) |
| Fuel in every session | 10 kg (time trial 20 kg), topped up at each timing line | Decision for this slice: fuel arrives in M4 |

## Timing

Laps and sectors run from the circuit's timing (control) line, which need not be the track
file's s = 0 (the start line). At Monza it is at s = 5472.5 m, 320.5 m before s = 0, measured on
the circuit map [4] (physics-validation 7.6); it is held per circuit in
`packages/race/src/circuit.ts` until the track pipeline carries it. Lap 1 of a race starts at
lights out, so it runs from each car's grid slot; every later lap runs line to line. This is
how the published race distance comes out: at Monza 53 × 5.793 km = 307.029 km, less the
published 306.720 km, leaves 309 m between the start line and the control line, within the
±13 m of the 320.5 m measured on the map.

Crossings are interpolated inside the 4.2 ms tick. Each car's distance along the lap is the sum
of its signed position changes, and a line counts only when that distance first reaches it, so
backing over a line and driving on does not cross it twice, several lines in one tick are all
found in order, cars in the pit lane cross the lines like cars on track, and a reset moves the
distance without crossing anything. When four wheels are off in the same tick as a line
crossing, the reading counts against both laps.

Across the field, every crossing of a tick (timing and sector lines, the speed trap, DRS
detection and zone ends) is found first with its interpolated time and then applied in time
order. Crossings at exactly the same time are applied in order of position at the start of the
tick, then in the order the car made them. So who is first to the line under the chequered
flag, which cars finish, DRS gaps (never negative) and session bests depend on when cars
crossed, never on their car numbers. A finishing car's race distance is the line's, not where
it was at the end of the tick.

A car moved between ticks (reset to the track, restart, a teleport) is repositioned, not
driven: no line is crossed. Lines it was moved over are skipped and the lap in progress stops
counting; moved over the timing line, it starts its next lap there, already invalid, with no
lap result. In time trial and practice a reset also brings a retired car back.

Colours: purple beats everyone's best this session (in time trial, the record kept on this
device), green is the car's own best, yellow is slower, red an invalid lap. Gaps and intervals
for a timing tower are the time difference at the same point of race distance, about every
150 m (mini-sectors), with laps down where cars are a lap or more apart. Positions are a total
order by race distance (a finished car keeps its distance at the line), ties broken by finish
time; a complete tie keeps the previous order (entry order before the first tick); retired
cars come last.

## The stuck-car watchdog

The definition used by the product's acceptance test. Watched: cars that are racing (after
lights out or the green, not finished or retired), never while held in the pit box or garage.

| Finding | Definition |
| --- | --- |
| stationary | slower than 1 m/s for 5 s |
| no progress | less than 10 m of race distance gained over the last 10 s, a rolling window over samples every 0.25 s: creeping, stop-start crawling and rocking back and forth are caught; the finding runs from the start of the first window that fell short for as long as every window falls short |
| off track | all four wheels past the line, outside the pit lane, for 10 s |
| wrong way | race distance falling faster than 1 m/s for 3 s |

Never flagged: cars on the grid before lights out, in the garage, stopped in the box, serving
a penalty or waiting for release, finished, or retired and parked.

A car stationary or making no progress for 60 s (from when it stopped) is retired, "stuck",
except a human driver in time trial or practice: they keep the warning and can reset or
restart, which puts them back in the session.

A retired car (dnf or dsq) is parked out of the race where it stopped: it becomes a ghost that no
other car touches and the AI drivers no longer see, so it can never block the road. It is not
moved: a car lifted elsewhere could land on another car or a barrier. Before it retires, a car
standing still in the road is an obstacle the AI drivers go round (`packages/ai`, race driver),
except where the racing line sweeps across the road beside it (a chicane): there they stop 10 m
behind it.

A car standing still on the road with traffic held up behind it is a ghost too, for as long as
it blocks: once a car within 60 m behind it (on the road, anywhere across it) has been held
under 5 m/s for 6 s, the stopped car becomes a ghost and the cars behind drive on through it.
Only the car at the head counts (no other car standing still within 40 m ahead of it). It is
solid again once it moves off at over 5 m/s clear of every car, with no solid car behind it
in an overlapping lane that would close the gap within 2 s at its closing speed. The drivers see
it again, as traffic, as soon as it moves faster than 2 m/s, so the cars behind plan round it
before it turns solid. The race screen draws a blocking ghost at half strength and tells the
player when their own car is one. Only cars racing and under way
count (not in the pit lane, not held by the pit crew, and not cars that have yet to move off the
grid). The state is carried in `RaceSession.snapshot` (`blockers`).

## Snapshots and cost

`RaceControl.snapshot` is the whole rules state as JSON. `RaceSession.snapshot` (version 2) adds
the world, the blocking-ghost state, every driver's memory (the AI driver's controllers and RNG, the launch, the pit-lane
follower's path) and every search hint, so a session restored from it continues bit for bit
(checked at the lights, mid-race, on the pit approach and mid-service).

A tick with nothing to report allocates nothing: it returns a shared frozen empty array, and the
per-tick path uses reused buffers and passes no loose numbers into calls that might box them
(checked over the quiet stretch of a twenty-car rail race).

## What the AI does that the rules need

`AiController` wraps a racing driver from `packages/ai` (the reference driver on the circuit's
racing line) with what a lap driver does not do: it holds the car on the grid, goes at lights
out after its reaction time and launches with wheelspin control until it is past 25 m/s and its
racing driver asks for full throttle, lifts (throttle at most 0.85) while shown a blue flag (its racing driver also moves off line to
the side away from the car lapping it), and
drives the pit lane: when asked in it turns for the pit lane 120 m before it leaves the lap,
follows the lane at the limit (reaching it 15 m before the first line, 0.8 m/s under), stops in
its box, waits while held and drives out to the track, where its racing driver takes over as the
car leaves the pit-lane surface and rejoins off line while the traffic passes. A car knocked off
its path short of its box (stopped 3 s, not held) gives the stop up, drives out and comes in
again next lap. The pit-lane driving is a plain path
follower (`PathFollower` in `packages/ai`); a player can have the same as an assist.

## Known gaps

- Cars touch (car-to-car contact in the sim, planar boxes, no damage yet) and the AI races with the
  racing driver of `packages/ai` (gap keeping, lanes, passing, blue flags, spin recovery). There is
  no slipstream or dirty air yet, so passes come from pace differences and DRS; no active defending
  (one move) yet. In the 20-car, 5-lap proof at Monza with one stop per car (seeds 1, 2, 3, 4, 17,
  404): no watchdog findings, 18 to 20 of 20 clean through turn one, longest contact under 2 s,
  6 to 13 on-track position changes per race.
- Pit loss at Monza comes out at about 33.2 s against the published 24.3 s (physics-validation
  4.5). Most of it is the track file's speed-limit lines, 511 m apart (110 m from each end of the
  OpenStreetMap pit way), so about 23 s at 80 km/h; the follower's conservative approach and stop
  add a few seconds. The limit lines should come from the circuit map (a track-pipeline task).
- Qualifying is one session, without the knockout parts.
- Penalties are time penalties only (no drive-through or stop-and-go). Collisions, safety car,
  red flags and weather are not modelled; the phase machine has room for them.
- The track file's DRS zone 2 activation at Monza is anchored to s = 0 rather than the control
  line (about 320 m late, physics-validation 7.6); the rules use the zones as the file has them.

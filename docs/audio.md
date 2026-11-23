# Audio

Engine and road sound for the player's car, synthesised in code. Nobody on the project can hear it, so the DSP core is deterministic, runs the same in the browser and in Node, and is judged by rendering standard manoeuvres offline and measuring them. Passing these checks says the sound is well-formed; it does not say it sounds good (see the end of this page).

| Where | What |
|---|---|
| `packages/audio/src/dsp/` | The DSP core: pure TypeScript, no DOM or Web Audio types, no `Math.random`, no allocation while rendering |
| `packages/audio/src/web/` | AudioWorklet host and the main-thread facade (`@undercut/audio/web`) |
| `packages/audio/src/analysis/` | FFT, BS.1770 loudness, true peak, step size (`@undercut/audio/analysis`) |
| `tools/audio/` | Offline renderer, scripted manoeuvres, WAV and spectrogram writers, scenario checks |
| `docs/evidence/m1-audio/` | Measurements of every scenario and five spectrograms |

## Input

The game sends an `AudioCarState` (`packages/audio/src/dsp/state.ts`) every sim step, at 60–240 Hz. All units are SI.

| Field | Unit | Drives |
|---|---|---|
| `engineOn` | flag | Engine voice fades in or out over about 0.1 s |
| `engineSpeed` | rad/s | Pitch: firing frequency = rpm/60 × 3 |
| `throttle`, `load` | 0–1 | Tone, level, overrun detection |
| `gear`, `shifting`, `shiftDirection` | –, flag, ±1 | Ignition cut on upshift, blip on downshift, gearbox clack |
| `revLimiter`, `pitLimiter` | flags | Ignition-cut patterns |
| `boost` | 0–1 | Turbo demand; the audio turbo spools towards it with lag |
| `ersPower` | W | MGU-K whine: + deploy, − harvest |
| `speed` | m/s | Tyre roll, cavity resonance, wind |
| `slipFront`, `slipRear` | – | Scrub (0.02–0.12) and squeal (0.08–0.2) per axle |
| `kerb`, `kerbFrequency` | 0–1, Hz (to 600 Hz: 150 m/s over 0.25 m ridges) | Kerb rumble at the ridge-passing rate |
| `bottoming` | 0–1 | Plank scrape, with a thump on first contact |

Every field is first checked at the core boundary, whichever form it arrives in (struct or packed): it is clamped to its supported range (`CAR_STATE_RANGE`; engine speed to 15 000 rpm, the pulse tables' limit), and NaN or infinity keeps the field's last valid value. Filters also drop non-finite memory and the mix never passes NaN on, so no update can leave the DSP broken. Every continuous field then ramps linearly from its current value to the new one over the measured update interval, so the control signals are continuous at any update rate. This costs one interval of latency (4–17 ms). Flags switch at the update. Every audible quantity is smoothed again inside the voices.

## Synthesis

**Engine voice** (`engine-voice.ts`). A 1.6 L four-stroke V6: six exhaust pulses per 720° cycle, read from wavetables that hold one cylinder's blowdown pulse. The tables are built by Fourier synthesis, capped at the harmonic count that stays under 0.45 × the sample rate up to 15 000 rpm, so the pulse train cannot alias. Two tables are mixed by load: a part-load pulse (slow rise, long decay, harmonics fall away fast) and a full-load pulse (near-instant rise, short decay, rich to the band limit). The second bank's pulses arrive 0.4 % of a cycle late and 5 % weaker at full load, 16 % weaker on the overrun; with small fixed per-cylinder trims and per-event jitter (more off throttle) this puts energy into the half and 1.5 orders. The pulse train then goes through fixed exhaust resonances (peaks at 170, 440, 1150 and 2900 Hz), an intake resonance at 1300 Hz fed in proportion to load, and combustion noise gated by each firing and scaled by load². The resonances do not move with rpm; the harmonic ladder moves through them. Level rises with load (×0.42 to ×1) and with rpm (×0.6 to ×1).

On top of that:

- **Turbo:** spool state with time constants 0.3 s up, 1.4 s down; whine from 1.8 kHz (idle) to 7.2 kHz (full spool) with a second partial, plus band-passed hiss. Exactly zero while `boost` and the spool are zero.
- **Near Nyquist:** every turbo and MGU-K partial fades linearly to silence between 0.40 and 0.45 of the sample rate, so none aliases and none switches on or off abruptly. The supported sample rates are 22.05 to 384 kHz; the core rejects lower rates and the browser engine falls back to silent there.
- **MGU-K:** electrical whine at crank speed × 3.3 (shaft ratio, estimate) × 4 pole pairs, about 2.6 kHz at 12 000 rpm; deploy and harvest have different harmonic mixes. Exactly zero at zero power.
- **Overrun pops:** short noise bursts through a random resonance (350–1450 Hz), with a small chance per firing event after a lift (decaying over about 1.2 s), after a downshift, and on cut events. Kept subtle.
- **Limiters:** the rev limiter cuts ignition in long runs (an 18-event pattern), the pit limiter in single events (a 14-event pattern). A cut cylinder keeps 25 % of its pulse. Cylinder gains only change while that cylinder is quiet, so cuts never step the waveform.
- **Shifts:** upshift dips the pulse train to 30 % while `shifting` is set (the 30 ms torque dip); downshift raises the load to 0.85 for the blip window (60 ms) and makes pops likelier for a moment; both add a short gearbox clack.

**Road voice** (`road-voice.ts`): rolling noise low-passed at 90 Hz rising to about 600 Hz at 324 km/h, a tyre cavity resonance at 225 Hz, wind band-passed at 280 Hz rising to about 1.7 kHz at 324 km/h, scaled by speed², with slow gusts, broadband scrub per axle, a narrow squeal resonance per axle (930 Hz front, 780 Hz rear, with a slight wobble), kerb thumps at `kerbFrequency` with a rattle, and a gritty 2.7 kHz scrape with a 65 Hz thump on first contact.

**Master bus** (`core.ts`, `limiter.ts`): voices → engine, effects and UI buses → bus gains → master gain and pause fade → DC blocker (12 Hz) → look-ahead true-peak limiter → soft clipper. Gains are smoothed over 30 ms; pause fades over about 10 ms, then outputs exact zeros and stops computing. The limiter detects true peak (each sample and the points the same 4× interpolator as the true-peak meter puts around it), looks 1.5 ms ahead and holds −1.5 dBTP on that measure exactly (the gain at each delayed sample is a moving average of sliding minima of the gain each sample needs, so it is never above what the peak needs); its latency is 79 samples at 48 kHz; the clipper after it is the identity below −1.3 dBFS and never reaches −0.5 dBFS.

**Other cars, ambience and cues** are the scene layer (`scene.ts`), mixed into the same buses after the player's car; see the Slice 2 section at the end.

**Allocation and determinism.** `AudioCore.process` renders in chunks of at most 32 frames aligned to its own sample clock, and does control-rate work (filter retuning, waking or sleeping optional layers) only on chunk boundaries of that clock, so the output is bit-identical however the host splits its blocks. Hot loops work on typed arrays and call nothing that returns a fractional number, every mutable field is initialised with a number, and filters are retuned by writing fields and calling `design()`. In V8 the other patterns (a non-inlined call returning a double, a field declared without an initialiser, a list of voices of different classes at one call site) each allocate per sample; together they produced a garbage collection every 20 ms before this was fixed.

**Cost.** Work whose result is already known is skipped without changing a bit of output: the limiter's true-peak interpolator (128 multiply-adds per stereo sample) runs only on blocks whose largest sample times the interpolator's largest gain (1.85) could reach the threshold, and while its gain rests at exactly 1 only the delay line runs; settled gain smoothers, control signals that hold still and silent impact envelopes are not recomputed. The turbo, MGU-K and gear-whine partials read a 4096-step interpolated sine table (`sine.ts`) instead of `Math.sin`; its error is at most 2.9e-7 of a partial (−131 dB), and renders differ from `Math.sin` by at most one float32 step (−150.5 dBFS; in the 16-bit reference renders at most 1 sample in 13 000 moves, by one step) with every measurement unchanged. In Node (tests, offline renders) the module runner reads each imported binding as a property of its module, so hot loops copy imported constants into locals first.

## Browser

```ts
import { createAudioEngine } from '@undercut/audio/web';

const audio = createAudioEngine(); // never throws; silent where Web Audio worklets are missing
window.addEventListener('pointerdown', () => void audio.resume(), { once: true });
// every sim step:
audio.setCarState(state);
audio.setVolume('engine', 0.8); // master | engine | effects | ui
```

The worklet module is bundled by Vite through `processor?worker&url` (one file, about 28 kB, nothing fetched from elsewhere). The AudioContext is created inside the first `resume()` so that it starts from a user gesture. When the tab is hidden the engine fades out and suspends the context, and resumes when the tab is shown again if the player had started it. The engine records what the game asked for (running, suspended, disposed) and reconciles it in serialised steps, so a `suspend()`, `dispose()` or hidden tab while the worklet is still loading is honoured when the load completes; the processor is created paused and is silent until told to run. Any failure (no AudioWorklet, a sample rate below 22.05 kHz, module blocked, context refused) switches to silent and reports once through `onFallback` (default `console.warn`).

`npm run audio:browser-check` builds a test page with Vite, runs the bundled worklet in Playwright's Chromium in an OfflineAudioContext and checks the pitch, then starts, suspends, resumes and disposes the facade on a live context. Result on this laptop: peak 0.35, firing peak 449.999 Hz for 9000 rpm (expected 450), statuses idle, running, suspended, running, silent.

## Rendering clips

```sh
npm run audio:render -- all                 # or one or more scenario names
npm run audio:render -- all --evidence docs/evidence/m1-audio
```

Writes `artifacts/audio/<scenario>.wav` (48 kHz, 16-bit stereo), `<scenario>.json` (measurements), `<scenario>.png` (spectrogram: log frequency 40 Hz–16 kHz, 80 dB range, the commanded firing frequency as a dashed green line) and `summary.json`. `artifacts/` is git-ignored. The state is sent at 120 Hz in 128-frame blocks, as the worklet would see it. Scenarios (`tools/audio/scenarios.ts`) are driven by a point-mass car using the ratios, shift points and shift times from `docs/physics-validation.md` section 1.3: `idle`, `full-throttle` (1st to 8th), `lift-off`, `braking-downshifts` (8th to 2nd), `limiter`, `slow-corner` (scrub, squeal, kerb), `pit-lane`, plus `rev-sweep` (full load, idle to limiter) and `load-steps` (11 000 rpm, throttle on and off each second).

## Checks and thresholds

Unit tests (`npm test`): `packages/audio/test/` and `tools/audio/*.test.ts`, about 15 s in total.

| Check | Threshold | Why |
|---|---|---|
| Firing peak vs rpm/20, steady rpm, 4500–12 500 rpm, full and trailing throttle | error < 0.05 %, ≥ 30 dB above the floor between the half orders | The pitch must be the engine's, not approximately |
| Firing peak in every scenario (85 ms windows, rpm steady to 1.5 %, no shift) | median < 0.25 %, max < 1 % | Includes the interpolation lag and short-window resolution |
| Same rpm, full vs trailing throttle (7000 and 11 000 rpm) | centroid ×1.25 or more; share of energy above 2 kHz +6 dB or more; level +5 dB or more | Tone must follow load, not only pitch |
| Turbo, ERS deploy, ERS harvest | layer exactly 0 when the input is 0; > −60 dBFS and +10 dB in their band when on | Present only when asked for |
| Every road layer | exactly 0 at rest; > −60 dBFS when its input is set | Same |
| Everything at maximum, all gains at 2 | limiter engages; sample and true peak (4× oversampled, flushed past the last sample) below 0 dBFS | The limiter must hold |
| Full-scale 8 kHz and 12 kHz square waves and a clipped 9 kHz sine through the limiter | true peak below 0 dBFS | Sample-peak detection let these through at up to +0.36 dBTP |
| Invalid input: NaN, ±infinity, ±1e12 and −1 in every field, packed and as a struct | output finite throughout; within 1 s of valid input, level within 1 dB and pitch within 0.5 Hz of a clean render | Bad data from the game must not break or stick |
| Sample rates | below 22 050 Hz rejected; at 22.05 kHz with every tonal source at its highest frequency, every spectral line also exists in a 96 kHz render | No aliasing at the lowest supported rate |
| Browser engine lifecycle | resume then suspend, resume then dispose, and a hidden tab, each while the worklet loads: nothing left running or unpaused | Asynchronous start-up must not override the game |
| Clicks: start, stop, pause and resume, upshift, downshift, a jump of every input in one update, gain changes, limiters | largest sample-to-sample step in the 150 ms after the event ≤ 1.2 × the largest in steady state around it (for shifts, including steady full load) | A click is a step far larger than the signal's own motion |
| Pause | exact zeros once faded | Silence must be silence |
| DC | \|mean\| < 1e-3 | |
| Loudness, every scenario | −28 to −14 LUFS (BS.1770-4 integrated, K-weighted, gated) | A sane in-game level with headroom |
| Loudness spread, scenarios with the car moving | ≤ 8 LU | The player should not ride the volume between manoeuvres; idle and the stationary sweep are excluded |
| Determinism | identical bits for the same seed and inputs, and for block sizes 1 to 4096 at 22.05 and 48 kHz, through limiter cuts, dense overrun pops at 15 000 rpm and rapid shifts | Offline renders must predict the browser |
| Allocation | young generation grows < 16 kB and no scavenge runs over 40 s of audio, state passed packed as the worklet receives it | The audio thread must not trigger garbage collection; one boxed number per block would be 240 kB. Measured after warm-up, a forced collection and a re-settle, since a collection can discard optimised code and the interpreter boxes numbers until it is rebuilt |
| Speed | > 10× real time, the best of five 10 s runs after a warm-up run; measured 52.5–53.0× on this laptop (Ryzen 7 7435HS), against 29.4–30.2× before the cost pass | One car at about 2 % of one core. Load on a shared runner only slows a run, so the fastest run is the cost; every run's factor is printed |

## Results

From `docs/evidence/m1-audio/summary.json`.

| Scenario | Duration (s) | Sample peak (dBFS) | True peak (dBTP) | Loudness (LUFS) | Firing error, median / max (%) |
|---|---|---|---|---|---|
| `idle` | 4 | −20.3 | −20.3 | −27.2 | 0.029 / 0.053 |
| `full-throttle` | 13 | −7.4 | −7.3 | −15.8 | 0.030 / 0.112 |
| `lift-off` | 7 | −7.9 | −7.8 | −20.5 | 0.043 / 0.286 |
| `braking-downshifts` | 4.5 | −7.7 | −7.7 | −19.1 | 0.009 / 0.179 |
| `limiter` | 4.5 | −7.1 | −7.1 | −19.1 | 0.200 / 0.400 |
| `slow-corner` | 6 | −6.5 | −6.4 | −18.3 | 0.029 / 0.242 |
| `pit-lane` | 5 | −9.9 | −9.9 | −20.8 | 0.011 / 0.166 |
| `rev-sweep` | 8 | −8.5 | −8.5 | −17.0 | 0.062 / 0.100 |
| `load-steps` | 6 | −7.6 | −7.6 | −18.0 | 0.016 / 0.569 |

DC offset is below 1e-5 in every scenario. The limiter never engages in normal driving; it only acts in the everything-at-maximum test.

## What the checks cannot tell

- Whether it sounds like a turbo-hybrid V6, or good at all. The checks prove the pitch is right, the tone changes with load, nothing clips or clicks, and the level is sane. Timbre, the balance between layers, and whether the formant and pulse choices are pleasant are matters of listening.
- Whether the layers are balanced against each other. Turbo, ERS, pops and road layers are at design levels that were never heard.
- Whether the rev-limiter and pit-limiter patterns sound like limiters or like a fault.
- Speaker and headphone differences, and phone speakers in particular (little below 300 Hz, where the half orders and kerb rumble live).
- Latency and glitches in a real browser under load; the browser check runs one offline render and one short live session.

## Listening queue

Render first with `npm run audio:render -- all`, then play, in this order:

1. `artifacts/audio/full-throttle.wav`: pitch climbs in each gear and drops on each upshift; does the cut sound like a seamless shift or a stutter?
2. `artifacts/audio/load-steps.wav`: same pitch throughout; full throttle and trailing throttle alternate every second. Is the difference convincing?
3. `artifacts/audio/braking-downshifts.wav`: blips and pops on six downshifts, harvest whine, a lock-up squeal, a plank scrape at the start.
4. `artifacts/audio/lift-off.wav`: the lift at 1.5 s; are the pops subtle enough, and does the turbo wind down naturally?
5. `artifacts/audio/limiter.wav` and `artifacts/audio/pit-lane.wav`: do the cut patterns read as limiters?
6. `artifacts/audio/slow-corner.wav`: scrub, squeal, kerb rumble; are the road layers too loud or too quiet against the engine?
7. `artifacts/audio/idle.wav` and `artifacts/audio/rev-sweep.wav`: the bare engine at idle and across the range.

## Decided without the owner

- Supported sample rates start at 22.05 kHz and lower rates are rejected, on top of the Nyquist fades: browsers run at 44.1 or 48 kHz, and below 22.05 kHz the pulse tables would keep too few harmonics to sound like this engine.
- Engine speed is passed in rad/s, not rpm, to keep SI in code (AGENTS.md); `rpmToRadPerSecond` converts at the edge.
- Idle at 4500 rpm and the limiter at 12 500 rpm (physics doc estimate); MGU-K shaft ratio 3.3 and 4 pole pairs are estimates, not published figures.
- The turbo is driven by a `boost` demand input rather than computed from rpm and load inside audio, so the vehicle model owns it; the scenarios use load × rpm ramp.
- Loudness targets and the 8 LU spread were set before tuning, from common game-mix practice (integrated levels in the −24 to −16 LUFS range), not from a standard that applies to this game.
- `rev-sweep` and `load-steps` were added beyond the brief's list because they show the ladder and the load response most clearly.
- Five spectrograms are committed (about 1 MB); the other four are reproducible with the command above.

## M6 car and road pass (Slice 1)

`npm run audio:render -- reference-lap --evidence docs/evidence/m6-audio` runs the
reference driver on the committed racing line with the normal vehicle model, captures one timed
lap at 240 Hz after the out-lap, and replays the exact `toAudioCarState` adapter used by the game.
`all` (also the default) includes this capture. Full stereo WAVs, spectrograms, measurements and
`reference-telemetry.json` go to `artifacts/audio/`. The evidence option saves measurements,
spectrograms and 12-second Vorbis excerpts beginning at 4 s. No third-party recordings are used.
The full lap is an offline check, deliberately outside CI. It gates pitch (median <0.25%, max <1%,
more than 100 steady windows), DC (<1e-3), true peak (<0 dBTP), loudness (−28 to −14 LUFS), and
bit-identical replay with 128- and 4096-frame host blocks (SHA-256 in each report).

The added generators are individually metered before view and bus gains:

- `crack`: a loaded upshift's ignition return excites a short filtered noise burst and three
  strengthened firing events. A lifted shift produces no crack.
- `burble`: irregular afterfire and uneven firing on a fresh lift, fading with time and load.
- `gearWhine`: engaged gear tooth-mesh and final-drive tones, gliding between pairs over 12 ms;
  stronger on the overrun, silent in neutral. Ratios, tooth counts and balance are design
  estimates in `spec.ts`, not measured gearbox data.
- `lockup` and `wheelspin`: signed per-axle longitudinal slip selects a 1.35 kHz howl or a lower
  rasp. Combined slip builds scrub from 0.3 of the nominal 0.1 grip limit, then squeal past it.
- `grass` and `gravel`: soft low rumble and swish versus impulsive stone noise and tub resonances;
  replace asphalt noise according to wheel contact shares. Kerb repetition is speed / 0.25 m.
- `drs`: one mechanical knock per flap transition; open DRS reduces wind about 3 dB.
- `impact`: severity-driven body thump and debris burst, once per event serial. Barrier
  impacts are wired: the sim's per-step `wallImpactSpeed` is kept as the hardest strike of each
  frame (`FrameResult.wallImpact`, since it resets every 240 Hz step and a 60 Hz frame would
  miss most of them), and `ImpactEvents` turns it into speed and serial; strikes within 80 ms
  merge into one impact unless twice as hard. Car-to-car contact impulses are not in the sim
  yet; they feed `ImpactEvents` the same way when they land. No collision is inferred from
  ordinary braking.

Existing limiter, spool-lag turbo, deploy/harvest whine, floor strikes and shift cut remain.
All acoustic levels, resonances and view paths are sound-design estimates; mechanical power-unit
inputs retain the sources in the original synthesis section and physics validation document.

`VIEW_BALANCE` documents cockpit, T-cam, chase and trackside gains and exhaust cutoffs. Onboard
views bring intake forward; the chase hears exhaust. Cockpit exhaust is dulled, but combustion
noise can make the total cockpit spectrum brighter under load. The trackside file is the external
balance throughout the lap; distance, panning and Doppler belong to Slice 2.

Five saved levels are exposed as settings data: master 0.8, engine 1, effects 0.8, UI 0.8,
ambience 0.6. Old saves acquire defaults for the new fields. The menus can consume these fields;
this slice does not redesign their controls. UI cues duck engine/effects up to 3 dB and ambience
8 dB; impacts duck ambience 6 dB; attack 10 ms, release 300 ms. Engine and road never duck each
other. Ambience and UI synthesis remain for Slice 2. The same master true-peak limiter protects
all buses, including gains of 2.

Listen first to `docs/evidence/m6-audio/reference-cockpit-excerpt.ogg`, then the matching
`reference-trackside-excerpt.ogg`: compare shift cuts, ignition cracks, intake and gear mesh.
Then play the full WAVs in `artifacts/audio/`: check braking burble and harvest, kerbs versus
scrub, wind/DRS, and whether the onboard high frequencies become tiring. Use `load-steps` for
same-RPM tone, and the new layer tests for off-road surfaces and collisions (a clean reference
lap does not exercise gravel or impacts). A human still needs to judge realism, balance and
phone/headphone playback; objective gates cannot award the audio scorecard rating.

Reference evidence (48 kHz stereo, 84.88 s, 1348 steady windows per view):

| View | LUFS | dBTP | Pitch error median / max | DC | Core speed |
| --- | --- | --- | --- | --- | --- |
| Cockpit | −17.1 | −6.55 | 0.023 / 0.275 % | 1.59e-7 | 41.6× real time |
| Trackside | −19.0 | −9.30 | 0.014 / 0.252 % | 1.16e-7 | 44.8× real time |

Re-rendered after the cost pass. The lap itself had changed earlier, with track format 3 (M4),
so the hashes first committed here no longer matched master; master rendered this lap at
26.9× and 25.3×, and every measurement above, including each layer's level, is the same
as master's render of it. Only the sine table changes samples (see Cost). The core cost is
about 2.3% of one CPU core for this one-car render, excluding analysis and file writing;
this is not a mobile AudioWorklet CPU measurement. Both
views pass the gates and block-size hash comparison. Silent layers are `null` in the JSON
(the JSON representation of −infinity dBFS).

## M6 other cars, ambience and cues (Slice 2)

The game sends an `AudioScene` every drawn frame (`apps/web/src/game/audio-scene.ts` builds it
from the race; `AudioEngine.setScene`), packed into a `Float64Array` of 119 numbers for the
worklet (`packScene`). It carries up to nineteen other cars in the player car's frame (+x forward,
+z right: position, relative velocity, crank speed, throttle), the circuit's bed, the crowd level
reaching each ear and the start-light state. Every field is clamped to its range in one pass;
a car with a non-finite position is absent.

**Voice pool** (`scene.ts`, `opponent-voice.ts`). Each car keeps the slot of its race index, so a
voice's phase never resets. The six nearest cars within 300 m get a voice; their level fades out
over the last 80 m and any voice that loses its place fades over 50 ms (no cut). Cars without a
voice but within 600 m are summed by power into one far-field voice, placed in their
power-weighted mean direction at the distance one car of that level would be, at their
power-weighted mean pitch and throttle.

Each voice is a cheaper engine than the player's: one table holds a whole six-pulse V6 cycle
(built from the player's single-cylinder pulse tables in the frequency domain, keeping only the
multiples of the sixth harmonic, so it is exactly as band-limited), part-load and full-load
trains mixed by throttle, with combustion noise gated by the pulses. Then, per voice:

| Stage | Model | Parameters |
|---|---|---|
| Distance | inverse distance (−6 dB per doubling) | reference 6 m, level 0.11 there at full throttle |
| Air absorption | one-pole low-pass | corner 20 kHz / (1 + (d − 6 m) / 15 m), floor 1.8 kHz; about −7 dB at 4 kHz and −12 dB at 8 kHz at 150 m (ISO 9613-1 air at 20 °C, 50 %: roughly −5 and −15 dB) |
| Interaural time difference | fractional delay on the far ear | up to 0.66 ms (Woodworth, 8.75 cm head radius) × sideways share |
| Level pan | equal power, width 0.7 | a car fully to one side is about 10 dB louder in the near ear |
| Head shadow | one-pole low-pass on the far ear, and on both ears for a car behind | far-ear corner down to 2.4 kHz, behind down to 3 kHz; corners in series with air absorption |
| Doppler | ratio 343 / (343 + radial velocity) of the relative velocity | bounded to 0.8–1.25 (closing or opening faster than about 69–86 m/s saturates), smoothed over 50 ms |

All voice parameters glide with a 50 ms time constant. A voice that wakes takes its target pitch,
place and tone at once and only fades in, so a car entering the pool does not sweep up from
silence. Occlusion is ignored. The listener is the player's car in every camera.

**Ambience** (`ambience.ts`), on the ambience bus:

| Layer | Synthesis | Where |
|---|---|---|
| Crowd | decorrelated noise per ear, band-pass 700 Hz Q 0.5, one-pole low-pass 2.2 kHz, swells at 0.13 and 0.31 Hz; lights out lifts it up to +8 dB (0.8 s rise, 6 s fall) | every circuit, by the stands |
| Trees | decorrelated noise, band-pass 550 Hz Q 0.8, gusts from two slow sines (0.07, 0.19 Hz) | forest 1, park 0.45 |
| Birds | calls of 3–6 falling notes, 2.6–4.4 kHz, 70 ms with 45 ms gaps, every 1.5–6 s, random side | forest 1, park 0.6 |
| Night city | traffic rumble (noise low-passed at 140 Hz), floodlight hum at 100, 200 and 300 Hz (twice the 50 Hz mains), insects (band-pass 5.2 kHz Q 3, pulsed at 38 Hz in 9 s waves) | city at night |

The crowd level comes from the render world's fitted grandstands (`StandFrame`): each stand is
sized by front length × rows (60 m × 20 rows at 20 m reads 1), heard from the nearest point of its
front edge, falling 6 dB per doubling beyond 20 m, panned by its bearing with width 0.8; stands add
by power. The beds by circuit: Monza parkland, Spa forest, Singapore city at night. The Lite
world has no stands, so it has no crowd. Levels move with a 0.5 s time constant.

**Cues** (`cues.ts`), on the UI bus (so they duck the car and the ambience as Slice 1 set out): up
to two notes each, sine plus an octave partial, 4 ms attack, exponential decay, 12 ms release to
exact zero; two players alternate so a cue never cuts the last one off.

| Cue | Notes |
|---|---|
| `focus` | 1.2 kHz tick, 30 ms |
| `accept` | 880 Hz then 1320 Hz 45 ms later (a rising fifth) |
| `back` | 990 Hz then 660 Hz (a falling fifth) |
| `light` | 1 kHz, 180 ms, once per lamp |
| `go` | 2 kHz, 400 ms, at lights out (only after a lamp was seen) |

The page (`apps/web/src/audio.ts`) plays `focus` when a menu control takes focus by keyboard or
gamepad (not from a pointer press), and `accept` or `back` (`data-action="back"` or `…-back`)
when one is pressed, once the engine exists: the first session start creates it, so the menus
are silent until the first drive. A menu press never creates the engine itself; doing so started an
AudioContext and fetched the worklet in the same click as the update bar's reload, and the offline
worker's handover then stalled that reload in CI. Outside a driving session the context runs for
0.8 s after a cue with the car and circuit buses held at 0, then suspends again.

**Checks** (`packages/audio/test/scene.test.ts`, `apps/web/test/audio-scene.test.ts`):

| Check | Threshold |
|---|---|
| Pool | 30 cars: 6 voiced and the far field on; 301 m: no voice, far field on; 601 m: nothing |
| Pitch | firing peak within 0.5 Hz of rpm / 20 |
| Tone follows throttle | spectral centroid ×1.3 or more, full against closed, same rpm |
| Distance | 10 m against 40 m at the firing frequency: 11–13 dB (inverse distance: 12.04) |
| Air absorption | 4–8 kHz against the firing band falls by more than 6 dB from 10 m to 150 m |
| Side | a car to the right: right louder by more than 8 dB, left lagging by the ITD (31.7 samples at 48 kHz) to the ITD plus 4 samples (the shadow filter's delay) |
| Behind | 3–8 kHz against the firing band at least 3 dB lower behind than in front |
| Doppler | closing at 30 m/s within 0.5 Hz of 343/313; at ±150 m/s exactly at the bounds |
| Pass-by | 50 m/s past at 4 m: 527 Hz and 393 Hz within 2 Hz at the ends, never rising by more than 0.5 Hz |
| Culling | a car dropped from the scene loses under 2 dB in the first 10 ms and is 60 dB down within 0.4 s |
| Determinism | bit-identical with host blocks of 127, 128 and 4096, nineteen cars moving, forest, crowd, lamps |
| Ambience | exact silence with no bed and no crowd; forest trees band 6.9 ± 1.5 dB over park; bird calls more than 10 dB over the forest bed (98th against 50th percentile, 2.8–4.6 kHz; 14.4 dB measured); city hum peak within 0.5 Hz of 100 Hz and 30–150 Hz more than 15 dB over the forest; crowd on its side by more than 30 dB and 12.04 ± 0.5 dB for a quarter level; lights out lifts the crowd more than 4 dB |
| Cues | one 1 kHz tone per lamp and 2 kHz at lights out, nothing between; each menu cue above −50 dBFS, silent after, silent with the UI bus at 0; an overlapping cue makes no step over 0.02 |
| Allocation | the Slice 1 allocation test now also sends a packed scene every 6 blocks (19 cars moving, city bed, crowd, a lamp every 400 blocks) and a cue every 250 blocks: still under 16 kB of young generation and no scavenge |
| App | crowd from stands: side, level 1 at 20 m, −6 dB per doubling, rows, power sum; opponent placement and relative velocity in the player's frame; menu cue mapping |

**Renders.** `npm run audio:render -- scene` writes five scenes to `artifacts/audio/` (WAV and
spectrogram) and Ogg excerpts, spectrograms and `scene-summary.json` to
`docs/evidence/m6-audio/`. The player's engine is off in these, so only the scene is heard.

| Scene | What to hear | LUFS | dBTP | Speed in Node |
|---|---|---|---|---|
| `grid-start` | from the back of the grid, stands on the left: five lamp tones over the idling field, lights out with a cheer, the field pulls away, the nearest six fall in pitch and the far field takes over | −24.2 | −10.4 | 30× |
| `opponent-pass` | one car at 50 m/s past on the right: 527 Hz down to 393 Hz, darker behind | −37.6 | −17.9 | 52× |
| `forest-leaving-stands` | Spa: crowd fading over 8 s, then trees and birds | −32.4 | −20.3 | 56× |
| `city-night` | Singapore: rumble, hum lines, insects in waves, a stand on the right | −33.2 | −20.7 | 52× |
| `menu-cues` | focus, focus, accept, back, focus, accept | −36.8 | −24.3 | 61× |

**CPU in the AudioWorklet.** `npm run audio:browser-check` runs the bundled worklet in
Playwright's Chromium (muted, 844×390 mobile viewport) through 43.7 s of audio with the worst
Mobile workload: the player's car with every layer, nineteen opponents in range (six voiced plus
the far field, confirmed by the processor's report), the city bed and a crowd on both sides. The
processor sums `Date.now()` around each 128-frame block (a coarse clock, unbiased over 16 384
blocks); the check fails at 10 % of one core. Measured on this laptop's desktop core: 2.3–2.4 %
(1021–1067 ms of processing). DevTools CPU throttling does not reach the worklet thread (at 4×
the cost was unchanged), so there is no phone-class figure; at a phone core 4–6 times slower this
would be about 10–15 %, which is the first thing to measure on a real device.

**What the checks cannot tell.** Whether six pulse-train voices and one far-field voice sound
like a field of cars or like a synth pad; whether the 50 ms glides read as smooth or as lag on a
fast pass; whether the crowd sounds like people or like surf; whether the birds and insects are
pleasant over a long session; whether the cues fit the interface's look. Phone speakers lose most
of the far field and the hum.

**Listening queue, Slice 2:**

1. `docs/evidence/m6-audio/opponent-pass-excerpt.ogg` on headphones: does the pass sit on the
   right and sweep down naturally, and does the car sound behind once past?
2. `artifacts/audio/grid-start.wav`: do the lamp tones and the lights-out tone sit well over the
   field, and does the cheer read as a cheer?
3. `artifacts/audio/forest-leaving-stands.wav` and `city-night.wav`: are the beds believable and
   quiet enough under an engine?
4. `artifacts/audio/menu-cues.wav`: are the cues too loud, too bright or too long?
5. In the game, a Quick Race start from mid-grid with the cockpit camera.

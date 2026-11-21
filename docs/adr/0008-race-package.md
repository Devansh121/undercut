# 0008 Race rules as a pure package

Status: accepted (M3).

**Decision.** The race rules (sessions, start procedure, timing, flags, track limits and
penalties, DRS and ERS rules, the pit lane and stop sequence, results, weekends and
championships) live in `packages/race`, a pure package in its own layer between `track, ai`
and `protocol`:

```
core → sim → track, ai → race → protocol → input, audio, render → apps/web
```

`race` may import core, sim, track and ai; protocol, input, audio, render and the app may
import it. It has the same purity rules as the sim (no DOM, no clock, seeded randomness only),
enforced by ESLint.

**Shape.** `RaceControl` is the rules engine over per-tick car facts (track position, speed,
wheels off, pit lane), so the rules are tested with cars on rails, independent of the vehicle
model. Session types (time trial, practice, qualifying, race) are strategies over one core;
the rules are small systems (track limits, flags, DRS, pit, watchdog) that each own their
serialisable state. `RaceSession` runs the engine over the sim world with drivers behind one
`CarController` interface (human input or AI). The whole state snapshots to JSON.

**Why.** The same rules must run in solo play, in headless scripted races (the product's
acceptance test) and later on the room service, which referees online sessions. One pure
package is the only way to keep those identical. It sits above `ai` because the session drives
AI cars; `protocol` sits above it so messages can carry its events and snapshots.

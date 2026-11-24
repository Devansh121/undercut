# 0003 Netcode: state sync

Status: accepted (M0); updated in M5 with what was built.

State sync, not lockstep: each browser simulates its own car, so bit-identical maths across browsers is not needed.
A room service (Cloudflare Worker, one Durable Object per room, run locally with `wrangler dev`) owns the clock, grid, lights-out, session state, timing checks and results. AI runs on the host and migrates with it.
Snapshots at about 30 Hz, rendered with interpolation and bounded extrapolation. Solo play never depends on the service.

## M5: how it turned out

The details are in [docs/netcode.md](../netcode.md). Where the build differs from or adds to the plan above:

- **The room is a pure state machine** in `packages/protocol/src/room/`, not code in the Durable Object. The Durable Object only turns socket events and alarms into machine events and carries out what comes back. All room rules are unit-tested in Node with a fake clock; the Workers runtime tests cover the wiring.
- **The service relays snapshots as they arrive** instead of batching them on a server tick: lowest latency, no timer while racing beyond a 500 ms alarm, and at 8 humans the extra sends are cheap. It drops stale and duplicate snapshots per car.
- **Snapshots are a 56-byte binary record**; control messages stay JSON. About 33 kB/s down per client with 20 cars.
- **The start schedule is announced in advance** (first light, interval, lights-out time including the random hold). Every client shows the lights from its estimate of server time. A modified client could know the hold; jump starts are still caught from snapshots that reach the server before lights out.
- **Timing is refereed for plausibility, not authenticity.** Claims are checked against physical floors, the car's own snapshots and the server's clock, and flagged or rejected with stable reasons. It is not an anti-cheat system.
- **A disconnected or silent car is a ghost** (held, then faded, no collisions) rather than being handed to the host's AI, until it resumes within the 60 s grace period or retires.
- **Remote cars use cubic Hermite interpolation** from the snapshot velocities, not linear: the soak showed linear interpolation losing 5 to 15 cm on curves when jitter makes the service drop reordered snapshots.
- **Race time is measured on the server clock.** Clients report race time from the server's lights out on their synced clock, so the server can refuse a race time longer than it has seen elapse. The chequered flag is derived from all counted crossings, so arrival order cannot change a result.
- **Unjoined sockets are bounded per room and per client address** before the upgrade is accepted, and the per-address limits trust only `CF-Connecting-IP` as the edge (or a local proxy) sets it.
- **Time runs in real time.** A Durable Object reads the wall clock, so the soak cannot run accelerated; it runs a short race in CI and a longer one nightly. Tests shorten the room timings through the service's `ROOM_TIMINGS` variable instead.
- **Online car-to-car contact is symmetric and latency-compensated.** Each client resolves 240 Hz planar contact between its owned car(s) and remote peers extrapolated to `serverNow` (circular-arc extrapolation up to 250 ms), applying its own equal-mass share with bounded per-step separation and mandatory post-contact `resolveWallContact` clamping so no car can be launched or pushed through a barrier. Owned-vs-owned pairs (host car and host AI) use full two-way `resolveCarContacts`.


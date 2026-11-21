# 0003 Netcode: state sync

Status: accepted (M0).

State sync, not lockstep: each browser simulates its own car, so bit-identical maths across browsers is not needed.
A room service (Cloudflare Worker, one Durable Object per room, run locally with `wrangler dev`) owns the clock, grid, lights-out, session state, timing checks and results. AI runs on the host and migrates with it.
Snapshots at about 30 Hz, rendered with interpolation and bounded extrapolation. Solo play never depends on the service.

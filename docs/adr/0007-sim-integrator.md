# 0007 Sim integrator and step

Status: accepted (M1).

**Decision.** The world steps at a fixed 1/240 s (the game loop's step). Each car splits that
into substeps of at most 1/960 s (four per world step) and integrates with semi-implicit
(symplectic) Euler: forces from the current state, velocities updated, then positions from the
new velocities. Two parts are treated implicitly because they are stiff or discontinuous:

- The tyre contact-patch deflection (relaxation-length slip) decays implicitly,
  `u ← (u + h·v_slip) / (1 + h·|v|/σ)`, so it is stable at any speed and turns into a spring at
  standstill instead of dividing by speed.
- Brakes, rolling resistance, the clutch and the limited-slip differential are Coulomb
  friction. They are solved as bounded velocity constraints on the engine and the four wheels
  with projected Gauss–Seidel (12 passes). A held brake gives an exact zero wheel speed, so a
  car parked on a slope does not creep or chatter.

**Why substeps.** The stiffest coupled modes are the wheel spin against the contact patch
(about 300 rad/s at high load), the unsprung mass on the tyre (about 110 rad/s) and the tyre's
vertical damping on the unsprung mass (c/m ≈ 280 1/s). At h = 1/960 s, h·ω ≈ 0.3 for the
fastest of them. Higher-order integrators (RK4) cost four force evaluations per step and buy
nothing across friction and contact discontinuities; a fully implicit solve over 25+ states is
far more code and cost for the same answers.

**Measured** on the owner's laptop (AMD Ryzen 7 7435HS, Node 20.19, one core, other agents
running), `npm run telemetry -- bench`, physics suite at each setting:

| Substep | Substeps per 240 Hz step | One car, × real time (3 runs) | Physics suite (61 checks) |
| --- | --- | --- | --- |
| 1/240 s | 1 | 2880–2930× | 55 fail: lateral sweeps and fuzz blow up |
| 1/480 s | 2 | 750–1330× | 4 fail: ABS-in-turn slide doubles, braking values drift |
| **1/960 s** | **4** | **530–880×** | **all pass** |
| 1/1920 s | 8 | 340–500× | top speed, acceleration and lateral identical to 2 decimals; braking distances 1–1.5 % shorter, so recorded gaps would need re-recording |

At 1/960 s one 240 Hz step of one car costs about 0.005 ms and of 20 cars about 0.07 ms, so a
60 Hz frame (four steps) of a full field costs about 0.3 ms in Node. The target was 150× real
time for one car; the chosen step gives 530–880× depending on machine load.

**Consequences.** Changing `MAX_SUBSTEP` changes the braking numbers by about 1 %; the
known-gap assertions in the physics suite will flag it, and the gaps are then re-recorded with
the Results section. The step-size table above is reproducible by editing `MAX_SUBSTEP` in
`packages/sim/src/step.ts` and running the benchmark and `npm run test:physics`.

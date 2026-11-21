# 0008 Barriers, bad ground and the pose invariants

Status: accepted (M1).

**Context.** On master 670438a a car that left the track at Monza could cross the barrier line,
reach ground where the lap projection is ambiguous, meet a 2 m step and be thrown hundreds of
metres up with pitch and roll growing without limit. Three things were wrong at once: nothing
stopped a car at a barrier; the lap projection accepted a non-solution, so ground inside the
barriers at the first chicane stepped by 2.7 m; and the vehicle model had no defence against a
step (no tyre force ceiling, no suspension stops, and a plank whose damping turned a step's
ground rate into a multi-meganewton impulse).

**Decision 1: an optional wall query on the surface contract.** `SurfaceSampler` gains
`wall?(x, z, hint, out: WallSample)`: the distance of a point past the nearest barrier face
(positive behind it) and the face's inward horizontal normal. Samplers without barriers leave it
out; `FLAT_SURFACE` and the validation surfaces do. The sim still imports nothing from the
track. `TrackSurface` answers it from the lap's per-sample barrier offsets (a slanted face, with
the normal from the gradient of |d| − barrier(s), where the offset changes along s) and, along
the pit straight, from the pit lane's own frame out to the garage wall, so the drivable area is
the union of the lap inside its barriers and the pit lane. The pit wall and its verge lie between
the two and block from both sides.

**Decision 2: minimal honest barrier contact in the sim.** Every substep the four corners of the
body's footprint (nose 1.2 m ahead of the front axle, tail 0.8 m behind the rear, ±1.0 m) are
checked. A corner behind a face is pushed back onto it, and if it is moving into the face a
planar impulse at the corner removes its normal speed (restitution 0.1) and a Coulomb friction
impulse (μ 0.5) scrubs its speed along the face. Applied at the corner, both change the yaw rate,
so a car hitting at an angle swings round and slides along the barrier instead of sticking or
bouncing. The largest normal speed on each step is kept as `CarState.wallImpactSpeed` and in
telemetry (`wallImpact`, `wallContact`) for damage and audio later. No damage model (M3b).

**Decision 3: the vehicle model survives bad ground.** Tyre vertical force saturates at the
tyre's bottoming load (stiffness × 60 % of the sidewall height of the 18-inch wheel, 23.7 kN,
about twice the 11.5 kN peak of the reference lap), and each floor skid at four times that.
Bump and droop stops act beyond 40 mm of spring travel either way (the reference lap uses 16 mm
and never extends a spring). Two position-level rules follow, both counted in the state:

- a rise of more than 0.15 m into a tyre within one substep (taller than any kerb) is a step:
  that corner, wheel and body together, is lifted by the rise, pivoting about the opposite
  corner, so no spring or tyre compression and no velocity changes. This is the last line of
  defence against bad ground (`groundSteps`) and is asserted never to act on a real circuit;
- penetration past any deflection (a wheel 50 mm beyond its bottoming depth, or the floor 50 mm
  into the ground) is resolved inelastically: the car moves up and loses its speed into the
  ground. This is a floor or rim strike (`contactLifts`). It never happens on the racing line;
  random driving at Monza meets it on raised kerbs taken hard (a 13 cm sausage kerb puts the
  floor's edge into it), and the fuzz asserts it happens nowhere else.

Pitch and roll stay bounded because the forces are bounded, not because the state is clamped.

**Decision 4: one invariant checker.** `checkCarInvariants(state, invariantLimits(model,
{ surfaceStep }))` in `packages/sim` checks every state number is finite, floor heights, pitch and
roll against the plane through the four contact heights, and wheel heights above the ground,
with limits derived from the car (docs/physics-validation.md, section 7.7). The game runs it on
the player's car every tick and resets the car if it ever fails (a safety net, counted in the
debug API; a browser test shows normal play never uses it).

**Consequences.** The reference lap is bit-identical (85.539 s before and after) and the AI
artefacts' behavioural fingerprints are unchanged: none of the new mechanisms acts on the racing
line. Barrier contact costs four wall queries per substep. Barrier data that sits beyond where
the lap frame is one-to-one would make the wall query ambiguous; on Monza every barrier offset
is inside the frame's clearance, and the ground-continuity test walks every point inside the
barriers. Changing the contact again (damage, deformable barriers) replaces decision 2 only.

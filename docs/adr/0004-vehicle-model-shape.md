# 0004 Vehicle model shape

Status: accepted (M0). The detailed car model is ADR 0005.

A planar multi-body model driven over a 2.5D track surface: longitudinal, lateral and yaw; four wheel-spin states; sprung-mass heave, pitch and roll through real springs, dampers and anti-roll bars feeding ride heights into the aero map. Slope, banking and vertical curvature enter through the surface. Fixed timestep, seeded RNG, no DOM.
Chosen over a free 3D rigid body with ray-cast wheels because it is far more testable and numerically robust while still producing every number in the validation list.
Car-to-car and car-to-barrier contact is 2D oriented-box impulse resolution.

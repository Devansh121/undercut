# Car hard points

The car's proportions are named constants in `carlib/dims.py`, asserted on every build. Units are metres in the build frame (+X forward, +Y left, +Z up, origin on the ground under the centre of the wheelbase). "Regulation" means the 2022–2025 technical regulations as summarised in `docs/physics-validation.md` section 1; "estimate" means a plausible figure for the era, read off the shape of current cars, with no published number behind it.

| Hard point | Value | Source |
| --- | --- | --- |
| Wheelbase | 3.600 | Regulation maximum; cars of the era run at or near it (physics-validation 1.1) |
| Front track (wheel centres) | 1.620 | Estimate in physics-validation 1.1: 2000 mm overall width less the front tyre width |
| Rear track | 1.550 | Same; rear tyres are wider |
| Overall width | 2.000 | Regulation maximum. Asserted: front 1.620/2 + 0.360/2 = 0.990, rear 1.550/2 + 0.445/2 = 0.998 |
| Tyre diameter | 0.720 | Regulation: at most 725 mm dry |
| Tyre width front / rear | 0.360 / 0.445 | Regulation ranges 345–375 and 440–470 mm; rear taken at the low end so the width limit holds with the 1.55 m track |
| Rim | 18 in, bead radius 0.2286, lip radius 0.2453, width 0.3353 / 0.4293 | Regulation (rim diameter, lip diameter and mounting widths) |
| Overall length | 5.600 (nose tip +3.000 to rear wing trailing edge −2.600) | Estimate: era cars are 5.6–5.7 m long |
| Front overhang (axle to nose tip) | 1.200 | Estimate, from the length above and a rear overhang of 0.8 m |
| Height at the roll hoop | 0.950 | Estimate for the era (brief: about 950 mm) |
| Plank underside (static ride height) | 0.030, flat, no rake | Estimate. Ground-effect cars run flat and low |
| Reference plane (floor underside) | 0.040 | Plank 10 mm thick (regulation figure for the skid block thickness is in the same range) |
| Floor half width | 0.975 between x = 0.30 and −0.40, tapering to 0.30 at the leading edge and 0.52 ahead of the diffuser | Estimate; follows the floor outline of current cars in plan |
| Floor leading edge and fences | x = 1.30 | Estimate: just behind the front tyres |
| Diffuser | x = −1.20 to −2.10, exit roof 0.330, half width 0.50 | Estimate |
| Survival cell at the cockpit | half width 0.420, rim height 0.700 | Estimate; side-impact structures make the cell widest beside the driver |
| Cockpit opening | x = 0.82 to −0.02, half width 0.255, rounded front | Estimate from the regulation cockpit template's size (about 850 mm long) |
| Helmet centre | (0.18, 0, 0.775), radii 0.150 / 0.118 / 0.138 | Estimate: helmet top just below the halo hoop, 1.62 m behind the front axle |
| Steering wheel | centre (0.53, 0, 0.64), face tilted 18° towards the driver | Estimate |
| Halo | pylon base (0.98, 0, 0.665), hoop front (0.82, 0, 0.835), rear mounts x = 0.03, half width 0.330, z = 0.705 | Estimate; the regulation fixes the halo as a standard part of about this size |
| Sidepod inlet | x = 0.70, half width 0.740, z = 0.36 to 0.62 | Estimate, a "downwash" sidepod of the 2023–2025 kind |
| Sidepod end (coke bottle) | x = −1.45, half width 0.215; the sidepod relaxes onto the chassis surface over the last 0.30 m | Estimate |
| Roll hoop and airbox | x = −0.10, top 0.950, airbox half width 0.105 | Estimate |
| Front wing | span 1.970 (endplate outer faces at ±0.985), main plane leading edge x = 2.985, lowest point z ≈ 0.09, top flap trailing edge at the tip z ≈ 0.31 | Regulation limits the wing to the car's width and to four elements; heights are estimates |
| Rear wing | span ±0.530 to the rolled tips, main plane leading edge x = −2.05, top 0.960, tips rolled over a 100 mm radius into the endplates | Estimate; the regulation box puts the rear wing narrower than the rear track, and cars of this era roll the wing tips into the endplates |
| Beam wing | x = −2.18, z = 0.33, two elements | Estimate |
| DRS flap | hinge at the flap trailing edge, opens 22° (slot about 85 mm) | Regulation: 85 mm maximum slot gap; the angle follows from the 0.225 m flap chord |
| Rear crash structure tip | x = −2.53, centre z = 0.33 | Estimate |
| Suspension pick-ups | `FRONT_*`, `REAR_*` in `dims.py` | Estimates. Front push-rod, rear pull-rod. Inboard points are moved onto the chassis surface at build time so no link ends in the air; outboard points are asserted to sit inside the wheel |

Checks run on every build (`dims._check`): overall width at both axles, front wing span, overall length 5.5–5.7 m, tyre diameter, cockpit at least 1.4 m ahead of the rear axle, rear wing narrower than the inside of the rear tyres, and every outboard pick-up inside its wheel.

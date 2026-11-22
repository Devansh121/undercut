# Physics validation targets

Working engineering document for the vehicle model. Era: the 2022–2025 ground-effect single-seaters (DRS, ERS, 18-inch tyres). Every figure has a source number from the list at the end, or is marked **estimate** with the reasoning. Where a published figure and an estimate conflict, the published figure wins and the estimate is recalibrated.

Source quality, best first: FIA regulations [1][2] (index [3]), FIA timing and event documents [46], official results, Brembo's own pages, reprints of Brembo releases in the trade press, other trade press, blogs. Blog-grade figures are flagged where used.

Model being validated: planar multi-body chassis on a 2.5D surface, four wheel-spin states, sprung-mass heave/pitch/roll, combined-slip load-sensitive tyres, speed- and ride-height-dependent aero, power unit with ERS, eight-speed gearbox, differential, brakes with bias.

## 1. Reference car parameter sheet

### 1.1 Mass, geometry, inertia

| Parameter | Value | Source / reasoning |
|---|---|---|
| Minimum mass, car + driver, no fuel | 800 kg (2025), plus a mass increase when a heat hazard is declared | [1] Art. 4.1, 4.7. Earlier seasons of the era were within a few kg of this (**estimate**; only the 2025 text was checked); use 800 kg throughout. |
| Driver + seat + ballast floor | 82 kg | [1] Art. 4.6.2 (ballast is added if driver and seat are lighter). |
| Front / rear axle minimum at minimum mass | ≥ 0.446 × 800 = 356.8 kg front, ≥ 0.539 × 800 = 431.2 kg rear | [1] Art. 4.2. Only 1.5 % (12 kg) is free to place, so static front share is 44.6–46.1 %. |
| Static weight distribution (model default) | 45.5 % front | **Estimate**: middle of the regulated window. Fuel sits ahead of the rear axle near the CoG, so the distribution moves only about 1 point rearward with a full tank. |
| Race start fuel | 100–110 kg | **Estimate**. A 110 kg race fuel cap is widely reported, but I did not find the figure in the 2025 Technical or Sporting Regulations text I searched [1][2]. Treat it as an open item and use 105 kg as the default race start load. Qualifying runs: 5–10 kg (estimate). |
| Fuel flow limit | 100 kg/h; below 10 500 rpm, Q = 0.009·N + 5.5 kg/h | [1] Art. 5.2.3–5.2.4 |
| Wheelbase | ≤ 3600 mm; model 3600 mm | [1] Art. 3.4.2. **Estimate**: cars of the era run at or near the limit. |
| Track width (wheel centre to wheel centre) | front 1.62 m, rear 1.56 m | **Estimate**: overall width is limited to 2000 mm; subtracting the tyre widths [1] Art. 10.8.1 (front 345–375 mm, rear 440–470 mm) gives about 1.63 m front and 1.55 m rear. |
| CoG height | 0.30 m (range 0.27–0.33) | **Estimate**. An open lap-time model of an older (13-inch-tyre) car uses 0.335 m [44]. The 2022+ cars sit lower, and the PU centre of gravity must be above Z = 200 mm [1] Art. 5.5.2, so 0.30 m is plausible. |
| Yaw inertia Izz | 1200 kg·m² (range 1000–1400) | **Estimate**: radius of gyration about 1.2 m for an 850 kg car, 5.6 m long with mass concentrated between the axles. |
| Pitch inertia Iyy | 1100 kg·m² | **Estimate**: slightly below Izz because the mass is flat. |
| Roll inertia Ixx | 180 kg·m² | **Estimate**: radius of gyration about 0.46 m. |
| Unsprung mass per corner | 25 kg front, 30 kg rear | **Estimate**: magnesium rims [1] Art. 10.7.1, wide tyres, uprights and brake assemblies. |

### 1.2 Tyres (18-inch)

| Parameter | Value | Source / reasoning |
|---|---|---|
| Rim | 18 in; outer lip diameter 490.6 mm; mounting width 335.3 mm front, 429.3 mm rear | [1] Art. 10.7.2 |
| Tyre width (new, 1.4 bar) | 345–375 mm front, 440–470 mm rear | [1] Art. 10.8.1 |
| Tyre diameter | ≤ 725 mm dry, ≤ 735 mm wet | [1] Art. 10.8.1 |
| Loaded rolling radius (model) | 0.355 m | **Estimate**: 0.36 m free radius minus about 5 mm deflection at running load. |
| Peak friction, lateral | μy at the reference load of 3 kN: range 1.7–2.2; model 2.145 (fitted, section 7) | **Estimate**, bounded by two open single-seater tyre sets: [56] gives 1.71 at 3 kN (1.80 at 2 kN, 1.45 at 6 kN, interpolated), [44] 1.85 front and 2.15 rear at 3 kN. About 2 at the reference load is usual for this class on the softest compound with low fuel. Fitted to the low-trim slow-corner lateral target (2.5). |
| Peak friction, longitudinal | μx at 3 kN: range 1.6–2.0; model 1.765 (fitted, section 7) | **Estimate**. Both cited sets have μx close to μy at the reference load: [44] 0.89–0.91 of it, [56] 0.97 (1.66 at 3 kN). The model's fitted ratio is 0.82, below both; section 7.4 says what that may mean. Set separately from μy, as [44], [56] and the magic formula's pDx and pDy terms do. |
| Load sensitivity | dμ/dFz in both directions: range −5 × 10⁻⁵ to −8.75 × 10⁻⁵ N⁻¹; model −8.75 × 10⁻⁵ (μ drops 0.44 between 3 kN and 8 kN) | Both cited sets use one slope for both directions: [44] −5 × 10⁻⁵ N⁻¹ (a 13-inch tyre), [56] −8.75 × 10⁻⁵ N⁻¹ (μx 1.75 → 1.40 and μy 1.80 → 1.45 from 2 to 6 kN, measured tyre parameters per its reference [11], linear in load). The model takes [56]'s, the only set with friction published at two loads, and does not fit the slope. Peak aero load per tyre at 300 km/h is about 6–9 kN, so this term matters. |
| Minimum starting pressures (slicks) | Monza 2025: F 26.5 psi, R 23.5 psi. Spa 2025: F 26.5, R 24.5. Singapore 2025: F 22.0, R 20.0 | [17][18][19] |
| Static camber limits | Monza: F −3.00°, R −2.00°. Spa: F −2.75°, R −1.50°. Singapore: F −3.25°, R −2.00° | [17][18][19] |
| Blanket limit | 70 °C tread and sidewall, at most 2 h (slicks); no blankets for full wets | [17][18][19] |
| Compounds | C1 (hardest) to C5 in the era, plus C6 in 2025; three are nominated per event | 2025 nominations: Monza C3/C4/C5 [17], Spa C1/C3/C4 [18], Singapore C3/C4/C5 [19] |

### 1.3 Power unit, ERS, transmission

| Parameter | Value | Source / reasoning |
|---|---|---|
| Engine | 1.6 L four-stroke V6 turbo | [1] Art. 5.2.1–5.2.2 |
| ICE crank power | 560 kW (range 540–590) | **Estimate**. Fuel power is 100 kg/h × about 43 MJ/kg ≈ 1.19 MW. One manufacturer reported more than 50 % thermal efficiency on the dyno in 2017 [40], and that figure includes energy recovered by the MGU-H. At about 47 % shaft efficiency the crank power is about 560 kW. Calibrate against the speed-trap and acceleration targets. |
| Power curve | full fuel flow from 10 500 rpm; peak power 10 500–11 500 rpm; useful limit about 12 200 rpm | Fuel-flow ramp from [1] Art. 5.2.4. The rpm figures are **estimates**, consistent with the shift points of 11 800 rpm used in [44]. |
| Rev limit | model limiter 12 500 rpm | **Estimate**. I did not find an explicit crankshaft-speed cap in the 2025 text; [1] Art. 9.9.2 refers to 15 000 rpm only in a gear-ratio rule. Above 10 500 rpm the fuel flow is fixed, so extra revs add friction loss rather than power. |
| MGU-K power | ±120 kW (deploy and harvest), torque ≤ 200 Nm | [1] Art. 5.3.3 and the energy-flow diagram in Art. 5.3.2 |
| MGU-K use at the start | only after the car reaches 100 km/h (except pit-lane starts) | [1] Art. 5.3.2 diagram |
| ES → MGU-K | ≤ 4 MJ per lap (33.3 s at 120 kW) | [1] Art. 5.3.2 |
| MGU-K → ES (harvest) | ≤ 2 MJ per lap | [1] Art. 5.3.2 |
| MGU-H ↔ ES and MGU-H → MGU-K | unlimited | [1] Art. 5.3.2. The MGU-H can feed the MGU-K directly, so deployment can last longer than 33 s per lap if the MGU-H harvests. Model the MGU-H as a speed- and load-dependent harvest source (**estimate**: 0–60 kW at full load). |
| ES state-of-charge window | max − min ≤ 4 MJ while on track | [1] Art. 5.3.2 |
| Lap definition for energy | timing-line crossings; the lap ends at pit-lane entry when pitting | [1] Art. 5.3.2 |
| ES cell mass | 20–25 kg | [1] Art. 5.5.3 |
| Forward gears | 8, ratios nominated once per season (one set for every circuit) | [1] Art. 9.7.1–9.7.2 |
| Every gear must reach | ≥ 80 km/h at 15 000 rpm | [1] Art. 9.9.2 |
| Overall ratios (engine revs per wheel rev), model default | 16.5, 12.4, 10.1, 8.5, 7.3, 6.3, 5.4, 4.6 | **Estimate**. With r = 0.355 m and 11 800 rpm these give 96, 127, 156, 186, 216, 251, 292 and 343 km/h, and 355 km/h on the limiter in 8th, which matches the Monza speed trap (section 2.2). 1st reaches 122 km/h at 15 000 rpm, which satisfies Art. 9.9.2. |
| Shift time | upshift torque dip 30 ms; downshift 60 ms including blip | **Estimate**: seamless-shift gearboxes have close to zero torque interruption. Keep it a parameter. |
| Drivetrain efficiency | 0.95 | **Estimate**; [44] uses 0.96 for the gearbox. |
| Automatic shifting | not permitted on the real car | [1] Art. 9.9.1. In the game it is an assist, which changes only what reaches the car. |

### 1.4 Aerodynamics

No team publishes CdA or ClA. All values below are **estimates**. They are fitted to the published speed traps and deceleration figures, so the tests in section 2 that use those same numbers check the fit, not the model. The independent checks are the lap times, the sector times and the braking distances.

How the drag values were derived: at the end of a straight that is long enough, wheel power = (½ρCdA·v² + rolling resistance)·v.

- **Monza**, qualifying speed-trap median 348.3 km/h with DRS open [11], ρ = 1.17 (**estimate** for a September afternoon at 180 m altitude). With the MGU-K deploying, wheel power ≈ 0.96 × 680 kW and CdA ≈ 1.15 m². With the MGU-K clipped (ES exhausted), wheel power ≈ 0.96 × 560 kW and CdA ≈ 0.93 m². The true value lies between these.
- **Spa**, Intermediate 1 ≈ 340–345 km/h [13]. Its position is not shown on the FIA map; it is the highest speed on the lap, so it is probably near the end of the Kemmel straight, which climbs about 4.6 % (DEM, [track-data.md]). This gives CdA ≈ 0.90–1.13 m² with DRS open, showing that 2025 Spa qualifying trims were close to low-drag.

| Trim | CdA, DRS closed (m²) | DRS drag change | ClA (m²) | Aero balance (front share of downforce) | Notes |
|---|---|---|---|---|---|
| Low drag (Monza) | 1.15 (1.05–1.25); model 1.16 (section 7) | −12 % | 3.6 (3.0–4.2) | 44 % | Monza wings are already small, so DRS gains less than at Spa. A constructor's explainer gives downforce equal to the car's weight (795 kg) at about 150 km/h [57], an effective ClA of about 7.5 m² there (trim and circuit not stated): it points to the upper part of this table's ranges, not past them. The top of the low-trim range was investigated and not adopted (section 7.3). |
| Medium (Spa) | 1.30 (1.15–1.45) | −15 % | 4.6 (4.0–5.2) | 44 % | |
| High downforce (Singapore) | 1.60 (1.45–1.75) | −18 % | 5.8 (5.0–6.5) | 45 % | No terminal-speed check is possible: the Singapore speed trap is 150 m before Turn 1 at the end of a short straight [6]. |
| Cross-check, older car [44] | 1.56 | −17 % | 4.88 | 45 % | Pre-2022 car at a medium-high downforce circuit |

DRS: in the open state the rear-wing slot gap is 9.4–85 mm, and there are only two positions [1] Art. 3.10.10.

Ride-height sensitivity (shape for the model, **estimate**):
- Downforce rises as the floor's front ride height falls, until a critical height (about 15–20 mm at the floor leading edge), below which the underfloor flow stalls. That stall causes porpoising and a 10–25 % loss of the floor's downforce over a few millimetres (in the model: of the floor's share only; the wings keep theirs).
- Model ClA(h_f, h_r) = ClA₀ · (1 − f + f·(1 + k_h·(h₀ − h_eff))·S) with k_h ≈ 0.02 per mm of the floor's own downforce above the stall height, f the floor's share of the downforce (**estimate** 0.6, range 0.5–0.7: the floor makes most of this era's downforce; the wings and bodywork do not see the floor height), and S the smooth stall factor below h_crit, applied to the floor term only. Move the balance forward when the rake increases.
- Decided in the model, without a source either way: the stall changes neither the drag (a stalled floor loses induced drag but gains separated-flow drag; the net is unknown and taken as zero) nor the balance (the floor's own centre of pressure is not separated from the wings', so the stall scales the floor's front and rear shares together). Both would move the braking peaks; neither is tuned.
- Drag sensitivity to ride height is about one third of the downforce sensitivity, again on the floor's share.
- None of these numbers is published; tune the shape so the car bottoms on the Monza and Spa straights and so the braking targets in section 2.3 are met.

Density: use ρ from circuit altitude and temperature. Spa is 364–467 m above sea level ([track-data.md]), so ρ is 4–5 % lower than at Monza. Also model the effect of the steep grade on vertical load at Eau Rouge.

### 1.5 Brakes

| Parameter | Value | Source / reasoning |
|---|---|---|
| Discs | one per wheel; thickness ≤ 32 mm; diameter 325–330 mm front, 275–280 mm rear | [1] Art. 11.3 |
| Pads | at most two per wheel | [1] Art. 11.3.5 |
| Peak braking power per car | 2.2–2.7 MW at the hardest stops; validation targets ±10 %, recorded gaps (section 7.9) | [21][22][23][51]: 2715 kW Monza T1 2025, 2584 kW Spa T5 2025, 2542 kW Singapore T7 2025, 2239 kW Singapore T14 2024 |
| Peak pedal load | 145–162 kg at the hardest stops | same sources |
| Brake bias (model default) | 57 % front, driver-adjustable 52–62 % | **Estimate**: the static front share is about 45 %; under 4–5 g braking the load moves forward, so the optimum is about 55–60 %. The rear also gets MGU-K harvest braking (up to 120 kW), which must be blended by brake-by-wire. |
| Disc operating window | 350–1000 °C; peaks to 1000 °C+ | **Estimate**, widely quoted range for carbon-carbon. Model friction falling below about 300 °C and above about 1100 °C. |

### 1.6 Suspension (all estimates)

No published figures exist for this era; the cars run very stiff to control floor ride height.

| Parameter | Value | Reasoning |
|---|---|---|
| Heave natural frequency (sprung mass on springs and tyres) | 5–7 Hz front, 4.5–6 Hz rear | Ground-effect floors need small ride-height changes: about 10 mm of aero compression at top speed under about 15 kN of downforce. |
| Pitch | about 4–5 Hz | Follows from the heave stiffness and wheelbase. |
| Roll stiffness distribution | 55–60 % front | Stable mid-corner balance with a 45 % front weight share. |
| Tyre vertical stiffness | 250–300 kN/m per tyre | Typical for 18-inch racing tyres at about 1.6 bar running pressure. |
| Damping ratio | 0.3–0.5 heave, 0.6–0.8 roll | Usual racing ranges. In the model most of it comes from a lumped term at the tyre (see below). |
| Contact patch | 0.32 m wide front, 0.40 m rear, 0.15 m long | **Estimate**: about 0.88 of the tread width ([1] Art. 10.8.1) and a typical loaded length. The tyre deflects against the ground averaged over the patch, so short features (a kerb's first rise) are spread over the patch's width. |

Where the damping sits, in this model. With its wheel rates five times the tyre's stiffness and no heave element or inerter, a damper on suspension travel cannot damp the body modes much: a Zener (standard linear solid) bound gives at most ζ ≈ (k∞ − k0) / (4√(k0 k∞)), with k0 the springs and tyres in series and k∞ the tyre alone, so ζ ≤ 0.05 front and 0.10 rear for 1.5 / 0.6 MN/m against 300 kN/m, and no choice inside this section's ranges (tyre 250–300 kN/m, heave 5–7 Hz) reaches 0.3. That is a limitation of this model's stiff springs and reduced suspension (corner springs, anti-roll bars and corner dampers only), not a physical need to put body damping in the tyre: a real car's heave element and inerters act on suspension travel with different rates. The model has corner dampers on suspension travel (they damp wheel hop) and carries the body damping as a lumped, phenomenological term on the tyre's deflection rate, 7 kN·s/m, standing in for carcass damping and the missing heave damping together; it acts on the patch-averaged ground and grows from nothing at first touch to its full value at 3 mm of deflection (section 7.3). Open item: revisit the wheel rates against the tyre stiffness and add a heave element, after which most of this term should move to the suspension.
| Static ride height (floor reference) | front 20–30 mm, rear 60–80 mm | Shape only. Tune against the bottoming and ride-height sensitivity above. |

## 2. Validation targets

How to read the table: "Test" says what the telemetry runner measures. Tolerances are two-sided: a car that is too fast fails the same as one that is too slow. Speeds are in km/h, decelerations in g (9.80665 m/s²).

### 2.1 Reference laps (primary targets)

Fastest dry pole lap of the 2022–2025 era on the current layout, from the official qualifying results.

| Circuit | Layout used | Reference lap | M1 band (±5 %, first circuit only) | M4 band (±3 %, all three) | Source |
|---|---|---|---|---|---|
| Monza | 5.793 km, unchanged 2022–2025 [4][20] | **1:18.792** (2025) | 74.852–82.732 s | 76.428–81.156 s | [24] |
| Spa | 7.004 km, unchanged 2022–2025 [5][20] | **1:40.562** (2025) | 95.534–105.590 s | 97.545–103.579 s | [25] |
| Singapore | Layout introduced 2023 (old Turns 16–19 replaced by a straight); 4.940 km in 2023–24, re-measured as 4.927 km in 2025 [6][7][20] | **1:29.158** (2025) | 84.700–93.616 s | 86.483–91.833 s | [26] |

Era context, pole times from the official results [24][25][26][45]:

| Circuit | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|
| Monza | 1:20.161 | 1:20.294 | 1:19.327 | 1:18.792 |
| Spa (fastest Q3 time) | 1:43.665 | 1:46.168 (damp) | 1:53.159 (wet) | 1:40.562 |
| Singapore | 1:49.412 (old layout, wet) | 1:30.984 | 1:29.525 | 1:29.158 |

Test: the reference AI driver drives a flying lap with qualifying fuel (about 10 kg), new softest compound, DRS used in the DRS zones only (qualifying rules), full ERS, circuit-specific trim, ISA-like conditions corrected to the event (25 °C, the circuit's altitude). Record the lap time. A lap outside the band fails.

### 2.2 Sector times and speed traps (secondary targets)

From the FIA qualifying documents [11][12][13][14][15][16]. The "best" columns are the session-best values across the field, so the ideal lap is quicker than the pole lap. Sector and trap positions are taken from the FIA circuit maps [4][5][6].

| Circuit | S1 best | S2 best | S3 best | Ideal lap | Sector lines | Pole lap sectors |
|---|---|---|---|---|---|---|
| Monza | 26.181 | 26.340 | 26.047 | 1:18.568 | S1 233 m before T4; S2 215 m before T8 | 26.262 / 26.483 / 26.047 (sum equals the pole lap) |
| Spa | 29.761 | 42.532 | 27.857 | 1:40.150 | S1 145 m before T5; S2 48 m before T15 | the pole-holder's best sectors sum to 1:40.402, so they came from different laps |
| Singapore | 26.415 | 37.329 | 25.220 | 1:28.964 | S1 150 m before T7; S2 140 m before T14 | best sectors sum to 1:29.028 |

Sector tolerance: ±3 % per sector at M4, the same as the lap. A sector that passes while another fails points to a specific weakness: S2 at Spa is the downforce sector, S1 at Monza is the drag-and-braking sector.

| Circuit | Trap position | Trap, qualifying 2025 (fastest / median of 20) | Intermediates (fastest) | Target for test |
|---|---|---|---|---|
| Monza | 212 m before T1 | 355.9 / 348.3 | I1 330.9, I2 347.3, finish line 320.7 | 348 ± 6 (DRS open, no tow) |
| Spa | 30 m after T4 (after Raidillon) | 319.9 / 314.9 | I1 345.2 (position unpublished, probably end of Kemmel), I2 221.4, finish line 234.9 | trap 315 ± 6; I1 341 ± 6 once its position is confirmed |
| Singapore | 150 m before T1 | 305.4 / 304.0 | I1 315.6, I2 281.2, finish line 264.8 | 304 ± 6 |

The fastest values include slipstream. The two cars quickest through the Monza trap, 355.9 km/h, were 7 km/h quicker than the median [11]. Test against the median in clean air.

Top speed with DRS at the end of the longest straight in low-drag trim: **348 ± 6 km/h** at the Monza trap. The DRS activation for the main straight is 12 m after the finish line [4]. Peak speed just before the T1 braking point should be 350 ± 7 km/h (**estimate**: the trap is 212 m before T1, and the car is still accelerating slightly).

### 2.3 Acceleration

No primary source publishes standing-start figures for this era. These targets are weak and carry wide tolerances. The lap, sector and trap targets take precedence if they conflict.

| Target | Value | Tolerance | Source | Test |
|---|---|---|---|---|
| 0–100 km/h | 2.6 s | ±0.3 s | [39] gives 0–60 mph ≈ 2.6 s (secondary). Traction-limited: 1st/2nd gear, MGU-K available only above 100 km/h [1]. | Launch on flat asphalt, race fuel 105 kg, launch control off (assist off), best of 5 runs |
| 0–200 km/h | 4.8 s | ±0.5 s | **Estimate**: with traction-limited 0–100 at 2.6 s and about 1.3 g mean from 100–200 km/h (power-limited, MGU-K on) the result is 4.6–5.0 s. Matches the brief's 4.5–5 s ballpark. | same run |
| 0–300 km/h | 10.5 s | ±1.5 s | **Estimate**: integrating 0.9 → 0.4 g between 200 and 300 km/h with the parameter sheet gives 9.5–11.5 s depending on CdA and ERS. | same run |

### 2.4 Braking

Brembo publishes the hardest braking event per circuit and, in some years, more than one. All figures are for the 2022–2025 cars. "Peak" is Brembo's reported maximum deceleration. Mean deceleration over distance, (v₁² − v₂²)/2d, is computed here and is the better-conditioned test quantity.

| Circuit, corner (year) | v₁ | v₂ | Distance | Time | Peak | Mean over distance | Source |
|---|---|---|---|---|---|---|---|
| Monza T1, Variante del Rettifilo (2025) | 337 | 89 | 129 m | 2.75 s | 4.7 g | 3.22 g | [21][47] |
| Monza T1 (2024) | 328 | 90 | 119 m | 2.52 s | 4.6 g | 3.29 g | [49] |
| Monza T1 (2023) | 334 | 89 | 122 m | 2.57 s | 5.2 g | 3.34 g | [48] |
| Monza T4, Variante della Roggia (2025) | n/p | n/p | 107 m | 2.02 s | 4.5 g | — | [27][47] |
| Monza T8, Variante Ascari entry (2025) | n/p | n/p | n/p | n/p | 4.5 g | — | [47] |
| Spa T5, Les Combes, end of Kemmel (2025) | 327 | 176 | 93 m | 1.48 s | 4.7 g | 3.21 g | [22] |
| Spa T5 (2024) | 320 | 167 | 99 m | 1.62 s | 4.5 g | 2.96 g | [50] |
| Spa T18, chicane (2025) | Δv = 219 km/h | | n/p | 2.51 s | 4.7 g | 2.47 g mean over time | [28] |
| Singapore T7, Memorial (2025) | 308 | 128 | 96 m | 1.90 s | 4.9 g | 3.22 g | [23][29] |
| Singapore T14 (2024) | 288 | 93 | 94 m | 2.19 s | 4.6 g | 3.11 g | [51] |

n/p = not published in the sources found.

Lap-level Brembo figures (2025): Monza has 7 braking events, 5 rated hard (≥ 3.8 g, > 120 kg), about 9.25 s on the brakes per lap [21]. Spa has 8 events (5 hard, 1 medium, 2 light), more than 12.5 s per lap, three events above 4.5 g [22]. Singapore has 11 events (5 hard, 3 medium, 3 light), more than 17 s per lap, seven events above 4 g [23].

Era contrast: Brembo figures for the pre-2022 cars at the same corners were 5.6–5.9 g peak (Monza T1 2019: 349 → 87 km/h in 137 m, 5.6 g [52]; Spa T18 2020: 333 → 92 km/h in 134 m, 5.9 g [53]). The 2022–2025 cars peak at 4.5–4.9 g, so the brief's "about 5 g" is slightly high for this era. Use the table above.

Tests:
1. Straight-line braking from v₁ to v₂ in the circuit's trim, race fuel 50 kg, driver applying full brake with optimal bias and no lock-up (ABS assist off, AI pedal control). Measure distance, time and peak deceleration (50 ms moving average).
   - Distance tolerance ±10 %.
   - Peak tolerance ±0.4 g.
   - Time tolerance ±12 %, wider because Brembo's time includes the trail-off into the corner.
2. Speed-dependent braking curve (shape test): maximum deceleration at 300, 250, 200, 150 and 100 km/h in Monza trim must fall monotonically. Peak at 300 km/h 4.6 ± 0.4 g; at 100 km/h 2.0 ± 0.4 g (**estimate**: mechanical grip plus a little aero).
3. Consistency check: Brembo's distance-mean deceleration is about 3.2 g at all three circuits, while peaks are 4.6–4.9 g. Deceleration therefore falls steeply with speed, which is the aero effect. A model with too little downforce passes the peak test but brakes too long. A model with too much passes the distance test but overshoots the peak.

### 2.5 Lateral acceleration

Published lateral-g figures for this era are scarce. Secondary-source values are flagged. Treat the slow-corner targets as model-consistency checks.

| Corner | Value | Tolerance | Source | Test |
|---|---|---|---|---|
| Spa T10–T11 (Pouhon), apex about 281 km/h | 5.7 g | ±0.7 g | [43] (blog citing car telemetry, 2022; secondary) | Qualifying lap, 0.5 s window centred on the apex, filtered lateral acceleration in the vehicle frame |
| Spa T3–T4 (Raidillon), about 300 km/h | 4.0–4.5 g | ±0.7 g | **Estimate**: 4 g was published for an older car with lower downforce [42]; the 2022+ cars are faster through it. Note the vertical loads: −1.7 g compression at the bottom and +1 g over the crest were published for the older car [42]. Use them as shape targets for the 2.5D surface. | same |
| Monza Parabolica / Curva Alboreto exit, about 260–280 km/h | 3.5–4.0 g | ±0.6 g | **Estimate** from Monza trim (ClA 3.6, μ 1.7) | same |
| Slow corners, 70–100 km/h (Monza T1–T2, Singapore T7, T13, T16) | 2.0–2.3 g | ±0.4 g | **Estimate**: mechanical grip μ ≈ 1.8–1.9 with downforce adding 10–20 % to vertical load at these speeds. Consistent with the brief's "about 2 g". | same |

Gap: there is no openly licensed per-corner telemetry for this era. Better lateral-g targets are a known gap (see section 5).

### 2.6 Corner minimum speeds, Monza (secondary reference, not targets)

Per-corner minimum speeds on a qualifying lap of this era were not found in an openly published
trace. What was found, and what is estimated, is listed here for the calibration report
(`npm run telemetry -- calibrate`). None of these is a test: they compare a lap on this track's
geometry with laps on the real one, and they are too weakly sourced to fail anything.

| Corner | Reference minimum (km/h) | Kind | Source or reasoning |
|---|---|---|---|
| T1–T2 Rettifilo | 75–85 | estimate | Brembo's T1 stop ends at 89 km/h [21][47], which is the speed at turn-in, not the minimum; the minimum through the chicane is lower. |
| T4 Roggia | 110–120 | estimate | No published figure; consistent with a 2.02 s, 107 m stop [27] from about 330 km/h. |
| T5 Roggia | 115–125 | estimate | As T4, exit side. |
| T6 Lesmo 1 | 175–190 | estimate | A little above Lesmo 2 (below), as the corner is more open. |
| T7 Lesmo 2 | 177–184 | sourced, practice | 2024 first practice: 184 km/h on one car's last lap, 177 km/h on the session's fastest lap (1:21.676, about 2.3 s slower than that year's pole) [54]. |
| T8–T9 Ascari | 176–190 | sourced, practice | 2024 first practice: 190 and 176 km/h [54]; the session's fastest lap 108.7 mph (175 km/h) in 2024 and 113.7 mph (183 km/h) in 2023 [55]. |
| T11 Parabolica | 200–215 | estimate | No era figure found. |

The practice figures are from laps two to three seconds slower than pole, so a pole lap's
minimum speeds are, if anything, higher.

## 3. Tolerances policy

1. A tolerance in this document, or in the test code that implements it, changes only in a pull request whose description explains why (new or better source, a measurement error in the target, or a modelling scope change).
2. A target the model cannot hit is recorded as a gap in section 5 with the measured value, not loosened. The test stays and is marked as an expected failure with a link to the gap entry.
3. When a better source replaces a figure, update the value, the source number and the date. Old values are kept in the git history, not in the table.
4. Fitted parameters (CdA, ClA, μ, power) are never re-fitted to the same quantity that validates them in the same pull request. Keep the fit set and the check set in section 2 separate.

## 4. Second-order effects with numbers

### 4.1 Slipstream and dirty air

| Effect | Value | Source |
|---|---|---|
| Downforce retained by the following car at 10 m (about one car length) | 2022 FIA baseline car 85 %; 2025 cars 65 % (2019 cars: 55 %) | [36], FIA CFD data |
| Downforce retained at 20 m (about two car lengths) | 2022 baseline 95 %; 2025 cars 80 % (2019: 65 %) | [36] |
| Pre-season design claim, 2022 | loss at 20 m cut from 35 % to 4 % | [37] |
| Model default | Mid-era values: retained downforce 75 % at 10 m, 88 % at 20 m, 97 % at 40 m, 100 % at 60 m. The balance moves rearward when the front wing is in a wake (**estimate**: −2 points front share at 10 m). Lateral offset of more than 1.5 car widths removes the effect. | Interpolated from [36] |
| Slipstream drag reduction | 25 % at 10 m, 12 % at 20 m, 5 % at 40 m, 0 beyond 60 m | **Estimate**. It is consistent with the 7 km/h spread between the towed and clean-air Monza speed traps [11]. With CdA 1.15 a 7 km/h gain at 350 km/h needs about 6 % less drag averaged over the straight. |

### 4.2 Tyre temperature and degradation

| Item | Value | Source / reasoning |
|---|---|---|
| Working ranges (13-inch era, last published) | C1 110–140 °C, C2 110–135 °C, C3 105–135 °C, C4 90–120 °C, C5 85–115 °C | [38], Pirelli 2019. No 18-inch-era windows were published in the sources found. Use these, shifted 5 °C lower to account for the 70 °C blanket limit [17]. **Estimate.** |
| C6 (2025) | 80–110 °C | **Estimate**: one step softer than C5. |
| Wear rates (lap-time loss from wear alone, fuel-corrected) | soft 0.08–0.12 s/lap, medium 0.05–0.08, hard 0.03–0.05 at a medium-degradation circuit | **Estimate**. Pirelli does not publish per-compound rates. Calibrate so that a one-stop race is viable on the nominated compounds at all three circuits, which matches the pit-loss figures in section 4.5 making extra stops expensive. |
| Thermal degradation | above the window: grip −1 % per 5 °C, wear rate × 1.5 per 10 °C | **Estimate**, shape only. |

### 4.3 Fuel effect

| Item | Value | Source / reasoning |
|---|---|---|
| Lap-time sensitivity to mass | 0.030–0.035 s per kg per lap, scaling with lap length (Spa about 0.04, Monza about 0.03) | **Estimate**. Widely quoted as 0.3 s per 10 kg; the model should produce it, not have it imposed. Test: the model lap time with +10 kg must be 0.25–0.40 s slower at Monza. |
| Fuel use per lap at race pace | about 105 kg / race laps: Monza 1.9 kg (53 laps), Spa 2.3 kg (44), Singapore 1.6 kg (62) | **Estimate** from the 105 kg start load and the lap counts [30][31][32]. |

### 4.4 Kerbs and run-off (all estimates)

No published friction data exists. The values give plausible behaviour.

| Surface | Peak μ relative to asphalt | Rolling drag | Notes |
|---|---|---|---|
| Flat painted kerb | 0.85–0.95 | ×1 | Less grip when wet-painted; slight vibration input |
| Sausage / high kerb | 0.6 | ×1.5 | Strong vertical input; can unload a wheel |
| Asphalt run-off | 0.95 | ×1 | Often a different, more abrasive compound |
| Artificial grass / astroturf | 0.6 | ×1.2 | |
| Grass | 0.35–0.45 | ×2 | |
| Gravel trap | 0.3–0.4 | ×6–10 (speed-dependent) | Must stop a car from 150 km/h within about 60–80 m |

### 4.5 Pit lane

| Circuit | Pit-lane speed limit | Typical pit stop time loss | Length of the OSM pit-lane way | Source |
|---|---|---|---|---|
| Monza | 80 km/h | 24.3 s | 742 m | [2] Art. 34.7; [30]; [track-data.md] |
| Spa | 80 km/h | 18.8 s | 720 m | [2] Art. 34.7; [31]; [track-data.md] |
| Singapore | 80 km/h from 2025 (60 km/h before) | 29.1 s averaged over earlier races at 60 km/h; about 21–23 s expected at 80 km/h (up to 8 s less) | 825 m | [2] Art. 34.7; [32]; [41]; [track-data.md] |

The 2025 race director notes contain no circuit-specific amendment to the 80 km/h limit for these events [8][9][10].

### 4.6 DRS zones (2025 FIA circuit maps)

Rules: DRS is enabled in a race if the car is less than 1 s behind another at the detection point, from one lap after the start or a safety-car period. It is disabled on first brake application, and the race director may disable it for poor visibility or yellow flags in the zone [2] Art. 22.1. In qualifying it is free in the zones.

| Circuit | Zone | Detection | Activation | Source |
|---|---|---|---|---|
| Monza | 1 (Serraglio straight to Ascari) | 95 m before T7 | 170 m after T7 | [4] |
| Monza | 2 (main straight) | 20 m after T11 | 12 m after the finish line | [4] |
| Spa | 1 (Kemmel straight) | 240 m before T2 | 305 m after T4 | [5] |
| Spa | 2 (main straight) | 160 m before T18 | 30 m after T19 | [5] |
| Singapore | 1 | at T4 | 48 m after T5 | [6] |
| Singapore | 2 | 102 m before T13 | 78 m after T13 | [6] |
| Singapore | 3 (shares detection 2) | 102 m before T13 | 100 m after T14 | [6] |
| Singapore | 4 (main straight) | 105 m after the apex of T17 | exit of T19 | [6] |

The 2024 Singapore map has the same four zones [7]. At Monza, a yellow on light panels 9–13 or 1–3 disables detection for zone 1 or 2 respectively [8].

### 4.7 Race distance

The number of laps is the least number of complete laps exceeding 305 km [2] Art. 5.4.

| Circuit | Laps | Race distance | Lap record (race) | Source |
|---|---|---|---|---|
| Monza | 53 | 306.720 km | 1:20.901 (2025) | [30] |
| Spa | 44 | 308.052 km | 1:44.701 (2024) | [31] |
| Singapore | 62 | 305.337 km (4.927 km lap) | 1:33.808 (2025) | [32] |

Also published: distance from pole position to the Turn 1 braking point is Monza 472 m, Spa 165 m, Singapore 178 m [33][34][35]. Use these as a start-procedure check.

## 5. Known gaps

| Gap | Effect | Plan |
|---|---|---|
| No published CdA/ClA, suspension rates or inertias | Parameter sheet relies on estimates | Fit against section 2 targets, keeping fit and check sets separate (section 3, rule 4) |
| Race fuel cap not located in the 2025 regulation text | Start mass uncertain by ±5 kg | Use 105 kg; re-check the regulations' appendices |
| Weak sources for standing-start acceleration | 0–200 and 0–300 targets are estimates | Wide tolerances; lap, sector and trap targets take precedence |
| Lateral g only from one secondary source (Pouhon) | Fast-corner grip calibration is weak | Look for a team or FIA publication with per-corner lateral g; until then use the Spa S2 sector time as the main downforce check |
| 18-inch tyre working ranges unpublished | Thermal model windows are estimates | Use the 2019 ranges shifted down; calibrate warm-up behaviour against the 70 °C blanket limit |
| Brembo per-corner data partial (only 1–3 events per circuit in the era) | Braking validation covers only the hardest stops | Add more events if Brembo publishes them; the speed-dependent curve test covers the rest |
| Braking times short (section 7) | Spa T5 1.13 and 1.20 s against 1.48 and 1.62 s ± 12 %; Singapore T7 1.45 s against 1.90; Singapore T14 1.81 s against 2.19 | Hypothesis, not established: Brembo's times may include the trail-off and turn-in into the corner, which the scripted stop (at the limit to v2; its pedal ceiling is an assumed estimate that barely acts, section 7.1) does not reproduce. The Monza times pass. Measure the stops on the real circuits with the reference driver's own trail braking once Spa and Singapore exist |
| Medium and high-downforce stops short and high-downforce peaks high (section 7) | Spa T5 77.3 and 78.5 m against 93 and 99 m ± 10 %; Singapore T7 83.1 m against 96 m ± 10 %; peaks Spa 2024 5.05 g against 4.5 ± 0.4, Singapore T7 5.40 g against 4.9 ± 0.4, Singapore T14 5.06 g against 4.6 ± 0.4 | The tyre's load slopes are set from [56], not fitted to braking, so these are not absorbed by the tyre. Competing explanations, none separated: more downforce lost under braking pitch than the modelled floor stall (a mechanism the model has, with unsourced settings); braking that becomes front-limited as load moves forward (an experiment in the review of this change, with an ideal instantaneous axle-capacity brake balance, did not bring the high-trim peaks into band on its own); the drivers' pedal build-up and the published peak's filtering; or a tyre more load-sensitive than both cited sets. Spa and Singapore laps with lateral data would separate tyre from aero |
| Monza T1 2023 peak 4.75 g against 5.2 ± 0.4 (section 7) | One event | The 2023 figure stands apart from 2024 (4.6 g) and 2025 (4.7 g) at the same corner and speed; the model gives about 4.7–4.8 g for all three. Check the 2023 source |
| Pouhon 4.59 g against 5.7 ± 0.7 (section 7) | Fast-corner lateral grip below the one secondary figure | Flat constant-speed sweep; the corner is downhill with two apexes and the source is a blog with no trace. With [56]'s load slope the tyre gives up more at high load than with [44]'s (4.92 g with it). Re-test on the Spa surface with the reference controller |
| Published brake powers (section 7.9) | Model 4401 / 4297 / 4026 / 3846 kW against 2715 / 2584 / 2542 / 2239 kW ± 10 % (+58 to +72 %) | Validation targets added in 7.9, recorded gaps. The sources do not say where in the stop the power falls. A capacity matched to it near v1 cannot lock a wheel at full pedal from 330 km/h in high trim and moves passing braking checks; the owner kept the passing checks. Not separated: when the power is reached, pad friction through the stop (not modelled), or a stronger brake system than the estimate |
| Downforce below [57] in low and medium trim (section 7.9) | At top speed the low and medium trims make 2.44 and 2.90 times the car's weight against "three or four times" [57] | Every increase tried moves a passing check (the Monza T1 2025 stop time, the Spa T5 2025 peak and trap, three PR 19 kerb cases) with brakes that can lock at full pedal; kept. This is most of the Monza and Spa lap gaps |
| Spa reference lap 109.072 s against the M4 band 97.545–103.579 s (section 7.8) | 5.49 s outside M4; all three sectors outside their ±3 % bands, sector 2 by most (+14 % on the session best) | The car's fast-corner grip: the line asks for the measured flat limit through Pouhon, Stavelot and Les Fagnes. Same cause as the Pouhon sweep row above and Monza's fast corners |
| Raidillon lift on `spa-medium` (section 7.8) | Profile plans a brief braking pulse at s = 1008–1016 m; the reference driver lifts for 0.167 s (< 99 % throttle) and brakes for 0.063 s (> 1 % brake) at s = 991–1005 m, whereas real cars take T3–T4 flat | Caused by linear extrapolation of the `[0.8, 1.0, 1.2] g` envelope load grid to 2.0–2.2 g Eau Rouge compression after the floor enters the 20 mm stall band at 320 km/h (`−0.129 g/g` slope). Forcing full throttle through Raidillon is clean (1.47° max sideslip) and gains 0.032 s in S1 |
| Singapore sectors 1 and 3 (section 7.8) | +3.1 % and +4.1 % on the session best; the lap itself is inside its band by 0.016 s | Recorded gaps; the lap is close to its band edge, so a small change to the car can move it outside |
| Monza reference lap 84.872 s against the M1 band 74.852–82.732 s (section 7.6) | 2.14 s outside M1 (2.24 s before DRS zone 2 moved to its mapped activation), 3.72 s outside M4 | Not reached. On the footprint-checked legal corridor the quasi-steady full-envelope profile predicts 83.447 s; the ideal reference controller loses 0.83 s to its own plan and plans at 98/95/98 % (0.69 s). That prediction is not an optimum or a bound (7.6). The top of the low-trim ClA range was investigated (84.036 s) and not adopted (7.3). Nothing here forces the band |
| Wheels leave the ground off a kerb's outer edge or a sausage (section 7.2) | 0.1–0.26 s airborne in the kerb-crossing runs | With springs five times the tyre's stiffness and about 1 mm of static spring compression the wheel cannot follow a 50 mm drop until the body rolls; physically plausible for a stiff ground-effect car, not checked against data. The legal corridor keeps the tyres off both; a player who drives over them gets it |
| Barrier contact is minimal (section 7.7) | Body corners against a line, one restitution and friction for every barrier type, no damage, no wheel-to-barrier or car-to-car contact | Damage and barrier types in M3b; the contact replaces only the impulse rule (ADR 0009) |

## 6. Sources

All URLs were opened while writing this document (fetched on 2026-11-21).

1. FIA, 2025 Formula 1 Technical Regulations, Issue 3, 2025-04-07. https://www.fia.com/sites/default/files/documents/fia_2025_formula_1_technical_regulations_-_issue_03_-_2025-04-07.pdf
2. FIA, 2025 Formula 1 Sporting Regulations, Issue 5, 2025-04-30. https://www.fia.com/system/files/documents/fia_2025_formula_1_sporting_regulations_-_issue_5_-_2025-04-30.pdf
3. FIA, regulations index (Formula 1 category). https://www.fia.com/regulation/category/110
4. FIA, 2025 Monza event, Circuit Map, version 2, 2025-09-04. https://www.fia.com/system/files/decision-document/2025_monza_event_-_circuit_map_-_monza_2025.pdf
5. FIA, 2025 Belgian Grand Prix, Event Notes: circuit map, pit lane, emergency exits, quarantine zone and red zones. https://www.fia.com/system/files/decision-document/2025_belgian_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exits_quarantine_zone_and_red_zones.pdf
6. FIA, 2025 Singapore Grand Prix, Event Notes: circuit map, pit lane, emergency exits map and quarantine zone. https://www.fia.com/system/files/decision-document/2025_singapore_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exits_map_and_quarantine_zone.pdf
7. FIA, 2024 Singapore Grand Prix, Event Notes: circuit map, pit lane drawing and red zones. https://www.fia.com/sites/default/files/decision-document/2024%20Singapore%20Grand%20Prix%20-%20Event%20Notes%20-%20Circuit%20Map,%20Pit%20Lane%20Drawing%20and%20Red%20Zones.pdf
8. FIA, 2025 Italian Grand Prix, Race Director's Event Notes. https://www.fia.com/system/files/decision-document/2025_italian_grand_prix_-_race_directors_event_notes_.pdf
9. FIA, 2025 Belgian Grand Prix, Race Director's Event Notes v3. https://www.fia.com/system/files/decision-document/2025_belgian_grand_prix_-_race_directors_event_notes_v3.pdf
10. FIA, 2025 Singapore Grand Prix, Race Director's Event Notes v2. https://www.fia.com/system/files/decision-document/2025_singapore_grand_prix_-_race_directors_event_notes_v2.pdf
11. FIA timing, 2025 Monza, Qualifying Session Maximum Speeds. https://www.fia.com/sites/default/files/2025_16_ita_f1_q0_timing_qualifyingsessionmaximumspeeds_v01_0.pdf
12. FIA timing, 2025 Monza, Qualifying Session Best Sector Times. https://www.fia.com/sites/default/files/2025_16_ita_f1_q0_timing_qualifyingsessionbestsectortimes_v01.pdf
13. FIA timing, 2025 Spa-Francorchamps, Qualifying Session Maximum Speeds. https://www.fia.com/sites/default/files/2025_13_bel_f1_q0_timing_qualifyingsessionmaximumspeeds_v01.pdf
14. FIA timing, 2025 Spa-Francorchamps, Qualifying Session Best Sector Times. https://www.fia.com/sites/default/files/2025_13_bel_f1_q0_timing_qualifyingsessionbestsectortimes_v01.pdf
15. FIA timing, 2025 Marina Bay, Qualifying Session Maximum Speeds. https://www.fia.com/sites/default/files/2025_18_sgp_f1_q0_timing_qualifyingsessionmaximumspeeds_v01.pdf
16. FIA timing, 2025 Marina Bay, Qualifying Session Best Sector Times. https://www.fia.com/sites/default/files/2025_18_sgp_f1_q0_timing_qualifyingsessionbestsectortimes_v01.pdf
17. FIA / Pirelli, 2025 Italian Grand Prix, Event Notes: Pirelli Preview, Issue B. https://www.fia.com/system/files/decision-document/2025_italian_grand_prix_-_event_notes_-_pirelli_preview_0.pdf
18. FIA / Pirelli, 2025 Belgian Grand Prix, Event Notes: Pirelli Preview. https://www.fia.com/system/files/decision-document/2025_belgian_grand_prix_-_event_notes_-_pirelli_preview.pdf
19. FIA / Pirelli, 2025 Singapore Grand Prix, Event Notes: Pirelli Preview. https://www.fia.com/system/files/decision-document/2025_singapore_grand_prix_-_event_notes_-_pirelli_preview.pdf
20. FIA, List of FIA Licensed Circuits, updated 2025-10-02. https://www.fia.com/sites/default/files/circuits_fia20251002.pdf
21. Brembo, "5 facts about the Italian Formula 1 GP" (2025). https://www.brembo.com/en/motorsport/formula1/2025/facts-formula1-gp-monza
22. Brembo, "5 facts about the Belgium Formula 1 GP" (2025). https://www.brembo.com/en/motorsport/formula1/2025/facts-formula1-gp-belgium
23. Brembo, "5 facts about the Singapore Formula 1 GP" (2025). https://www.brembo.com/en/motorsport/formula1/2025/facts-formula1-gp-singapore
24. Formula 1 official results, Gran Premio d'Italia 2025, Qualifying. https://www.formula1.com/en/results/2025/races/1268/italy/qualifying
25. Formula 1 official results, Belgian Grand Prix 2025, Qualifying. https://www.formula1.com/en/results/2025/races/1265/belgium/qualifying
26. Formula 1 official results, Singapore Grand Prix 2025, Qualifying. https://www.formula1.com/en/results/2025/races/1270/singapore/qualifying
27. Brembo, "5 facts about the Italian GP" (2026 edition, with 2025 Turn 4 comparison). https://www.brembo.com/en/motorsport/formula1/2026/facts-monza-2026
28. Brembo, "5 facts about the Belgian Grand Prix" (2026 edition, with 2025 Turn 18 comparison). https://www.brembo.com/en/motorsport/formula1/2026/facts-belgium-2026
29. Brembo, "5 facts about the Singapore Formula 1 Grand Prix" (2026 edition, with 2025 Turn 7 comparison). https://www.brembo.com/en/motorsport/formula1/2026/facts-singapore-2026
30. Formula 1, Italian Grand Prix 2025 event page (circuit length, laps, race distance, lap record). https://www.formula1.com/en/racing/2025/italy
31. Formula 1, Belgian Grand Prix 2025 event page. https://www.formula1.com/en/racing/2025/belgium
32. Formula 1, Singapore Grand Prix 2025 event page. https://www.formula1.com/en/racing/2025/singapore
33. Formula 1, "NEED TO KNOW: ... 2025 Italian Grand Prix". https://www.formula1.com/en/latest/article/need-to-know-the-most-important-facts-stats-and-trivia-ahead-of-the-2025-italian-grand-prix.4HiHxhtZYqq5rxAql7JwPW
34. Formula 1, "NEED TO KNOW: ... 2025 Belgian Grand Prix". https://www.formula1.com/en/latest/article/need-to-know-the-most-important-facts-stats-and-trivia-ahead-of-the-2025-belgian-grand-prix.1aVkT2HdYMC3n9FBp7fWgM
35. Formula 1, "NEED TO KNOW: ... 2025 Singapore Grand Prix". https://www.formula1.com/en/latest/article/need-to-know-the-most-important-facts-stats-and-trivia-ahead-of-the-2025-singapore.468A8YSelm8nsKywLuGTf
36. The Race, "Revealed: The data on F1's worsening dirty air problem" (FIA CFD data). https://www.the-race.com/formula-1/exclusive-new-data-f1-aero-losses-ruining-close-racing/
37. Aston Martin F1 Team, "Six key areas of F1 2022: how overtaking will change". https://www.astonmartinf1.com/en-GB/news/feature/six-key-areas-of-f1-2022-how-overtaking-will-change
38. Pirelli, "What's new with Pirelli's 2019 Formula 1 tyres?" (working ranges). https://press.pirelli.com/whats-new-with-pirellis-2019-formula-1-tyres/
39. Autosport, "How fast is an F1 car? Top speeds of F1, IndyCar, MotoGP and more" (2024-12-09). https://www.autosport.com/f1/news/how-fast-is-an-f1-car-top-speeds-of-f1-indycar-motogp-and-more-4980734/4980734
40. Motorsport.com, "Mercedes F1 engine hits new benchmark on dyno" (2017-09-13). https://www.motorsport.com/f1/news/mercedes-f1-engine-hits-new-benchmark-on-dyno-952330/
41. Autosport, "Strategy Corner: will random factors reign in F1 Singapore GP outcome" (2025-10-05). https://www.autosport.com/f1/news/strategy-corner-will-random-factors-reign-in-f1-singapore-gp-outcome/10765131/
42. Motorsport.com, "Mercedes feature: majestic Spa-Francorchamps" (2011, older-generation car). https://au.motorsport.com/f1/news/f1-mercedes-feature-majestic-spa-francorchamps/2581100/
43. Oversteer48, "Pouhon Spa: The 300kph 5-G Force Corner" (blog; secondary). https://oversteer48.com/pouhon-spa-francorchamps/
44. TUM Institute of Automotive Technology, laptime-simulation, vehicle file F1_Shanghai.ini (LGPL-3.0). https://raw.githubusercontent.com/TUMFTM/laptime-simulation/master/laptimesim/input/vehicles/F1_Shanghai.ini and repository https://github.com/TUMFTM/laptime-simulation
45. Formula 1 official results, 2022–2024 qualifying pages used for the era table: https://www.formula1.com/en/results/2022/races/1120/italy/qualifying, https://www.formula1.com/en/results/2023/races/1218/italy/qualifying, https://www.formula1.com/en/results/2024/races/1244/italy/qualifying, https://www.formula1.com/en/results/2022/races/1118/belgium/qualifying, https://www.formula1.com/en/results/2023/races/1216/belgium/qualifying, https://www.formula1.com/en/results/2024/races/1242/belgium/qualifying, https://www.formula1.com/en/results/2022/races/1133/singapore/qualifying, https://www.formula1.com/en/results/2023/races/1219/singapore/qualifying, https://www.formula1.com/en/results/2024/races/1246/singapore/qualifying
46. FIA, 2025 season event document pages (index of the event notes above): https://www.fia.com/documents/championships/fia-formula-one-world-championship-14/season/season-2025-2071/event/Italian%20Grand%20Prix, https://www.fia.com/documents/championships/fia-formula-one-world-championship-14/season/season-2025-2071/event/Belgian%20Grand%20Prix, https://www.fia.com/documents/championships/fia-formula-one-world-championship-14/season/season-2025-2071/event/Singapore%20Grand%20Prix
47. AutoRacer.it, "Monza, alta velocità e grandi frenate: i dati di Brembo sulle staccate del GP Italia" (2025, Brembo data). https://autoracer.it/monza-alta-velocita-grandi-frenate-dati-brembo-gp-italia/
48. Motorbox, "GP Italia 2023: i segreti del circuito di Monza con Brembo". https://www.motorbox.com/auto/sport/f1/news/gp-italia-2023-i-segreti-del-circuito-di-monza-con-brembo
49. Motorbox, "Formula 1 GP Italia 2024: orari, meteo e segreti del circuito" (Brembo data). https://www.motorbox.com/auto/sport/f1/gran-premi/formula-1-gp-italia-2024-orari-meteo-e-segreti-del-circuito
50. Motorbox, "Formula 1 GP Belgio 2024: orari, meteo e segreti del circuito" (Brembo data). https://www.motorbox.com/auto/sport/f1/gran-premi/formula-1-gp-belgio-2024-orari-meteo-e-segreti-del-circuito
51. ScuderiaFans, "F1 Singapore GP Brembo preview: the critical factor for brakes at Marina Bay" (2024-09-20). https://scuderiafans.com/f1-singapore-gp-brembo-preview-the-critical-factor-for-brakes-at-marina-bay/
52. Motorionline, "Formula 1, GP Italia: Brembo analizza l'impegno dei sistemi frenanti sul tracciato di Monza" (2019-09-03, pre-era). https://f1grandprix.motorionline.com/en/formula-1-gp-italia-brembo-analizza-limpegno-dei-sistemi-frenanti-sul-tracciato-di-monza/
53. Motorionline, "F1, GP Belgio: l'impegno dei freni sul tracciato di Spa" (2020-08-25, pre-era). https://f1grandprix.motorionline.com/en/f1-gp-belgio-limpegno-dei-freni-sul-tracciato-di-spa/
54. Autosport, J. Noble, "The 'astonishing' speed data that explains Antonelli's FP1 crash" (2024-08-31, 2024 Italian GP first practice). https://www.autosport.com/f1/news/the-astonishing-speed-data-that-explains-antonellis-crash/10649340/
55. Motorsport.com, A. Kalinauckas, "How the controversial kerb changes have really altered Monza" (2024-08-30). https://www.motorsport.com/f1/news/how-the-controversial-kerb-changes-have-really-altered-monza/10649313/
56. G. Perantoni and D. J. N. Limebeer, "Optimal control for a Formula One car with variable parameters", Vehicle System Dynamics 52(5), 653–678 (2014), doi:10.1080/00423114.2014.889315; accepted manuscript, Appendix B, Table 3 (tyre friction parameters). https://ora.ox.ac.uk/objects/uuid:ce1a7106-0a2c-41af-8449-41541220809f
57. Mercedes-AMG Petronas F1 Team, "Downforce in Formula One explained" (feature, undated; the 795 kg minimum weight dates it to 2022): "At around 150 km/h, the car generates as much downforce as it weighs (the minimum weight of the car is 795kg)." At top speed "it is probably three or four times the weight of the car." https://www.mercedesamgf1.com/news/feature-downforce-in-formula-one-explained
58. Autosport, J. Noble, "The unique wings F1 teams have fitted for high-speed Monza" (2022-10-07): the new cars "produce much more of their downforce from ground effect than wings". https://www.autosport.com/f1/news/the-unique-wings-f1-teams-have-fitted-for-high-speed-monza/10366205/

`[track-data.md]` refers to measurements in `docs/track-data.md` (OSM centreline lengths, pit lane lengths, DEM profiles).

## 7. Results

Vehicle model v1 (M1) after the M1 calibration, measured with the telemetry runner:
`npm run telemetry -- validate` (and `-- all` for the rest), 240 Hz world step with 1/960 s
substeps (ADR 0007). `npm run telemetry -- calibrate` runs every target, the Monza lap, its
sectors and corner speeds in one go, for the committed car or a candidate parameter file
(`--set`), and prints one summed-miss score; it is how every number below was produced. The
physics suite (`npm run test:physics`) asserts every row: a pass stays inside its band, a gap
stays where it was recorded (section 3, rule 2). Speeds in km/h, decelerations and
accelerations in g.

### 7.1 Section 2 targets

"Before" is the car this calibration started from (master at the reference-driver merge);
"after" is the committed car. The role column is the set the target belongs to (below): fit,
selection check, or withheld validation.

| Target (section) | Stated | Before | After | Role | Verdict after |
|---|---|---|---|---|---|
| 0–100 km/h (2.3) | 2.6 ± 0.3 s | 3.00 s, gap | 2.69 s | fit | pass |
| 0–200 km/h (2.3) | 4.8 ± 0.5 s | 5.63 s, gap | 5.15 s | validation | pass |
| 0–300 km/h (2.3) | 10.5 ± 1.5 s | 11.71 s | 11.32 s | validation | pass |
| Top speed, low trim, DRS open (2.2) | 348 ± 6 | 353.9 | 353.7 | fit | pass |
| Monza T1 2025, 337→89: distance / time / peak (2.4) | 129 m ± 10 % / 2.75 s ± 12 % / 4.7 ± 0.4 | 141.1 / 2.67 / 4.71 | 131.2 m / 2.45 s / 4.78 | validation / validation / fit | pass / pass / pass |
| Monza T1 2024, 328→90 | 119 m / 2.52 s / 4.6 | 136.2 gap / 2.62 / 4.64 | 126.7 m / 2.40 s / 4.71 | validation / validation / selection | pass / pass / pass |
| Monza T1 2023, 334→89 | 122 m / 2.57 s / 5.2 | 139.2 gap / 2.65 / 4.68 gap | 130.3 m / 2.45 s / 4.75 | validation / validation / selection | pass / pass / gap |
| Spa T5 2025, 327→176 | 93 m / 1.48 s / 4.7 | 81.9 / 1.21 / 5.11, all gaps | 77.3 m / 1.13 s / 5.10 | validation / validation / selection | gap / gap / pass |
| Spa T5 2024, 320→167 | 99 m / 1.62 s / 4.5 | 83.4 / 1.28 / 5.07, all gaps | 78.5 m / 1.20 s / 5.05 | validation / validation / selection | gap / gap / gap |
| Singapore T7 2025, 308→128 | 96 m / 1.90 s / 4.9 | 88.9 / 1.57 gap / 5.70 gap | 83.1 m / 1.45 s / 5.40 | validation / validation / selection | gap / gap / gap |
| Singapore T14 2024, 288→93 | 94 m / 2.19 s / 4.6 | 98.0 / 2.04 / 5.11 gap | 88.5 m / 1.81 s / 5.06 | validation / validation / selection | pass / gap / gap |
| Peak deceleration from 300 km/h, Monza trim (2.4 test 2) | 4.6 ± 0.4 | 4.33 | 4.41 | validation | pass |
| Peak deceleration from 100 km/h, Monza trim | 2.0 ± 0.4 | 1.90 | 2.13 | validation | pass |
| Peak deceleration falls with speed: 300/250/200/150/100 | monotonic | 4.33 / 3.35 / 2.74 / 2.24 / 1.90 | 4.41 / 3.60 / 3.00 / 2.50 / 2.13 | validation | pass |
| Pouhon, medium trim, 281 km/h, Spa air (2.5) | 5.7 ± 0.7 | 4.14, gap | 4.59 | validation | gap |
| Parabolica exit, low trim, 270 km/h, Monza air | 3.5–4.0 ± 0.6 | 3.62 | 4.08 | validation | pass |
| Slow corner 85 km/h, low / medium / high trim | 2.0–2.3 ± 0.4 | 1.81 / 1.82 / 1.85 | 2.15 / 2.18 / 2.24 | fit / validation / validation | pass |
| Monza reference lap, low trim, qualifying fuel, reference driver (2.1; 7.6) | 74.852–82.732 s (M1) | 90.137 s, gap | 85.539 s (84.969 s after the lap-band changes, 84.872 s with DRS zone 2 at its mapped activation, 7.6) | selection | gap |
| Monza speed trap on that lap, DRS open, no tow (2.2) | 348 ± 6 | 347.3 | 347.4 | validation | pass |

Of the 32 component targets, 20 are in band and 12 are recorded gaps (section 5), against 17 and
15 before. Five gaps closed: both launch times, the Monza 2024 and 2023 distances and the Spa
2025 peak. Two targets that passed before are now gaps; for each the doc has hypotheses, not an
established cause:

- Singapore T7 2025 distance, 83.1 m against a band from 86.4 m. Possible causes: the
  high-downforce car holds its deceleration longer as speed falls than the published distances
  allow, for one of the reasons listed for the high-trim peaks in section 5; or the published
  distance includes a trail-off the scripted stop does not reproduce.
- Singapore T14 2024 time, 1.81 s against a band from 1.93 s. Possibly the same trail-off: every
  published time at the medium and high-downforce circuits comes out short, while that stop's
  distance passes.

The Monza T1 2025 time, which went out of band in the first version of this calibration, is back
inside (2.45 s).

The reference lap and its trap are measured by the reference driver on the Monza surface
(section 7.6). Not covered yet: Spa and Singapore laps (2.1), per-sector bands (2.2, an M4
target), and Raidillon and other corners whose grade or compression matters (2.5).

**Three sets.** Every target is in exactly one, in the code (`FIT_TARGETS`,
`SELECTION_TARGETS` in `packages/sim/validation/lib/targets.ts`; each target's `role`, also on
the lap targets in `packages/ai`) and here; a test asserts the code's sets.

*Direct fits* (a parameter was solved for the target; it checks the fit, not the model):

| Parameter | Fitted to | Method | Result |
|---|---|---|---|
| Tyre μx at 3 kN | 0–100 km/h (2.6 s) and the Monza T1 2025 peak (4.7 g, low trim) | least squares in band half-widths, μx 1.5–2.0 by 0.1 then 0.01 | 1.765; residuals 2.69 s and 4.78 g. The two agree: either alone gives 1.76–1.82 |
| Tyre μy at 3 kN | Slow corner, low trim, 85 km/h (2.0–2.3 g, centre 2.15) | one-dimensional | 2.145 (2.149 g) |
| Low-trim CdA | Top speed, low trim, DRS open (as doc 1.4 derived CdA from the trap) | the floor share raised the unlimited-straight speed out of its band | 1.16 (353.7) |

The tyre's load slopes are not fitted: both are −8.75 × 10⁻⁵ N⁻¹, from [56] (section 1.2).

*Selection checks* (looked at while choosing an estimate, so not independent):

- The braking peaks of the other six events, Monza 2024 and 2023 and all of Spa and Singapore.
  The cross-trim peaks chose the floor stall's height and loss in the first version of the
  model (unchanged here), and in this calibration they were looked at when the longitudinal
  load slope was first fitted to them (Singapore T7), then replaced by the slope from [56].
- The Monza reference lap: it was consulted when the floor share was chosen (it is worth 0.6 s
  there), and with the braking peaks when the top of the low-trim ClA range was investigated
  (section 7.3, not adopted).

*Withheld validation* (used for no choice): the 0–200 and 0–300 times, every braking distance
and time, the speed curve, Pouhon, the Parabolica exit, the medium and high-trim slow corners
(close relatives of the low-trim fit, so weak checks), the speed trap (related to the CdA fit
through the same drag), the sectors and the corner speeds. The first version of this section
called the cross-trim peaks and the lap independent checks; that was wrong and is corrected
here.

How the tests run (unchanged from section 2 unless noted):

- Braking: race fuel 50 kg, the circuit's trim and air (25 °C at the circuit's altitude), the best
  bias in 52–62 %. The approach is held at v1 with DRS open and the MGU-K deploying (each event
  ends a DRS straight); braking starts within 0.05 km/h of v1, DRS closes on the brake, and the
  crossing of v2 is interpolated. Peak is a 50 ms moving average.
- Published events use one pedal profile for every event: the pedal goes to full in 80 ms and is
  eased off whenever a wheel passes 10 % slip (no ABS). Over the last 25 % of the speed drop an
  assumed pedal ceiling falls linearly to 30 % at v2. Both constants are unsupported estimates,
  and the ceiling barely acts: the threshold controller already asks for less, and removing it
  moved the seven events by at most 0.22 m and 0.006 s (measured on the starting car). It does
  not reproduce the trail braking in Brembo's times. The speed-curve test (2.4 test 2) uses no
  ceiling.
- Brakes: capacity follows from the hardware, not from a published operating point. 160 kg on the
  pedal (doc 1.5) through a 3:1 pedal onto a 17.8 mm master cylinder gives about 110 bar on a
  six-piston front caliper (three 36 mm pistons a side); carbon pads at μ 0.55 on a 140 mm effective
  radius (330 mm disc) give 5.1 kN·m per front wheel at the 57 % default bias, 17.8 kN·m in total.
  That locks the tyres at full pedal from 330 km/h in high-downforce trim, so braking is
  tyre-limited. The published peak powers (2.2–2.7 MW) are event figures and are not used.
- Top speed: from 200 km/h on an unlimited flat straight with DRS open and the MGU-K deploying,
  10 kg of fuel; the maximum is reported (the doc derived CdA from the trap as if it were terminal).
- Lateral sweeps hold speed and tighten the corner by 0.25 g/s until the car will not take more,
  10 kg fuel, 0.5 s window.

### 7.2 Other measurements

| Measurement | Result |
|---|---|
| Top speed, DRS open / closed: low trim | 353.7 / 344.1 |
| medium trim | 347.8 / 333.5 |
| high trim | 332.5 / 311.7 |
| Sustained lateral g, sea-level air, low trim, 85 / 120 / 160 / 200 / 240 / 281 / 300 km/h | 2.15 / 2.42 / 2.77 / 3.19 / 3.69 / 4.29 / 4.51 (before: 1.81 / 2.04 / 2.34 / 2.72 / 3.22 / 3.87 / 4.16) |
| medium trim | 2.19 / 2.50 / 2.92 / 3.43 / 4.03 / 4.68 / 4.85 |
| high trim | 2.24 / 2.60 / 3.10 / 3.71 / 4.39 / 4.93 / 4.94 |
| Coast-down in neutral, medium trim, at 300 / 250 / 200 / 150 / 100 km/h | 0.661 / 0.447 / 0.283 / 0.161 / 0.077 g |
| Step steer at 80 / 150 / 250 km/h: yaw-rate rise time (10–90 %), overshoot | 0.025 / 0.042 / 0.037 s; 8.8 / 0.3 / 0.0 % (before 0.033 / 0.050 / 0.046 s; 5.4 / 2.1 / 0.3 %) |
| Lift-off at 150 km/h from 60 / 80 / 95 % of the limit (1.65 / 2.20 / 2.60 g): yaw-rate rise, max sideslip | 5.6 / 7.4 / 9.4 %; 0.16 / 0.47 / 1.30°; no spin (before at 1.38 / 1.84 / 2.17 g: 5.1 / 7.3 / 10.0 %; 0.32 / 0.74 / 1.73°) |
| Lift-off at 250 km/h from 90 % (3.66 g) | 3.2 %, 1.35°, no spin |
| Full throttle out of an 80 km/h corner at 85 % of the limit, TC off / 1 / 2 / 3: max rear slip, max sideslip | 0.22, 1.8° / 0.17, 1.8° / 0.16, 1.8° / 0.15, 1.8° (before 0.22, 1.2° / 0.17, 2.4° / 0.16, 1.8° / 0.15, 1.2°) |
| Full brake in a 200 km/h corner at 85 % of the limit, ABS off / 1 / 2 / 3: min slip, max sideslip | −1.00 (locked), 19.3° / −0.20, 3.2° / −0.19, 2.7° / −0.19, 2.1° (before −1.00, 17.3° / −0.20, 4.2° / −0.19, 3.2° / −0.19, 2.5°) |
| Full pedal, straight line 300→100 km/h, high trim, ABS off / 1 / 2 / 3: distance | 97.0 m (locked) / 86.5 / 87.0 / 88.3 m |
| Load transfer with aero off, against h·ΣF (braking and cornering) | within 0.5 % (unit tests) |
| Body modes, dry car at rest (free decay): heave, pitch, roll | 5.2 Hz ζ 0.33; 5.6 Hz ζ 0.52; 7.3 Hz ζ 0.60 (unchanged) |
| Floor height at 300 km/h, 50 kg fuel, front / rear axle: low / medium / high trim | 12.4 / 42.6; 10.9 / 43.7; 9.4 / 45.2 mm (unchanged: on a straight the tyres do not set it, and at the reference height the floor share changes nothing) |
| Cost | see the kerb paragraph below (track workload) |

**Kerb crossings and the contact model** (`npm run telemetry -- kerbs`; data in
`docs/evidence/m1-lap-band/kerb-crossings.csv`, plot `kerb-crossings.png`). The car runs across
the track file's kerb profiles at a fixed speed and lateral speed, holding its heading, on a
straight edge with the kerb on its left (the profiles of `monza.json`: flat 35 mm over 0.12 m,
rising to 50 mm, dropping to the verge at 1.35–1.5 m; exit 20 mm over 0.10 m to 30 mm, dropping
at 2.3–2.5 m; chicane as flat, then an 80 mm sausage from 1.6 m). Before, the tyre followed the
ground at one point under the wheel centre; after, it deflects against the ground averaged over
its contact patch (always the whole 5 × 2 grid's mean, sampled once per 240 Hz step where the
wheel will be at the step's end, the substeps running the ground from the last height to it),
and its carcass damping grows from nothing at first touch:

| Crossing | Largest carcass damping (before → after) | Largest load step in one tick | Plank contact | Front-left load range |
|---|---|---|---|---|
| flat, 200 km/h, 5 m/s across | 7.9 → 2.6 kN | 8.7 → 1.3 kN | 6.6 kN → none | 0–11.3 → 0–6.1 kN |
| exit, 200 km/h, 3 m/s | 3.0 → 0.6 kN | 3.9 → 0.5 kN | none | 0.3–6.3 → 1.4–4.2 kN |
| exit, 250 km/h, 5 m/s | 5.9 → 1.4 kN | 6.9 → 0.7 kN | none | 0–9.3 → 0.7–5.7 kN, no wheel lift (was 0.046 s) |
| chicane (over the sausage), 120 km/h, 4 m/s | 12.4 → 5.4 kN | 13.3 → 5.3 kN | 7.5 kN → none | still lifts a wheel 0.16 s |

An earlier version of the patch stood in for the grid with three probes across it when they
looked like one plane. Three probes cannot see a step along the travel (a 35 mm longitudinal
step 20 mm ahead read 0 or 35 mm, where the grid reads 17.5 mm), and on the Monza surface it
departed from the grid by up to 0.3 mm; it was removed, and the unit tests now include
longitudinal and oblique steps.

**Cost** (`npm run telemetry -- bench`, which now includes a representative workload: twenty
cars on the Monza surface spread round the lap on the racing line with the reference
controller, timing the world steps): point contact 0.17 ms per 240 Hz tick for the field; the
grid sampled every substep 0.75 ms; the grid sampled once per step 0.38 ms (about 11× real time
for twenty cars on one core of this laptop). The flat-ground bench gives 0.09–0.12 ms per
twenty-car tick.

The damping stays under the closed-form bound for a ramp spread over the patch width,
1.1 · c · v_lateral · rise / width (asserted for the flat and exit cases). A wheel still leaves the
ground for about 0.1–0.2 s when it runs off a kerb's outer edge (a 50 mm drop to the verge) or
over the sausage: with springs about five times stiffer than the tyres and about 1 mm of static
spring compression the wheel cannot follow a 50 mm drop until the body rolls toward it, which is
what a stiff ground-effect car does. The racing line never goes there (7.6).

Body modes by free decay, fitted (`freeDecay` in the validation library; unchanged by the
contact patch): heave 5.5 Hz ζ 0.33, pitch 7.6 Hz ζ 0.49, roll 9.0 Hz ζ 0.596. Roll sits at the
lower edge of section 1.6's 0.6–0.8, as it did before; the earlier table's roll figure (7.3 Hz,
0.60) was read by a different method.

**Handling with more grip.** The tyre's curve shape is unchanged: the force peaks at 10 % slip
ratio and at a slip angle of 5.1° (tan α = 0.09) at every load, and falls away progressively
after it. At 3 kN, lateral: 1.95 at 2.5°, 2.15 at the 5.1° peak, 2.11 at 8°, 2.07 at 10°, 2.01
at 15° and 1.92 at 30° (×Fz); longitudinal: 1.57 at 5 % slip, 1.77 at 10 %, 1.73 at 15 %, 1.67
at 20 %, 1.54 at 40 % and 1.43 locked. At the car level the lift-off response is more
progressive than before (less sideslip at each share of a higher limit), step steer settles
with a little more overshoot at 80 km/h (8.8 %), and full throttle out of a slow corner without
traction control spins the rears no more than before (0.22 slip). The one sharper case is
locking all four wheels in a 200 km/h corner without ABS: 19° of yaw against 17°. With TC or
ABS at any level every case stays at or below its earlier value. Low speed is unchanged: the
standstill-on-a-slope, creep and pit-limiter tests pass, the keyboard autopilot lap in
`apps/web` passes, and launch is quicker (0–100 km/h 2.69 s).

### 7.3 Estimates moved inside their ranges, and new estimates

Moved in this calibration (each inside its range in section 1):

| Parameter | Before | After | Range | Reason |
|---|---|---|---|---|
| Tyre: structure | one μy, μx = 0.9 μy, one load slope | μx and μy each with its own load slope | — | The cited sets ([44], [56]) and the magic formula set the directions separately |
| Tyre load slopes, both directions | −5 × 10⁻⁵ N⁻¹ (μx 0.9 × that) | −8.75 × 10⁻⁵ N⁻¹ | −5 × 10⁻⁵ [44] to −8.75 × 10⁻⁵ [56] | Set from [56], the only cited set with friction at two loads; not fitted |
| Tyre μy at 3 kN | 1.80 | 2.145 | 1.7–2.2 | Fitted, 7.1 |
| Tyre μx at 3 kN | 1.62 (0.9 × 1.80) | 1.765 | 1.6–2.0 | Fitted, 7.1; μx/μy 0.82, below the cited 0.89–0.97 (7.4) |
| Floor share of downforce | 1 (all of ClA followed the floor height and stalled) | 0.6 | 0.5–0.7 (new, 1.4) | Wings and bodywork see neither the floor height nor its stall; estimate |
| Floor stall | 25 % of all downforce | 25 % of the floor's downforce (15 % of the total) | 10–25 % | The stall is the floor's; the range is the doc's, now read as the floor's own loss |
| Low-trim CdA | 1.15 m² | 1.16 m² | 1.05–1.25 | Re-fitted to the top speed, 7.1 |

Tried and not adopted:

- The low-trim ClA at the top of its range (4.2 m², with the doc's CdA 1.15 keeping the top
  speed in band, μx refitted to 1.73 and μy to 2.112). It took the Monza lap to 84.036 s
  (83.941 s with DRS zone 2 at its mapped activation), held ten clean laps at 34 kg (84.35–84.78
  s) and brought the Monza T1 2023 and Singapore T7 and T14 peaks into band while the Monza T1
  2025 time left it. It was not adopted because the low-trim car then runs low enough at 300 km/h
  that its floor's leading edge (19.3 mm) is below the stall height (20 mm): the floor stalls at
  its own reference condition, so the table ClA never holds, and keeping it would need the
  low-trim static ride height raised as well (inside its 20–30 mm range, but a further change
  chosen for the lap). A constructor's figure [57] points to the upper part of the ClA ranges;
  that, a ride-height change and the stall settings belong together in a follow-up.
- The reference ride heights of the three trims (the floor heights at 300 km/h at which the
  table ClA holds) have drifted by 0.2–0.3 mm since the floor-share change (measured 21.63 /
  20.94 / 20.31 mm against 21.4 / 20.7 / 20.1); re-measuring them moves the Spa T5 2025 peak to
  5.101 g, 0.001 g past its band. Left as they are and recorded here as an open item.

- A longitudinal load slope fitted to the braking peaks of two trims (−1.3 × 10⁻⁴ N⁻¹, in the
  first version of this calibration). It met the high-trim peaks, but the cited tyre data do not
  support it (both sets use one slope for both directions, at most −8.75 × 10⁻⁵), and it made
  μx/μy 0.58 at 9 kN. Replaced by [56]'s slope; the high-trim peaks it had absorbed are gaps.
- Counting the engine's overrun drag inside the brake-by-wire rear demand (so a real car's BBW
  would take it out of the rear friction torque). It made the combined braking-in-a-turn limit
  worse (envelope exponent 1.80 → 1.53) and the planned Monza lap 1.0 s slower: at the fixed
  57 % default bias the engine's drag acts as a rearward brake migration at low speed that the
  car relies on. It belongs with a brake-migration model, which needs a source for how the real
  cars' migration is set. Lowering the default bias to 55 % or 53 % made the plan faster but the
  driven lap slower, so 57 % stays (the straight-line stops pick 56–58 %).

Moved in the first version of the model (unchanged here):

- Floor stall: critical height 20 mm at the leading edge (15–20) and 25 % loss (10–25 %), both the
  top of the range, chosen with the published braking peaks of the three trims (a selection
  check, 7.1). At 300 km/h on a straight the leading edge sits at 20.1–21.4 mm, so the
  reference condition is not stalled.
- Tyre vertical stiffness 300 kN/m (250–300) and wheel-centre spring rates 1.5 / 0.6 MN/m, giving
  heave frequencies of 6.1 / 5.0 Hz on paper (5–7 / 4.5–6) and roll stiffness 56 % front (55–60 %).
- Static ride heights per trim, front / rear: low 25 / 65 mm, medium 27 / 72 mm, high 30 / 80 mm
  (20–30 / 60–80).

New estimates the sheet did not cover (all in `packages/sim/src/params.ts` with their reasoning):

- Brake hardware (7.1): pedal ratio 3, 17.8 mm master cylinder, three 36 mm front pistons a side,
  pad μ 0.55, 140 mm effective radius.
- Ride-height map: ClA and CdA hold the table values at the floor height the car runs at 300 km/h
  in that trim (measured: 21.4 / 20.7 / 20.1 mm front-weighted mean), so the fitted table values
  stay the fitted values. Ground effect is weighted 70 % to the front ride height.
- Tyre vertical damping 7 kN·s/m: with springs five times stiffer than the tyres the corner
  dampers barely act on the body modes (free decay gave ζ ≈ 0.05), so the damping that holds
  section 1.6's ratios is carried as carcass damping on the tyre's deflection rate (section 1.6
  shows a suspension-travel damper cannot reach them with these rates). Since the lap-band work it
  acts on the patch-averaged ground and grows in from first touch (below).
- Load transfer: the sprung CoG height follows from the whole car's (0.30 m) and the unsprung
  masses at the wheel centres; the sprung share goes through the springs, the unsprung inertia
  straight to the tyres, so the total is h·ΣF.
- Tyre shape: peak at 10 % slip ratio and tan α = 0.09; sliding at 76 % (locked) and 85 %
  (sideways) of peak; relaxation lengths 0.08 m and 0.25 m; rolling resistance 0.012. Wheel
  inertia 1.2 / 1.4 kg·m², engine 0.02 kg·m². DRS also removes 8 / 10 / 12 % of total downforce
  from the rear by trim, over 0.20 s opening and 0.15 s closing.
- Assists: ABS holds the rear tyres at 0.65 of the front combined-slip limit at every level, so a
  braked corner keeps rear lateral grip.
- With no grip (a wheel on a zero-grip surface) the low-speed carcass damping passes no force;
  before, a division by the zero friction limit left that force unbounded.
- Contact patch (M1 lap band): the tyre's ground is the mean height over a 5 × 2 grid across a
  0.32 / 0.40 m wide, 0.15 m long patch (front / rear), always the whole grid (a sampler may
  provide a faster path that must equal it; the flat test surface does), sampled once per 240 Hz
  step where the wheel will be at the step's end and run linearly from the last height across
  the substeps. Grip and rolling drag are the patch's mean. The carcass damping grows linearly
  from zero at first touch to its full value at 3 mm of deflection (static deflection is 7–9 mm).
  Cost in 7.2.

### 7.4 What the data say about the tyre and the floor

The first version's gaps shared a pattern: targets at low tyre load (the launch, the low-speed
end of the Monza stops) wanted more grip than μy = 1.80 gave, targets at high load in
high-downforce trim (Spa and Singapore braking) wanted less. With the directions separated, the
load slopes taken from [56] (−8.75 × 10⁻⁵ N⁻¹, steeper than [44]'s) and μx fitted at the
reference load, the low-load side closes: the launch and the low-trim Monza peak agree on μx
(1.76–1.82 each), and the Monza distances follow without being fitted. The high-load side does
not: the high-downforce peaks stay 0.05–0.5 g above the published ones (section 5).

Two things are left open by that:

- μx/μy at 3 kN comes out at 0.82, below the 0.89–0.97 of both cited sets. With μx at [44]'s
  0.9 × μy (1.93) the Monza T1 2025 peak would be 5.18 g (band to 5.1) and the stop 120 m, and
  the Singapore T7 peak 6.0 g; 13 of 32 targets would be in band. So the braking targets, low
  trim included, sit below what a tyre with the cited directional ratio and the fitted lateral
  grip would give. Either the 18-inch tyre's longitudinal peak is lower relative to its lateral
  peak than in those older sets, or something besides the tyre limits the published stops
  (the same candidates as for the high-trim peaks: aero under pitch, front-limited braking, the
  event driver and the peak's filtering), or the slow-corner estimate that sets μy is high.
- The high-trim peaks. A mechanism the model already has (the floor stall under dive) could
  carry more of it, but its settings are unsourced and at the top of their range, and no source
  was found for any other mechanism, so none is added.

The floor: logged through a constant-speed corner at 150 km/h in low trim, with the whole ClA
following the floor height the car made 74 % of its table downforce (the floor rides about
10 mm higher than at 300 km/h, at 2 % per mm). Only the floor sees that height, so the map now
applies to the floor's share (0.6); the car keeps about 85 % of its table downforce there
(measured). The stall is likewise the floor's alone: before this change the stall factor also
took 25 % of the wings' downforce, even with no floor share.

The cornering shape is now inside the doc's own estimates at both ends: 2.15 g at 85 km/h (the
slow-corner centre) and 4.08 g at 270 km/h (just above the Parabolica estimate's 3.5–4.0, inside
its tolerance). The medium-speed corners at Monza, where the lap is lost (7.6), sit between the
two.

### 7.5 Inconsistencies found in section 1

- "About 10 mm of aero compression under about 15 kN" needs about 1.5 MN/m in total, but four
  tyres at 250–300 kN/m already compress 13–15 mm under that load. The car runs about 13–15 mm
  lower at the front axle at 300 km/h than at rest.
- Pitch "about 4–5 Hz, following from heave stiffness and wheelbase" does not follow with
  Iyy = 1100 kg·m²: the heave rates give about 6–8 Hz undamped (5.6 Hz damped in the model).
- The published peak brake powers (2.2–2.7 MW) imply 28–30 kN of friction force at every event if
  the peak power came at the start of the stop, which would cap deceleration below the published
  peaks. They are event figures, not a hardware limit, and the model does not use them.

### 7.6 Reference lap, Monza (2.1, 2.2)

The reference driver (`packages/ai`) drives the committed Monza surface in the section 2.1
conditions: low trim exactly as the game builds the car (`createCarParams('low')`, `createWorld`
with the track's surface, `addCar`), 10 kg of fuel, 25 °C at 180 m, DRS in the zones, full ERS.
It is an **ideal, telemetry-driven reference controller**, not a model of a human: the car's
built-in traction control and ABS are off, as on the real car, but the controller reads exact
per-wheel slip ratio, slip angle and load and the car's exact sideslip every 240 Hz tick, with
no reaction lag or noise, and regulates the pedals from slip (lock and wheelspin thresholds)
and recovers from slides (countersteer, brake release) instantly. It produces only the
`ControlInput` a player's devices produce, and the car is the player's car. Measured with
`npm run telemetry -- lap` (and `-- calibrate`); asserted by
`packages/ai/validation/reference-lap.test.ts` in the physics job (one lap) and by the nightly
soak (ten consecutive laps). "Before" is the car and line after the calibration (PR #14).

| Quantity | Before | After | Target or reference |
|---|---|---|---|
| Lap | 85.539 s | 84.969 s; **84.872 s** with DRS zone 2 at its mapped activation (below), now the committed value | 1:18.792 (+6.080 s, +7.7 %); M1 band 74.852–82.732 s: outside by 2.140 s (2.237 s before the DRS fix); M4 band 76.428–81.156 s: outside by 3.716 s (3.813 s) |
| Controller's speed profile / full-envelope profile on the same line | 84.764 / 83.781 s | 84.141 / 83.447 s | |
| Speed trap (412 m, 212 m before T1) | 347.4 km/h | 347.4 km/h | 348 ± 6 (median 348.3), pass |
| Control line | 312.3 km/h | 311.4 km/h | fastest 320.7 published |
| MGU-K deployed from the store / harvested | 3.22 / 1.35 MJ | 3.22 / 1.35 MJ | ≤ 4 / ≤ 2 MJ per lap |
| Track limits (four-wheel rule, tyre wholly past the line) | at most two wheels off | at most two wheels off, never four | never all four wheels wholly beyond the edges |
| Tyre samples on grass or gravel (centre and both tread edges of each wheel, every tick) | not measured | 0 | asserted: none |
| Stability | sideslip ≤ 5.1°, no spin | sideslip ≤ 9.0°, no spin | |
| Ten consecutive laps (34 kg start, getting lighter) | 85.921–86.314 s, spread 0.393 s | 85.236–85.590 s, spread 0.354 s, all clean, no tyre on grass or gravel | nightly soak: spread ≤ 0.5 s |

**The legal corridor** (`packages/ai/src/line/limits.ts`). Track limits have one definition for
planning and for judging: a wheel is off when its tyre is wholly past the white line (its centre
more than a half tread, 0.18 m, beyond it, the game's own rule in `apps/web`), and a lap is
invalid when all four are off at once. The lap runner counts wheels off by that rule. The
racing line's corridor is built from the car's footprint: at each sample, the bound is the
largest car-centre offset at which, with the car moved 0.3 m further out (tracking error) and
turned through every heading within ±10° of the centreline (checked at five), one wheel still
touches the line and every corner of every tyre's footprint (tread half widths 0.18 / 0.23 m,
patch ±0.075 m fore and aft) lies on usable ground less 0.2 m: track, a kerb inside its crest
(never over its outer drop or onto a sausage) or asphalt run-off; never grass, gravel or the
ground behind a barrier. Each point is placed in the world and projected back onto the lap; a
test checks the bound the same way round the whole lap. An earlier version used the car-centre
station alone with half tracks and widths: within the heading allowance a rear tyre's edge
could reach grass, and the soak put tyres on grass on every lap (17 wheel-centre and 616
tyre-edge samples over ten laps, measured in the review); now none. Inside the corridor the speed profile reads the surface grip under the wheels (kerb 0.9,
asphalt run-off 0.95, doc 4.4); forbidding the flat kerbs outright made the plan and the lap
slower, so they stay usable.

**DRS zone 2.** The FIA map anchors the main straight's DRS activation 12 m after the finish
(control) line [4], and the control line is at s = 5472.5 m (below), so the activation belongs
at **s = 5484.5 m**. The track file stores s = 12 m, 320.5 m late (a track-data fix in progress
elsewhere). Measured with the calibration harness's labelled override (`npm run telemetry --
calibrate --drs2 5484.5`), it is worth 0.097 s: 84.969 → 84.872 s. The track file now stores the
activation at s = 5484.5 m (track format 3, docs/track-data.md 5.5); with the racing line
rebuilt (`npm run ai:build`: minimum curvature 84.711 s, refined 84.048 s) the driven lap is
84.872 s (S1 27.784, S2 28.665, S3 28.423 s; plan 84.052 s), and that is the committed value.
The other figures in this section were measured before that change.

**Changes in this work** (the car's own change is the contact patch, 7.2; the low-trim ClA at
the top of its range was investigated and not adopted, 7.3):

- Countersteer: beyond 3.4° of sideslip the controller adds road-wheel angle toward the slide,
  one radian per radian of extra sideslip, holds its yaw integrator, and comes off the brake.
  Before, the wider line spun the car at the Parabolica entry when the inside rear unloaded over
  the apex kerb under trail braking.
- Corner entry: the lock threshold follows each tyre's combined slip: it shrinks to the friction
  ellipse's longitudinal room, the light inside front's extra allowance fades out as it starts
  to turn, and a light rear gets none. The envelope rig uses the same rule.
- Lock and wheelspin recovery: the pedal is eased at 150 (was 400) per second per unit of slip
  past the threshold, so one lock spike at turn-in no longer drops the pedal to nothing; throttle
  comes back at 10 per second after wheelspin (was 3).
- Planning fractions: 98 % of the lateral and traction limits, 95 % of braking (were 97/95/97).
  On earlier versions of this line 98/96/98 also held ten clean laps and 99/96/99 was slower;
  100 % is not drivable (it leaves the track).
- Heavier fuel: the ten-lap run from 34 kg holds clean on the footprint corridor, with the
  committed car and with the investigated ClA 4.2, which left the track at 34 kg in the
  review's run on the previous corridor.

**Timing origin.** The track file's s = 0 is the OpenStreetMap start node, at the start line.
The FIA circuit map [4] draws the start line and the control (timing) line apart on the main
straight, and lap and sector times run from the control line. The map gives no distance for it,
so it was measured: the map's drawn track (its vector paths) was fitted to this centreline with a
similarity transform (median miss 3.4 m), and the control-line tick projected onto it. The control
line is at **s = 5472.5 m, 320.5 m before s = 0**, within about ±13 m: the map's S1, S2 and
speed-trap ticks land −8.0, −6.6 and +12.6 m from their stored positions under the same fit. The
lap runner times laps, sectors and the ERS lap from that line (`CircuitSetup.controlLine`); the
track file is unchanged here, and carrying the control line as track metadata is a track-pipeline
task. Two things follow. The map also anchors DRS activation 2 at "12 m after the finish line",
so the track file's zone 2 activation (s = 12 m) is about 320 m later than allowed: the car opens
DRS that much later on the main straight than a real car may. And the earlier version of this
section, which timed from s = 0, had sector 1 faster than the pole lap's; that does not survive:
timed from the control line every sector is slower.

| Sector (from the control line) | Before | After | After, speed profile | Pole lap 2025 | Session best | After − pole |
|---|---|---|---|---|---|---|
| S1 (5472.5 → 1609.3 m, 1930 m) | 27.981 | 27.877 | 27.609 | 26.262 | 26.181 | +1.615 (+6.2 %) |
| S2 (1609.3 → 3433.6 m, 1824 m) | 29.123 | 28.667 | 28.520 | 26.483 | 26.340 | +2.184 (+8.2 %) |
| S3 (3433.6 → 5472.5 m, 2039 m) | 28.435 | 28.425 | 28.012 | 26.047 | 26.047 | +2.378 (+9.1 %) |

| Corner | Line min radius before → after (m) | Min speed before → after (km/h) | Speed profile after | Implied lateral after (g) | Car's flat limit there (g) | Reference minimum (2.6) |
|---|---|---|---|---|---|---|
| T1 Rettifilo | 18.7 → 18.8 | 69.2 → 76.7 | 69.5 | 2.46 | 2.09 | 75–85, estimate |
| T2 Rettifilo | 20.7 → 20.4 | 69.1 → 64.6 | 72.0 | 1.60 | 2.00 | 75–85, estimate |
| T3 Biassono | 278.7 → 278.6 | 177.6 → 174.6 | 181.7 | 0.86 | 2.90 | — |
| T4 Roggia | 38.5 → 45.9 | 106.8 → 118.6 | 116.0 | 2.41 | 2.40 | 110–120, estimate |
| T5 Roggia | 46.3 → 48.0 | 117.2 → 122.8 | 121.3 | 2.47 | 2.43 | 115–125, estimate |
| T6 Lesmo 1 | 74.1 → 74.8 | 157.2 → 161.6 | 163.2 | 2.74 | 2.78 | 175–190, estimate |
| T7 Lesmo 2 | 67.2 → 73.6 | 156.1 → 163.3 | 163.3 | 2.85 | 2.79 | 177–184, practice [54] |
| T8 Ascari entry | 70.9 → 69.4 | 158.7 → 153.9 | 152.9 | 2.69 | 2.70 | 176–190, practice [54][55] |
| T9 Ascari | 101.0 → 106.1 | 178.8 → 174.8 | 173.5 | 2.27 | 2.90 | — |
| T10 Ascari exit | 106.5 → 111.9 | 211.4 → 218.2 | 222.6 | 3.35 | 3.39 | — |
| T11 Parabolica | 79.2 → 81.1 | 167.5 → 169.2 | 177.4 | 2.78 | 2.85 | 200–215, estimate |

Implied above the flat limit means the minimum speed and the minimum radius do not coincide (at
T1 the car runs in too fast and wide of the line's apex) or the ground helps.

**Reference speeds on this line.** The reference speeds of section 2.6 on this line's radii,
the lateral acceleration they would need, the car's flat limit at those speeds, and the radius
the car would need at its limit:

| Corner | Line radius (m) | Reference speed (km/h) | Needed on this radius (g) | Car's limit at that speed (g) | Radius at the car's limit (m) |
|---|---|---|---|---|---|
| T1 | 18.8 | 75–85 | 2.35–3.02 | 2.08–2.15 | 21–26 |
| T4 | 45.9 | 110–120 | 2.07–2.47 | 2.33–2.41 | 41–47 |
| T6 Lesmo 1 | 74.8 | 175–190 | 3.22–3.80 | 2.91–3.06 | 83–93 |
| T7 Lesmo 2 | 73.6 | 177–184 (practice) | 3.35–3.62 | 2.93–3.00 | 84–89 |
| T8 Ascari | 69.4 | 176–190 (practice) | 3.51–4.09 | 2.92–3.06 | 84–93 |
| T11 Parabolica | 81.1 | 200–215 | 3.88–4.48 | 3.17–3.35 | 99–109 |

This comparison does not establish a grip deficit on its own. A real car's line through these
corners is not this line: real drivers use the kerbs further, take different apexes, and the
radius that matters is the one at the speed minimum, which this line's tightest radius only
approximates. The published speeds are practice laps or estimates. What the table shows is
that on this line and this model's radii the car would need 3.4–3.6 g at Lesmo 2 and 3.5–4.1 g at
Ascari to match the practice speeds, against about 2.9–3.1 g it has there; either the car's
lateral grip at 170–190 km/h, or the line's radii (the corridor, the kerb use, the centreline and
widths), or both, account for the difference, and the data here do not separate them.

Plots: `docs/evidence/m1-ai/monza-low-line.png` and the related close-ups are from the first
version of the car and line (`npm run ai:plot` redraws them); `docs/evidence/m1-lap-band/` has
the kerb-crossing traces.

**What separates the lap from the pole lap (78.792 s).**

| Item | s | What it is |
|---|---|---|
| Driving | 0.83 | Lap 84.969 s against the controller's own speed profile on the same line, 84.141 s: 0.27 s in S1, 0.15 s in S2, 0.41 s in S3. Largest single losses: T1, where a lock at turn-in still costs pedal and the car runs in at 77 km/h against a planned 70 and loses the T2 exit (65 against 72 km/h); the Parabolica (169 against 177 km/h); the Ascari exit. |
| Planning margin | 0.69 | The controller plans at 98/95/98 % of the measured envelope; the full-envelope profile on the same line is 83.447 s. |
| The rest | 4.66 | The full-envelope profile on this line against the pole lap. |

The full-envelope profile is a quasi-steady prediction on one chosen line: the speed profile of
the measured limits along this corridor's refined line. It is not an optimum (a different line,
more kerb, or a transient manoeuvre the quasi-steady envelope does not represent could be
faster) and not a bound (the profile can over- or under-estimate what the car does through a
corner; at T4 the controller's minimum, 118.6 km/h, is above its own 98 % plan's, 116.0 km/h).
So "the rest" mixes the car, the line the corridor allows, the track model (centreline, widths, the late DRS activation worth 0.097 s)
and the profile's approximation; it is not attributed to one of them.

**Kerbs and the player.** The contact patch is what a player feels too: a kerb strike now loads
a wheel about half as hard or less (flat kerb at 200 km/h and 5 m/s across: peak carcass damping
7.9 → 2.6 kN, no plank strike), and an exit kerb at 250 km/h no longer lifts a wheel. The game's
kerb rumble is unaffected: it comes from the surface's roughness and kind, which the game samples
itself (`apps/web/src/game/session.ts`); the sim's surface samples keep both.

**Envelope.** Measured by driving the vehicle model (`packages/ai/src/envelope/measure.ts`,
about 1–2 s of wall time), cached in `packages/ai/data/monza-low.envelope.json`: constant-speed
lateral sweeps at 60–340 km/h, threshold stops from above top speed (with the controller's
combined-slip lock rule), and full-throttle runs with wheelspin held at the tyre's peak, DRS
closed and open, MGU-K on and off, each at 0.8, 1.0 and 1.2 g of normal load, and braking in a
held turn for the shape of the combined limit (exponent 1.62). At load 1, in g: lateral 1.97 /
2.26 / 2.58 / 2.96 / 3.41 / 3.94 / 4.55 at 60 / 100 / 140 / 180 / 220 / 260 / 300 km/h; braking
(tyres alone) 1.42 / 1.67 / 2.04 / 2.58 / 3.05 / 3.59 / 4.12 at the same speeds; top speed
344.0 km/h with DRS closed and 353.6 km/h open. It agrees with the physics suite's own
manoeuvres (lateral at 200 km/h within 2 %, top speed within 1 km/h; both asserted).

**What flatters the car in this measurement**

- The controller reads exact slips, loads and sideslip every tick and reacts without lag: no
  human, and no race AI with human-like sensing, does that.
- It plans with the measured envelope of this exact car, so the line and speeds fit the car
  better than any human's would.
- No wind, no traffic, no tyre temperature or wear model yet.

**What handicaps it**

- The fixed 57 % brake bias: braking while turning in, the lightly loaded inside front locks
  first (T1, the Parabolica). A real driver adjusts bias per corner; no source was found for how
  the real cars' brake migration is set, so the bias stays fixed.
- DRS on the main straight opens 320.5 m later than the map allows (track file, above).
- No downforce gain from the tow, and the controller never uses more than 98 % of the envelope.
- The racing line is computed on the OpenStreetMap-derived centreline and authored widths
  (track-data.md), and the authored run-off kinds decide where the corridor may use run-off.

### 7.7 Pose invariants and barrier contact

Added after the owner found a car thrown hundreds of metres up beyond the barrier at Monza (ADR
0009). `checkCarInvariants` in `packages/sim/src/invariants.ts` is the one checker; the game runs
it on the player's car every tick, and the suites below call it every step.

**Limits, reference car, low trim** (medium and high differ only by their static ride height):

| Invariant | Limit | Derivation |
|---|---|---|
| Every state number | finite | |
| Floor height above the ground under each axle | −0.100 to 0.644 m | Top: static rear ride height 0.065 m, plus the tyre's full bottoming deflection 0.079 m (wheels unloaded), plus 0.5 m of airborne allowance (about four times the tallest kerb face, 0.13 m). Bottom: twice the depth at which the contact lifts the floor out (50 mm) |
| Pitch relative to the plane through the four contact heights | ±0.207 rad | Relative pitch is exactly (front − rear floor height) / wheelbase, so it follows from the floor-height span over 3.6 m |
| Roll relative to that plane | ±0.531 rad | The floor-height span across the floor's 1.4 m width |
| Wheel centre above the ground under it | 0.181 to 1.004 m | Bottom: free radius 0.36 m less the bottoming deflection and the plank allowance. Top: free radius plus the highest floor |
| Tyre bottoming deflection, force ceiling | 0.079 m, 23.7 kN | 60 % of the 18-inch tyre's 0.131 m sidewall; × 300 kN/m. Reference lap peak 11.5 kN and 32.5 mm. A floor skid has the same ceiling |
| Bump and droop stops | 40 mm of spring travel either way, 5 MN/m | Reference lap: at most 16 mm of compression, never extended |

A surface that declares steps (`surfaceStep`) widens the height limits by the step and the angle
limits through them: 2.644 m, ±1.318 rad pitch and ±3.388 rad roll for 2 m steps.

**Coverage.**

| Suite | Runs | Result |
|---|---|---|
| Adversarial surface (`packages/sim/validation/adversarial-surface.test.ts`, CI): cells 4–16 m with heights ±1 m (steps to 2 m), normals tilted up to 20°, grip 0.2–1.2, drag ×1–10, random inputs held up to 1 s | 6 seeds × 30 s, plus determinism | All in bounds; bit-identical repeat. A 40-seed sweep: no failures, highest floor 2.25 m against 2.65 |
| Random driving on Monza (`packages/track/validation/drive-fuzz.test.ts`, CI): random start round the lap and across the track, random steer, throttle and brake held 0.1–3 s | 10 seeds × 180 s (30 min) | All in bounds; deepest body corner 5 µm past a face at the end of a step; hardest barrier impact 62.4 m/s; highest floor 0.281 m; the ground-step rule never acted; floor or rim strikes only with a wheel on a kerb |
| The same, nightly (`drive-fuzz.soak.test.ts`) | 100 seeds × 600 s (16.7 h) | All in bounds; deepest corner 52 µm past a face; hardest impact 69.3 m/s; highest floor 0.502 m; no ground steps; one floor strike, on a kerb. The first run had failed that seed because a strike on a kerb counted as a failure; strikes on kerbs are now counted, not failed. Raising the skid ceiling to four tyre loads so the floor could lift the car off the kerb was tried and dropped: it threw a rear wheel 1.02 m up (limit 1.01) |
| The owner's run (`packages/track/test/offtrack.test.ts`) | 40 s with barriers, and 40 s with the barriers taken away | Bounded both ways; with barriers the car stops at the left barrier before the first chicane and never meets a step |
| Pit lane (`packages/track/validation/pit-lane.test.ts`) | Entry to exit at 20 m/s | No barrier contact |
| Ground a car can reach (`packages/track/test/ground-continuity.test.ts`) | Every point inside the barriers plus 0.5 m, and the pit lane, on a 1 m × 0.5 m lattice with 0.25 m probes | No step larger than the steepest kerb flank allows (0.34 m per 0.35 m probe). Before the projection fix: 2.73 m at the first chicane |

The drive fuzz now runs on Monza, Spa and Singapore, and starts each car with the vertical velocity of the ground along its heading (body heave and wheels): a level start on Kemmel's 6 % grade at up to 80 m/s met the rising ground as a floor strike in the first steps (track-data 5.2).

Random driving spends about 70 % of its time touching a barrier in the three-minute runs and 90 %
in the ten-minute ones (an undriven car ends up against one), so the coverage of free running is
thinner than the hours suggest.

**Reference lap.** 84.969 s on master after the contact patch (#17) and on this branch, bit for
bit; the physics suite and the AI artefact fingerprints are unchanged.

### 7.8 Reference laps, Spa and Singapore (2.1, 2.2)

The same reference driver, line builder and legal footprint corridor as at Monza (7.6), built by
`npm run ai:build` for Spa in medium trim and Singapore in high trim (the physics suite's
`CIRCUITS`), 10 kg of fuel, 25 °C at the circuit's altitude (Spa 415 m, Singapore 15 m), DRS in
the zones, full ERS. Each lap is timed from the circuit's timing line, which the track file now
carries (track format 3: Spa s = 6875.4 m, Singapore s = 4798.4 m, both 128.6 m before the start
line). Asserted by `packages/ai/validation/reference-lap.test.ts` (one lap each, physics job)
and the nightly soak (ten laps each); printed by `npm run telemetry -- lap --circuit spa` or
`singapore`. The lap is judged against the era's pole in the M4 band (±3 %), the trap against
2.2, and each sector against the session best (±3 %, 2.2; the pole laps' own sectors are not
published as one lap). Misses are recorded gaps (section 3, rule 2), not loosened targets.

| Quantity | Spa (medium trim) | Singapore (high trim) |
|---|---|---|
| Racing line (`ai:build`) | minimum curvature 109.402 s, refined 107.721 s | minimum curvature 92.989 s, refined 91.320 s |
| Lap | **109.072 s** (plan 107.725 s); pole 1:40.562: +8.510 s (+8.5 %); M4 band 97.545–103.579 s: outside by 5.493 s, recorded gap | **91.817 s** (plan 91.329 s); pole 1:29.158: +2.659 s (+3.0 %); M4 band 86.483–91.833 s: inside, by 0.016 s |
| Sectors (session best) | S1 31.750 (29.761, +6.7 %), S2 48.486 (42.532, +14.0 %), S3 28.836 (27.857, +3.5 %): all three recorded gaps | S1 27.234 (26.415, +3.1 %, gap), S2 38.326 (37.329, +2.7 %, pass), S3 26.257 (25.220, +4.1 %, gap) |
| Speed trap | 312.9 km/h at 30 m after T4 (315 ± 6, pass) | 301.7 km/h at 150 m before T1 (304 ± 6, pass) |
| Timing line | 218.5 km/h (fastest published 234.9) | 259.1 km/h (fastest published 264.8) |
| Clean | at most 2 wheels wholly past a white line, never four; no tyre sample on grass or gravel; sideslip ≤ 8.0°; line error max 5.00 m, RMS 0.77 m | at most 3 wheels wholly past a white line, never four; no tyre sample on grass or gravel; sideslip ≤ 3.3°; line error max 0.82 m, RMS 0.23 m |
| MGU-K deployed / harvested | 3.76 / 1.62 MJ | 2.59 / 1.91 MJ |
| Fuel a lap | 2.07 kg | 1.56 kg |
| Ten consecutive laps (nightly soak) | 109.783–110.159 s from 39.7 kg, spread 0.376 s, all clean, sideslip ≤ 8.2° | 91.883–91.992 s from 32.0 kg, spread 0.109 s, all clean, sideslip ≤ 4.0° |

**Where Spa's time goes.** Most of it is sector 2, the downforce sector (2.2): +5.95 s on the
session best, against +1.99 s in sector 1 and +0.98 s in sector 3. The line asks the car for its
measured flat limit almost everywhere in that sector (Pouhon T10 3.86 g against 3.88, Stavelot
3.61 against 3.73, Les Fagnes 2.91 against 2.97), so this is the car's fast-corner grip, the same
gap as at Monza's Lesmo and Parabolica (7.6) and as the Pouhon sweep in section 5, not the driver.
The largest line error (5.0 m, RMS 0.77 m) is the driver's; the lap is still clean.

**Raidillon lift (T3–T4).** The `spa-medium` profile plans a brief braking pulse at s = 1008–1016 m (speed dropping from 321.2 to 313.4 km/h on the 155.7 m line radius); via its 0.2 s speed preview the reference driver lifts at s = 990.9–1005.0 m (0.167 s under 99 % throttle, 0.063 s over 1 % brake on the timed lap), whereas real cars take Raidillon flat. Cause: at 320 km/h the medium-trim floor's leading edge drops into the 20 mm stall band under 1.2 g load, so the measured lateral envelope falls from 5.158 g (1.0 g) to 5.132 g (1.2 g), a −0.129 g/g slope. `EnvelopeModel` linearly extrapolates that `[0.8, 1.0, 1.2] g` grid to the 2.03–2.21 g Eau Rouge compression, underpredicting the limit as 5.00 g (4.90 g at 98 % planning scale) and capping the corner at 315.4 km/h. In the simulator itself the car compresses to a 7.9–14.7 mm leading-edge height (stalling ClA from 4.64 to 4.11–4.18 m² and touching the plank at 1.3–2.8 kN), yet lateral grip still grows with load, and holding full throttle through s = 960–1080 m stays clean (max sideslip 1.47°, at most 2 wheels off, 0 grass samples, min speed 311.2 km/h, trap 314.5 km/h, −0.032 s in S1).

**Singapore** is the slow-corner circuit, where the car is closest to the era's cars: the lap is
inside its band, sector 2 is inside its band, and sectors 1 and 3 miss by 0.8 % and 1.1 % beyond
the ±3 %. The lap sits 0.016 s inside its band, so a small change to the car can move it outside;
the suite will then fail and the result must be recorded, as section 3 requires.

| Corner (Spa) | Driven min (km/h) | Line min radius (m) | Implied lateral (g) | Flat limit at that speed (g) |
|---|---|---|---|---|
| T1 La Source | 71.3 | 18.7 | 2.14 | 2.07 |
| T3 Raidillon | 309.1 | 155.7 | 4.83 | 4.97 |
| T5 Les Combes | 144.0 | 59.3 | 2.75 | 2.71 |
| T8 Bruxelles | 117.5 | 43.4 | 2.50 | 2.46 |
| T10 Pouhon | 236.0 | 113.7 | 3.86 | 3.88 |
| T15 Stavelot | 225.3 | 110.6 | 3.61 | 3.73 |
| T17 Blanchimont | 321.2 | 168.5 | 4.82 | 5.18 |
| T18 Bus Stop | 82.9 | 25.9 | 2.09 | 2.17 |

| Corner (Singapore) | Driven min (km/h) | Line min radius (m) | Implied lateral (g) | Flat limit at that speed (g) |
|---|---|---|---|---|
| T1 Republic Boulevard | 134.2 | 51.1 | 2.77 | 2.76 |
| T3 Republic Boulevard | 94.8 | 31.9 | 2.22 | 2.33 |
| T7 Nicoll Highway | 123.7 | 44.8 | 2.69 | 2.64 |
| T8 Stamford Road | 89.4 | 28.1 | 2.24 | 2.28 |
| T13 Esplanade Drive | 62.5 | 15.6 | 1.97 | 2.03 |
| T14 Esplanade | 89.8 | 27.4 | 2.31 | 2.28 |
| T18 Marina Promenade | 184.6 | 77.0 | 3.48 | 3.48 |

Singapore's turn 13 hairpin is taken at 62.5 km/h on a 15.6 m line radius, wider than the 8.3 m
centreline radius the map data gives (track-data 5.3); later work may use the wider path a
reviewer judged drivable there.


### 7.9 Brake powers and trim downforce against the passing checks (M4 lap gap)

Goal point 3 asks for reference laps within 3 % of the 2025 poles on all three circuits. The car
is unchanged by this section: every candidate that brought the laps closer moved a check that
passes on master, and the owner's rule is that passing checks win. What it adds is four
validation targets, the measurements below, and the conflict recorded.

**Brake powers (doc 1.5).** Brembo gives a braking power for the hardest stop at each circuit
[21][22][23][51]: 2715 / 2584 / 2542 / 2239 kW (Monza T1 2025, Spa T5 2025, Singapore T7 2025,
Singapore T14 2024). The pages state the power without saying where in the stop it falls. The
braking manoeuvre now measures the peak friction brake power of each published stop (pedal
torque at the wheels' rolling speed, less what the MGU-K harvests), and the four figures are
validation targets at ±10 %. The car makes 4401 / 4297 / 4026 / 3846 kW, 58–72 % more:
recorded gaps.

Matching them was tried. Read near v1, the powers give 28–30 kN of friction force at all four
stops across three trims, and a master-cylinder bore of 22.5–23 mm (from 17.8) brings all four
inside their bands. That capacity cannot lock a wheel at full pedal from 330 km/h in high trim
(a passing unit test) and, at 23 mm, took the Monza and Spa peaks and the 300 km/h peak out of
their bands. The owner's decision: the sources do not place the power in the stop, so it is not a
ceiling at the start of braking; the brakes keep master's capacity and the powers are recorded.

**Trim downforce.** [57] also gives "probably three or four times the weight of the car" at top
speed. At each trim's own DRS-closed top speed in its event air (344 / 336 / 310 km/h) the
car makes 2.44 / 2.90 / 3.25 times its weight (ClA 3.6 / 4.6 / 5.8): low and medium are below
the source's range, high is inside it. Raising low and medium to 3.5 times (5.15 / 5.55 m²)
took the laps to about Monza 82.5 s, Spa 107.1–107.4 s and Singapore 90.5–90.7 s, but with brakes that can lock
at full pedal every increase moves a passing check:

| Trim | Tried | What it moves (passing on master) |
|---|---|---|
| Low | 3.7, 3.8, 3.9 | Three PR 19 game kerb cases (teleport (540, 8, 300 km/h), steer −0.1 at TC 0 and 2, steer 0 at TC 0) strike the turn 1 inside sausage kerb at 300 km/h and need the safety reset (docs/track-data.md 5.6): steer 0 at TC 0 from 3.7, all three at 3.9; above 3.9 the Monza T1 2025 stop time leaves its band (2.422 s at 3.9 against 2.42) |
| Medium | 4.7, 4.8 | Spa T5 2025 peak 5.11–5.12 g against 5.1; the Spa trap 304.7–305.0 km/h against 309 (the floor rides lower on Kemmel) |
| High | 6.0 (6.24 stalls the floor at its reference condition) | No passing check, but three recorded gaps widen (Singapore T7 distance, T14 peak, sector 3) for 0.16 s, and [57] gives no reason to move a trim already inside its range |

A first version of this step also moved the floor stall, the ride heights and the reference
driver's lock rule; each of those changed passing checks (the clumsy keyboard and autopilot
laps, kerb cases, the Monza lap) and is not kept.

**Reference laps** (`npm run telemetry -- lap --circuit …`), unchanged from master: Monza 84.872 s
(+7.7 %), Spa 109.072 s (+8.5 %), Singapore 91.817 s (+3.0 %, inside its band by 0.016 s).

**Component targets.** The original 32: 20 pass, as on master, the same 20. With the four brake
powers (recorded gaps), 20 of 36.

**What it would take.** The low and medium downforce the cited figure points to needs either a
braking model under which the published Monza and Spa stops and the high-trim lock hold together
(a pad friction that changes through the stop, with a source for its curve, is the candidate),
or addressing the turn 1 inside sausage kerb strike at 300 km/h (docs/track-data.md 5.6) so
the kerb cases stop depending on the exact path. Neither is done here.

**Sources looked for and not used.** No team, FIA or peer-reviewed figure was found for ClA, CdA,
the floor's share, a per-trim downforce cut, measured ride heights, or per-corner lateral g or
minimum speeds of this era; technical journalism gives only qualitative statements [58]. Public
timing-derived telemetry exists (the OpenF1 API), but it is licensed CC BY-NC-SA 4.0, which does
not fit this repository. It was looked at only privately, to see where the laps lose time; no
parameter, target or figure here comes from it.

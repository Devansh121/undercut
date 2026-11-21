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
| Peak friction, lateral | μy ≈ 1.8 at the reference load of 3 kN, falling with load | **Estimate**, cross-checked against an open lap-time model of an older car: μy 1.85 front and 2.15 rear at Fz0 = 3 kN [44]. The 18-inch tyres are used less aggressively, so start lower and calibrate to the cornering targets in section 2. |
| Peak friction, longitudinal | μx ≈ 0.9 × μy | **Estimate**, same reference [44] (ratio about 0.89–0.91). |
| Load sensitivity | dμ/dFz ≈ −5 × 10⁻⁵ N⁻¹ (μ drops about 0.25 between 3 kN and 8 kN) | [44] uses −5 × 10⁻⁵ N⁻¹. Peak aero load per tyre at 300 km/h is about 6–9 kN, so this term matters. |
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
| Low drag (Monza) | 1.15 (1.05–1.25) | −12 % | 3.6 (3.0–4.2) | 44 % | Monza wings are already small, so DRS gains less than at Spa. |
| Medium (Spa) | 1.30 (1.15–1.45) | −15 % | 4.6 (4.0–5.2) | 44 % | |
| High downforce (Singapore) | 1.60 (1.45–1.75) | −18 % | 5.8 (5.0–6.5) | 45 % | No terminal-speed check is possible: the Singapore speed trap is 150 m before Turn 1 at the end of a short straight [6]. |
| Cross-check, older car [44] | 1.56 | −17 % | 4.88 | 45 % | Pre-2022 car at a medium-high downforce circuit |

DRS: in the open state the rear-wing slot gap is 9.4–85 mm, and there are only two positions [1] Art. 3.10.10.

Ride-height sensitivity (shape for the model, **estimate**):
- Downforce rises as the floor's front ride height falls, until a critical height (about 15–20 mm at the floor leading edge), below which the underfloor flow stalls. That stall causes porpoising and a 10–25 % loss over a few millimetres.
- Model ClA(h_f, h_r) = ClA₀ · (1 + k_h·(h₀ − h_eff)) with k_h ≈ 0.02 per mm above the stall height. Apply a smooth stall drop below h_crit, and move the balance forward when the rake increases.
- Drag sensitivity to ride height is about one third of the downforce sensitivity.
- None of these numbers is published; tune the shape so the car bottoms on the Monza and Spa straights and so the braking targets in section 2.3 are met.

Density: use ρ from circuit altitude and temperature. Spa is 364–467 m above sea level ([track-data.md]), so ρ is 4–5 % lower than at Monza. Also model the effect of the steep grade on vertical load at Eau Rouge.

### 1.5 Brakes

| Parameter | Value | Source / reasoning |
|---|---|---|
| Discs | one per wheel; thickness ≤ 32 mm; diameter 325–330 mm front, 275–280 mm rear | [1] Art. 11.3 |
| Pads | at most two per wheel | [1] Art. 11.3.5 |
| Peak braking power per car | 2.2–2.7 MW at the hardest stops | [21][22][23][28]: 2715 kW Monza T1 2025, 2584 kW Spa T5 2025, 2542 kW Singapore T7 2025, 2239 kW Singapore T14 2024 |
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
| Damping ratio | 0.3–0.5 heave, 0.6–0.8 roll | Usual racing ranges. |
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
| Model peak braking 4.1–4.4 g against published 4.6–5.2 g (section 7) | Peaks at Monza T1 2025 and 2023, Spa T5 2025, Singapore T7 2025 and the 300 km/h curve point miss by 0.06–0.6 g | The friction-brake torque is set by the published peak brake power, which gives the same 28–30 kN at all four events; with it these peaks are not reachable. Find whether Brembo's peak power and peak g are simultaneous, or a source for brake torque or pedal pressure |
| Model stops shorter and quicker than the published Spa T5 and Singapore T7/T14 events (section 7) | 77–85 m against 93–99 m; 1.1–1.9 s against 1.5–2.2 s | The published figures include the trail-off into the corner: Spa T5 2025 averages 2.9 g over its 1.48 s while peaking at 4.7 g, far below the grip at 176 km/h. A straight-line full stop cannot match them. Revisit with corner-entry braking on the real circuit (reference AI) |
| Pouhon 4.86 g against 5.7 ± 0.7 (section 7) | Fast-corner grip below the one secondary figure | Flat constant-speed sweep; the corner is downhill with two apexes. Re-test on the Spa surface with the reference driver; keep the target's source quality in mind |

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

`[track-data.md]` refers to measurements in `docs/track-data.md` (OSM centreline lengths, pit lane lengths, DEM profiles).

## 7. Results

Vehicle model v1 (M1), measured with the telemetry runner: `npm run telemetry -- validate` (and
`-- all` for the rest), 240 Hz world step with 1/960 s substeps (ADR 0007). The physics suite
(`npm run test:physics`) asserts every row: a pass stays inside its band, a gap stays where it was
recorded (section 3, rule 2). Speeds in km/h, decelerations and accelerations in g.

### 7.1 Section 2 targets

| Target (section) | Stated | Result | Verdict |
|---|---|---|---|
| 0–100 km/h (2.3) | 2.6 ± 0.3 s | 2.52 s | pass |
| 0–200 km/h (2.3) | 4.8 ± 0.5 s | 4.91 s | pass |
| 0–300 km/h (2.3) | 10.5 ± 1.5 s | 10.96 s | pass |
| Top speed, low trim, DRS open (2.2) | 348 ± 6 | 352.5 | pass |
| Monza T1 2025, 337→89: distance / time / peak (2.4) | 129 m ± 10 % / 2.75 s ± 12 % / 4.7 ± 0.4 | 128.3 m / 2.44 s / 4.24 | pass / pass / gap |
| Monza T1 2024, 328→90 | 119 m / 2.52 s / 4.6 | 123.0 m / 2.37 s / 4.20 | pass / pass / pass |
| Monza T1 2023, 334→89 | 122 m / 2.57 s / 5.2 | 127.7 m / 2.44 s / 4.23 | pass / pass / gap |
| Spa T5 2025, 327→176 | 93 m / 1.48 s / 4.7 | 77.1 m / 1.13 s / 4.26 | gap / gap / gap |
| Spa T5 2024, 320→167 | 99 m / 1.62 s / 4.5 | 77.7 m / 1.18 s / 4.23 | gap / gap / pass |
| Singapore T7 2025, 308→128 | 96 m / 1.90 s / 4.9 | 85.3 m / 1.49 s / 4.35 | gap / gap / gap |
| Singapore T14 2024, 288→93 | 94 m / 2.19 s / 4.6 | 90.5 m / 1.88 s / 4.22 | pass / gap / pass |
| Peak deceleration from 300 km/h, Monza trim (2.4 test 2) | 4.6 ± 0.4 | 4.08 | gap |
| Peak deceleration from 100 km/h, Monza trim | 2.0 ± 0.4 | 2.18 | pass |
| Peak deceleration falls with speed: 300/250/200/150/100 | monotonic | 4.08 / 3.72 / 3.33 / 2.70 / 2.18 | pass |
| Pouhon, medium trim, 281 km/h, Spa air (2.5) | 5.7 ± 0.7 | 4.86 | gap |
| Parabolica exit, low trim, 270 km/h, Monza air | 3.5–4.0 ± 0.6 | 4.25 | pass |
| Slow corner 85 km/h, low / medium / high trim | 2.0–2.3 ± 0.4 | 2.11 / 2.13 / 2.15 | pass (high trim is the μ fit) |

19 of 32 pass and 13 are recorded gaps (section 5). Not covered yet: reference laps (2.1),
sector times and speed traps (2.2), Raidillon and other corners whose grade or compression
matters (2.5): they need the circuit surface and the reference driver.

How the tests run (unchanged from section 2 unless noted): braking uses race fuel 50 kg, the
circuit's trim and air (25 °C at the circuit's altitude), a driver applying the pedal in 80 ms
and easing it whenever a wheel passes 10 % slip (no ABS), and the best bias in 52–62 %; peak is
a 50 ms moving average. The top-speed run starts at 200 km/h on an unlimited flat straight with
DRS open and the MGU-K deploying, 10 kg of fuel, and reports the maximum (the doc derived CdA
from the trap as if it were terminal speed). Lateral sweeps hold speed and tighten the corner by
0.25 g/s until the car will not take more, 10 kg fuel, 0.5 s window.

### 7.2 Other measurements

| Measurement | Result |
|---|---|
| Top speed, DRS open / closed: low trim | 352.5 / 342.7 |
| medium trim | 345.3 / 330.3 |
| high trim | 329.8 / 310.9 |
| Sustained lateral g, sea-level air, low trim, 85 / 120 / 160 / 200 / 240 / 281 / 300 km/h | 2.11 / 2.38 / 2.74 / 3.20 / 3.77 / 4.53 / 4.86 |
| medium trim | 2.13 / 2.43 / 2.85 / 3.39 / 4.10 / 4.99 / 5.23 |
| high trim | 2.15 / 2.47 / 2.94 / 3.58 / 4.45 / 5.17 / 5.19 |
| Coast-down in neutral, medium trim, at 300 / 250 / 200 / 150 / 100 km/h | 0.664 / 0.435 / 0.271 / 0.153 / 0.073 g |
| Step steer at 80 / 150 / 250 km/h: yaw-rate rise time (10–90 %), overshoot | 0.025 / 0.042 / 0.033 s; 8.3 / 0.5 / 0.2 % |
| Lift-off at 150 km/h from 1.5 / 2.4 / 3.0 g: yaw-rate rise, max sideslip | 5.6 / 9.2 / 17.3 %; 0.15 / 0.91 / 2.26°; no spin |
| Full throttle out of an 80 km/h, 1.8 g corner, TC off / 1 / 2 / 3: max rear slip, max sideslip | 0.55, 6.0° / 0.16, 2.0° / 0.15, 1.7° / 0.15, 1.7° |
| Full brake in a 200 km/h, 3 g corner, ABS off / 1 / 2 / 3: min slip, max sideslip | −1.00 (locked), 8.1° / −0.16, 10.3° / −0.15, 5.9° / −0.15, 4.2° |
| Body modes, dry car at rest (free decay): heave, pitch, roll | 5.2 Hz ζ 0.33; 5.6 Hz ζ 0.52; 7.3 Hz ζ 0.60 |
| Floor height at 300 km/h, 50 kg fuel, front / rear axle: low / medium / high trim | 12.3 / 42.7; 10.8 / 43.9; 9.2 / 45.4 mm |
| Cost: one car, one core, Node 20.19 | 530–880× real time (ADR 0007) |

### 7.3 Estimates moved inside their ranges, and new estimates

Moved (each inside the range section 1 gives):

- Peak lateral friction μy 1.8 → **2.12**: section 1.2 says to start below [44]'s 1.85–2.15 and calibrate to the cornering targets. Fitted once, to the centre (2.15 g) of the slow-corner band in high-downforce trim. Every other target is a check.
- Tyre vertical stiffness → **300 kN/m** (250–300) and wheel-centre spring rates 1.5 / 0.6 MN/m, giving heave frequencies of 6.1 / 5.0 Hz on paper (5–7 / 4.5–6) and roll stiffness 56 % front (55–60 %).
- Static ride heights per trim, front / rear: low 25 / 65 mm, medium 27 / 72 mm, high 30 / 80 mm (20–30 / 60–80). Raising the car with downforce keeps the high trim's floor out of the stall at 300 km/h.
- Stall at the floor leading edge (section 1.4 shape): 15 mm critical height (15–20), 15 % loss (10–25 %) over 4 mm.

New estimates the sheet did not cover (all in `packages/sim/src/params.ts` with their reasoning):

- Ride-height map: ClA and CdA hold the table values at the floor height the car runs at 300 km/h in that trim (measured: 21.4 / 20.7 / 20.1 mm front-weighted mean), so the fitted table values stay the fitted values. Ground effect is weighted 70 % to the front ride height.
- Friction-brake torque 10.3 kN·m in total, from the 2715 kW peak at 337 km/h (Monza T1 2025); MGU-K harvest adds on top at full pedal through brake-by-wire.
- Tyre vertical damping 7 kN·s/m: with springs five times stiffer than the tyres the corner dampers barely act on the body modes (free decay gave ζ ≈ 0.05), so the damping that holds section 1.6's ratios is lumped at the tyre (carcass plus the inerter and heave damper of a real car).
- Tyre shape: peak at 10 % slip ratio and tan α = 0.09; sliding at 76 % (locked) and 85 % (sideways) of peak; relaxation lengths 0.08 m and 0.25 m; rolling resistance 0.012. Wheel inertia 1.2 / 1.4 kg·m², engine 0.02 kg·m². DRS also removes 8 / 10 / 12 % of total downforce from the rear by trim, over 0.20 s opening and 0.15 s closing.

### 7.4 Inconsistencies found in section 1

- "About 10 mm of aero compression under about 15 kN" needs about 1.5 MN/m in total, but four tyres at 250–300 kN/m already compress 13–15 mm under that load. The car runs about 13–15 mm lower at the front axle at 300 km/h than at rest.
- Pitch "about 4–5 Hz, following from heave stiffness and wheelbase" does not follow with Iyy = 1100 kg·m²: the heave rates give about 6–8 Hz undamped (5.6 Hz damped in the model).
- The published peak brake powers and peak decelerations disagree by about 14 % if the peak power occurs at the start of the stop (section 5).

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
| Peak friction, lateral | μy at the reference load of 3 kN: range 1.8–2.2; model 2.14 (fitted, section 7) | **Estimate**, bounded by an open lap-time model of an older car: μy 1.85 front and 2.15 rear at Fz0 = 3 kN [44]. About 2 at the reference load is usual for this class on the softest compound with low fuel. Fitted to the low-trim slow-corner lateral target (2.5). |
| Peak friction, longitudinal | μx at 3 kN: range 1.6–2.0; model 1.85 (fitted, section 7) | **Estimate**. [44] gives μx/μy of 0.89–0.91 at the reference load; the model's is 0.86. Set separately from μy, as the magic formula's pDx and pDy terms and [44]'s separate longitudinal and lateral coefficients are. |
| Load sensitivity | lateral dμy/dFz = −5 × 10⁻⁵ N⁻¹ (μ drops 0.25 between 3 kN and 8 kN); longitudinal dμx/dFz: range −5 × 10⁻⁵ to −1.5 × 10⁻⁴ N⁻¹, model −1.3 × 10⁻⁴ (fitted) | Lateral from [44]. [44] also uses −5 × 10⁻⁵ longitudinally, but for a 13-inch tyre; the range is widened here because the launch (low load) and the braking peaks of all three trims (high load, nearly equal at 4.7–4.9 g [21][22][23]) cannot both be met with that slope (section 7.4), and the one lateral figure at high load (Pouhon 5.7 g [43]) sits well above the braking peaks. Peak aero load per tyre at 300 km/h is about 6–9 kN, so this term matters. |
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
| Low drag (Monza) | 1.15 (1.05–1.25); model 1.16 (section 7) | −12 % | 3.6 (3.0–4.2) | 44 % | Monza wings are already small, so DRS gains less than at Spa. |
| Medium (Spa) | 1.30 (1.15–1.45) | −15 % | 4.6 (4.0–5.2) | 44 % | |
| High downforce (Singapore) | 1.60 (1.45–1.75) | −18 % | 5.8 (5.0–6.5) | 45 % | No terminal-speed check is possible: the Singapore speed trap is 150 m before Turn 1 at the end of a short straight [6]. |
| Cross-check, older car [44] | 1.56 | −17 % | 4.88 | 45 % | Pre-2022 car at a medium-high downforce circuit |

DRS: in the open state the rear-wing slot gap is 9.4–85 mm, and there are only two positions [1] Art. 3.10.10.

Ride-height sensitivity (shape for the model, **estimate**):
- Downforce rises as the floor's front ride height falls, until a critical height (about 15–20 mm at the floor leading edge), below which the underfloor flow stalls. That stall causes porpoising and a 10–25 % loss over a few millimetres.
- Model ClA(h_f, h_r) = ClA₀ · (1 − f + f·(1 + k_h·(h₀ − h_eff))) with k_h ≈ 0.02 per mm of the floor's own downforce above the stall height, and f the floor's share of the downforce (**estimate** 0.6, range 0.5–0.7: the floor makes most of this era's downforce; the wings and bodywork do not see the floor height). Apply a smooth stall drop below h_crit, and move the balance forward when the rake increases.
- Drag sensitivity to ride height is about one third of the downforce sensitivity, again on the floor's share.
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
| Braking times short (section 7) | Monza T1 2025 2.41 s against 2.75 ± 12 %; Spa T5 1.16 and 1.22 s against 1.48 and 1.62; Singapore T7 1.48 s against 1.90; Singapore T14 1.81 s against 2.19 | Brembo's times include the trail-off and turn-in into the corner; the scripted stop brakes at the limit all the way to v2 (its pedal ceiling is an assumed estimate that barely acts, section 7.1). The distances and peaks of the same stops mostly pass. Measure the stops on the real circuits with the reference driver's own trail braking once Spa and Singapore exist |
| Medium and high-downforce stops short (section 7) | Spa T5 79.4 and 80.6 m against 93 and 99 m ± 10 %; Singapore T7 85.4 m against 96 m ± 10 % | The peaks now match (4.7–5.0 g) but the deceleration holds up longer as speed falls than the published distances allow. The trims' ClA (doc values) and the longitudinal load slope trade off in braking; lateral or lap data at Spa and Singapore would separate them |
| Monza T1 2023 peak 4.56 g against 5.2 ± 0.4 (section 7) | One event | The 2023 figure stands apart from 2024 (4.6 g) and 2025 (4.7 g) at the same corner and speed; the model gives about 4.55 g for all three. Check the 2023 source |
| Pouhon 4.92 g against 5.7 ± 0.7 (section 7) | Fast-corner lateral grip below the one secondary figure | Flat constant-speed sweep; the corner is downhill with two apexes and the source is a blog with no trace. Re-test on the Spa surface with the reference driver |
| Monza reference lap 84.690 s against the M1 band 74.852–82.732 s (section 7.6) | 1.96 s outside M1, 3.53 s outside M4 | Not reachable inside the documented parameter ranges: with μy and the low-trim ClA both at the top of their ranges (2.2 and 4.2) and the line rebuilt, the lap is 82.817 s, still outside. What separates it from the band is measured in section 7.6: the reference driver's planning margin and driving (1.86 s), the line's margin and unused kerbs (0.78 s in the plan), and track geometry that is tighter than the published corner speeds allow (section 7.6, track check) |

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
"after" is the committed car.

| Target (section) | Stated | Before | After | Verdict after |
|---|---|---|---|---|
| 0–100 km/h (2.3) | 2.6 ± 0.3 s | 3.00 s, gap | 2.55 s | **fit** |
| 0–200 km/h (2.3) | 4.8 ± 0.5 s | 5.63 s, gap | 4.97 s | pass |
| 0–300 km/h (2.3) | 10.5 ± 1.5 s | 11.71 s | 11.15 s | pass |
| Top speed, low trim, DRS open (2.2) | 348 ± 6 | 353.9 | 353.7 | **fit** |
| Monza T1 2025, 337→89: distance / time / peak (2.4) | 129 m ± 10 % / 2.75 s ± 12 % / 4.7 ± 0.4 | 141.1 / 2.67 / 4.71 (fit) | 131.4 m / 2.41 s / 4.58 | pass / gap / **fit** |
| Monza T1 2024, 328→90 | 119 m / 2.52 s / 4.6 | 136.2 gap / 2.62 / 4.64 | 126.3 m / 2.36 s / 4.52 | pass / pass / pass |
| Monza T1 2023, 334→89 | 122 m / 2.57 s / 5.2 | 139.2 gap / 2.65 / 4.68 gap | 129.2 m / 2.38 s / 4.56 | pass / pass / gap |
| Spa T5 2025, 327→176 | 93 m / 1.48 s / 4.7 | 81.9 / 1.21 / 5.11, all gaps | 79.4 m / 1.16 s / 4.81 | gap / gap / pass |
| Spa T5 2024, 320→167 | 99 m / 1.62 s / 4.5 | 83.4 / 1.28 / 5.07, all gaps | 80.6 m / 1.22 s / 4.78 | gap / gap / pass |
| Singapore T7 2025, 308→128 | 96 m / 1.90 s / 4.9 | 88.9 / 1.57 gap / 5.70 gap | 85.4 m / 1.48 s / 4.97 | gap / gap / **fit** |
| Singapore T14 2024, 288→93 | 94 m / 2.19 s / 4.6 | 98.0 / 2.04 / 5.11 gap | 89.8 m / 1.81 s / 4.68 | pass / gap / pass |
| Peak deceleration from 300 km/h, Monza trim (2.4 test 2) | 4.6 ± 0.4 | 4.33 | 4.33 | pass |
| Peak deceleration from 100 km/h, Monza trim | 2.0 ± 0.4 | 1.90 | 2.26 | pass |
| Peak deceleration falls with speed: 300/250/200/150/100 | monotonic | 4.33 / 3.35 / 2.74 / 2.24 / 1.90 | 4.33 / 3.63 / 3.08 / 2.61 / 2.26 | pass |
| Pouhon, medium trim, 281 km/h, Spa air (2.5) | 5.7 ± 0.7 | 4.14, gap | 4.92 | gap |
| Parabolica exit, low trim, 270 km/h, Monza air | 3.5–4.0 ± 0.6 | 3.62 | 4.31 | pass |
| Slow corner 85 km/h, low / medium / high trim | 2.0–2.3 ± 0.4 | 1.81 / 1.82 / 1.85 | 2.15 / 2.18 / 2.24 | **fit** / pass / pass |
| Monza reference lap, low trim, qualifying fuel, reference driver (2.1; 7.6) | 74.852–82.732 s (M1) | 90.137 s, gap | 84.690 s | gap |
| Monza speed trap on that lap, DRS open, no tow (2.2) | 348 ± 6 | 347.3 | 347.5 | pass |

Of the 32 component targets, 22 are in band (5 of them fit targets, below) and 10 are recorded
gaps (section 5), against 17 and 15 before. Eight gaps closed: both launch times, the Monza 2024
and 2023 distances and the four high-trim peaks (Spa 2025 and 2024, Singapore T7 and T14).
Three targets that passed before are now gaps, all braking at the low-speed end or in high trim:

- Monza T1 2025 time, 2.41 s against a band from 2.42 s. Every published stop time comes out
  short (Spa, Singapore and now this one): Brembo's time includes the trail-off into the corner,
  and the scripted stop brakes at the limit all the way to v2. It passed before only because the
  car had less grip at low load and so braked less at the end of the stop.
- Singapore T7 2025 distance, 85.4 m against a band from 86.4 m, and Singapore T14 2024 time,
  1.81 s against 1.93 s: the high-trim car now has the published peaks but holds its
  deceleration longer as speed falls than the published distances allow (section 5).

The reference lap and its trap are measured by the reference driver on the Monza surface
(section 7.6). Not covered yet: Spa and Singapore laps (2.1), per-sector bands (2.2, an M4
target), and Raidillon and other corners whose grade or compression matters (2.5).

**Fit and check sets.** Every observable used to set a parameter, and how:

| Parameter | Fitted to | Method | Result |
|---|---|---|---|
| Tyre μx at 3 kN and its load slope dμx/dFz | 0–100 km/h (2.6 s), Monza T1 2025 peak (4.7 g, low trim), Singapore T7 2025 peak (4.9 g, high trim) | least squares in band half-widths over a grid (μx 1.75–1.975 by 0.025, slope −1.0 to −1.7 × 10⁻⁴ by 0.1 × 10⁻⁴, refined to 0.01 and 0.05 × 10⁻⁴) | 1.85 and −1.3 × 10⁻⁴ per N; residuals 2.55 s, 4.58 g, 4.97 g |
| Tyre μy at 3 kN | Slow corner, low trim, 85 km/h (2.0–2.3 g, centre 2.15) | one-dimensional | 2.14 (2.147 g) |
| Low-trim CdA | Top speed, low trim, DRS open (as doc 1.4 derived CdA from the trap) | the floor share (below) raised the unlimited-straight speed to 354.3, outside its band | 1.16 (353.7; lap trap 347.5) |

Used to choose among estimates without being solved for (calibration checks, not independent):

- The floor stall's critical height and loss (20 mm and 25 %, the top of their ranges) were
  chosen in the first version of the model using the published braking peaks of all three
  trims (section 7.3). Unchanged here.
- The floor share of the downforce (0.6, section 1.4) is a structural estimate, not tuned: it
  was introduced after logging the effective downforce through a corner (74 % of the table value
  at 150 km/h with the whole of ClA following the floor height, section 7.4), and the Monza lap
  was looked at while deciding it (it is worth 0.6 s there).

Everything else is an independent check: the 0–200 and 0–300 times, every distance and time,
the other braking peaks, the speed curve, Pouhon, the Parabolica exit, the medium and high-trim
slow corners (close relatives of the low-trim fit, so weak checks), the lap and its sectors,
corner speeds and trap (the trap checks the CdA fit). The previous version of this section
called every row but the Monza peak a check, although the stall settings had been chosen with the
cross-trim braking peaks; that is corrected above.

How the tests run (unchanged from section 2 unless noted):

- Braking: race fuel 50 kg, the circuit's trim and air (25 °C at the circuit's altitude), the best
  bias in 52–62 %. The approach is held at v1 with DRS open and the MGU-K deploying (each event
  ends a DRS straight); braking starts within 0.05 km/h of v1, DRS closes on the brake, and the
  crossing of v2 is interpolated. Peak is a 50 ms moving average.
- Published events use one pedal profile for every event: the pedal goes to full in 80 ms and is
  eased off whenever a wheel passes 10 % slip (no ABS). Over the last 25 % of the speed drop an
  assumed pedal ceiling falls linearly to 30 % at v2. Both constants are unsupported estimates,
  and the ceiling barely acts: the threshold controller already asks for less, and removing it
  moves the seven events by at most 0.22 m and 0.006 s (measured). It does not reproduce the
  trail braking in Brembo's times. The speed-curve test (2.4 test 2) uses no ceiling.
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
| medium trim | 347.7 / 333.5 |
| high trim | 332.4 / 311.6 |
| Sustained lateral g, sea-level air, low trim, 85 / 120 / 160 / 200 / 240 / 281 / 300 km/h | 2.15 / 2.44 / 2.83 / 3.29 / 3.86 / 4.56 / 4.81 (before: 1.81 / 2.04 / 2.34 / 2.72 / 3.22 / 3.87 / 4.16) |
| medium trim | 2.19 / 2.53 / 2.99 / 3.56 / 4.26 / 5.03 / 5.21 |
| high trim | 2.24 / 2.63 / 3.19 / 3.89 / 4.70 / 5.30 / — |
| Coast-down in neutral, medium trim, at 300 / 250 / 200 / 150 / 100 km/h | 0.661 / 0.447 / 0.283 / 0.161 / 0.077 g |
| Step steer at 80 / 150 / 250 km/h: yaw-rate rise time (10–90 %), overshoot | 0.025 / 0.042 / 0.033 s; 8.7 / 0.4 / 0.3 % (before 0.033 / 0.050 / 0.046 s; 5.4 / 2.1 / 0.3 %) |
| Lift-off at 150 km/h from 60 / 80 / 95 % of the limit (1.69 / 2.25 / 2.65 g): yaw-rate rise, max sideslip | 6.7 / 8.9 / 12.1 %; 0.16 / 0.49 / 1.48°; no spin (before at 1.38 / 1.84 / 2.17 g: 5.1 / 7.3 / 10.0 %; 0.32 / 0.74 / 1.73°) |
| Lift-off at 250 km/h from 90 % (3.90 g) | 7.0 %, 1.37°, no spin |
| Full throttle out of an 80 km/h corner at 85 % of the limit, TC off / 1 / 2 / 3: max rear slip, max sideslip | 0.55, 5.6° / 0.16, 1.8° / 0.16, 1.8° / 0.15, 1.8° (before 0.22, 1.2° / 0.17, 2.4° / 0.16, 1.8° / 0.15, 1.2°) |
| Full brake in a 200 km/h corner at 85 % of the limit, ABS off / 1 / 2 / 3: min slip, max sideslip | −1.00 (locked), 26.1° / −0.19, 3.7° / −0.19, 2.8° / −0.19, 2.2° (before −1.00, 17.3° / −0.20, 4.2° / −0.19, 3.2° / −0.19, 2.5°) |
| Full pedal, straight line 300→100 km/h, high trim, ABS off / 1 / 2 / 3: distance | 97.0 m (locked) / 86.8 / 87.2 / 88.3 m |
| Load transfer with aero off, against h·ΣF (braking and cornering) | within 0.5 % (unit tests) |
| Body modes, dry car at rest (free decay): heave, pitch, roll | 5.2 Hz ζ 0.33; 5.6 Hz ζ 0.52; 7.3 Hz ζ 0.60 (unchanged) |
| Floor height at 300 km/h, 50 kg fuel, front / rear axle: low / medium / high trim | 12.4 / 42.6; 10.9 / 43.7; 9.4 / 45.2 mm (unchanged: on a straight the tyres do not set it, and at the reference height the floor share changes nothing) |
| Cost: one car, one core, Node 20.19 | 540–800× real time (ADR 0007) |

**Handling with more grip.** The tyre's curve shape is unchanged: the force peaks at 10 % slip
ratio and at a slip angle of 5.1° (tan α = 0.09) at every load, and falls away progressively
after it. At 3 kN, lateral: 1.94 at 2.5°, 2.14 at the 5.1° peak, 2.10 at 8°, 2.07 at 10°, 2.01
at 15° and 1.92 at 30° (×Fz); longitudinal: 1.65 at 5 % slip, 1.85 at 10 %, 1.81 at 15 %, 1.75
at 20 %, 1.61 at 40 % and 1.50 locked. At the car level the lift-off response is more
progressive than before (less sideslip at each share of a higher limit), and step steer settles
as before with a little more overshoot at 80 km/h (8.7 %). Two things are sharper and are what a
player without assists will notice: full throttle at 85 % of a higher cornering limit spins the
rears more without traction control (0.55 slip, 5.6° of sideslip, no spin), and locking all four
wheels in a 200 km/h corner without ABS now yaws the car further (26° against 17°). With TC or
ABS at any level both stay at or below their earlier values. Low speed is unchanged: the
standstill-on-a-slope, creep and pit-limiter tests pass as before, and launch is quicker
(0–100 km/h 2.55 s).

### 7.3 Estimates moved inside their ranges, and new estimates

Moved in this calibration (each inside its range in section 1, ranges widened only where
section 1 now says why):

| Parameter | Before | After | Range | Reason |
|---|---|---|---|---|
| Tyre: structure | one μy, μx = 0.9 μy, one load slope | μx and μy each with its own load slope | — | The launch wants more longitudinal grip at low load, the braking peaks of the three trims less at high load, cornering is established independently (7.4) |
| Tyre μy at 3 kN | 1.80 | 2.14 | 1.8–2.2 ([44] 1.85–2.15) | Fitted, 7.1 |
| Tyre μx at 3 kN | 1.62 (0.9 × 1.80) | 1.85 | 1.6–2.0 | Fitted, 7.1 |
| Lateral load slope | −5 × 10⁻⁵ N⁻¹ | −5 × 10⁻⁵ N⁻¹ | [44] | Unchanged |
| Longitudinal load slope | −4.5 × 10⁻⁵ N⁻¹ (0.9 × lateral) | −1.3 × 10⁻⁴ N⁻¹ | −5 × 10⁻⁵ to −1.5 × 10⁻⁴ (widened, 1.2) | Fitted, 7.1 |
| Floor share of downforce | 1 (all of ClA followed the floor height) | 0.6 | 0.5–0.7 (new, 1.4) | Wings and bodywork do not see the floor height; estimate |
| Low-trim CdA | 1.15 m² | 1.16 m² | 1.05–1.25 | Re-fitted to the trap, 7.1 |

Tried and not adopted: counting the engine's overrun drag inside the brake-by-wire rear demand
(so a real car's BBW would take it out of the rear friction torque). It made the combined
braking-in-a-turn limit worse (envelope exponent 1.80 → 1.53) and the planned Monza lap 1.0 s
slower: at the fixed 57 % default bias the engine's drag acts as a rearward brake migration at
low speed that the car relies on. It belongs with a brake-migration model, which needs a source
for how the real cars' migration is set. Lowering the default bias to 55 % or 53 % made the
plan faster but the driven lap slower (84.88 and 84.95 s), so 57 % stays (the straight-line
stops pick 56–58 %).

Moved in the first version of the model (unchanged here):

- Floor stall: critical height 20 mm at the leading edge (15–20) and 25 % loss (10–25 %), both the
  top of the range, chosen with the published braking peaks of the three trims (a calibration
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
  section 1.6's ratios is lumped at the tyre (carcass plus the inerter and heave damper of a real
  car).
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

### 7.4 What the data say about the tyre and the floor

The first version's gaps shared a pattern: targets at low tyre load (the launch, the low-speed
end of the Monza stops) wanted more grip than μy = 1.80 gave, targets at high load in
high-downforce trim (Spa and Singapore braking) wanted less. One friction coefficient with a
fixed longitudinal share and [44]'s shared load slope could not do both. Giving the longitudinal
direction its own peak and slope resolves it: one longitudinal curve, fitted to the launch and
to the braking peaks of the low and high trims, also brings the Monza 2024 and 2023 distances,
the Spa peaks and Singapore T14 peak into their bands, which it was not fitted to. Lateral grip
is then set by its own target.

The price is a large difference between the directions at high load: at 9 kN μy is 1.84 and μx
1.07. The one lateral figure at high load (Pouhon, 5.7 g at 281 km/h) against braking peaks of
4.5–4.9 g at higher speeds points the same way, but that figure is a blog's. The other reading
of the braking data is that something besides the tyre caps the deceleration at high speed (the
drivers' pedal force, the brake system, or a floor that loses more under dive than modelled);
that would let μx keep [44]'s slope. The data here cannot separate the two; Spa and Singapore
laps with lateral data would.

The floor: logged through a constant-speed corner at 150 km/h in low trim, with the whole ClA
following the floor height the car made 74 % of its table downforce (the floor rides about
10 mm higher than at 300 km/h, at 2 % per mm). Only the floor sees that height, so the map now
applies to the floor's share (0.6); the car keeps about 85 % of its table downforce there (measured).

The cornering shape is now at both ends of the doc's own estimates: 2.15 g at 85 km/h (the
slow-corner centre) and 4.31 g at 270 km/h (above the Parabolica estimate's 3.5–4.0, inside its
tolerance). The medium-speed corners at Monza, where the lap is lost (7.6), sit between the two.

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
It produces only the `ControlInput` a player's devices produce. It drives one out-lap, saving the
MGU-K so the store is full at the line as in qualifying, then the timed lap, timed from the
**control line** (below). Measured with `npm run telemetry -- lap` (and `-- calibrate`);
asserted by `packages/ai/validation/reference-lap.test.ts` in the physics job (one lap) and by
the nightly soak (ten consecutive laps). The racing line and envelope were rebuilt for the
calibrated car (`npm run ai:build`).

| Quantity | Before | After | Target or reference |
|---|---|---|---|
| Lap | 90.137 s | **84.690 s** | 1:18.792 (+5.898 s, +7.5 %); M1 band 74.852–82.732 s: outside by 1.958 s; M4 band 76.428–81.156 s: outside by 3.534 s |
| Speed trap (412 m, 212 m before T1) | 347.3 km/h | 347.5 km/h | 348 ± 6 (median 348.3), pass |
| Control line | 308.9 km/h | 312.3 km/h | fastest 320.7 published |
| MGU-K deployed from the store / harvested | 3.08 / 1.52 MJ | 3.29 / 1.33 MJ | ≤ 4 / ≤ 2 MJ per lap |
| Track limits | at most one wheel past a white line | at most two wheel centres past a white line, never four | rule: never all four wheels beyond the edges |
| Stability | sideslip ≤ 4.4°, no spin | sideslip ≤ 5.7°, no spin | |
| Ten consecutive laps (34 kg start, getting lighter) | 90.281–90.509 s, spread 0.228 s | 85.112–85.504 s, spread 0.392 s, all clean, sideslip ≤ 6.6° | nightly soak: spread ≤ 0.5 s |

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
| S1 (5472.5 → 1609.3 m, 1930 m) | 28.922 | 27.789 | 27.481 | 26.262 | 26.181 | +1.527 (+5.8 %) |
| S2 (1609.3 → 3433.6 m, 1824 m) | 30.925 | 28.793 | 28.636 | 26.483 | 26.340 | +2.310 (+8.7 %) |
| S3 (3433.6 → 5472.5 m, 2039 m) | 30.290 | 28.108 | 27.681 | 26.047 | 26.047 | +2.061 (+7.9 %) |

| Corner | Min speed before | Min speed after | Speed profile after | Braking into it (after) | Reference minimum (2.6) |
|---|---|---|---|---|---|
| T1 Rettifilo | 63.0 | 69.4 | 69.0 | from 348 km/h, 178 m, 3.69 s to the minimum; 337→89 km/h takes 150 m, 2.73 s (published 129 m, 2.75 s) | 75–85, estimate |
| T2 Rettifilo | 62.2 | 69.9 | 72.1 | 30 m | 75–85, estimate |
| T3 Biassono | 163.8 | 181.5 | 188.4 | lift only | — |
| T4 Roggia | 95.7 | 107.6 | 103.9 | from 333 km/h, 156 m, 2.83 s (published 107 m, 2.02 s, speeds not published) | 110–120, estimate |
| T5 Roggia | 105.8 | 118.1 | 118.3 | 20 m | 115–125, estimate |
| T6 Lesmo 1 | 141.7 | 159.8 | 159.9 | from 258 km/h, 116 m, 2.10 s | 175–190, estimate |
| T7 Lesmo 2 | 139.1 | 159.7 | 159.2 | from 259 km/h, 108 m, 1.94 s | 177–184, practice [54] |
| T8 Ascari entry | 139.7 | 162.2 | 161.1 | from 344 km/h, 157 m, 2.41 s | 176–190, practice [54][55] |
| T9 Ascari | 157.7 | 184.3 | 183.9 | — | — |
| T10 Ascari exit | 183.6 | 216.0 | 216.3 | — | — |
| T11 Parabolica | 150.8 | 174.9 | 184.2 | from 336 km/h, 235 m, 3.80 s | 200–215, estimate |

**What the line asks of the car.** Per corner: the line's tightest radius, the driven minimum
speed, the lateral acceleration that speed implies on that radius, and the car's measured
sustained lateral limit at that speed on flat ground at 1 g (the envelope; printed by
`npm run telemetry -- lap`). Implied above the limit means grip the flat sweep does not show
(banking, a compression, or a minimum speed and a minimum radius that do not coincide); below it,
margin left at that corner on this line.

| Corner | Line min radius (m) | Driven min speed (km/h) | Implied lateral (g) | Measured flat limit at that speed (g) |
|---|---|---|---|---|
| T1 Rettifilo | 18.7 | 69.4 | 2.02 | 2.03 |
| T2 Rettifilo | 20.7 | 69.9 | 1.86 | 2.04 |
| T3 Biassono | 278.7 | 181.5 | 0.93 | 3.05 |
| T4 Roggia | 38.5 | 107.6 | 2.37 | 2.33 |
| T5 Roggia | 46.3 | 118.1 | 2.37 | 2.42 |
| T6 Lesmo 1 | 74.1 | 159.8 | 2.71 | 2.81 |
| T7 Lesmo 2 | 67.2 | 159.7 | 2.98 | 2.81 |
| T8 Ascari entry | 70.9 | 162.2 | 2.92 | 2.84 |
| T9 Ascari | 99.8 | 184.3 | 2.68 | 3.08 |
| T10 Ascari exit | 103.0 | 216.0 | 3.56 | 3.49 |
| T11 Parabolica | 82.3 | 174.9 | 2.93 | 2.97 |

**Track check.** The same radii against the reference minimum speeds of section 2.6: the lateral
acceleration each reference speed would need on this line's radius, the calibrated car's flat
limit at that speed, and the radius a car would need at that speed at its limit and at 3.5 g
(the top of what cars of this class pull in these corners, by the estimate this task started
from):

| Corner | Line radius (m) | Reference speed (km/h) | Needed on this radius (g) | Car's limit at that speed (g) | Radius at the car's limit (m) | Radius at 3.5 g (m) |
|---|---|---|---|---|---|---|
| T1 | 18.7 | 75–85 | 2.37–3.04 | 2.07–2.15 | 21–26 | 13–16 |
| T4 | 38.5 | 110–120 | 2.47–2.94 | 2.35–2.43 | 41–47 | 27–32 |
| T6 Lesmo 1 | 74.1 | 175–190 | 3.25–3.83 | 2.98–3.15 | 81–90 | 69–81 |
| T7 Lesmo 2 | 67.2 | 177–184 (practice) | 3.67–3.96 | 3.00–3.08 | 82–87 | 70–76 |
| T8 Ascari | 70.9 | 176–190 (practice) | 3.44–4.01 | 2.99–3.15 | 82–90 | 70–81 |
| T11 Parabolica | 82.3 | 200–215 | 3.82–4.42 | 3.27–3.47 | 96–105 | 90–104 |

At Lesmo 2 and Ascari, the two corners with sourced (practice) speeds, this line's radius needs
3.4–4.0 g at the real speeds, more than the car (3.0–3.15 g) and more than the 3.5 g a car of
this class is credited with; a car at 3.5 g would need 70–81 m, 4–20 % more than the line has.
At the Parabolica the estimate needs 3.8–4.4 g, or 9–28 % more radius. So part of what is left
is the track and line, not the car: either the OSM-derived centreline and authored widths make
these corners tighter than the real ones, or real cars take a wider line using the kerbs (which
this line does not, below). The slow chicanes (T1, T4) need less than 3.5 g on these radii, so
there the car itself is short (2.1–2.4 g). Corrections to the track data are a track-pipeline
task; nothing in `packages/track/data/monza.json` is changed here.

Plots: `docs/evidence/m1-ai/monza-low-line.png` (the line over the plan, speed as colour),
close-ups `monza-low-line-t*.png`, and `monza-low-speed.png` (target speed along the lap with the
driven lap over it), from the first version of the car (`npm run ai:plot` redraws them).

**Where the 5.9 s go.** What is measured, and what is not separated:

1. *Driving* (0.89 s): the driven lap (84.690 s) against the driver's own speed profile on the
   same line (83.799 s): 0.31 s in S1, 0.16 s in S2 and 0.43 s in S3. Most of S3's is the
   Parabolica, which the driver takes 9 km/h under its plan (174.9 against 184.2 km/h): braking
   in from 336 km/h while turning, the lightly loaded inside front locks first under the fixed
   57 % bias and the driver eases the pedal and runs wide.
2. *Planning margin* (0.97 s): the driver plans with 97 % of the lateral and traction limits and
   95 % of the braking limit; at the full measured envelope the profile on the same line is
   82.833 s.
3. *Line* (0.83 s, in the plan at the full envelope): re-optimising the line at the full envelope
   gives 82.786 s; with no margin 82.581 s (0.20 s) and with the kerbs
   allowed (flat 1.0 m, exit 1.5 m, chicane 1.0 m; another 0.58 s) the line's
   full-envelope profile is 82.005 s. In this model a kerb's leading edge (35–50 mm high within
   10–12 cm) throws the wheel load around enough to unsettle the car at the limit, so the
   reference line keeps off the kerbs.
4. *Residual* (about 3.2 s against the pole lap, 82.0 s against 78.8 s): car and track geometry
   together. The track check above puts part of it in the geometry of the medium and fast
   corners; the slow chicanes point at the car's low-speed grip. They are not separated further.

*Sensitivities* (driven lap, committed line unless noted): low-trim ClA at the top of its range
(4.2 m²) 83.525 s; μy at the top of its range (2.2) 84.184 s; both, with the line rebuilt for
that car, 82.817 s, still outside the M1 band by 0.085 s. Inside the documented ranges the band
is not reachable on this track with this driver, and nothing here forces it.

**Envelope.** Measured by driving the vehicle model (`packages/ai/src/envelope/measure.ts`, 1092 s
of driving, about 1–2 s of wall time), cached in `packages/ai/data/monza-low.envelope.json`:
constant-speed lateral sweeps at 60–340 km/h, threshold stops from above top speed, and
full-throttle runs with wheelspin held at the tyre's peak, DRS closed and open, MGU-K on and off,
each at 0.8, 1.0 and 1.2 g of normal load (gravity scaled: what a crest or compression does), and
braking in a held turn for the shape of the combined limit (exponent 1.72, from 1.80). It agrees
with the physics suite's own manoeuvres (lateral at 200 km/h within 2 %, top speed within
1 km/h; both asserted). At load 1, in g: lateral 1.97 / 2.27 / 2.61 / 3.03 / 3.54 / 4.14 / 4.88 at
60 / 100 / 140 / 180 / 220 / 260 / 300 km/h; braking (tyres alone) 1.74 / 2.16 / 2.68 / 3.14 /
3.59 at 100 / 140 / 180 / 220 / 260 km/h; traction 1.31 / 1.49 / 1.74 / 2.06 at 100 / 140 / 180 /
220 km/h; top speed 343.9 km/h with DRS closed and 353.6 km/h open.

**What flatters the car in this measurement**

- The driver plans with the measured envelope of this exact car, so the line and speeds fit the
  car better than any human's would.
- No wind, no traffic, no tyre temperature or wear model yet (the softest compound's grip is the
  tyre's one μy and one μx).

**What handicaps it**

- The driver keeps its wheels off the kerbs (above, 0.58 s in the plan) and 0.3 m inside the
  white lines (0.20 s).
- DRS on the main straight opens about 320 m later than the map allows (track file, above).
- The fixed 57 % brake bias and no ABS: braking while turning in, the lightly loaded inside front
  locks first, and the driver eases the pedal to keep it turning (the Parabolica, above). A real
  driver adjusts bias per corner.
- No downforce gain from the tow, and the driver never uses more than 97 % of the envelope.
- The racing line is computed on the OpenStreetMap-derived centreline and authored widths
  (track-data.md); local width or curvature errors there show up as line choices (track check,
  above).

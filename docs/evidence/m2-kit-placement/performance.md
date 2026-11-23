# Rendering observations

The table uses the predeclared control series where available. The original before/after runs, including the heavily contended Spa run, remain in `performance.json`. Values are observations on a shared laptop with a two-CPU affinity. Added geometry and host scheduling both affect these figures. Uncapped time counts frames actually drawn, rather than animation callbacks. Dynamic resolution remains enabled; raw records include its scale.

| Circuit / preset / station | Vsync fps, base → kit | Uncapped draw ms, base → kit | Calls, base → kit | Triangles M, base → kit | Textures + targets MiB, base → kit |
| --- | ---: | ---: | ---: | ---: | ---: |
| Monza / High / drive | 60.0 → 60.0 | 9.67 → 9.80 | 604 → 701 | 2.64 → 3.74 | 433.9 → 433.9 |
| Monza / High / grid | 60.0 → 60.0 | 8.16 → 11.33 | 1,043 → 1,246 | 5.18 → 9.84 | 433.9 → 433.9 |
| Monza / Mobile / drive | 60.0 → 60.0 | 3.24 → 4.40 | 240 → 351 | 0.69 → 1.25 | 138.6 → 133.2 |
| Monza / Mobile / grid | 60.0 → 60.0 | 4.02 → 6.17 | 375 → 518 | 1.48 → 2.23 | 150.1 → 144.8 |
| Spa / High / drive | 60.0 → 59.7 | 14.57 → 14.01 | 700 → 830 | 2.84 → 3.18 | 409.6 → 414.9 |
| Spa / High / grid | 60.0 → 59.6 | 8.59 → 9.92 | 866 → 947 | 4.48 → 5.66 | 409.6 → 414.9 |
| Spa / Mobile / drive | 60.0 → 60.0 | 5.25 → 6.26 | 284 → 423 | 0.62 → 0.91 | 139.1 → 133.8 |
| Spa / Mobile / grid | 60.0 → 60.0 | 4.22 → 5.49 | 310 → 366 | 1.20 → 1.47 | 144.0 → 138.7 |
| Singapore / High / drive | 60.0 → 60.0 | 6.52 → 6.40 | 484 → 516 | 1.13 → 1.24 | 385.1 → 385.1 |
| Singapore / High / grid | 60.0 → 60.0 | 5.74 → 7.19 | 411 → 456 | 1.56 → 2.60 | 385.1 → 385.1 |
| Singapore / Mobile / drive | 60.0 → 60.0 | 3.40 → 4.68 | 242 → 275 | 0.54 → 0.61 | 126.3 → 115.9 |
| Singapore / Mobile / grid | 60.0 → 60.0 | 3.16 → 12.40 | 277 → 323 | 0.86 → 1.01 | 137.9 → 132.5 |

High: 1920×1080. Mobile: 844×390, emulated DPR 3. Grid: last slot, nineteen cars ahead. Transfer inventory and loading-pass costs:

| Circuit | High MiB | Mobile MiB | High prop warm ms | Mobile prop warm ms |
| --- | ---: | ---: | ---: | ---: |
| Monza | 10.35 | 4.15 | 1290 | 621 |
| Spa | 10.95 | 4.18 | 1366 | 652 |
| Singapore | 9.81 | 4.17 | 707 | 334 |

The transfer limit remains 25 MiB. Loading-time work is deliberately paid before driving. The loading pass draws every registered level once to a one-pixel target, with one instance and frustum culling disabled, then restores all state and disposes the target. The tests cover normal and failing restoration; the GPU station runs check the resulting shaders and frames.

![Uncapped grid frame times](performance.svg)

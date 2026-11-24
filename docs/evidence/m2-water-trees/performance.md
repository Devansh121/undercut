# Water and mid-distance trees: frames and performance

Frames: each image is master (bfcd3f5, top) over this branch (0b6f57c, bottom), at the screenshot stations (`npm run shots`, RTX 4050 laptop, real GPU), 1440×900 and 844×390. `sg-day` is Singapore with `tod=monza-afternoon`, `sg-night` its floodlit night. `bay-tv` is the station across the bay; on master the bay is the old flat dark sheet.

Performance: `npm run shots -- <circuit> --no-shots --perf`, run in the order master, branch, branch, master per circuit, under the GPU lock on a shared host (1-minute load at the end of each run between 2.4 and 15.8). High is 1920×1080, Mobile 844×390 at an emulated DPR 3 with dynamic resolution on. Grid: the last slot with nineteen cars ahead; drive: the autopilot. Singapore runs at its default floodlit night with the bay in view of the grid. Each cell lists the runs in order, master → branch. Raw numbers in `performance.json`.

| Circuit / preset / run | Vsync fps, 1 % low (master → branch) | Uncapped drawn ms | Draw calls | Triangles M | Texture + target MiB |
| --- | --- | --- | --- | --- | --- |
| Monza / High / grid | 60/59.4, 60/58.5 → 60/59.3, 60/58.6 | 9.94, 11.07 → 11.69, 11.66 | 1,055 → 1,055 | 5.18 → 5.19 | 433.9 → 437.9 |
| Monza / High / drive | 60/59.1, 60/57.2 → 60/58, 60/57.2 | 9.53, 10.75 → 11.71, 11.61 | 738 → 745 | 3.14 → 3.23 | 433.9 → 437.9 |
| Monza / Mobile / grid | 60/59.2, 60/57.9 → 60/53.3, 60/58 | 4.08, 2.67 → 2.73, 2.74 | 384 → 384 | 1.48 → 1.48 | 144.8 → 151.1 |
| Monza / Mobile / drive | 60/58.9, 60/57.8 → 60/57.7, 60/58.2 | 3.74, 2.57 → 2.71, 2.63 | 304 → 312 | 0.88 → 0.94 | 133.2 → 139.6 |
| Spa / High / grid | 60/58.7, 60/59.4 → 60/57.6, 60/58.7 | 11.76, 11.51 → 11.41, 11.91 | 878 → 878 | 4.49 → 4.51 | 414.9 → 413.6 |
| Spa / High / drive | 60/55.7, 60/57.7 → 60/58.8, 60/59.1 | 14.39, 14.12 → 14.27, 14.35 | 784 → 732 | 3.92 → 3.90 | 414.9 → 413.6 |
| Spa / Mobile / grid | 60/55.5, 60/58.1 → 60/57.5, 60/56 | 2.6, 2.56 → 4.24, 2.94 | 317 → 317 | 1.20 → 1.20 | 138.7 → 139.7 |
| Spa / Mobile / drive | 60/58, 60/58.9 → 60/57.6, 60/58 | 3.18, 3.48 → 4.22, 3.54 | 288 → 288 | 1.05 → 1.05 | 127.1 → 128.1 |
| Singapore / High / grid | 60/59.5, 60/58.5 → 60/59.4, 59.9/45.4 | 9.07, 6.87 → 7.15, 6.86 | 411 → 606 | 1.56 → 2.18 | 385.1 → 400.7 |
| Singapore / High / drive | 60/58.4, 60/54.7 → 60/57.1, 60/50.7 | 4.98, 6.26 → 5.84, 6.55 | 158 → 243 | 0.48 → 0.79 | 385.1 → 400.7 |
| Singapore / Mobile / grid | 60/58.7, 60/58.7 → 60/59.3, 60/49.5 | 2.73, 3.66 → 3.16, 3.46 | 277 → 311 | 0.86 → 0.98 | 132.5 → 139.9 |
| Singapore / Mobile / drive | 60/57.9, 60/53.9 → 60/56.7, 60/45.5 | 3.23, 3.96 → 3.95, 4.15 | 121 → 132 | 0.35 → 0.40 | 120.9 → 128 |

- Every run of both builds holds 60 fps with vsync. The 1 % lows follow host load: the second branch run at Singapore (45.4 on the High grid, 49.5 on the Mobile grid) ended at load 9.4, the first at 4.8 (59.4 and 59.3).
- Monza and Spa: draw calls and triangles change by under 0.1 M. The relief now reaches 300 m on Mobile (was 180 m) at no measurable cost.
- Singapore: the reflection pass costs 195 draw calls and 0.6 M triangles on High at the grid (it reflects the circuit, ground and trees as well as the skyline) and 34 calls on Mobile (skyline only, quarter-size target). Uncapped frame times are level with master within the host's spread.

Texture memory (`renderStats().textureMiB`, now counting the textures only the compiled shaders hold: `userData.surfaceUniforms`). The column moves by up to 5 MiB between runs of the same build (master reads 132.5 and 137.9 MiB at Singapore Mobile at the same render scale), so the added textures are also listed as computed from their sizes:

| Texture | High | Mobile |
| --- | --- | --- |
| Relief atlas (half the colour atlas, RGBA8 with mips) | 1024×768, 4.0 MiB | 512×384, 1.0 MiB |
| Wave slope map (RGBA8 with mips) | 256², 0.33 MiB | 128², 0.08 MiB |
| Reflection target (RGBA16F and depth, Singapore only) | half the drawing buffer: 960×540, 5.9 MiB | a quarter: 422×195 at DPR 2, 0.9 MiB |
| Added at Monza and Spa | 4.3 MiB | 1.1 MiB |
| Added at Singapore | 10.2 MiB | 2.0 MiB |

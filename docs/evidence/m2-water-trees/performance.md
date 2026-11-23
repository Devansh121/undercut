# Water and mid-distance trees: frames and performance

Frames: each image is master (851a39d, top) over this branch (bottom), at the screenshot stations (`npm run shots`, RTX 4050 laptop, real GPU), 1440×900 and 844×390. `sg-day` is Singapore with `tod=monza-afternoon`, `sg-night` its floodlit night. `bay-tv` is the new station across the bay; on master the bay is the old flat dark sheet.

Performance: `npm run shots -- <circuit> --no-shots --perf`, master 851a39d against this branch, one build after the other under the GPU lock on a shared host (load 13 to 26 during the Singapore pair). High is 1920×1080, Mobile 844×390 at an emulated DPR 3 (dynamic resolution on). Grid: the last slot with nineteen cars ahead; drive: the autopilot. Singapore runs at its default floodlit night with the water in view of the grid. Each cell is master → branch. Raw numbers in `performance.json`.

| Circuit / preset / run | Vsync fps, 1 % low | Uncapped drawn ms | Draw calls | Triangles M | GPU ms (uncapped) |
| --- | --- | --- | --- | --- | --- |
| Monza / High / grid | 60, 58.3 → 60, 59.2 | 11.23 → 10.6 | 1,055 → 1,055 | 5.18 → 5.19 | 7.63 → 7.17 |
| Monza / High / drive | 60, 57.6 → 60, 55.2 | 11.09 → 10.74 | 749 → 746 | 3.18 → 3.14 | 6.71 → 8.08 |
| Monza / Mobile / grid | 60, 58.1 → 60, 59.4 | 2.98 → 3 | 384 → 384 | 1.48 → 1.48 | 4.75 → 1.75 |
| Monza / Mobile / drive | 60, 58 → 60, 56.3 | 2.5 → 2.8 | 312 → 312 | 0.93 → 0.93 | 1.37 → 2.13 |
| Spa / High / grid | 59.7, 40.1 → 60, 58.1 | 10.4 → 11.77 | 878 → 878 | 4.49 → 4.51 | 7.28 → 8.01 |
| Spa / High / drive | 59.4, 35.3 → 60, 58.2 | 14.6 → 14.42 | 732 → 732 | 3.88 → 3.89 | 8.42 → 6.4 |
| Spa / Mobile / grid | 60, 44.9 → 60, 56 | 5.09 → 2.8 | 317 → 317 | 1.20 → 1.20 | 3.71 → 1.61 |
| Spa / Mobile / drive | 60, 46.1 → 60, 58.1 | 6.41 → 3.19 | 287 → 302 | 1.05 → 1.14 | 1.67 → 1.39 |
| Singapore / High / grid | 60, 58.7 → 59.9, 43.4 | 7.65 → 6.4 | 411 → 601 | 1.56 → 2.05 | 6.05 → 6.41 |
| Singapore / High / drive | 60, 58.5 → 60, 51.2 | 4.87 → 5.71 | 157 → 240 | 0.48 → 0.76 | 3.8 → 5.94 |
| Singapore / Mobile / grid | 60, 59.3 → 60, 57.8 | 2.93 → 2.82 | 277 → 302 | 0.86 → 0.87 | 1.74 → 1.72 |
| Singapore / Mobile / drive | 60, 59.1 → 60, 59 | 3.35 → 3.59 | 119 → 130 | 0.35 → 0.35 | 0.87 → 0.99 |

- Monza and Spa: draw calls and triangles unchanged within 0.1 M (the relief cards replace the plain cards in the 220–300 m band on High, 120–180 m on Mobile). Every run holds 60 fps with vsync. Uncapped differences are within the host's run-to-run spread (Spa master's own 1 % lows were 35 to 46 fps in its run).
- Singapore: the reflection pass costs 190 draw calls and 0.5 M triangles on High at the grid (it draws the circuit, ground and trees as well as the skyline) and 25 calls on Mobile (sky and skyline only, a quarter-size target). Both presets hold 60 fps with vsync; High's 1 % lows were 43 and 51 fps against master's 59 in the same pair, at host load 19 to 26.
- The first branch measurement drew 52 to 54 fps on Singapore High (uncapped 13.8 ms driving): the reflection's nested render updated every world matrix a second time. It now skips that (the frame's own render has just done it): uncapped 5.7 ms driving and 6.4 ms at the grid, against master's 4.9 and 7.7.

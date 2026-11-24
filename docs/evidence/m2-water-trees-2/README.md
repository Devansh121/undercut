# Water and trees review follow-up

The night bay frames compare the unfiltered facade from merged PR 71 with the filtered facade on this branch, at the `bay-tv` station. Captured on the real GPU under the shared GPU lock, with the floodlit night sky. The 844×390 viewport uses DPR 3; the files preserve the original drawing size. WebP copies use quality 90; original PNGs are in `/home/devansh/.cache/undercut/scratch/m2-water-trees/bay-sw/` and `bay-final/`.

| Viewport | Before | After |
| --- | --- | --- |
| 1440×900 | [Before](bay-tv-1440x900-before.webp) | [After](bay-tv-1440x900-after.webp) |
| 844×390 | [Before](bay-tv-844x390-before.webp) | [After](bay-tv-844x390-after.webp) |

The facade shader averages both the window coverage and the random shutter and lighting decisions as their screen-space footprints become too small. Night lighting is grouped in six-bay floor sections before those sections also fade to their average. The reflection uses the same shader and averages sooner at its lower resolution.

Validation: build and transfer budgets, lint and typecheck passed; the 20 street/water unit tests passed; all three desktop world-dressing browser tests passed (51.6 s). Those browser tests inspect the flags on the actual scene objects, including the environment, mapped buildings, stands, pit building, ground, all three tree kinds, track, bridges, street furniture and backdrops. Unit assertions also check the street and backdrop prop kinds at their builders.

The tree-swap check holds the renderer's animation time at zero as well as freezing the simulation. The simulation freeze alone leaves camera shake, wind and waves advancing on real time, moving the camera and silhouettes between the compared states. Real frame time still settles the camera, lamp pool and exposure; every normal render pass runs. Each pose settles for 90 frames, then averages 12 captures per state in interleaved order. The tolerance remains 0.10.

# Water and trees review follow-up

The night bay frames compare the unfiltered facade from merged PR 71 with the filtered facade on this branch, at the `bay-tv` station. Captured on the real GPU under the shared GPU lock, with the floodlit night sky. The 844×390 viewport uses DPR 3; the files preserve the original drawing size. WebP copies use quality 90; original PNGs are in `/home/devansh/.cache/undercut/scratch/m2-water-trees/bay-sw/` and `bay-final/`.

| Viewport | Before | After |
| --- | --- | --- |
| 1440×900 | [Before](bay-tv-1440x900-before.webp) | [After](bay-tv-1440x900-after.webp) |
| 844×390 | [Before](bay-tv-844x390-before.webp) | [After](bay-tv-844x390-after.webp) |

The facade shader averages both the window coverage and the random shutter and lighting decisions as their screen-space footprints become too small. Night lighting is grouped in six-bay floor sections before those sections also fade to their average. The reflection uses the same shader and averages sooner at its lower resolution.

Validation: build and transfer budgets, lint and typecheck passed; the 20 street/water unit tests passed; all three desktop world-dressing browser tests passed (51.6 s). Those browser tests inspect the flags on the actual scene objects, including the environment, mapped buildings, stands, pit building, ground, all three tree kinds, track, bridges, street furniture and backdrops. Unit assertions also check the street and backdrop prop kinds at their builders.

The tree-swap check holds the renderer's animation time at zero as well as freezing the simulation. The simulation freeze alone leaves camera shake, wind and waves advancing on real time, moving the camera and silhouettes between the compared states. Real frame time still settles the camera, lamp pool and exposure; every normal render pass runs. Each pose settles for 90 frames, then averages 12 captures per state in interleaved order. The tolerance remains 0.10.


## Review corrections

The near conifer models are widened by 35 % in the horizontal plane and use linear colour scale 0.65. Owned copies preserve the shared catalogue meshes, tree height and triangle count. Three runs at every station on all three circuits pass the unchanged 0.10 tolerance; [full ranges are in STATUS](../../STATUS.md#decided-for-you--water-and-trees-review-follow-up) and [all nine raw reports are retained](tree-swap-r2.json). The reports retain the checkout HEAD at capture time: the first eight runs measured the production correction before it was committed; the last Singapore run measured the committed implementation.

The new unit regression builds the real High-world tree paths and instantiates the registry's meshes. A small dressing fixture and stand-in catalogue geometry keep this structural test below the existing timeout; real models are checked by the GPU runs. The test requires near cloud trees and both kit conifer kinds, checks nonzero instance counts and checks every near mesh's production reflection flag.

Each flag-removal mutation fails independently:

```text
Cloud flag removed (exit 1):
AssertionError: prop:tree-wood-near: expected null to be 'scenery'

Kit flag removed (exit 1):
AssertionError: prop:tree-conifer-near-forest-spruce: expected null to be 'scenery'
```

Full output: [cloud mutation](mutation-cloud.txt), [kit mutation](mutation-kit.txt). Both production flags were restored before the successful 57-test focused rendering run (6 files). Build/transfer budgets, typecheck and lint pass.

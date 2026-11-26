# Credits

Code in this repository is MIT licensed (see `LICENSE`). Third-party code and assets keep their own licences.

## Third-party code shipped in the client

| Project | Package | Licence | Use |
| --- | --- | --- | --- |
| [three.js](https://github.com/mrdoob/three.js) | `three` | MIT | 3D rendering, bundled into the game's scripts |
| [SMAA](https://github.com/iryoku/smaa) area and search textures (embedded in three.js's `SMAAPass`) | (in `three`) | MIT, Copyright (C) 2013 Jorge Jimenez, Jose I. Echevarria, Belen Masia, Fernando Navarro, Diego Gutierrez | Anti-aliasing in the post-processing pipeline; bundled into the game's scripts |
| [Draco](https://github.com/google/draco) decoder (`draco_decoder.wasm`, `draco_wasm_wrapper.js`, as shipped in three.js's `examples/jsm/libs/draco/gltf/`) | (in `three`) | Apache-2.0 | Decoding the compressed models; served from the game's own origin at /assets/draco/ |

The build writes `licences.txt` at the site root (`apps/web/licences.ts`) with the full licence text of everything above, the fonts and the circuit data, because minifying drops the licence comments from the bundled code. The Apache-2.0 text it uses is the canonical copy in `apps/web/licences/Apache-2.0.txt`; SMAA's MIT text, with its copyright lines, is copied verbatim from upstream into `apps/web/licences/SMAA-MIT.txt`.

The rooms server (`services/rooms`) bundles no third-party code.

## Tools used to build, run and test (not shipped)

npm packages named in a `package.json`; their own dependencies are checked against `tools/ci/dependency-licences.json` by `npm run check:credits`.

| Project | Package | Licence |
| --- | --- | --- |
| [TypeScript](https://github.com/microsoft/TypeScript) | `typescript` | Apache-2.0 |
| [Vite](https://github.com/vitejs/vite) | `vite` | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) | `vitest` | MIT |
| [Playwright](https://github.com/microsoft/playwright) | `@playwright/test` | Apache-2.0 |
| [Wrangler](https://github.com/cloudflare/workers-sdk) and [workerd](https://github.com/cloudflare/workerd) | `wrangler` | MIT or Apache-2.0; Apache-2.0 |
| [Workers types](https://github.com/cloudflare/workerd) | `@cloudflare/workers-types` | MIT or Apache-2.0 |
| [ESLint](https://github.com/eslint/eslint) | `eslint`, `@eslint/js` | MIT |
| [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) | `typescript-eslint` | MIT |
| [globals](https://github.com/sindresorhus/globals) | `globals` | MIT |
| [Prettier](https://github.com/prettier/prettier) | `prettier` | MIT |
| [ws](https://github.com/websockets/ws) | `ws` | MIT |
| [selfsigned](https://github.com/jfromaniello/selfsigned) | `selfsigned` | MIT |
| [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) type definitions | `@types/node`, `@types/ws`, `@types/three` | MIT |

Two licences among those packages' own dependencies are not permissive; neither is shipped: [Lightning CSS](https://github.com/parcel-bundler/lightningcss) (MPL-2.0, Vite's CSS minifier, used unmodified) and the libvips binaries in [sharp](https://github.com/lovell/sharp)'s optional prebuilt packages (LGPL-3.0-or-later, pulled in by Wrangler's local runtime).

Programs run outside npm:

| Project | Licence | Use |
| --- | --- | --- |
| [Blender](https://www.blender.org/) 5.2 LTS | GPL-2.0-or-later | Building the car and prop models (`tools/car/`, `tools/props/`) |
| [NumPy](https://numpy.org/) | BSD-3-Clause | Procedural textures and texture processing in the Python tools |
| [Pillow](https://python-pillow.org/) | MIT-CMU | Image reading and writing in `tools/assets/build_textures.py` |
| [fontTools](https://github.com/fonttools/fonttools) | MIT | Repackaging the Archivo font as WOFF2 |
| [FFmpeg](https://ffmpeg.org/) | LGPL-2.1-or-later (GPL builds: GPL-2.0-or-later) | Encoding audio renders, screenshots and evidence images |
| [gitleaks](https://github.com/gitleaks/gitleaks) (CI only) | MIT | Secret scan |

## Track and circuit dressing data

The circuit files in `packages/track/data/` and `packages/render/data/` are databases derived from open geodata, and the racing lines in `packages/ai/data/` (`*.line.json`) are computed along them; all are offered under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/), not the MIT licence. The full notices are in [`packages/track/data/LICENSE-DATA.md`](packages/track/data/LICENSE-DATA.md), [`packages/render/data/LICENSE-DATA.md`](packages/render/data/LICENSE-DATA.md) and [`packages/ai/data/LICENSE-DATA.md`](packages/ai/data/LICENSE-DATA.md). The game shows the OpenStreetMap and Copernicus credit on its launch screen. OpenStreetMap feature names are not kept in the dressing data (many name real drivers, teams, sponsors or shops), except the two the renderer reads.

Images of the circuits in `docs/evidence/` (plans, profiles, screenshots) are produced works from this data: © OpenStreetMap contributors; heights from Copernicus WorldDEM-30.

| Source | Use | Licence |
| --- | --- | --- |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Centrelines, pit lanes, mapped gravel and barriers; surrounding woods, trees, meadows, service roads, grandstands, paddock buildings, bridges and historic banking | Open Database License 1.0 |
| [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/) | Heights along the track and surrounding terrain grid | Licence for the use of the Copernicus WorldDEM-30 |

© OpenStreetMap contributors. The data is available under the Open Database License, see https://www.openstreetmap.org/copyright.

Heights produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30.

| Circuit file | OpenStreetMap relation and pit-lane way | Copernicus GLO-30 tile |
| --- | --- | --- |
| `monza.json` | [284565](https://www.openstreetmap.org/relation/284565), way 38168747 | N45 E009 |
| `spa.json` | [284560](https://www.openstreetmap.org/relation/284560), way 323851541 | N50 E005 |
| `singapore.json` | [421263](https://www.openstreetmap.org/relation/421263), way 100484287 | N01 E103 |

Timing-line positions were measured on the FIA's published 2025 circuit maps; the maps are not redistributed.

## Assets

Every third-party asset is listed in [`assets/MANIFEST.json`](assets/MANIFEST.json) with its file, source URL, author, licence, changes and sha256.

### Fonts

| Family | Files | Source | Licence |
| --- | --- | --- | --- |
| Archivo (variable, weight 100–900, width 62–125%) | `design/mock/fonts/Archivo-Variable.woff2` | [Omnibus-Type/Archivo](https://github.com/Omnibus-Type/Archivo) | SIL Open Font License 1.1, full text in `design/mock/fonts/Archivo-OFL.txt` |
| Barlow Semi Condensed (Medium, SemiBold, Bold) | `design/mock/fonts/BarlowSemiCondensed-*.woff2` | [jpt/barlow](https://github.com/jpt/barlow) | SIL Open Font License 1.1, full text in `design/mock/fonts/Barlow-OFL.txt` |

Archivo: Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo). This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is copied in the file named above, and is also available with a FAQ at: http://scripts.sil.org/OFL. The variable TTF was repackaged as WOFF2 without changes to glyphs, metrics or names.

Barlow: Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow). This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is copied in the file named above, and is also available with a FAQ at: http://scripts.sil.org/OFL. The WOFF2 files are unchanged from upstream.

### Environment textures and skies

Built by `npm run assets:build` (`tools/assets/build_textures.py`): resized and re-encoded as WebP, skies with the sun measured and painted out. Every file is in `assets/MANIFEST.json` with its source URL and sha256. All CC0 1.0; credit is not required and is given anyway.

| Asset | Used for | Author | Source |
| --- | --- | --- | --- |
| Asphalt Track | Racing surface, painted lines | Dimitrios Savva, Poly Haven | https://polyhaven.com/a/asphalt_track |
| Asphalt Pit Lane | Run-off asphalt, pit lane | Dimitrios Savva, Poly Haven | https://polyhaven.com/a/asphalt_pit_lane |
| Concrete Floor Worn 001 | Kerbs, concrete walls | Dimitrios Savva and Rico Cilliers, Poly Haven | https://polyhaven.com/a/concrete_floor_worn_001 |
| Gravel Stones | Gravel traps | Amal Kumar, Poly Haven | https://polyhaven.com/a/gravel_stones |
| Metal Plate | Armco | Rob Tuytel, Poly Haven | https://polyhaven.com/a/metal_plate |
| Grass001 | Grass, verges, terrain | Lennart Demes, ambientCG | https://ambientcg.com/view?id=Grass001 |
| Rubber004 | Tyre walls | Lennart Demes, ambientCG | https://ambientcg.com/view?id=Rubber004 |
| Kloofendal 48d Partly Cloudy (Pure Sky) | Monza afternoon sky and light | Greg Zaal and Jarod Guest, Poly Haven | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky |
| Overcast Soil (Pure Sky) | Overcast time of day (Spa), CC0 | Sergej Majboroda and Jarod Guest, Poly Haven | https://polyhaven.com/a/overcast_soil_puresky |
| Kloppenheim 07 (Pure Sky) | Night time of day | Greg Zaal and Jarod Guest, Poly Haven | https://polyhaven.com/a/kloppenheim_07_puresky |

Created using Grass001 and Rubber004 from ambientCG.com, licensed under the Creative Commons CC0 1.0 Universal License.

The texture index the game reads, `apps/web/public/assets/index.json`, is written by the same script and is under the repository's MIT licence.

### Car

The car (`apps/web/public/assets/car/`: three GLB levels of detail, ten team livery masks and the livery index) is generated from nothing by the repository's own scripts in `tools/car/` (`npm run car:build`) and is under the same MIT licence as the code. Its textures (carbon twill, bodywork panel detail, tyre sidewall with an invented maker's mark and compound ticks, brake-disc glow) are drawn procedurally; no third-party image or model is used. The build runs [Blender](https://www.blender.org/) 5.2 LTS (GPL-2.0-or-later) as a tool; Blender is not shipped. The studio lighting in the committed Blender reference renders is Poly Haven's `studio_small_09` HDRI (CC0), used for lighting only and not committed.

The team car images on the main menu (`apps/web/public/assets/ui/cars/`) are renders of that car in each driver's livery, made by `tools/ui/team-cars.mjs` (`npm run ui:cars`) with the repository's car viewer, under the same MIT licence.

### Audio

Every sound in the game (engines, tyres, wind, kerbs, crowd and ambience) is synthesised at run time by `packages/audio/`; no recordings or samples are used.

## Circuit prop kit

The GLBs in `apps/web/public/assets/props/` are original scripted models by Project contributors, MIT, authored in `tools/props/props.py`: geometry, procedural surface grain and baked vertex ambient occlusion. No third-party models or textures are included. Per-file hashes and provenance are recorded in `assets/MANIFEST.json`.

The street furniture, temporary scaffold stands, generic marina facades, hill pit extension and conifer forest assets are also original scripted work by Project contributors, MIT (`tools/props/kits.py`). Their surface grain is procedural, and the conifers are needle-spray geometry with no foliage textures; no third-party source imagery. The manifest records every GLB, including its embedded textures.

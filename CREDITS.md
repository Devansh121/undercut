# Credits

Code in this repository is MIT licensed (see `LICENSE`). Third-party code and assets keep their own licences.

## Third-party code shipped in the client

| Project | Licence | Use |
| --- | --- | --- |
| [three.js](https://github.com/mrdoob/three.js) | MIT | 3D rendering |
| [Draco](https://github.com/google/draco) decoder (`draco_decoder.wasm`, `draco_wasm_wrapper.js`, as shipped in three.js's `examples/jsm/libs/draco/gltf/`) | Apache-2.0 | Decoding the car's compressed geometry; served from the game's own origin at `assets/draco/` |

## Tools used to build, run and test (not shipped)

| Project | Licence |
| --- | --- |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 |
| [Vite](https://github.com/vitejs/vite) | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) | MIT |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 |
| [Wrangler](https://github.com/cloudflare/workers-sdk) and [workerd](https://github.com/cloudflare/workerd) | MIT or Apache-2.0; Apache-2.0 |
| [ESLint](https://github.com/eslint/eslint), [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) | MIT |
| [Prettier](https://github.com/prettier/prettier) | MIT |
| [ws](https://github.com/websockets/ws) | MIT |
| [selfsigned](https://github.com/jfromaniello/selfsigned) | MIT |
| [gitleaks](https://github.com/gitleaks/gitleaks) (CI only) | MIT |

## Track data

The circuit files in `packages/track/data/` are databases derived from open geodata and are offered under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/), not the MIT licence. The full notices are in [`packages/track/data/LICENSE-DATA.md`](packages/track/data/LICENSE-DATA.md).

| Source | Use | Licence |
| --- | --- | --- |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Centrelines, pit lanes, mapped gravel and barriers | Open Database License 1.0 |
| [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/) | Heights along the track | Licence for the use of the Copernicus WorldDEM-30 |

© OpenStreetMap contributors. The data is available under the Open Database License, see https://www.openstreetmap.org/copyright.

Heights produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

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
| Kloofendal Overcast (Pure Sky) | Overcast time of day | Greg Zaal, Poly Haven | https://polyhaven.com/a/kloofendal_overcast_puresky |
| Kloppenheim 07 (Pure Sky) | Night time of day | Greg Zaal and Jarod Guest, Poly Haven | https://polyhaven.com/a/kloppenheim_07_puresky |

Created using Grass001 and Rubber004 from ambientCG.com, licensed under the Creative Commons CC0 1.0 Universal License.

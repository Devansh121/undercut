# Credits

Code in this repository is MIT licensed (see `LICENSE`). Third-party code and assets keep their own licences.

## Third-party code shipped in the client

| Project | Licence | Use |
| --- | --- | --- |
| [three.js](https://github.com/mrdoob/three.js) | MIT | 3D rendering |

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

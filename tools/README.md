# Tools

| Folder | What it is |
| --- | --- |
| `serve/` | The local server behind `./start.sh` and `npm run dev`: static client, `/rooms` proxy, self-signed HTTPS, address listing |
| `budget/` | Bundle and asset budget check run after `npm run build`; thresholds in `budget.config.json` |
| `assets/` | Asset licence check against `assets/MANIFEST.json`; allowed licences in `licences.json` |
| `ci/` | Name checks and the gitleaks secret scan |
| `telemetry/` | Telemetry runner (M1) |
| `stations/` | Screenshot stations (M2) |
| `pipeline/` | Asset pipeline (M1–M2) |

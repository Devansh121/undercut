# Tools

| Folder | What it is |
| --- | --- |
| `serve/` | The local server behind `./start.sh` and `npm run dev`: static client, `/rooms` proxy, self-signed HTTPS, address listing |
| `budget/` | Bundle and asset budget check run after `npm run build`; thresholds in `budget.config.json` |
| `assets/` | Asset licence check against `assets/MANIFEST.json`; allowed licences in `licences.json` |
| `ci/` | Name checks and the gitleaks secret scan |
| `telemetry/` | Telemetry runner: validation manoeuvres, benchmark, and the reference driver's `lap` |
| `ai/` | Racing-line build (`npm run ai:build`, `-- --check` for staleness) and the line plot (`npm run ai:plot -- monza`) |
| `stations/` | Screenshot stations (M2) |
| `pipeline/` | Asset pipeline (M1–M2) |
| `research/` | OpenStreetMap and elevation survey scripts behind `docs/track-data.md` (Python, standard library) |

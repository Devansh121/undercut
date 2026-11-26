// Conservative integration ceiling: existing first race plus every new LOD, plus both skies.
import fs from 'node:fs';
import { format, resolveConfig } from 'prettier';
const catalog = JSON.parse(fs.readFileSync('packages/render/data/props.catalog.json'));
const first = JSON.parse(fs.readFileSync('apps/web/dist/first-race.json'));
const index = JSON.parse(fs.readFileSync('apps/web/public/assets/index.json'));
const kit = catalog.props.filter((p) =>
  /^(street-|floodlight-|lighting-|temporary-|marina-|hill-|forest-)/.test(p.id),
);
const bytes = kit.flatMap((p) => p.lods).reduce((n, l) => n + l.bytes, 0);
const skies = ['overcast_soil', 'night'].flatMap((id) =>
  ['hi', 'lo'].map((tier) => index.skies[id][tier]),
);
const skyBytes = [...new Set(skies)].reduce(
  (n, file) => n + fs.statSync('apps/web/public/assets/' + file).size,
  0,
);
const results = Object.fromEntries(
  ['high', 'mobile'].map((preset) => {
    const ceiling = first.presets[preset].total + bytes + skyBytes;
    if (ceiling > 25 * 1024 * 1024) throw new Error(`${preset} integration ceiling exceeds 25 MiB`);
    return [
      preset,
      {
        existingFirstRace: first.presets[preset].total,
        allNewLods: bytes,
        bothSkiesAllTiers: skyBytes,
        ceiling,
      },
    ];
  }),
);
const report = {
  method:
    'Conservative reservation, not integrated Spa/Singapore request telemetry. Adds all twelve new props at all LODs and both circuits sky tiers to the existing Monza first race, without subtracting replaced assets.',
  results,
  props: kit.map((p) => ({
    id: p.id,
    triangles: p.lods.map((l) => l.triangles),
    bytes: p.lods.map((l) => l.bytes),
  })),
};
fs.writeFileSync(
  'docs/evidence/m2-models/kit-budget.json',
  await format(JSON.stringify(report), {
    ...(await resolveConfig('docs/evidence/m2-models/kit-budget.json')),
    parser: 'json',
  }),
);
console.log(results);

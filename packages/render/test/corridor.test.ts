import { describe, expect, it } from 'vitest';
import { Track } from '@undercut/track';
import monzaTrackJson from '@undercut/track/data/monza.json';
import spaTrackJson from '@undercut/track/data/spa.json';
import singaporeTrackJson from '@undercut/track/data/singapore.json';
import monzaDressingJson from '../data/monza.dressing.json';
import spaDressingJson from '../data/spa.dressing.json';
import singaporeDressingJson from '../data/singapore.dressing.json';
import { CORRIDOR_MARGIN, footprintOnTrack } from '../src/world/corridor';
import { bounds, inRing, type DressingFile } from '../src/world/dressing';
import { LapIndex } from '../src/world/lap-index';

const circuits = [
  ['monza', monzaTrackJson, monzaDressingJson],
  ['spa', spaTrackJson, spaDressingJson],
  ['singapore', singaporeTrackJson, singaporeDressingJson],
] as const;

describe('buildings and the drivable corridor', () => {
  for (const [id, trackJson, dressingJson] of circuits) {
    it(
      `keeps every building at ${id} out of the track, its run-off and walls`,
      { timeout: 30_000 },
      () => {
        const track = Track.fromJSON(trackJson);
        const lap = new LapIndex(track);
        const dressing = dressingJson as unknown as DressingFile;
        const kept = dressing.mapped.building.filter((f) => !footprintOnTrack(f.p, lap));
        expect(kept.length).toBeGreaterThan(0);
        // Checked without the lap index: every centreline sample against every kept footprint,
        // and every outline point (corners and mid-edges) against its nearest sample by brute force.
        const L = track.lap;
        const offenders: string[] = [];
        for (const f of kept) {
          const [x0, z0, x1, z1] = bounds(f.p);
          for (let i = 0; i < L.count; i++) {
            const x = L.x[i] as number;
            const z = L.z[i] as number;
            if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && inRing(f.p, x, z)) {
              offenders.push(`${f.id} spans the road at s ${Math.round(i * L.step)}`);
              break;
            }
          }
          const m = f.p.length / 2;
          for (let k = 0; k < m; k++) {
            const j = (k + 1) % m;
            for (const t of [0, 0.5]) {
              const x = (f.p[2 * k] as number) * (1 - t) + (f.p[2 * j] as number) * t;
              const z = (f.p[2 * k + 1] as number) * (1 - t) + (f.p[2 * j + 1] as number) * t;
              let best = 0;
              let bestD2 = Infinity;
              for (let i = 0; i < L.count; i++) {
                const dx = (L.x[i] as number) - x;
                const dz = (L.z[i] as number) - z;
                const d2 = dx * dx + dz * dz;
                if (d2 < bestD2) {
                  bestD2 = d2;
                  best = i;
                }
              }
              const d =
                (x - (L.x[best] as number)) * (L.nx[best] as number) +
                (z - (L.z[best] as number)) * (L.nz[best] as number);
              const barrier = Math.abs(track.barrier[d >= 0 ? 0 : 1][best] as number);
              if (Math.sqrt(bestD2) <= barrier + CORRIDOR_MARGIN - 0.01)
                offenders.push(
                  `${f.id} reaches into the corridor at s ${Math.round(best * L.step)}`,
                );
            }
          }
        }
        expect(offenders).toEqual([]);
      },
    );
  }

  it('drops the two Singapore buildings mapped across the road (s 1234 and 1366)', () => {
    const track = Track.fromJSON(singaporeTrackJson);
    const lap = new LapIndex(track);
    const dressing = singaporeDressingJson as unknown as DressingFile;
    for (const id of ['w/393090492', 'w/303311927']) {
      const f = dressing.mapped.building.find((b) => b.id === id);
      expect(f, id).toBeDefined();
      expect(footprintOnTrack(f!.p, lap), id).toBe(true);
    }
  });
});

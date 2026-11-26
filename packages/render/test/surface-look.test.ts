import { describe, expect, it } from 'vitest';
import indexJson from '../../../apps/web/public/assets/index.json';
import { MONZA_AFTERNOON, OVERCAST_DAY } from '../src/lighting/time-of-day';
import { GRASS, GRASS_COLOUR, GRASS_MOWING } from '../src/track-view';

const index = indexJson as {
  files: Record<string, number>;
  skies: Record<string, { hi: string; lo: string; sun: { present: boolean } }>;
};

describe('grass', () => {
  it('varies by clumps, clover and thin patches without leaving lawn colours', () => {
    expect(GRASS.clump[0]).toBeGreaterThanOrEqual(0.8);
    expect(GRASS.clump[1]).toBeLessThanOrEqual(1.15);
    for (const [lo, hi] of [GRASS.clump, GRASS.tuft]) expect(lo).toBeLessThan(hi);
    expect(GRASS.tuft[1] - GRASS.tuft[0]).toBeLessThan(GRASS.clump[1] - GRASS.clump[0]);
    // Clover is a deeper, bluer green: red down most, green kept most.
    const [cr, cg, cb] = GRASS.clover.tint;
    expect(cr).toBeLessThan(cb);
    expect(cg).toBeGreaterThan(cr);
    // Thin patches show straw: warmer, never bluer.
    const [tr, , tb] = GRASS.thin.tint;
    expect(tr).toBeGreaterThan(1);
    expect(tb).toBeLessThan(1);
    for (const cover of [GRASS.clover.cover, GRASS.thin.cover]) {
      expect(cover).toBeGreaterThan(0);
      expect(cover).toBeLessThan(0.35);
    }
    expect(GRASS_COLOUR).toContain('macroFine.a');
  });

  it('mows the verges in deck-wide bands that stay subtle and fade before they alias', () => {
    expect(GRASS.mowWidth).toBeGreaterThanOrEqual(2);
    expect(GRASS.mowWidth).toBeLessThanOrEqual(4);
    // Worst case light band against dark band: a visible stripe, not a painted one.
    const peak = GRASS.mowBase + GRASS.mowSheen;
    expect(peak).toBeGreaterThan(0.05);
    expect((1 + peak) / (1 - peak)).toBeLessThan(1.3);
    // Antialiased edge and a fade on the band's screen size.
    expect(GRASS_MOWING).toContain('fwidth(bandX)');
    expect(GRASS_MOWING).toMatch(/smoothstep\([^)]*fw\)/);
    // Bands follow the track edge (lateral coordinate), not the world axes.
    expect(GRASS_MOWING).toContain(`vSurfUv.x / ${GRASS.mowWidth.toFixed(2)}`);
  });
});

describe('overcast sky', () => {
  it('uses a built sky with cloud structure and no sun to paint out', () => {
    const sky = index.skies[OVERCAST_DAY.sky];
    expect(sky).toBeDefined();
    expect(OVERCAST_DAY.sky).toBe('overcast_soil');
    expect(sky?.sun.present).toBe(false);
    for (const tier of ['hi', 'lo'] as const)
      expect(index.files[sky?.[tier] ?? '']).toBeGreaterThan(0);
  });

  it('keeps the cloud deck low on the horizon and the far hills out of a grey wall', () => {
    // The clear afternoon keeps its milky horizon; the deck shows its structure.
    expect(OVERCAST_DAY.skyHaze).toBeLessThan(MONZA_AFTERNOON.skyHaze);
    expect(OVERCAST_DAY.skyHaze).toBeGreaterThan(0.2);
    // Haze at 300 m (camera height) under a quarter, at 2 km still well short of a wall.
    expect(1 - Math.exp(-OVERCAST_DAY.fogDensity * 300)).toBeLessThan(0.2);
    expect(1 - Math.exp(-OVERCAST_DAY.fogDensity * 2000)).toBeLessThan(0.75);
    expect(1 - Math.exp(-OVERCAST_DAY.fogDensity * 2000)).toBeGreaterThan(0.4);
  });
});

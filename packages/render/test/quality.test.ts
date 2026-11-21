import { describe, expect, it } from 'vitest';
import presets from '../src/presets.json';
import { QUALITY, QUALITY_NAMES, benchmarkPick, effectiveQuality } from '../src/quality';

describe('quality presets', () => {
  it('every preset is complete and ordered by cost', () => {
    for (const n of QUALITY_NAMES) {
      const q = QUALITY[n];
      expect(q.name).toBe(n);
      expect(q.carLods.length).toBe(q.carLodPixels.length + 1);
      expect(q.carLods).toContain(q.playerLod === 'high' ? 'high' : q.playerLod);
      if (!q.post) {
        // Lite: every post effect has its fallback (none of them run).
        expect(q.ao.enabled || q.bloom.enabled || q.smaa || q.msaa > 0).toBe(false);
      }
    }
    expect(QUALITY.ultra.shadow.mapSize).toBeGreaterThanOrEqual(QUALITY.high.shadow.mapSize);
    expect(QUALITY.high.shadow.cascades).toBeGreaterThan(QUALITY.mobile.shadow.cascades);
    expect(
      Object.keys(presets)
        .filter((k) => !k.startsWith('$'))
        .sort(),
    ).toEqual([...QUALITY_NAMES].sort());
  });
});

describe('benchmarkPick', () => {
  it('keeps the preset when a vsync-capped frame time says only "holds 60"', () => {
    expect(benchmarkPick('high', { gpuMs: null, frameMs: 16.7 }, false)).toBe('high');
  });
  it('steps down when frames are long', () => {
    expect(benchmarkPick('high', { gpuMs: null, frameMs: 30 }, false)).toBe('mobile');
    expect(benchmarkPick('high', { gpuMs: null, frameMs: 21 }, false)).toBe('medium');
  });
  it('uses GPU time to step up when there is headroom', () => {
    expect(benchmarkPick('high', { gpuMs: 6, frameMs: 16.7 }, false)).toBe('ultra');
    expect(benchmarkPick('high', { gpuMs: 12, frameMs: 16.7 }, false)).toBe('high');
  });
  it('never picks Ultra or High on a touch device', () => {
    expect(benchmarkPick('mobile', { gpuMs: 2, frameMs: 16.7 }, true)).toBe('medium');
  });
});

describe('effectiveQuality (what the GPU can actually do)', () => {
  it('keeps the preset when half-float targets render', () => {
    expect(effectiveQuality(QUALITY.high, { floatTargets: true })).toBe(QUALITY.high);
  });

  it('without renderable float targets drops to the direct path: no HDR target, no post, no PMREM', () => {
    for (const name of QUALITY_NAMES) {
      const q = effectiveQuality(QUALITY[name], { floatTargets: false });
      expect(q.post).toBe(false);
      expect(q.msaa).toBe(0);
      expect(q.smaa || q.ao.enabled || q.bloom.enabled || q.speedBlur || q.grainVignette).toBe(
        false,
      );
      expect(q.envSize).toBe(0);
      // Everything else (shadows, textures, car levels) is kept.
      expect(q.shadow).toEqual(QUALITY[name].shadow);
      expect(q.textureTier).toBe(QUALITY[name].textureTier);
      expect(q.name).toBe(name);
    }
  });
});

describe('film grain', () => {
  it('is a per-preset amount, subtle, and off wherever grain and vignette are off', () => {
    for (const name of QUALITY_NAMES) {
      const q = QUALITY[name];
      expect(q.grain).toBeLessThanOrEqual(0.005);
      if (!q.grainVignette) expect(q.grain).toBe(0);
    }
  });
});

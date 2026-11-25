import { describe, expect, it } from 'vitest';
import { buildMinimap } from '../src/game/minimap';
import { loadMonza } from './fixtures';

describe('buildMinimap', () => {
  const track = loadMonza();
  const plan = buildMinimap(track, 208, 150, 8);

  it('draws a closed path that stays inside the padded box', () => {
    expect(plan.path.startsWith('M')).toBe(true);
    expect(plan.path.endsWith('Z')).toBe(true);
    const nums = plan.path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThanOrEqual(7.9);
      expect(nums[i]).toBeLessThanOrEqual(200.1);
      expect(nums[i + 1]).toBeGreaterThanOrEqual(7.9);
      expect(nums[i + 1]).toBeLessThanOrEqual(142.1);
    }
  });

  it('projects world points with east to the right and south down', () => {
    const p = track.startPose;
    const [x0, y0] = plan.project(p.x, p.z);
    const [x1] = plan.project(p.x + 100, p.z);
    const [, y1] = plan.project(p.x, p.z + 100);
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBeGreaterThan(y0);
  });

  it('builds one open SVG path per marshalling sector within the padded box', () => {
    const withSectors = buildMinimap(track, 208, 150, 8, 6, 12);
    expect(withSectors.sectorPaths).toHaveLength(12);
    for (const seg of withSectors.sectorPaths) {
      expect(seg.startsWith('M')).toBe(true);
      expect(seg.endsWith('Z')).toBe(false);
      const nums = seg.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      expect(nums.length).toBeGreaterThanOrEqual(16);
      for (let i = 0; i < nums.length; i += 2) {
        expect(nums[i]).toBeGreaterThanOrEqual(7.9);
        expect(nums[i]).toBeLessThanOrEqual(200.1);
        expect(nums[i + 1]).toBeGreaterThanOrEqual(7.9);
        expect(nums[i + 1]).toBeLessThanOrEqual(142.1);
      }
    }
  });
});

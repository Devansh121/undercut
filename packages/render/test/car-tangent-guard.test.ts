import { describe, expect, it } from 'vitest';
import { patchCarShader } from '../src/car/car-shader';

// three.js derives the tangent frame for normal and anisotropy maps from UV derivatives. Where a
// triangle's UVs have no area the frame is zero, and the anisotropic environment lighting then
// normalises a zero vector: NaN, which bloom spreads over the whole image.
describe('car anisotropy survives a degenerate tangent frame', () => {
  const patch = (fragmentShader: string): string => {
    const shader = { fragmentShader, vertexShader: '', uniforms: {} } as never as Parameters<
      typeof patchCarShader
    >[0];
    patchCarShader(shader);
    return shader.fragmentShader;
  };

  it('rebuilds a zero tangent frame from the normal, right after three.js builds it', () => {
    const out = patch(
      'void main() {\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n}',
    );
    const begin = out.indexOf('#include <normal_fragment_begin>');
    const guard = out.indexOf('USE_ANISOTROPY', begin);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(begin);
    expect(guard).toBeLessThan(out.indexOf('#include <normal_fragment_maps>'));
    const block = out.slice(guard, out.indexOf('#include <normal_fragment_maps>'));
    expect(block).toMatch(/dot\(\s*tbn\[\s*0\s*\],\s*tbn\[\s*0\s*\]\s*\)/);
    expect(block).toMatch(/tbn\[\s*0\s*\]\s*=\s*normalize\(\s*cross\(/);
    expect(block).toMatch(/tbn\[\s*1\s*\]\s*=\s*cross\(\s*normal,\s*tbn\[\s*0\s*\]\s*\)/);
  });

  it('leaves shaders without the chunk untouched apart from the other car edits', () => {
    expect(patch('void main() {}')).toBe('void main() {}');
  });
});

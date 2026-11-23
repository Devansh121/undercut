import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  type InstancedMesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  type WebGLRenderer,
} from 'three';
import { PropRegistry } from '../src/props/registry';
import { warmPropLevels } from '../src/world/warm-props';
import { crowdMaterial, crowdSwapMaterial } from '../src/world/crowd';
import { Vector3, type WebGLProgramParametersWithUniforms } from 'three';

describe('loading prop levels', () => {
  it.each([false, true])('draws every level and restores state after failure=%s', (fail) => {
    const props = new PropRegistry(1000);
    const geometry = new BoxGeometry();
    const material = new MeshStandardMaterial();
    props.define({
      id: 'kit',
      lods: [20, 50, 100].map((maxDistance) => ({ geometry, material, maxDistance })),
    });
    for (let i = 0; i < 3; i++) props.place('kit', { x: i, y: 0, z: 0, s: i });
    props.build();
    props.update(new Vector3());
    const meshes = props.group.children as InstancedMesh[];
    const before = meshes.map((m) => ({
      visible: m.visible,
      count: m.count,
      cull: m.frustumCulled,
    }));
    const render = vi.fn(() => {
      expect(meshes.every((m) => m.visible && !m.frustumCulled && m.count === 1)).toBe(true);
      if (fail) throw new Error('lost context');
    });
    const renderer = {
      getRenderTarget: () => null,
      setRenderTarget: vi.fn(),
      shadowMap: { autoUpdate: true },
      render,
    };
    const draw = () =>
      warmPropLevels(
        renderer as unknown as WebGLRenderer,
        new Scene(),
        new PerspectiveCamera(),
        props,
      );
    if (fail) expect(draw).toThrow('lost context');
    else draw();
    expect(render).toHaveBeenCalledOnce();
    expect(
      meshes.map((m) => ({ visible: m.visible, count: m.count, cull: m.frustumCulled })),
    ).toEqual(before);
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null);
    props.dispose();
    geometry.dispose();
    material.dispose();
  });
});

describe('crowd handover', () => {
  it('shares the eye and complementary discard with the existing idle animation', () => {
    const eye = { value: new Vector3() };
    for (const near of [false, true]) {
      const material = crowdMaterial({ value: 3 });
      crowdSwapMaterial(material, eye, near);
      const shader = {
        uniforms: {},
        vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>',
        fragmentShader: '#include <common>\n#include <alphatest_fragment>',
      } as WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as WebGLRenderer);
      expect(shader.uniforms.uCrowdEye).toBe(eye);
      expect(shader.vertexShader).toContain('sin(uCrowdTime');
      expect(shader.fragmentShader).toContain(
        near ? 'crowdNoise < vCrowdFar' : 'crowdNoise >= vCrowdFar',
      );
      material.dispose();
    }
  });
});

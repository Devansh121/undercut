import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  FloatType,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  RedFormat,
  RepeatWrapping,
  type Material,
  type Texture,
} from 'three';
import {
  MESH_LOD,
  MeshSurface,
  buildTrackMeshes,
  type MeshData,
  type Track,
} from '@undercut/track';
import type { Quality } from './quality';
import { estimateRacingLine } from './racing-line';
import { fenceTexture, noiseColourTexture, noiseGreyTexture, noiseNormalTexture } from './textures';

/**
 * The circuit as three.js meshes: `buildTrackMeshes` output split by surface, each surface with
 * its own physically based material. All textures are procedural (no third-party images in M1);
 * UVs from the track package are in metres, so texture scale is a repeat per metre.
 */
export class TrackView {
  readonly group = new Group();
  private readonly materials: Material[] = [];
  private readonly textures: Texture[] = [];
  private readonly geometries: BufferGeometry[] = [];

  constructor(track: Track, quality: Quality) {
    this.group.name = 'track';
    const meshes = buildTrackMeshes(track, MESH_LOD[quality.meshLod]);
    const mat = this.buildMaterials(track, quality);
    const add = (data: MeshData, name: string, receive = true, cast = false): void => {
      for (const [surface, geometry] of splitBySurface(data)) {
        const material = mat.get(surface) ?? mat.get(MeshSurface.Asphalt);
        if (!material) continue;
        const mesh = new Mesh(geometry, material);
        mesh.name = `${name}:${surface}`;
        mesh.receiveShadow = receive;
        mesh.castShadow = cast;
        // The track is static: compute matrices once.
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.geometries.push(geometry);
        this.group.add(mesh);
      }
    };
    add(meshes.terrain, 'terrain');
    add(meshes.runoff, 'runoff');
    add(meshes.road, 'road');
    add(meshes.pit, 'pit');
    add(meshes.lines, 'lines');
    add(meshes.markings, 'markings');
    add(meshes.kerbs, 'kerbs', true, quality.sceneryShadows);
    add(meshes.barriers, 'barriers', true, quality.sceneryShadows);
  }

  private tex<T extends Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  private material(m: MeshStandardMaterial): MeshStandardMaterial {
    this.materials.push(m);
    return m;
  }

  private buildMaterials(track: Track, q: Quality): Map<number, Material> {
    const size = q.textureSize;
    const an = q.anisotropy;
    const repeat = (t: Texture, metres: number): Texture => {
      t.repeat.set(1 / metres, 1 / metres);
      return t;
    };
    const map = new Map<number, Material>();

    // Asphalt: warm grey aggregate, a fine normal map, and a rubbered racing line drawn in the
    // shader from an estimate of the line (a 1D texture of lateral offset along s).
    const asphaltMap = this.tex(
      repeat(
        noiseColourTexture(
          size,
          11,
          '#4a4846',
          '#6d6a66',
          { cells: 16, speckle: 0.06, speckleColour: '#8f8a83' },
          an,
        ),
        3,
      ),
    );
    const asphaltNormal = this.tex(repeat(noiseNormalTexture(size, 12, 64, 2.2, an), 3));
    const asphaltRough = this.tex(repeat(noiseGreyTexture(size, 13, 16, 0.78, 0.95, an), 3));
    const line = estimateRacingLine(track);
    const lineTex = this.tex(new DataTexture(line, line.length, 1, RedFormat, FloatType));
    lineTex.wrapS = RepeatWrapping;
    lineTex.magFilter = LinearFilter;
    lineTex.minFilter = LinearFilter;
    lineTex.needsUpdate = true;
    const macro = this.tex(noiseGreyTexture(256, 14, 6, 0, 1, an));
    const asphalt = this.material(
      new MeshStandardMaterial({
        color: '#ffffff',
        map: asphaltMap,
        normalMap: asphaltNormal,
        roughnessMap: asphaltRough,
        roughness: 1,
        metalness: 0,
      }),
    );
    asphalt.normalScale.set(0.6, 0.6);
    addTrackDetail(asphalt, lineTex, macro, track.length, true);
    map.set(MeshSurface.Asphalt, asphalt);

    const pit = this.material(asphalt.clone());
    addTrackDetail(pit, lineTex, macro, track.length, false);
    pit.color = new Color('#d8d5d0');
    map.set(MeshSurface.PitLane, pit);

    // Run-off asphalt: lighter, smoother, less used.
    const runoffAsphalt = this.material(
      new MeshStandardMaterial({
        map: this.tex(
          repeat(
            noiseColourTexture(size, 21, '#5d5b58', '#7c7974', { cells: 12, speckle: 0.04 }, an),
            3,
          ),
        ),
        normalMap: asphaltNormal,
        roughness: 0.9,
        metalness: 0,
      }),
    );
    runoffAsphalt.normalScale.set(0.4, 0.4);
    map.set(MeshSurface.RunoffAsphalt, runoffAsphalt);

    // Paint: white line and markings, slightly smoother than the asphalt.
    const paint = this.material(
      new MeshStandardMaterial({
        color: '#e9e6df',
        roughness: 0.62,
        metalness: 0,
        normalMap: asphaltNormal,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    paint.normalScale.set(0.3, 0.3);
    map.set(MeshSurface.Paint, paint);
    map.set(MeshSurface.Marking, paint);

    // Kerbs: red and white blocks along s, 1 m each; the raised sausage kerb yellow and black.
    const kerb = this.material(
      new MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.55,
        metalness: 0,
        normalMap: asphaltNormal,
      }),
    );
    kerb.normalScale.set(0.25, 0.25);
    addKerbStripes(kerb, '#b8241f', '#ece9e2', 2.0);
    map.set(MeshSurface.Kerb, kerb);
    const kerbHigh = this.material(
      new MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0 }),
    );
    addKerbStripes(kerbHigh, '#e2b51c', '#1d1e20', 1.2);
    map.set(MeshSurface.KerbHigh, kerbHigh);

    // Grass: parkland greens with mowing bands along the track.
    const grassMap = this.tex(
      repeat(
        noiseColourTexture(
          size,
          31,
          '#3f552d',
          '#6f7d4a',
          { cells: 10, speckle: 0.05, speckleColour: '#86905c' },
          an,
        ),
        6,
      ),
    );
    const grassNormal = this.tex(repeat(noiseNormalTexture(size, 32, 96, 3, an), 2));
    const grass = this.material(
      new MeshStandardMaterial({
        map: grassMap,
        normalMap: grassNormal,
        roughness: 0.95,
        metalness: 0,
      }),
    );
    addMowingBands(grass, 6);
    map.set(MeshSurface.Grass, grass);
    const terrain = this.material(
      new MeshStandardMaterial({
        map: this.tex(
          repeat(
            noiseColourTexture(size, 33, '#34482a', '#5f6e40', { cells: 6, speckle: 0.03 }, an),
            24,
          ),
        ),
        normalMap: grassNormal,
        roughness: 1,
        metalness: 0,
      }),
    );
    map.set(MeshSurface.Terrain, terrain);
    map.set(MeshSurface.Verge, grass);

    // Gravel: sand-coloured stones, rough, with a strong fine normal.
    const gravel = this.material(
      new MeshStandardMaterial({
        map: this.tex(
          repeat(
            noiseColourTexture(
              size,
              41,
              '#a08e6c',
              '#cdbd99',
              { cells: 48, octaves: 3, speckle: 0.25, speckleColour: '#e3d7bd', contrast: 2.2 },
              an,
            ),
            2,
          ),
        ),
        normalMap: this.tex(repeat(noiseNormalTexture(size, 42, 128, 5, an), 2)),
        roughness: 1,
        metalness: 0,
      }),
    );
    map.set(MeshSurface.Gravel, gravel);

    // Barriers.
    map.set(
      MeshSurface.Armco,
      this.material(
        new MeshStandardMaterial({
          color: '#b4b9bd',
          metalness: 0.85,
          roughness: 0.38,
          roughnessMap: this.tex(repeat(noiseGreyTexture(size, 51, 24, 0.7, 1, an), 2)),
        }),
      ),
    );
    map.set(
      MeshSurface.Concrete,
      this.material(
        new MeshStandardMaterial({
          map: this.tex(
            repeat(
              noiseColourTexture(size, 52, '#9c9a94', '#c6c3bb', { cells: 12, speckle: 0.03 }, an),
              3,
            ),
          ),
          roughness: 0.92,
          metalness: 0,
        }),
      ),
    );
    map.set(
      MeshSurface.Tyres,
      this.material(
        new MeshStandardMaterial({
          map: this.tex(
            repeat(noiseColourTexture(size, 53, '#121314', '#2a2b2d', { cells: 32 }, an), 1),
          ),
          roughness: 0.9,
          metalness: 0,
        }),
      ),
    );
    const fence = this.tex(fenceTexture(an));
    fence.repeat.set(1 / 0.06, 1 / 0.06);
    map.set(
      MeshSurface.Fence,
      this.material(
        new MeshStandardMaterial({
          map: fence,
          alphaTest: 0.5,
          transparent: false,
          side: DoubleSide,
          metalness: 0.6,
          roughness: 0.5,
        }),
      ),
    );
    return map;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}

/** Split one MeshData into a geometry per surface id (by each triangle's first vertex). */
function splitBySurface(data: MeshData): Map<number, BufferGeometry> {
  const groups = new Map<number, number[]>();
  const idx = data.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] as number;
    const surface = data.surface[a] as number;
    let list = groups.get(surface);
    if (!list) groups.set(surface, (list = []));
    list.push(a, idx[t + 1] as number, idx[t + 2] as number);
  }
  const out = new Map<number, BufferGeometry>();
  for (const [surface, list] of groups) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new BufferAttribute(data.normals, 3));
    g.setAttribute('uv', new BufferAttribute(data.uvs, 2));
    g.setIndex(new BufferAttribute(Uint32Array.from(list), 1));
    g.computeBoundingSphere();
    out.set(surface, g);
  }
  return out;
}

/** Shader chunk that passes the raw track UV (metres: u across, v along s) to the fragment. */
function passTrackUv(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vTrackUv;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTrackUv = uv;');
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    '#include <common>\nvarying vec2 vTrackUv;',
  );
}

/**
 * Asphalt detail: large patches of older and newer surface, and the rubbered line (darker and a
 * little less rough) where the racing line runs, faded out toward its edges.
 */
function addTrackDetail(
  material: MeshStandardMaterial,
  line: DataTexture,
  macro: Texture,
  length: number,
  rubber: boolean,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLine = { value: line };
    shader.uniforms.uMacro = { value: macro };
    shader.uniforms.uLength = { value: length };
    shader.uniforms.uRubber = { value: rubber ? 1 : 0 };
    passTrackUv(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uLine;\nuniform sampler2D uMacro;\nuniform float uLength;\nuniform float uRubber;\nfloat trackRubber;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float lineD = texture2D(uLine, vec2(vTrackUv.y / uLength, 0.5)).r;
          float dist = abs(vTrackUv.x - lineD);
          float wobble = texture2D(uMacro, vTrackUv * vec2(0.08, 0.004)).r;
          trackRubber = uRubber * (1.0 - smoothstep(0.5, 1.7 + wobble, dist)) * (0.55 + 0.45 * wobble);
          float patch = texture2D(uMacro, vTrackUv * 0.012).r;
          diffuseColor.rgb *= mix(0.86, 1.08, patch);
          diffuseColor.rgb *= 1.0 - 0.38 * trackRubber;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor - 0.12 * trackRubber, 0.0, 1.0);',
      );
  };
  material.customProgramCacheKey = () => `track-detail-${rubber ? 1 : 0}`;
}

/** Alternating stripe colours along s, `period` metres per block. */
function addKerbStripes(
  material: MeshStandardMaterial,
  a: string,
  b: string,
  period: number,
): void {
  const ca = new Color(a);
  const cb = new Color(b);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uKerbA = { value: ca };
    shader.uniforms.uKerbB = { value: cb };
    shader.uniforms.uKerbPeriod = { value: period };
    passTrackUv(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uKerbA;\nuniform vec3 uKerbB;\nuniform float uKerbPeriod;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float x = vTrackUv.y / uKerbPeriod;
          float w = fwidth(x) + 0.01;
          // Square wave with antialiased edges at a quarter and three quarters of the period.
          float stripe = clamp((0.25 - abs(fract(x) - 0.5)) / w + 0.5, 0.0, 1.0);
          diffuseColor.rgb *= mix(uKerbA, uKerbB, stripe);
        }`,
      );
  };
  material.customProgramCacheKey = () => `kerb-${a}-${b}-${period}`;
}

/** Mowing bands: alternate light and dark grass every `period` metres along s. */
function addMowingBands(material: MeshStandardMaterial, period: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMowPeriod = { value: period };
    passTrackUv(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uMowPeriod;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float band = step(0.5, fract(vTrackUv.y / uMowPeriod));
          diffuseColor.rgb *= mix(0.9, 1.06, band);
        }`,
      );
  };
  material.customProgramCacheKey = () => `mow-${period}`;
}

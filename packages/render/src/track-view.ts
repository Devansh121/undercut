import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector2,
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
import {
  LINE_RANGE,
  lapTexture,
  macroNoise,
  surfaceMaterial,
  type PbrSet,
} from './materials/surface';
import type { Quality } from './quality';
import { estimateRacingLine } from './racing-line';
import { fenceTexture } from './textures';

/** The texture sets a circuit's surfaces use (ids in assets/index.json). */
export const TRACK_TEXTURE_IDS = [
  'asphalt',
  'asphalt_worn',
  'concrete',
  'grass',
  'gravel',
  'metal',
  'rubber',
] as const;
export type TrackTextureId = (typeof TRACK_TEXTURE_IDS)[number];

export interface TrackViewOptions {
  track: Track;
  quality: Quality;
  sets: Readonly<Record<TrackTextureId, PbrSet>>;
  /** Racing-line lateral offset per lap sample (m), e.g. from the AI's line; estimated if absent. */
  racingLine?: ArrayLike<number> | null;
  /** Draw the track package's own ground grid (false when the circuit's world brings terrain). */
  terrain?: boolean;
}

/**
 * How the grass varies between the texture's grain and the large lush-to-dry patches, and how the
 * verges are mown. Multipliers on linear albedo; widths in metres.
 */
export const GRASS = Object.freeze({
  /** Darkest and lightest clump, about two metres across. */
  clump: [0.8, 1.14] as const,
  /** Darkest and lightest tuft, about half a metre across. */
  tuft: [0.9, 1.07] as const,
  /** Clover and weeds: deeper, bluer green, and how much of the lawn they cover (0–1). */
  clover: { tint: [0.8, 0.93, 0.9] as const, cover: 0.22 },
  /** Thin, dry patches where straw shows, and their cover (0–1). */
  thin: { tint: [1.14, 1.06, 0.8] as const, cover: 0.14 },
  /** Mowing: band width (one pass of a ride-on deck), m. */
  mowWidth: 3.2,
  /** Albedo difference between the two directions of cut, seen across the lay of the blades. */
  mowBase: 0.04,
  /** Extra brightness seen along the lay (blades leaning away), darker against it. */
  mowSheen: 0.085,
});

const v3 = (c: readonly number[]): string => `vec3(${c.map((x) => x.toFixed(3)).join(', ')})`;

/** Metre-scale variation of the sward (inside GRASS_COLOUR's block; uses `macro`, `macroFine`). */
const GRASS_SWARD = `
        diffuseColor.rgb *= mix(${GRASS.clump[0].toFixed(3)}, ${GRASS.clump[1].toFixed(3)}, macroFine.a);
        diffuseColor.rgb *= mix(${GRASS.tuft[0].toFixed(3)}, ${GRASS.tuft[1].toFixed(3)}, texture2D(uMacro, macroUv * 0.23 + 0.71).a);
        float clover = smoothstep(${(1 - GRASS.clover.cover).toFixed(3)} - 0.12, ${(1 - GRASS.clover.cover).toFixed(3)} + 0.08, macroFine.r * 0.65 + macro.b * 0.35);
        diffuseColor.rgb *= mix(vec3(1.0), ${v3(GRASS.clover.tint)}, clover);
        float thin = smoothstep(${(1 - GRASS.thin.cover).toFixed(3)} - 0.1, ${(1 - GRASS.thin.cover).toFixed(3)} + 0.08, macroFine.g * 0.45 + macro.g * 0.55);
        diffuseColor.rgb *= mix(vec3(1.0), ${v3(GRASS.thin.tint)}, thin * (1.0 - clover));`;

/**
 * Mowing stripes on the circuit's own grass (track UVs: u is d across, v is s along the lap):
 * bands parallel to the track edge, cut in alternate directions. A band whose blades lean away
 * from the eye shows their lit sides and reads lighter, one leaning toward it darker, so the
 * stripes swap as the camera turns, as they do on a real lawn. The band edge is antialiased and
 * the stripes fade out where a band shrinks toward a pixel.
 */
export const GRASS_MOWING = `
      {
        float bandX = vSurfUv.x / ${GRASS.mowWidth.toFixed(2)};
        float fw = fwidth(bandX);
        float tri = abs(fract(bandX) - 0.5) * 4.0 - 1.0;
        float cut = clamp(tri / max(2.0 * fw, 1e-4), -1.0, 1.0);
        float keep = 1.0 - smoothstep(0.12, 0.45, fw);
        // Direction of increasing s on the surface (gradient of v, cotangent frame).
        vec3 dpx = dFdx(vSurfWorld);
        vec3 dpy = dFdy(vSurfWorld);
        vec3 sn = cross(dpx, dpy);
        vec3 along = cross(dpy, sn) * dFdx(vSurfUv.y) + cross(sn, dpx) * dFdy(vSurfUv.y);
        vec2 eye = cameraPosition.xz - vSurfWorld.xz;
        float lay = dot(along.xz, eye) / max(length(along.xz) * length(eye), 1e-6);
        diffuseColor.rgb *= 1.0 + cut * keep * (${GRASS.mowBase.toFixed(3)} + ${GRASS.mowSheen.toFixed(3)} * lay);
      }`;

/**
 * Grass colour variation (shader chunk for the surface material): a coarser sample of the same
 * texture faded in with distance so the tile never repeats toward the horizon, lush-to-dry
 * patches. Shared with the world's ground so the verges and the land match.
 */
export const GRASS_COLOUR = `
      {
        float far = smoothstep(12.0, 60.0, length(vSurfWorld - cameraPosition));
        vec3 coarse = texture2D(map, vMapUv * 0.21 + 0.13).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, coarse * diffuseColor.a, far * 0.6);
        vec3 lush = vec3(0.84, 0.86, 0.66);
        vec3 dry = vec3(1.12, 1.0, 0.72);
        diffuseColor.rgb *= mix(lush, dry, smoothstep(0.25, 0.88, macro.r)) * mix(0.8, 1.1, macro.g);
        // Metre-scale sward: clumps a shade darker or lighter, clover and weed patches (deeper,
        // bluer green) and thin, dry patches (straw showing), so the lawn is not one even green
        // between the texture's 1.4 m grain and the 20 m lush-to-dry patches.
        ${GRASS_SWARD}
      }`;

const MAX_GRID = 24;
/** Linear gain on the asphalt set's colour (see buildMaterials). */
const ASPHALT_GAIN = [4.9, 5.4, 5.9] as const;

/**
 * The circuit as three.js meshes: `buildTrackMeshes` output split by surface, each surface with a
 * physically based material over a real texture set (docs/asset-survey.md), plus what wear puts
 * on a circuit: a rubbered racing line and marbles off it in the corners, dust toward the
 * unused edges, oil and launch marks on the grid, worn paint and rubber on the kerbs. Track UVs
 * are in metres (u = d across, v = s along the lap), so texture scale is the set's real size.
 */
export class TrackView {
  readonly group = new Group();
  private readonly materials: Material[] = [];
  private readonly textures: Texture[] = [];
  private readonly geometries: BufferGeometry[] = [];
  /** The drivable meshes' data (road, lines, kerbs, run-off, pit, markings), for the world's ground. */
  readonly drivable: readonly MeshData[];

  constructor(options: TrackViewOptions) {
    const { track, quality } = options;
    this.group.name = 'track';
    // In the water's reflection where the preset reflects the circuit (world/water.ts).
    this.group.userData.reflect = 'scenery';
    const meshes = buildTrackMeshes(track, MESH_LOD[quality.meshLod]);
    const mat = this.buildMaterials(options);
    const add = (data: MeshData, name: string, receive = true, cast = false): void => {
      for (const [surface, geometry] of splitBySurface(data)) {
        const material = mat.get(surface) ?? mat.get(MeshSurface.Asphalt);
        if (!material) continue;
        const mesh = new Mesh(geometry, material);
        mesh.name = `${name}:${surface}`;
        mesh.receiveShadow = receive;
        mesh.castShadow = cast;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.geometries.push(geometry);
        this.group.add(mesh);
      }
    };
    this.drivable = [
      meshes.road,
      meshes.lines,
      meshes.kerbs,
      meshes.runoff,
      meshes.pit,
      meshes.markings,
    ];
    if (options.terrain !== false) add(meshes.terrain, 'terrain');
    add(meshes.runoff, 'runoff');
    add(meshes.road, 'road');
    add(meshes.pit, 'pit');
    add(meshes.lines, 'lines');
    add(meshes.markings, 'markings');
    add(meshes.kerbs, 'kerbs', true, quality.sceneryShadows);
    add(meshes.barriers, 'barriers', true, quality.sceneryShadows);
  }

  private keep<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private buildMaterials({ track, sets, racingLine }: TrackViewOptions): Map<number, Material> {
    const map = new Map<number, Material>();
    const macro = macroNoise();
    this.textures.push(macro);

    // Lap lookup: racing line and corner strength (curvature smoothed over ±30 m, so the marble
    // zone covers entry to exit).
    const n = track.lap.count;
    const line = racingLine && racingLine.length === n ? racingLine : estimateRacingLine(track);
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) raw[i] = track.curvatureAt(i * track.lap.step);
    const reach = Math.round(30 / track.lap.step);
    const curv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -reach; k <= reach; k++) acc += Math.abs(raw[(i + k + n) % n] as number);
      curv[i] = acc / (2 * reach + 1);
    }
    const lap = lapTexture(line, curv);
    this.textures.push(lap);
    const grid = Array.from({ length: MAX_GRID }, (_, i) => {
      const g = track.gridSlots[i];
      return g ? new Vector2(g.s, g.d) : new Vector2(-1e6, 0);
    });
    let gs0 = Infinity;
    let gs1 = -Infinity;
    for (const g of track.gridSlots) {
      gs0 = Math.min(gs0, g.s - 12);
      gs1 = Math.max(gs1, g.s + 12);
    }

    // Asphalt.
    const asphalt = this.keep(
      surfaceMaterial(
        sets.asphalt,
        macro,
        {
          key: 'asphalt',
          uniforms: {
            uLap: { value: lap },
            uLength: { value: track.length },
            uGrid: { value: grid },
            uGridCount: { value: Math.min(MAX_GRID, track.gridSlots.length) },
            uGridRange: { value: new Vector2(gs0, gs1) },
          },
          pars: `
          uniform sampler2D uLap;
          uniform float uLength;
          uniform vec2 uGrid[${MAX_GRID}];
          uniform int uGridCount;
          uniform vec2 uGridRange;
          float trackRubber;
          float trackOil;`,
          colour: `
          {
            vec4 lapS = texture2D(uLap, vec2(vSurfUv.y / uLength, 0.5));
            float lineD = (lapS.r * 2.0 - 1.0) * ${LINE_RANGE.toFixed(1)};
            float corner = lapS.g;
            float dist = abs(vSurfUv.x - lineD);
            // Rubber: darker and a touch smoother along the line, widest where cars brake.
            float band = 1.0 - smoothstep(0.3, 1.3 + 0.7 * macroFine.r + 0.6 * corner, dist);
            trackRubber = band * (0.55 + 0.45 * macro.g);
            // Dust on the unused width away from the line.
            float dust = smoothstep(2.2, 5.5, dist) * (0.4 + 0.6 * macro.b);
            // Marbles: rubber crumbs off line in the corners.
            float crumbs = smoothstep(0.62, 0.9, texture2D(uMacro, vSurfUv * 0.53).b);
            float marbles = crumbs * smoothstep(2.0, 3.2, dist) * (1.0 - smoothstep(6.0, 8.5, dist)) * smoothstep(0.08, 0.4, corner);
            // Older and newer surface in large irregular patches.
            diffuseColor.rgb *= mix(0.88, 1.08, macro.r) * mix(0.96, 1.03, macroFine.g);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.14 + 0.012, dust * 0.55);
            diffuseColor.rgb *= 1.0 - 0.4 * trackRubber;
            diffuseColor.rgb *= 1.0 - 0.55 * marbles;
            // Grid: oil under each car and launch marks ahead of the rear wheels.
            trackOil = 0.0;
            if (vSurfUv.y > uGridRange.x && vSurfUv.y < uGridRange.y) {
              for (int i = 0; i < ${MAX_GRID}; i++) {
                if (i >= uGridCount) break;
                vec2 q = vec2(vSurfUv.y - uGrid[i].x, vSurfUv.x - uGrid[i].y);
                float r = length((q + vec2(0.6, 0.0)) * vec2(0.55, 1.1));
                trackOil = max(trackOil, (1.0 - smoothstep(0.15, 0.75 + 0.5 * macroFine.g, r)) * (0.45 + 0.55 * macroFine.b));
                float ahead = smoothstep(-2.0, -1.6, q.x) * (1.0 - smoothstep(1.5, 7.0, q.x));
                float wheel = 1.0 - smoothstep(0.12, 0.22, abs(abs(q.y) - 0.78));
                trackOil = max(trackOil, ahead * wheel * 0.7 * (0.6 + 0.4 * macroFine.r));
              }
            }
            diffuseColor.rgb *= 1.0 - 0.5 * trackOil;
          }`,
          roughness: `
          roughnessFactor *= mix(1.0, 0.8, trackRubber);
          roughnessFactor = mix(roughnessFactor, 0.45, trackOil * 0.6);`,
        },
        { aoMapIntensity: 0.6 },
      ),
    );
    // The scanned set is fresh black tarmac (albedo 0.015); a used circuit surface is a light,
    // aggregate-rich grey around 0.08. Scale in linear light, nudged from warm toward neutral.
    asphalt.color.setRGB(ASPHALT_GAIN[0], ASPHALT_GAIN[1], ASPHALT_GAIN[2]);
    asphalt.normalScale.set(0.9, 0.9);
    map.set(MeshSurface.Asphalt, asphalt);

    // Pit lane and run-off asphalt: the worn set, no racing line.
    const worn = (key: string, tint: string): MeshStandardMaterial => {
      const m = this.keep(
        surfaceMaterial(sets.asphalt_worn, macro, {
          key,
          colour: `diffuseColor.rgb *= mix(0.9, 1.06, macro.r) * mix(0.95, 1.03, macroFine.g);`,
        }),
      );
      m.color = new Color(tint).multiplyScalar(1.9);
      return m;
    };
    map.set(MeshSurface.PitLane, worn('pit', '#d9d6d0'));
    map.set(MeshSurface.RunoffAsphalt, worn('runoff', '#e4e1db'));

    // Paint: white lines and markings over the asphalt grain, worn through in places.
    const paint = this.keep(
      surfaceMaterial(
        sets.asphalt,
        macro,
        {
          key: 'paint',
          antiTile: false,
          pars: 'float paintWear;',
          colour: `
          {
            float grain = dot(diffuseColor.rgb, vec3(0.33));
            paintWear = smoothstep(0.66, 0.9, macroFine.g * 0.7 + grain * 0.9 + macro.b * 0.25);
            vec3 paintCol = vec3(0.80, 0.795, 0.77) * mix(0.92, 1.0, macro.r);
            diffuseColor.rgb = mix(paintCol, diffuseColor.rgb, paintWear * 0.85);
          }`,
          roughness: 'roughnessFactor = mix(0.5, roughnessFactor, paintWear);',
        },
        { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 },
      ),
    );
    paint.color.setRGB(ASPHALT_GAIN[0], ASPHALT_GAIN[1], ASPHALT_GAIN[2]);
    paint.normalScale.set(0.45, 0.45);
    map.set(MeshSurface.Paint, paint);
    map.set(MeshSurface.Marking, paint);

    // Kerbs: painted concrete in 1 m red and white blocks along s, with chipped paint and rubber
    // streaks; the raised sausage kerb yellow and black.
    const kerb = (key: string, a: string, b: string, period: number): MeshStandardMaterial =>
      this.keep(
        surfaceMaterial(sets.concrete, macro, {
          key,
          uniforms: {
            uKerbA: { value: new Color(a) },
            uKerbB: { value: new Color(b) },
            uKerbPeriod: { value: period },
          },
          pars: 'uniform vec3 uKerbA; uniform vec3 uKerbB; uniform float uKerbPeriod; float kerbPaint;',
          colour: `
          {
            float x = vSurfUv.y / uKerbPeriod;
            float w = fwidth(x) + 0.01;
            float stripe = clamp((0.25 - abs(fract(x) - 0.5)) / w + 0.5, 0.0, 1.0);
            vec3 paintCol = mix(uKerbA, uKerbB, stripe);
            float chip = smoothstep(0.68, 0.82, macroFine.b * 0.6 + texture2D(uMacro, vSurfUv * 0.9).b * 0.6);
            kerbPaint = 1.0 - chip;
            vec3 concrete = diffuseColor.rgb;
            diffuseColor.rgb = mix(concrete * 0.9, paintCol * mix(0.9, 1.0, macroFine.r), kerbPaint);
            float streak = smoothstep(0.55, 0.85, texture2D(uMacro, vec2(vSurfUv.x * 0.9, vSurfUv.y * 0.015)).g);
            diffuseColor.rgb *= 1.0 - 0.45 * streak * (0.5 + 0.5 * macro.g);
          }`,
          roughness: 'roughnessFactor = mix(roughnessFactor, 0.48, kerbPaint);',
        }),
      );
    map.set(MeshSurface.Kerb, kerb('kerb', '#a8221d', '#e6e3dc', 2.0));
    map.set(MeshSurface.KerbHigh, kerb('kerb-high', '#d9ab1a', '#1b1c1e', 1.2));

    // Grass: real grass, its colour broken by noise at three scales, and a coarser sample of the
    // same texture faded in with distance so the tile never repeats visibly toward the horizon.
    // The verges are mown in stripes along the track; the land beyond is not.
    const grassColour = GRASS_COLOUR;
    const grass = this.keep(
      surfaceMaterial(
        sets.grass,
        macro,
        { key: 'grass', colour: grassColour + GRASS_MOWING },
        { aoMapIntensity: 1 },
      ),
    );
    map.set(MeshSurface.Grass, grass);
    map.set(MeshSurface.Verge, grass);
    const terrain = this.keep(
      surfaceMaterial(
        sets.grass,
        macro,
        { key: 'terrain', colour: grassColour + 'diffuseColor.rgb *= 0.92;', worldMacro: true },
        { aoMapIntensity: 1 },
      ),
    );
    map.set(MeshSurface.Terrain, terrain);

    const gravel = this.keep(
      surfaceMaterial(sets.gravel, macro, {
        key: 'gravel',
        colour: 'diffuseColor.rgb *= vec3(1.06, 1.0, 0.9) * mix(0.9, 1.08, macro.r);',
      }),
    );
    map.set(MeshSurface.Gravel, gravel);

    // Barriers: galvanised Armco (grey zinc over the plate's normals), concrete, tyre stacks.
    const armco = this.keep(
      surfaceMaterial(sets.metal, macro, {
        key: 'armco',
        antiTile: false,
        colour: `
          float zinc = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          diffuseColor.rgb = vec3(0.56, 0.58, 0.6) * mix(0.8, 1.1, zinc * 2.0) * mix(0.9, 1.05, macroFine.r);`,
        roughness: 'roughnessFactor = clamp(roughnessFactor * 0.9 + 0.12, 0.2, 0.8);',
      }),
    );
    map.set(MeshSurface.Armco, armco);
    map.set(
      MeshSurface.Concrete,
      this.keep(
        surfaceMaterial(sets.concrete, macro, {
          key: 'concrete',
          colour: 'diffuseColor.rgb *= mix(0.9, 1.06, macro.r);',
        }),
      ),
    );
    const tyres = this.keep(
      surfaceMaterial(sets.rubber, macro, {
        key: 'tyres',
        antiTile: false,
        colour: 'diffuseColor.rgb *= 0.35;',
      }),
    );
    map.set(MeshSurface.Tyres, tyres);

    const fence = fenceTexture(sets.metal.map.anisotropy);
    this.textures.push(fence);
    fence.repeat.set(1 / 0.06, 1 / 0.06);
    map.set(
      MeshSurface.Fence,
      this.keep(
        new MeshStandardMaterial({
          map: fence,
          alphaTest: 0.5,
          alphaToCoverage: true,
          transparent: false,
          side: DoubleSide,
          metalness: 0.7,
          roughness: 0.45,
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
  const position = new BufferAttribute(data.positions, 3);
  const normal = new BufferAttribute(data.normals, 3);
  const uv = new BufferAttribute(data.uvs, 2);
  for (const [surface, list] of groups) {
    const g = new BufferGeometry();
    g.setAttribute('position', position);
    g.setAttribute('normal', normal);
    g.setAttribute('uv', uv);
    g.setIndex(new BufferAttribute(Uint32Array.from(list), 1));
    g.computeBoundingSphere();
    out.set(surface, g);
  }
  return out;
}

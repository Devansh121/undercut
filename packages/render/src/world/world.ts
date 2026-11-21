import {
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Texture,
  type BufferGeometry,
} from 'three';
import type { MeshData, Track } from '@undercut/track';
import { macroNoise, surfaceMaterial, type PbrSet } from '../materials/surface';
import type { PropRegistry } from '../props/registry';
import type { Quality } from '../quality';
import { buildBuildings, facadeMaterial } from './buildings';
import { buildCoverMap, type CoverMap } from './cover';
import { crowdMaterial, spectatorGeometry, CLOTHING } from './crowd';
import {
  decodeTerrain,
  hash01,
  inRing,
  bounds,
  type DressingFile,
  type MappedFeature,
} from './dressing';
import { buildStands, crowdSeats, fitStand, type StandFrame } from './grandstands';
import { LapIndex } from './lap-index';
import { buildTerrain, TERRAIN_HIGH, TERRAIN_MOBILE } from './terrain';
import { treeAtlas } from './tree-atlas';
import { treeCards, treeMaterials, type TreeMaterials } from './trees';

/** What a preset draws of the world (presets.json, `world`). */
export interface WorldQuality {
  /** Fraction of the full tree density placed (1 on High). */
  treeDensity: number;
  /** Atlas pixels per species. */
  treeTile: number;
  /** Fine terrain cells near the circuit ('high' 10 m, 'mobile' 24 m). */
  terrain: 'high' | 'mobile';
  wind: boolean;
  /** Fraction of seats with a spectator. */
  crowd: number;
  /** Ground cover raster resolution, m per pixel. */
  coverResolution: number;
  /** Tree cards drawn near / far (m from the chunk centre). */
  treeNear: number;
  treeFar: number;
}

export interface CircuitWorldOptions {
  track: Track;
  dressing: DressingFile;
  quality: Quality;
  /** The track's drivable meshes, for lowering the ground under them. */
  drivable: readonly MeshData[];
  grass: PbrSet;
  /** Shared grass colour shader chunk of the track view, so the verges and the land match. */
  grassColour: string;
  props: PropRegistry;
}

/** Trees per square metre of woodland at full density (about one per 42 m²). */
const WOOD_DENSITY = 1 / 42;
/** Clear ground between the barrier and the first trees, m. */
const TREE_CLEARANCE = 9;

/**
 * The place around the circuit, built from its dressing file: ground to the horizon with the
 * map's ground cover, the woods, tree rows and single trees as instanced impostors, every mapped
 * building, the grandstands fitted to their footprints with a crowd in them. Circuit-agnostic:
 * everything here comes from the dressing file and the track.
 */
export class CircuitWorld {
  readonly group = new Group();
  readonly heightAt: (x: number, z: number) => number;
  readonly stands: StandFrame[] = [];
  readonly counts: Record<string, number> = {};
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly textures: Texture[] = [];
  private readonly cover: CoverMap;
  private readonly trees: TreeMaterials[] = [];
  private readonly crowdTime = { value: 0 };
  private readonly lap: LapIndex;

  constructor(o: CircuitWorldOptions) {
    const { track, dressing, quality } = o;
    const wq = quality.world;
    this.group.name = 'world';
    this.lap = new LapIndex(track);
    const grid = decodeTerrain(dressing.terrain);

    // Ground.
    const terrain = buildTerrain(
      track,
      grid,
      this.lap,
      o.drivable,
      wq.terrain === 'high' ? TERRAIN_HIGH : TERRAIN_MOBILE,
    );
    this.heightAt = terrain.heightAt;
    const lapBox = bounds(
      Array.from({ length: track.lap.count * 2 }, (_, i) =>
        i % 2 === 0 ? (track.lap.x[i >> 1] as number) : (track.lap.z[i >> 1] as number),
      ),
    );
    const r = dressing.radius + 50;
    this.cover = buildCoverMap(
      dressing,
      { x0: lapBox[0] - r, z0: lapBox[1] - r, x1: lapBox[2] + r, z1: lapBox[3] + r },
      wq.coverResolution,
    );
    this.textures.push(this.cover.texture);
    const macro = macroNoise();
    this.textures.push(macro);
    const ground = surfaceMaterial(
      o.grass,
      macro,
      {
        key: 'world-ground',
        worldMacro: true,
        uniforms: {
          uCover: { value: this.cover.texture },
          uCoverT: { value: this.cover.transform },
        },
        pars: 'uniform sampler2D uCover; uniform vec4 uCoverT; float groundPaved; float groundWood;',
        colour: `${o.grassColour}
          {
            diffuseColor.rgb *= 0.92;
            vec2 cuv = (vSurfWorld.xz - uCoverT.xy) * uCoverT.zw;
            float inside = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
            vec3 cov = texture2D(uCover, clamp(cuv, 0.0, 1.0)).rgb * inside;
            // Farmland and rough grass far out: large patches of drier and greener ground.
            float far = smoothstep(500.0, 1500.0, length(vSurfWorld.xz - cameraPosition.xz));
            vec4 field = texture2D(uMacro, vSurfWorld.xz * 0.0011 + 0.5);
            diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.82, 0.92, 0.7), vec3(1.25, 1.1, 0.72), field.r), far * (1.0 - inside * 0.7));
            // Woodland floor: earth and leaf litter in the shade of the canopy.
            vec3 litter = vec3(0.105, 0.08, 0.05) * mix(0.7, 1.25, macroFine.r);
            groundWood = cov.r;
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.6, litter, 0.65), cov.r * 0.9);
            // Unpaved paths and service tracks: compacted gravel.
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.29, 0.24) * mix(0.85, 1.1, macroFine.g), cov.g);
            // Roads, car parks and building aprons.
            groundPaved = cov.b;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.1, 0.1) * mix(0.85, 1.12, macro.r), cov.b);
          }`,
        roughness: 'roughnessFactor = mix(roughnessFactor, 0.85, groundPaved);',
      },
      { aoMapIntensity: 1 },
    );
    this.materials.push(ground);
    const groundMesh = new Mesh(terrain.geometry, ground);
    groundMesh.name = 'world:ground';
    groundMesh.receiveShadow = true;
    groundMesh.matrixAutoUpdate = false;
    this.geometries.push(terrain.geometry);
    this.group.add(groundMesh);

    this.placeTrees(o);
    this.placeBuildings(o);
    this.placeStands(o);
  }

  /** Woods, tree rows and single trees into the prop registry. */
  private placeTrees(o: CircuitWorldOptions): void {
    const { dressing, quality, props } = o;
    const wq = quality.world;
    if (wq.treeDensity <= 0) return;
    const atlas = treeAtlas(wq.treeTile, quality.anisotropy);
    this.textures.push(atlas);
    const coverage = quality.msaa > 0;
    const kinds: { id: string; tiles: number[] }[] = [
      { id: 'tree-wood', tiles: [0, 1, 3, 6, 1, 0, 7, 5] },
      { id: 'tree-row', tiles: [4, 4, 1, 2] },
      { id: 'tree-park', tiles: [2, 0, 3, 6] },
    ];
    const near = treeCards(3);
    const far = treeCards(2);
    this.geometries.push(near, far);
    for (const k of kinds) {
      const mats = treeMaterials(atlas, k.tiles, k.id, { wind: wq.wind, coverage });
      this.trees.push(mats);
      this.materials.push(mats.material, mats.depth);
      props.define({
        id: k.id,
        gridCell: 320,
        castShadow: quality.sceneryShadows,
        receiveShadow: true,
        lods: [
          {
            geometry: near,
            material: mats.material,
            depthMaterial: mats.depth,
            maxDistance: wq.treeNear,
          },
          {
            geometry: far,
            material: mats.material,
            depthMaterial: mats.depth,
            maxDistance: wq.treeFar,
          },
        ],
      });
    }
    const hit = { index: 0, s: 0, d: 0, dist: 0 };
    let serial = 0;
    const place = (kind: string, x: number, z: number, size: number): boolean => {
      if (!this.cover.treeAllowed(x, z)) return false;
      this.lap.nearest(x, z, hit);
      if (hit.dist < this.lap.barrierAt(hit.index, hit.d) + TREE_CLEARANCE) return false;
      const n = serial++;
      const h1 = hash01(n, 11);
      const h2 = hash01(n, 12);
      const h3 = hash01(n, 13);
      props.place(kind, {
        x,
        y: this.heightAt(x, z) - 0.2,
        z,
        s: hit.s,
        yaw: hash01(n, 14) * Math.PI * 2,
        scale: size * (0.72 + 0.56 * h1),
        colour: [0.86 + 0.22 * h2, 0.9 + 0.16 * h3, 0.82 + 0.2 * h1],
      });
      return true;
    };
    const step = Math.sqrt(1 / (WOOD_DENSITY * wq.treeDensity));
    const fillArea = (f: MappedFeature, density: number, size: number, salt: number): number => {
      const [x0, z0, x1, z1] = bounds(f.p);
      const sp = step / Math.sqrt(density);
      let placed = 0;
      for (let j = 0, z = z0; z < z1; j++, z += sp) {
        for (let i = 0, x = x0; x < x1; i++, x += sp) {
          const px = x + (hash01(i, j, salt) - 0.5) * sp * 0.9;
          const pz = z + (hash01(i, j, salt + 1) - 0.5) * sp * 0.9;
          if (!inRing(f.p, px, pz)) continue;
          if (place('tree-wood', px, pz, size)) placed++;
        }
      }
      return placed;
    };
    let woods = 0;
    dressing.mapped.wood.forEach((f, n) => (woods += fillArea(f, 1, 20, 1000 + n * 7)));
    dressing.mapped.scrub.forEach((f, n) => (woods += fillArea(f, 0.35, 9, 5000 + n * 7)));
    let rows = 0;
    for (const f of dressing.mapped.treeRow) {
      const p = f.p;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i] as number;
        const az = p[i + 1] as number;
        const bx = p[i + 2] as number;
        const bz = p[i + 3] as number;
        const len = Math.hypot(bx - ax, bz - az);
        const gap = 9 / Math.min(1, Math.sqrt(wq.treeDensity) * 1.5);
        for (let t = 0; t < len; t += gap) {
          if (place('tree-row', ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len, 21)) rows++;
        }
      }
    }
    let singles = 0;
    const tp = dressing.mapped.tree;
    for (let i = 0; i + 1 < tp.length; i += 2) {
      if (hash01(i, 99) > Math.max(0.2, wq.treeDensity)) continue;
      if (place('tree-park', tp[i] as number, tp[i + 1] as number, 17)) singles++;
    }
    this.counts.treesWood = woods;
    this.counts.treesRow = rows;
    this.counts.treesSingle = singles;
  }

  private placeBuildings(o: CircuitWorldOptions): void {
    const { geometry, count } = buildBuildings(o.dressing.mapped.building, this.heightAt, (f) => {
      // Buildings on the circuit itself (mapped over the pit lane or under bridges) stay out.
      const [x0, z0, x1, z1] = bounds(f.p);
      const hit = this.lap.nearest((x0 + x1) / 2, (z0 + z1) / 2);
      return hit.dist < 12;
    });
    this.counts.buildings = count;
    const mat = facadeMaterial();
    this.geometries.push(geometry);
    this.materials.push(mat);
    const mesh = new Mesh(geometry, mat);
    mesh.name = 'world:buildings';
    mesh.castShadow = o.quality.sceneryShadows;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
  }

  private placeStands(o: CircuitWorldOptions): void {
    o.dressing.mapped.grandstand.forEach((f, n) => {
      const fr = fitStand(f, this.lap, this.heightAt, n);
      if (fr) this.stands.push(fr);
    });
    this.counts.stands = this.stands.length;
    if (this.stands.length === 0) return;
    const geometry = buildStands(this.stands);
    const standMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0,
    });
    standMat.name = 'grandstand';
    this.geometries.push(geometry);
    this.materials.push(standMat);
    const mesh = new Mesh(geometry, standMat);
    mesh.name = 'world:stands';
    mesh.castShadow = o.quality.sceneryShadows;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);

    // Crowd: fuller near the start line and the first chicane, thinner at the back of big stands.
    const wq = o.quality.world;
    if (wq.crowd <= 0) return;
    const L = o.track.length;
    const seats = crowdSeats(this.stands, (fr, row) => {
      const ds = Math.min(Math.abs(fr.s), Math.abs(L - fr.s));
      const busy = 0.55 + 0.4 * Math.exp(-ds / 600);
      return wq.crowd * busy * (row > fr.rows * 0.8 ? 0.75 : 1);
    });
    const mats = crowdMaterial(this.crowdTime);
    this.materials.push(mats);
    const variants = 3;
    for (let v = 0; v < variants; v++) {
      const g = spectatorGeometry(v);
      this.geometries.push(g);
      o.props.define({
        id: `crowd-${v}`,
        castShadow: false,
        receiveShadow: true,
        lods: [{ geometry: g, material: mats, maxDistance: 650 }],
      });
    }
    for (const seat of seats) {
      const c = CLOTHING[Math.floor(hash01(seat.k, 3) * CLOTHING.length)] as [
        number,
        number,
        number,
      ];
      o.props.place(`crowd-${seat.k % variants}`, {
        x: seat.x,
        y: seat.y,
        z: seat.z,
        s: seat.s,
        yaw: seat.yaw + (hash01(seat.k, 4) - 0.5) * 0.5,
        scale: 0.94 + hash01(seat.k, 5) * 0.12,
        colour: c,
      });
    }
    this.counts.crowd = seats.length;
  }

  /** Per frame: wind and the crowd's idle motion. */
  update(time: number): void {
    for (const t of this.trees) t.time.value = time;
    this.crowdTime.value = time;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.cover.dispose();
    this.group.removeFromParent();
  }
}

import {
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import type { MeshData, Track } from '@undercut/track';
import { macroNoise, surfaceMaterial, type PbrSet } from '../materials/surface';
import { boardMaterial, type PropRegistry } from '../props/registry';
import type { Quality } from '../quality';
import { brandAtlas, catchFenceTexture, signageAtlas, type BrandSpec } from './brands';
import { buildBuildings, facadeMaterial } from './buildings';
import { buildCoverMap, type CoverMap } from './cover';
import { crowdMaterial, spectatorGeometry, CLOTHING } from './crowd';
import {
  bounds,
  decodeTerrain,
  hash01,
  inRing,
  type DressingFile,
  type MappedFeature,
} from './dressing';
import {
  buildHistoricBanking,
  buildStartGantry,
  buildTrackBridges,
  placeTracksideFurniture,
  type StartGantry,
} from './furniture';
import {
  buildStands,
  crowdSeats,
  fitStand,
  grandstandMaterial,
  type StandFrame,
} from './grandstands';
import { LapIndex } from './lap-index';
import {
  buildPitBuilding,
  garageBoardTexture,
  pitCrewGeometry,
  pitFacadeMaterial,
  pitWallCanopyGeometry,
  teamTintedMaterial,
  type GarageTeam,
  type PitComplexData,
} from './pit-building';
import { buildSurfaceDecals } from './surface-decals';
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
  /** Teams for garage boards, pit-wall canopies and pit crew (from design/teams.json). */
  garageTeams?: readonly GarageTeam[] | undefined;
  /** Invented brands for trackside hoardings and bridge banners (from design/brands.json). */
  brands?: readonly BrandSpec[] | undefined;
}

/** Trees per square metre of woodland at full density (about one per 42 m²). */
const WOOD_DENSITY = 1 / 42;
/** Clear ground between the barrier and the first trees, m. */
const TREE_CLEARANCE = 9;

const DEFAULT_BRANDS: readonly BrandSpec[] = [
  {
    id: 'kronwerk',
    name: 'KRONWERK',
    sub: 'PRECISION INSTRUMENTS',
    bg: '#151920',
    fg: '#EBE9E2',
    accent: '#9AA6B8',
    style: 'horology',
  },
  {
    id: 'caldera',
    name: 'CALDERA',
    sub: 'GRID SYSTEMS',
    bg: '#0F3D42',
    fg: '#F2F4EC',
    accent: '#D4C64A',
    style: 'stripe',
  },
  {
    id: 'solvant',
    name: 'SOLVANT',
    sub: 'SYNTHETIC FLUIDS',
    bg: '#13233A',
    fg: '#F4F1EA',
    accent: '#E09A2B',
    style: 'chevron',
  },
  {
    id: 'maretti',
    name: 'MARETTI',
    sub: 'TORREFAZIONE',
    bg: '#2B1813',
    fg: '#F2E7D5',
    accent: '#C76D3C',
    style: 'serif',
  },
];

function hexLinear(hex: string): [number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

/**
 * The place around the circuit, built from its dressing file: ground to the horizon with the
 * map's ground cover, the woods, tree rows, single trees and distant treeline as instanced
 * impostors, every mapped building, the pit complex (garages, team boards, pit-wall canopies and
 * pit crew), grandstands with crowd, start gantry with addressable lights, catch fencing,
 * invented-brand hoardings, braking/DRS boards, bridges, historic banking and surface decals.
 * Circuit-agnostic: everything here comes from the dressing file, track and design data.
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
  private pitComplex: PitComplexData | null = null;
  private startGantry: StartGantry | null = null;

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
            diffuseColor.rgb *= 0.88;
            vec2 cuv = (vSurfWorld.xz - uCoverT.xy) * uCoverT.zw;
            float inside = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
            vec3 cov = texture2D(uCover, clamp(cuv, 0.0, 1.0)).rgb * inside;
            // Farmland and rough grass far out: large patches of drier and greener ground.
            float far = smoothstep(500.0, 1500.0, length(vSurfWorld.xz - cameraPosition.xz));
            vec4 field = texture2D(uMacro, vSurfWorld.xz * 0.0011 + 0.5);
            diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.76, 0.86, 0.64), vec3(1.18, 1.04, 0.68), field.r), far * (1.0 - inside * 0.7));
            // Woodland floor: earth and leaf litter in the shade of the canopy.
            vec3 litter = vec3(0.095, 0.072, 0.045) * mix(0.7, 1.25, macroFine.r);
            groundWood = cov.r;
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.55, litter, 0.68), cov.r * 0.9);
            // Unpaved paths and service tracks: compacted gravel.
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.255, 0.21) * mix(0.85, 1.1, macroFine.g), cov.g);
            // Roads, car parks and building aprons.
            groundPaved = cov.b;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.095, 0.095, 0.098) * mix(0.85, 1.12, macro.r), cov.b);
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

    // Build pit complex before generic buildings so its footprint excludes mapped pit slabs.
    this.placePitComplex(o);
    this.placeTrees(o, lapBox);
    this.placeBuildings(o);
    this.placeStands(o);
    this.placeFurnitureAndDecals(o);
  }

  /** Set the 5 start-gantry lights (bits 0..4 red pods, bit 5 green). */
  setStartLights(mask: number): void {
    this.startGantry?.setLights(mask);
  }

  /** Pit building, team garage boards, pit-wall canopies and pit crew. */
  private placePitComplex(o: CircuitWorldOptions): void {
    const { track, quality, props } = o;
    const teams: readonly GarageTeam[] =
      o.garageTeams && o.garageTeams.length > 0
        ? o.garageTeams
        : [{ name: 'Kestrel Grand Prix', code: 'KST', primary: '#1F4FBF', secondary: '#C3C8D0' }];

    const pit = buildPitBuilding(track, this.lap, teams.length);
    this.pitComplex = pit;
    const mat = pitFacadeMaterial(teams.map((t) => t.primary));
    this.geometries.push(pit.geometry);
    this.materials.push(mat);

    const mesh = new Mesh(pit.geometry, mat);
    mesh.name = 'world:pit-building';
    mesh.castShadow = quality.sceneryShadows;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);

    // Garage team fascia boards (one per bay, facing the pit lane).
    const boardMats = teams.map((team) => {
      const tex = garageBoardTexture(team);
      this.textures.push(tex);
      const bm = boardMaterial(tex, { anisotropy: quality.anisotropy, roughness: 0.45 });
      bm.name = `garage-board-${team.code}`;
      this.materials.push(bm);
      return bm;
    });
    const boardGeo = new PlaneGeometry(5.6, 0.98);
    // Rotate plane so its front (+Z) faces +X to match the prop pivot convention (+X front).
    boardGeo.rotateY(Math.PI / 2);
    this.geometries.push(boardGeo);
    boardMats.forEach((bm, ti) => {
      props.define({
        id: `garage-board-${ti}`,
        castShadow: false,
        receiveShadow: true,
        lods: [{ geometry: boardGeo, material: bm, maxDistance: 650 }],
      });
    });
    for (const bay of pit.bays) {
      props.place(`garage-board-${bay.teamIndex}`, {
        x: bay.x,
        y: bay.y,
        z: bay.z,
        yaw: bay.yaw,
        s: bay.s,
      });
    }
    this.counts.garageBays = pit.bays.length;

    // Modular pit-wall timing canopies + pit crew (engineers on pit wall, mechanics outside garages).
    const canopyGeo = pitWallCanopyGeometry();
    const canopyMat = teamTintedMaterial('pit-wall-canopy', 0.55, 0.25);
    const mechGeo = pitCrewGeometry('mechanic');
    const engGeo = pitCrewGeometry('engineer');
    const crewMat = teamTintedMaterial('pit-crew', 0.82, 0.04);
    this.geometries.push(canopyGeo, mechGeo, engGeo);
    this.materials.push(canopyMat, crewMat);

    const far = quality.world.terrain === 'mobile' ? 360 : 750;
    props.define({
      id: 'pit-wall-canopy',
      castShadow: quality.sceneryShadows,
      receiveShadow: true,
      lods: [{ geometry: canopyGeo, material: canopyMat, maxDistance: far }],
    });
    props.define({
      id: 'pit-crew-engineer',
      castShadow: false,
      receiveShadow: true,
      lods: [{ geometry: engGeo, material: crewMat, maxDistance: far * 0.7 }],
    });
    props.define({
      id: 'pit-crew-mechanic',
      castShadow: false,
      receiveShadow: true,
      lods: [{ geometry: mechGeo, material: crewMat, maxDistance: far * 0.7 }],
    });

    let crewCount = 0;
    const isLite = quality.world.treeDensity < 0.1;
    pit.pitWallSpots.forEach((spot, idx) => {
      const team = teams[spot.teamIndex % teams.length]!;
      const tint = hexLinear(team.primary);
      props.place('pit-wall-canopy', {
        x: spot.x,
        y: spot.y,
        z: spot.z,
        yaw: spot.yaw,
        s: spot.s,
        colour: tint,
      });
      if (!isLite) {
        // 3 seated race engineers per pit-wall canopy looking toward the track / monitors.
        for (const offsetAlong of [-1.25, 0, 1.25]) {
          props.place('pit-crew-engineer', {
            x: spot.x - spot.nx * 0.28 + spot.tx * offsetAlong,
            y: spot.y + 0.22,
            z: spot.z - spot.nz * 0.28 + spot.tz * offsetAlong,
            yaw: spot.yaw,
            s: spot.s,
            scale: 0.96 + hash01(idx, Math.round(offsetAlong * 10) + 20) * 0.08,
            colour: tint,
          });
          crewCount++;
        }
      }
    });

    // Standing pit-box mechanics outside the garage aprons in their team's overalls.
    if (!isLite) {
      pit.bays.forEach((bay, bi) => {
        // 1-2 mechanics standing near every second bay (outside the working fast lane).
        if (bi % 2 !== 0 && quality.world.crowd < 0.5) return;
        const team = teams[bay.teamIndex % teams.length]!;
        const tint = hexLinear(team.primary);
        const countHere = quality.world.crowd >= 0.5 ? 2 : 1;
        for (let m = 0; m < countHere; m++) {
          const lateral = (m - (countHere - 1) / 2) * 1.6 + (hash01(bi, m, 31) - 0.5) * 0.5;
          const forward = 1.4 + hash01(bi, m, 32) * 1.1;
          // Tangent along the garage wall perpendicular to normal (nx, nz).
          const tx = -bay.nz;
          const tz = bay.nx;
          props.place('pit-crew-mechanic', {
            x: bay.x + bay.nx * forward + tx * lateral,
            y: bay.groundY,
            z: bay.z + bay.nz * forward + tz * lateral,
            yaw: bay.yaw + (hash01(bi, m, 33) - 0.5) * 0.8,
            s: bay.s,
            scale: 0.95 + hash01(bi, m, 34) * 0.1,
            colour: tint,
          });
          crewCount++;
        }
      });
    }
    this.counts.pitCanopies = pit.pitWallSpots.length;
    this.counts.pitCrew = crewCount;
  }

  /** Woods, tree rows, single trees and a distant horizon forest ring into the prop registry. */
  private placeTrees(o: CircuitWorldOptions, lapBox: [number, number, number, number]): void {
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
    const place = (
      kind: string,
      x: number,
      z: number,
      size: number,
      checkCover = true,
    ): boolean => {
      if (checkCover && !this.cover.treeAllowed(x, z)) return false;
      this.lap.nearest(x, z, hit);
      if (hit.dist < this.lap.barrierAt(hit.index, hit.d) + TREE_CLEARANCE) return false;
      const n = serial++;
      const h1 = hash01(n, 11);
      const h2 = hash01(n, 12);
      const h3 = hash01(n, 13);
      props.place(kind, {
        x,
        y: this.heightAt(x, z) - 0.25,
        z,
        s: hit.s,
        yaw: hash01(n, 14) * Math.PI * 2,
        scale: size * (0.72 + 0.56 * h1),
        colour: [0.84 + 0.22 * h2, 0.88 + 0.16 * h3, 0.8 + 0.2 * h1],
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

    // Distant treeline skyline ring beyond the OSM mapping radius so the far horizon always meets
    // soft forest instead of a bare green-to-sky edge.
    let skyline = 0;
    if (wq.treeDensity >= 0.2) {
      const cx = (lapBox[0] + lapBox[2]) * 0.5;
      const cz = (lapBox[1] + lapBox[3]) * 0.5;
      const rx = (lapBox[2] - lapBox[0]) * 0.5 + dressing.radius + 90;
      const rz = (lapBox[3] - lapBox[1]) * 0.5 + dressing.radius + 90;
      const rings = wq.treeDensity >= 0.7 ? 3 : 2;
      for (let ring = 0; ring < rings; ring++) {
        const scaleR = 1 + ring * 0.28;
        const count = Math.round(140 * scaleR * Math.min(1, wq.treeDensity + 0.3));
        for (let i = 0; i < count; i++) {
          const ang = ((i + hash01(ring, i, 41) * 0.8) / count) * Math.PI * 2;
          const jitter = 0.92 + hash01(ring, i, 42) * 0.24;
          const px = cx + Math.cos(ang) * rx * scaleR * jitter;
          const pz = cz + Math.sin(ang) * rz * scaleR * jitter;
          if (place('tree-wood', px, pz, 28 + ring * 6, false)) skyline++;
        }
      }
    }
    this.counts.treesWood = woods;
    this.counts.treesRow = rows;
    this.counts.treesSingle = singles;
    this.counts.treesSkyline = skyline;
  }

  private placeBuildings(o: CircuitWorldOptions): void {
    const pitFoot = this.pitComplex?.footprint ?? [];
    const { geometry, count } = buildBuildings(o.dressing.mapped.building, this.heightAt, (f) => {
      // Buildings on the circuit itself (mapped over the pit lane or under bridges) stay out.
      const [x0, z0, x1, z1] = bounds(f.p);
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const hit = this.lap.nearest(cx, cz);
      if (hit.dist < 12) return true;
      // Exclude mapped OSM slabs overlapping the dedicated pit complex (e.g. Palazzina Box).
      if (pitFoot.length >= 6) {
        if (inRing(pitFoot, cx, cz)) return true;
        for (let i = 0; i + 1 < f.p.length; i += 2) {
          if (inRing(pitFoot, f.p[i] as number, f.p[i + 1] as number)) return true;
        }
      }
      return false;
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
    const standMat = grandstandMaterial();
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

  /** Start gantry, bridges, historic banking, trackside furniture and place-dependent surface decals. */
  private placeFurnitureAndDecals(o: CircuitWorldOptions): void {
    const { track, dressing, quality, props } = o;
    const mobile = quality.world.terrain === 'mobile';
    const tileW = mobile ? 256 : 512;
    const tileH = mobile ? 64 : 128;
    const brandTex = brandAtlas(
      o.brands && o.brands.length > 0 ? o.brands : DEFAULT_BRANDS,
      tileW,
      tileH,
      quality.anisotropy,
    );
    const signTex = signageAtlas(quality.anisotropy);
    const fenceTex = catchFenceTexture(quality.anisotropy);
    this.textures.push(brandTex, signTex, fenceTex);

    // Start gantry at s = 0 with 5 individually addressable start lights.
    const gantry = buildStartGantry(track, brandTex, 0);
    this.startGantry = gantry;
    this.geometries.push(...gantry.geometries);
    this.materials.push(...gantry.materials);
    this.group.add(gantry.group);

    // Over-track bridges from OSM + authored config.
    const bridges = buildTrackBridges(track, dressing, this.lap, brandTex);
    this.geometries.push(...bridges.geometries);
    this.materials.push(...bridges.materials);
    if (bridges.count > 0) this.group.add(bridges.group);
    this.counts.bridges = bridges.count;

    // Historic banked oval concrete where mapped (e.g., Monza's Sopraelevata).
    const banking = buildHistoricBanking(dressing.mapped.raceway, this.heightAt, this.lap);
    if (banking.mesh && banking.geometry && banking.material) {
      this.geometries.push(banking.geometry);
      this.materials.push(banking.material);
      this.group.add(banking.mesh);
    }

    // Modular instanced furniture (hoardings, catch fencing, braking/DRS boards, marshals, Tecpro, screens, towers).
    const furnCounts = placeTracksideFurniture({
      track,
      dressing,
      lap: this.lap,
      stands: this.stands,
      pitComplex: this.pitComplex,
      heightAt: this.heightAt,
      props,
      brandAtlasTex: brandTex,
      signageAtlasTex: signTex,
      fenceTex,
      castShadows: quality.sceneryShadows,
      mobile,
      geometries: this.geometries,
      materials: this.materials,
    });
    Object.assign(this.counts, furnCounts);

    // Surface decals (start/finish chequer, grid numbers, pit-lane lines, painted run-off chevrons).
    const decals = buildSurfaceDecals(track, quality.anisotropy);
    this.geometries.push(...decals.geometries);
    this.materials.push(...decals.materials);
    this.textures.push(...decals.textures);
    this.group.add(decals.group);
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

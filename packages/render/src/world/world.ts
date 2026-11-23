import {
  Color,
  Group,
  Mesh,
  MeshDepthMaterial,
  MeshPhysicalMaterial,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import type { MeshData, Track } from '@undercut/track';
import { macroNoise, surfaceMaterial, type PbrSet } from '../materials/surface';
import { createPropKitMaterial, type PropKitAssets } from '../props/catalog';
import { boardMaterial, type PropPlacement, type PropRegistry } from '../props/registry';
import type { Quality } from '../quality';
import { brandAtlas, catchFenceTexture, signageAtlas, type BrandSpec } from './brands';
import { buildBuildingChunks, buildingHeight, facadeMaterial } from './buildings';
import { buildCoverMap, type CoverMap } from './cover';
import { crowdSwapMaterial, crowdMaterial, spectatorGeometry, CLOTHING } from './crowd';
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
  brandHoardingMaterial,
  buildTrackBridges,
  placeTracksideFurniture,
  type StartGantry,
} from './furniture';
import {
  buildStandChunks,
  crowdSeats,
  fitStand,
  grandstandMaterial,
  type StandFrame,
} from './grandstands';
import { footprintOnTrack } from './corridor';
import { streetGround } from './lamps';
import { placeKitBarriers } from './kit-barriers';
import { LapIndex } from './lap-index';
import {
  buildGarageBoardsGeometry,
  buildPitBuilding,
  garageBoardAtlas,
  PIT_BUILDING,
  pitCrewGeometry,
  pitFacadeMaterial,
  pitWallCanopyGeometry,
  teamTintedMaterial,
  type GarageTeam,
  type PitComplexData,
} from './pit-building';
import { buildSurfaceDecals } from './surface-decals';
import type { LocalLight } from '../lighting/light-pool';
import { pickBackdrops, placeStreetCircuit, windowMaterial } from './street';
import {
  buildTerrain,
  TERRAIN_HIGH,
  TERRAIN_LITE,
  TERRAIN_MOBILE,
  waterBodies,
  waterGeometry,
  type WaterBody,
} from './terrain';
import { coniferShare, worldTheme, type WorldTheme } from './theme';
import { treeAtlas } from './tree-atlas';
import {
  BROADLEAF_CLOUD,
  COLUMNAR_CLOUD,
  treeCards,
  treeCloudGeometry,
  nearKitTreeMaterial,
  treeCloudMaterials,
  treeMaterials,
  type TreeMaterials,
  type TreeSwap,
} from './trees';

/** What a preset draws of the world (presets.json, `world`). */
export interface WorldQuality {
  /**
   * Load the circuit's dressing at all. Off on Lite (software-WebGL tests): the circuit sits on
   * the track package's own ground, as without a dressing file.
   */
  enabled: boolean;
  /** Fraction of the full tree density placed (1 on High). */
  treeDensity: number;
  /** Atlas pixels per species. */
  treeTile: number;
  /** Fine terrain cells near the circuit ('high' 10 m, 'mobile' 24 m). */
  terrain: 'high' | 'mobile' | 'lite';
  wind: boolean;
  /** Fraction of seats with a spectator. */
  crowd: number;
  /** Ground cover raster resolution, m per pixel. */
  coverResolution: number;
  /** Tree cards drawn near / far (m from the chunk centre). */
  treeNear: number;
  treeFar: number;
  /** Trees nearer the eye than this are real geometry instead of cards, m (0: cards only). */
  treeCloud: number;
  /**
   * Build the structures (pit complex, buildings, stands and crowd, trackside furniture,
   * bridges, decals). Off on Lite (software-WebGL tests): ground and a few trees only.
   */
  structures: boolean;
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
  /**
   * Modelled props from the prop catalogue (packages/render/data/props.catalog.json). Each kind
   * the kit has replaces its procedural stand-in at the same placements (ground-centre pivot,
   * +Y up, +X front); kinds it lacks keep the stand-in.
   */
  propKit?: PropKitAssets | null;
  /** Lamps and windows lit (a floodlit night). */
  night?: boolean;
}

/**
 * How far (to the sphere's edge) world chunks draw, m. Haze hides them well before this; the
 * gates only skip drawing what cannot be seen, so they are set long to avoid pop-in.
 */
const FAR_BUILDINGS = 4000;
const FAR_STANDS = 3200;
const FAR_BRIDGES = 3000;
const FAR_BOARDS = 1200;
const FAR_DECALS = 900;

/** Trees per square metre of woodland at full density (about one per 42 m²). */
const WOOD_DENSITY = 1 / 42;
/**
 * The kit conifers' colour against the spruce cards they take over from at the swap distance:
 * at 1 they measured 12–15% lighter (by day and under floodlights).
 */
const NEAR_CONIFER_TONE = 0.8;
/** Grid cell of the near kit conifers, m, and the distance (cell near edge) of their finest level. */
const NEAR_CONIFER_CELL = 60;
const NEAR_CONIFER_HIGH = 20;
/** Depth of the wood edge (past the clearance) whose conifers are kit models up close, m. */
const NEAR_CONIFER_BAND = 30;
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
    bg: '#3B3832',
    fg: '#F2F4EC',
    accent: '#D4C64A',
    style: 'stripe',
  },
  {
    id: 'tervale',
    name: 'TERVALE',
    sub: 'SYNTHETIC FLUIDS',
    bg: '#13233A',
    fg: '#F4F1EA',
    accent: '#E09A2B',
    style: 'chevron',
  },
  {
    id: 'vassero',
    name: 'VASSERO',
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
interface WorldChunk {
  mesh: Mesh;
  centre: Vector3;
  radius: number;
  maxDistance: number;
  castShadow: boolean;
  shadowMaxDistance: number;
}

const defaultYield = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class CircuitWorld {
  readonly group = new Group();
  heightAt: (x: number, z: number) => number = () => 0;
  readonly stands: StandFrame[] = [];
  readonly counts: Record<string, number> = {};
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly textures: Texture[] = [];
  /** Unset until the ground step of the build has run. */
  private cover: CoverMap | null = null;
  private readonly trees: TreeMaterials[] = [];
  /** Per-tree swap between near trees and cards (eye updated every frame). */
  private readonly treeSwap: TreeSwap = { eye: { value: new Vector3() }, distance: { value: 0 } };
  private readonly crowdEye = { value: new Vector3() };
  private readonly crowdTime = { value: 0 };
  /** Nearest lap sample to a world point (shared with the view's lamp map). */
  readonly lap: LapIndex;
  private readonly worldChunks: WorldChunk[] = [];
  private pitComplex: PitComplexData | null = null;
  private startGantry: StartGantry | null = null;
  /** The circuit's regional look (theme.ts), from the track's id. */
  readonly theme: WorldTheme;
  /** The circuit's own floodlights (lamp banks it placed), for the pooled lights at night. */
  readonly localLights: LocalLight[] = [];
  private crowdKinds = 0;
  /** Mapped water drawn as a surface (theme `water`), with the ground kept under it. */
  private water: WaterBody[] = [];

  /** Milliseconds per build step (start-up budget). */
  readonly buildTimes: Record<string, number> = {};

  constructor(o: CircuitWorldOptions, deferBuild = false) {
    this.group.name = 'world';
    this.lap = new LapIndex(o.track);
    this.theme = worldTheme(o.track.id);
    if (!deferBuild) {
      this.buildSync(o);
    }
  }

  /** Build the circuit world cooperatively across event-loop slices so the UI stays responsive. */
  static async buildAsync(
    o: CircuitWorldOptions,
    yieldSlice: () => Promise<void> = defaultYield,
  ): Promise<CircuitWorld> {
    const world = new CircuitWorld(o, true);
    const { track, dressing, quality } = o;
    const wq = quality.world;
    let sliceStart = performance.now();
    let maxSlice = 0;
    const maybeYield = async (): Promise<void> => {
      const elapsed = performance.now() - sliceStart;
      if (elapsed > maxSlice) maxSlice = elapsed;
      if (elapsed >= 12) {
        await yieldSlice();
        sliceStart = performance.now();
      }
    };
    const timed = async (name: string, fn: () => void): Promise<void> => {
      const t0 = performance.now();
      fn();
      world.buildTimes[name] = Math.round(performance.now() - t0);
      await maybeYield();
    };

    try {
      const lapBox = bounds(
        Array.from({ length: track.lap.count * 2 }, (_, i) =>
          i % 2 === 0 ? (track.lap.x[i >> 1] as number) : (track.lap.z[i >> 1] as number),
        ),
      );
      let terrain: ReturnType<typeof buildTerrain> | null = null;
      await timed('terrain', () => {
        const grid = decodeTerrain(dressing.terrain);
        world.water = world.theme.water ? waterBodies(dressing.mapped.water, grid) : [];
        terrain = buildTerrain(
          track,
          grid,
          world.lap,
          o.drivable,
          wq.terrain === 'high'
            ? TERRAIN_HIGH
            : wq.terrain === 'lite'
              ? TERRAIN_LITE
              : TERRAIN_MOBILE,
          world.water,
        );
        world.heightAt = terrain.heightAt;
      });
      await timed('cover', () => {
        world.buildGround(o, terrain!, lapBox);
        world.placeWater();
      });
      if (!wq.structures) {
        await timed('trees', () => world.placeTrees(o, lapBox));
      } else {
        await timed('pit', () => world.placePitComplex(o));
        await timed('trees', () => world.placeTrees(o, lapBox));
        await timed('buildings', () => world.placeBuildings(o));
        await timed('stands', () => world.placeStands(o));
        await timed('furniture', () => world.placeFurnitureAndDecals(o));
      }
    } catch (error) {
      // Release what the steps so far made; the caller gets the error.
      world.dispose();
      throw error;
    }
    world.ownShadowDepth();
    const finalSlice = performance.now() - sliceStart;
    if (finalSlice > maxSlice) maxSlice = finalSlice;
    world.buildTimes.maxSlice = Math.round(maxSlice);
    return world;
  }

  private buildSync(o: CircuitWorldOptions): void {
    const { track, dressing, quality } = o;
    const wq = quality.world;
    let mark = performance.now();
    const step = (name: string): void => {
      const now = performance.now();
      this.buildTimes[name] = Math.round(now - mark);
      mark = now;
    };
    const grid = decodeTerrain(dressing.terrain);
    step('index');

    this.water = this.theme.water ? waterBodies(dressing.mapped.water, grid) : [];
    const terrain = buildTerrain(
      track,
      grid,
      this.lap,
      o.drivable,
      wq.terrain === 'high' ? TERRAIN_HIGH : wq.terrain === 'lite' ? TERRAIN_LITE : TERRAIN_MOBILE,
      this.water,
    );
    this.heightAt = terrain.heightAt;
    step('terrain');
    const lapBox = bounds(
      Array.from({ length: track.lap.count * 2 }, (_, i) =>
        i % 2 === 0 ? (track.lap.x[i >> 1] as number) : (track.lap.z[i >> 1] as number),
      ),
    );
    this.buildGround(o, terrain, lapBox);
    this.placeWater();
    step('ground');
    if (!wq.structures) {
      this.placeTrees(o, lapBox);
      step('trees');
      return;
    }
    // Build pit complex before generic buildings so its footprint excludes mapped pit slabs.
    this.placePitComplex(o);
    step('pit');
    this.placeTrees(o, lapBox);
    step('trees');
    this.placeBuildings(o);
    step('buildings');
    this.placeStands(o);
    step('stands');
    this.placeFurnitureAndDecals(o);
    step('furniture');
    this.ownShadowDepth();
  }

  /**
   * Every mesh of the world without its own shadow depth material gets the world's, released with
   * the world: left to three.js, the shadow map's depth material (as long-lived as the renderer)
   * would compile and keep a variant for the world's meshes after the session ends.
   */
  private ownShadowDepth(): void {
    const depth = new MeshDepthMaterial();
    depth.name = 'world-shadow-depth';
    this.materials.push(depth);
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.customDepthMaterial === undefined) m.customDepthMaterial = depth;
    });
  }

  private addWorldChunk(
    mesh: Mesh,
    centre: readonly [number, number, number],
    radius: number,
    maxDistance: number,
    shadowMaxDistance: number,
  ): void {
    this.worldChunks.push({
      mesh,
      centre: new Vector3(centre[0], centre[1], centre[2]),
      radius,
      maxDistance,
      castShadow: mesh.castShadow,
      shadowMaxDistance,
    });
  }

  private buildGround(
    o: CircuitWorldOptions,
    terrain: ReturnType<typeof buildTerrain>,
    lapBox: [number, number, number, number],
  ): void {
    const { dressing, quality } = o;
    const wq = quality.world;
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
    terrain.chunks.forEach((cg, ci) => {
      const groundMesh = new Mesh(cg, ground);
      groundMesh.name = ci === 0 ? 'world:ground' : `world:ground-${ci}`;
      groundMesh.receiveShadow = true;
      groundMesh.matrixAutoUpdate = false;
      this.geometries.push(cg);
      this.group.add(groundMesh);
    });
  }

  /** Flat water surfaces at each body's level: dark, smooth, reflecting the sky and the lamps. */
  private placeWater(): void {
    if (this.water.length === 0) return;
    // Harbour water: dark green-grey, a broken sheen rather than a mirror of the sky (weaker
    // specular than glass, so the overcast sky at a grazing angle does not turn it white).
    const mat = new MeshPhysicalMaterial({
      color: new Color('#0b1b1f'),
      roughness: 0.2,
      metalness: 0,
      specularIntensity: 0.35,
      envMapIntensity: 0.6,
    });
    mat.name = 'water';
    this.materials.push(mat);
    this.water.forEach((b, wi) => {
      const g = waterGeometry(b);
      if (!g) return;
      this.geometries.push(g);
      const mesh = new Mesh(g, mat);
      mesh.name = `world:water-${wi}`;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      const bs = g.boundingSphere;
      if (bs)
        this.addWorldChunk(
          mesh,
          [bs.center.x, bs.center.y, bs.center.z],
          bs.radius,
          FAR_BUILDINGS,
          0,
        );
    });
    this.counts.water = this.water.length;
  }

  /** Set the 5 start-gantry lights (bits 0..4 red pods, bit 5 green). */
  setStartLights(mask: number): void {
    this.startGantry?.setLights(mask);
  }

  /**
   * Distance within which trees are real geometry, m; 0 shows the cards everywhere. Read back
   * when called without an argument (the tree-swap check compares the two).
   */
  treeSwapDistance(distance?: number): number {
    if (distance !== undefined) this.treeSwap.distance.value = Math.max(0, distance);
    return this.treeSwap.distance.value;
  }

  /** Pit building, team garage boards, pit-wall canopies and pit crew. */
  private placePitComplex(o: CircuitWorldOptions): void {
    const { track, quality, props } = o;
    const teams: readonly GarageTeam[] =
      o.garageTeams && o.garageTeams.length > 0
        ? o.garageTeams
        : [{ name: 'Kestrel Grand Prix', code: 'KST', primary: '#1F4FBF', secondary: '#C3C8D0' }];

    const built = buildPitBuilding(track, this.lap, teams.length);
    const garageLods =
      built.bays.length > 0
        ? (o.propKit?.lodsFor(this.theme.pit === 'kit-garages' ? 'hill-pit-garage' : 'pit-garage', {
            // Its own board panel stays dark behind the team boards placed on it.
            slotColors: { 'board-face': [0.018, 0.019, 0.021] },
            maxDistanceScale: 2.6,
            distanceCaps: [80, 300, FAR_STANDS],
          }) ?? null)
        : null;
    let pit = built;
    if (garageLods) {
      // A row of the kit's garage modules, one per bay, instead of the built-up block: each is
      // stretched along the row to the bay pitch, its front wall on the garage line, and the
      // team boards move onto the panel the module carries for them.
      for (const ch of built.chunks) ch.geometry.dispose();
      const entry = o.propKit?.entries.get(
        this.theme.pit === 'kit-garages' ? 'hill-pit-garage' : 'pit-garage',
      );
      const board = entry?.attachments?.find((a) => a.name === 'team-board');
      const k = PIT_BUILDING.bay / (entry?.moduleLength || 6);
      const wallX = (board?.position[0] ?? 4.98) * k;
      const boardY = (board?.position[1] ?? 4.18) * k;
      pit = {
        ...built,
        chunks: [],
        bays: built.bays.map((b) => ({ ...b, y: b.groundY + boardY })),
      };
      props.define({
        id: 'pit-garage',
        castShadow: quality.sceneryShadows,
        shadowMaxDistance: 240,
        receiveShadow: true,
        lods: garageLods,
      });
      for (const b of built.bays) {
        props.place('pit-garage', {
          x: b.x - b.nx * (0.08 + wallX),
          y: b.groundY,
          z: b.z - b.nz * (0.08 + wallX),
          yaw: b.yaw,
          s: b.s,
          scale: k,
        });
      }
      this.counts.pitGarages = built.bays.length;
    }
    this.pitComplex = pit;
    if (!garageLods) {
      const mat = pitFacadeMaterial(teams.map((t) => t.primary));
      this.materials.push(mat);
      pit.chunks.forEach((ch, ci) => {
        this.geometries.push(ch.geometry);
        const mesh = new Mesh(ch.geometry, mat);
        mesh.name = ci === 0 ? 'world:pit-building' : `world:pit-building-${ci}`;
        mesh.castShadow = quality.sceneryShadows;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.addWorldChunk(mesh, ch.centre, ch.radius, FAR_STANDS, 240);
      });
    }

    // Garage team fascia boards consolidated into one atlas texture and one draw call.
    if (pit.bays.length > 0) {
      const atlas = garageBoardAtlas(teams, quality.anisotropy);
      this.textures.push(atlas);
      const bm = boardMaterial(atlas, { anisotropy: quality.anisotropy, roughness: 0.45 });
      bm.name = 'garage-boards';
      this.materials.push(bm);
      const boardGeo = buildGarageBoardsGeometry(pit.bays, teams.length);
      this.geometries.push(boardGeo);
      const boardMesh = new Mesh(boardGeo, bm);
      boardMesh.name = 'world:garage-boards';
      boardMesh.castShadow = false;
      boardMesh.receiveShadow = true;
      boardMesh.matrixAutoUpdate = false;
      this.group.add(boardMesh);
      const bs = boardGeo.boundingSphere;
      if (bs) {
        this.addWorldChunk(
          boardMesh,
          [bs.center.x, bs.center.y, bs.center.z],
          bs.radius,
          FAR_BOARDS,
          0,
        );
      }
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

    const far = quality.world.terrain === 'high' ? 750 : 360;
    props.define({
      id: 'pit-wall-canopy',
      castShadow: quality.sceneryShadows,
      shadowMaxDistance: 180,
      receiveShadow: true,
      lods: o.propKit?.lodsFor('pit-wall') ?? [
        { geometry: canopyGeo, material: canopyMat, maxDistance: far },
      ],
    });
    props.define({
      id: 'pit-crew-engineer',
      castShadow: false,
      receiveShadow: true,
      lods: o.propKit?.lodsFor('crew-engineer-seated')?.map((l) => {
        l.geometry.translate(0, -0.5, 0);
        return l;
      }) ?? [{ geometry: engGeo, material: crewMat, maxDistance: far * 0.7 }],
    });
    props.define({
      id: 'pit-crew-mechanic',
      castShadow: false,
      receiveShadow: true,
      lods: o.propKit?.lodsFor('crew-mechanic-standing') ?? [
        { geometry: mechGeo, material: crewMat, maxDistance: far * 0.7 },
      ],
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
    const cover = this.cover;
    if (!cover) throw new Error('trees are placed after the ground');
    const atlas = treeAtlas(wq.treeTile, quality.anisotropy, this.theme.species);
    this.textures.push(atlas);
    const coverage = quality.msaa > 0;
    const theme = this.theme;
    const conifers = theme.conifers;
    const kinds: { id: string; tiles: readonly number[] }[] = [
      { id: 'tree-wood', tiles: theme.trees.wood },
      { id: 'tree-row', tiles: theme.trees.row },
      { id: 'tree-park', tiles: theme.trees.park },
    ];
    if (conifers) kinds.push({ id: 'tree-conifer', tiles: conifers.tiles });
    // With the kit's conifers up close, only the wood edge facing the track takes them; deeper in
    // (behind the edge rows) the conifers stay cards at every distance.
    const kitConifers =
      wq.treeCloud > 0 && conifers !== null && conifers.kit.some((id) => o.propKit?.has(id));
    if (conifers && kitConifers) kinds.push({ id: 'tree-conifer-deep', tiles: conifers.tiles });
    // Near conifers from the kit's models where it has them (else the columnar near tree).
    const nearKits: { id: string; height: number }[] = [];
    const near = treeCards(3);
    const far = treeCards(2);
    this.geometries.push(near, far);
    // Near trees: real geometry within `treeCloud` of the eye, on small chunks so only the few
    // around the camera draw; the cards fade out over the same distance per tree.
    const cloud = wq.treeCloud > 0;
    const swap: TreeSwap | null = cloud ? this.treeSwap : null;
    this.treeSwap.distance.value = wq.treeCloud;
    const clouds = cloud
      ? {
          broad: treeCloudGeometry(BROADLEAF_CLOUD, 17),
          column: treeCloudGeometry(COLUMNAR_CLOUD, 29),
        }
      : null;
    if (clouds) this.geometries.push(clouds.broad, clouds.column);
    for (const k of kinds) {
      const deep = k.id === 'tree-conifer-deep';
      const mats = treeMaterials(atlas, k.tiles, k.id, {
        wind: wq.wind,
        coverage,
        swap: deep ? null : swap,
      });
      this.trees.push(mats);
      this.materials.push(mats.material, mats.depth);
      const kitIds =
        clouds && k.id === 'tree-conifer' && conifers
          ? conifers.kit.filter((id) => o.propKit?.has(id))
          : [];
      if (kitIds.length > 0 && o.propKit) {
        const kitMat = nearKitTreeMaterial(this.treeSwap);
        this.materials.push(kitMat);
        for (const id of kitIds) {
          const lods = o.propKit.lodsFor(id, {
            baseMaterial: kitMat,
            tintSlots: [`${id}-needles`],
            // Measured against the spruce cards they replace (shots --tree-swap-check).
            colourScale: NEAR_CONIFER_TONE,
            // High and Mobile levels only (the far level is not fetched: cards draw beyond the
            // swap band); the finest very near, nothing past the band.
            distanceCaps: [NEAR_CONIFER_HIGH, wq.treeCloud + 15],
          });
          if (!lods) continue;
          const nearId = `${k.id}-near-${id}`;
          props.define({
            id: nearId,
            // Small cells: the levels go by a cell's near edge, and each kit conifer is
            // thousands of triangles, so a cell should not reach far past the swap distance.
            gridCell: NEAR_CONIFER_CELL,
            // The cards cast every tree's shadow (see treeMaterials).
            castShadow: false,
            shadowMaxDistance: 170,
            receiveShadow: true,
            lods,
          });
          nearKits.push({ id: nearId, height: o.propKit.entries.get(id)?.bounds?.max[1] ?? 16 });
        }
      } else if (clouds && !deep) {
        const cm = treeCloudMaterials(
          atlas,
          k.id,
          { wind: wq.wind, coverage },
          mats.time,
          this.treeSwap,
        );
        this.materials.push(cm.material, cm.depth);
        props.define({
          id: `${k.id}-near`,
          gridCell: 120,
          // The cards cast every tree's shadow (see treeMaterials).
          castShadow: false,
          shadowMaxDistance: 170,
          receiveShadow: true,
          lods: [
            {
              geometry:
                k.id === 'tree-row' || k.id === 'tree-conifer' ? clouds.column : clouds.broad,
              material: cm.material,
              depthMaterial: cm.depth,
              // Near-edge distance of the chunk: the swap distance plus the dither band.
              maxDistance: wq.treeCloud + 15,
            },
          ],
        });
      }
      props.define({
        id: k.id,
        gridCell: 320,
        castShadow: quality.sceneryShadows,
        shadowMaxDistance: 170,
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
      if (checkCover && !cover.treeAllowed(x, z)) return false;
      this.lap.nearest(x, z, hit);
      if (hit.dist < this.lap.barrierAt(hit.index, hit.d) + TREE_CLEARANCE) return false;
      const n = serial++;
      const h1 = hash01(n, 11);
      const h2 = hash01(n, 12);
      const h3 = hash01(n, 13);
      const placement: PropPlacement = {
        x,
        y: this.heightAt(x, z) - 0.25,
        z,
        s: hit.s,
        yaw: hash01(n, 14) * Math.PI * 2,
        scale: size * (0.72 + 0.56 * h1),
        colour: [0.84 + 0.22 * h2, 0.88 + 0.16 * h3, 0.8 + 0.2 * h1],
      };
      const deep =
        kind === 'tree-conifer' &&
        nearKits.length > 0 &&
        hit.dist > this.lap.barrierAt(hit.index, hit.d) + TREE_CLEARANCE + NEAR_CONIFER_BAND;
      props.place(deep ? 'tree-conifer-deep' : kind, placement);
      if (cloud && !deep) {
        if (kind === 'tree-conifer' && nearKits.length > 0) {
          const nk = nearKits[Math.floor(hash01(n, 15) * nearKits.length)] as (typeof nearKits)[0];
          props.place(nk.id, { ...placement, scale: (placement.scale ?? 1) / nk.height });
        } else props.place(`${kind}-near`, placement);
      }
      return true;
    };
    const step = Math.sqrt(1 / (WOOD_DENSITY * wq.treeDensity));
    let coniferCount = 0;
    const fillArea = (f: MappedFeature, density: number, size: number, salt: number): number => {
      const [x0, z0, x1, z1] = bounds(f.p);
      const sp = step / Math.sqrt(density);
      // Conifers by the wood's mapped leaf type (none where the theme has no conifers).
      const share = coniferShare(theme, f.t);
      let placed = 0;
      for (let j = 0, z = z0; z < z1; j++, z += sp) {
        for (let i = 0, x = x0; x < x1; i++, x += sp) {
          const px = x + (hash01(i, j, salt) - 0.5) * sp * 0.9;
          const pz = z + (hash01(i, j, salt + 1) - 0.5) * sp * 0.9;
          if (!inRing(f.p, px, pz)) continue;
          const conifer = share > 0 && hash01(i, j, salt + 2) < share;
          if (place(conifer ? 'tree-conifer' : 'tree-wood', px, pz, size)) {
            placed++;
            if (conifer) coniferCount++;
          }
        }
      }
      return placed;
    };
    let woods = 0;
    dressing.mapped.wood.forEach((f, n) => (woods += fillArea(f, 1, 20, 1000 + n * 7)));
    dressing.mapped.scrub.forEach((f, n) => (woods += fillArea(f, 0.35, 9, 5000 + n * 7)));
    // Without the structures (Lite, software-WebGL tests) the woods alone: one tree shader.
    const woodsOnly = !wq.structures;
    let rows = 0;
    for (const f of woodsOnly ? [] : dressing.mapped.treeRow) {
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
    for (let i = 0; !woodsOnly && i + 1 < tp.length; i += 2) {
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
          const conifer = conifers !== null && hash01(ring, i, 43) < conifers.untyped;
          if (place(conifer ? 'tree-conifer' : 'tree-wood', px, pz, 28 + ring * 6, false))
            skyline++;
        }
      }
    }
    this.counts.treesWood = woods;
    this.counts.treesRow = rows;
    this.counts.treesSingle = singles;
    this.counts.treesSkyline = skyline;
    if (conifers) this.counts.treesConifer = coniferCount;
  }

  private placeBuildings(o: CircuitWorldOptions): void {
    const pitFoot = this.pitComplex?.footprint ?? [];
    // A street circuit's smaller buildings by the track are the kit's marina backdrops.
    const street = this.theme.street;
    const kit = o.propKit;
    const backdrops =
      street && kit
        ? pickBackdrops(
            o.dressing.mapped.building,
            this.lap,
            this.heightAt,
            street,
            kit,
            buildingHeight,
          )
        : [];
    const asBackdrop = new Set(backdrops.map((b) => b.feature));
    if (kit && backdrops.length > 0) {
      const windows = windowMaterial(o.night ?? false);
      this.materials.push(windows);
      for (const id of new Set(backdrops.map((b) => b.kitId))) {
        const lods = kit.lodsFor(id, {
          materialOverrides: { 'window-emissive-mask': windows },
          // Seen across the city: as far as the mapped buildings.
          maxDistanceScale: 3.4,
          distanceCaps: [80, 300, FAR_BUILDINGS],
        });
        if (!lods) continue;
        o.props.define({
          id: `backdrop-${id}`,
          castShadow: o.quality.sceneryShadows,
          shadowMaxDistance: 220,
          receiveShadow: true,
          lods,
        });
      }
      for (const b of backdrops)
        o.props.place(`backdrop-${b.kitId}`, {
          x: b.x,
          y: b.y,
          z: b.z,
          yaw: b.yaw,
          scale: b.scale,
          s: b.s,
        });
      this.counts.backdrops = backdrops.length;
    }
    const { chunks, count } = buildBuildingChunks(
      o.dressing.mapped.building,
      this.heightAt,
      (f) => {
        if (asBackdrop.has(f.id)) return true;
        // Buildings reaching into the circuit (mapped over a road the race closes, the pit lane
        // or under bridges) stay out, whole footprint judged.
        if (footprintOnTrack(f.p, this.lap)) return true;
        const [x0, z0, x1, z1] = bounds(f.p);
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;
        // Exclude mapped OSM slabs overlapping the dedicated pit complex (e.g. Palazzina Box).
        if (pitFoot.length >= 6) {
          if (inRing(pitFoot, cx, cz)) return true;
          for (let i = 0; i + 1 < f.p.length; i += 2) {
            if (inRing(pitFoot, f.p[i] as number, f.p[i + 1] as number)) return true;
          }
        }
        return false;
      },
      320,
      this.theme.buildings,
    );
    this.counts.buildings = count;
    const mat = facadeMaterial(o.night ?? false, this.theme.buildings.variety ?? false);
    this.materials.push(mat);
    chunks.forEach((ch, ci) => {
      this.geometries.push(ch.geometry);
      const mesh = new Mesh(ch.geometry, mat);
      mesh.name = ci === 0 ? 'world:buildings' : `world:buildings-${ci}`;
      mesh.castShadow = o.quality.sceneryShadows;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.addWorldChunk(mesh, ch.centre, ch.radius, FAR_BUILDINGS, 220);
    });
  }

  private placeStands(o: CircuitWorldOptions): void {
    o.dressing.mapped.grandstand.forEach((f, n) => {
      const fr = fitStand(f, this.lap, this.heightAt, n);
      if (fr) this.stands.push(fr);
    });
    this.counts.stands = this.stands.length;
    if (this.stands.length === 0) return;
    const fallback: StandFrame[] = [];
    const spectator = this.spectators(o);
    let kitCrowd = 0;
    for (const [i, fr] of this.stands.entries()) {
      const kitId = fr.roof ? 'grandstand-roof' : 'grandstand';
      const entry = o.propKit?.entries.get(kitId);
      const lods = o.propKit?.lodsFor(kitId, { maxDistanceScale: 2.7 });
      if (!entry || !lods) {
        fallback.push(fr);
        continue;
      }
      const n = Math.max(1, Math.round(fr.length / 10));
      const pitch = fr.length / n;
      const sx = fr.depth / 9.47;
      const sy = Math.max(0.7, fr.rows / 10);
      const sz = pitch / 10;
      for (const l of lods) l.geometry.scale(sx, sy, sz);
      const id = `stand-kit-${i}`;
      o.props.define({
        id,
        lods,
        chunkLength: 40,
        castShadow: o.quality.sceneryShadows,
        shadowMaxDistance: 240,
      });
      const yaw = Math.atan2(fr.bz, -fr.bx);
      for (let m = 0; m < n; m++) {
        const x = fr.ox + fr.ax * ((m + 0.5) * pitch) + fr.bx * (4.76 * sx);
        const z = fr.oz + fr.az * ((m + 0.5) * pitch) + fr.bz * (4.76 * sx);
        o.props.place(id, { x, y: fr.base, z, yaw, s: fr.s, colour: fr.seat });
        for (const [row, a] of (entry.attachments ?? [])
          .filter((a) => a.name.startsWith('crowd-row-'))
          .entries()) {
          for (let j = 0; j < (a.count ?? 0); j++) {
            const k = i * 100000 + m * 1000 + row * 30 + j;
            if (hash01(k, 77) > o.quality.world.crowd * 0.85) continue;
            const lx = a.position[0] * sx;
            const lz = (a.position[2] + j * (a.spacing ?? 0.55)) * sz;
            spectator({
              x: x - fr.bx * lx + fr.ax * lz,
              y: fr.base + a.position[1] * sy,
              z: z - fr.bz * lx + fr.az * lz,
              yaw,
              s: fr.s,
              k,
              near: row < 4,
            });
            kitCrowd++;
          }
        }
      }
    }
    this.counts.kitStandModules = this.stands.reduce(
      (sum, fr) => sum + Math.max(1, Math.round(fr.length / 10)),
      0,
    );
    const standChunks = buildStandChunks(fallback);
    const standMat = grandstandMaterial();
    this.materials.push(standMat);
    standChunks.forEach((ch, ci) => {
      this.geometries.push(ch.geometry);
      const mesh = new Mesh(ch.geometry, standMat);
      mesh.name = ci === 0 ? 'world:stands' : `world:stands-${ci}`;
      mesh.castShadow = o.quality.sceneryShadows;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.addWorldChunk(mesh, ch.centre, ch.radius, FAR_STANDS, 240);
    });

    // Crowd: fuller near the start line and the first chicane, thinner at the back of big stands.
    const wq = o.quality.world;
    if (wq.crowd <= 0) return;
    const L = o.track.length;
    const seats = crowdSeats(fallback, (fr, row) => {
      const ds = Math.min(Math.abs(fr.s), Math.abs(L - fr.s));
      const busy = 0.55 + 0.4 * Math.exp(-ds / 600);
      return wq.crowd * busy * (row > fr.rows * 0.8 ? 0.75 : 1);
    });
    for (const seat of seats) spectator(seat);
    this.counts.crowd = seats.length + kitCrowd;
  }

  /**
   * Place one spectator on a seat (the crowd kinds are defined on first use): variant, clothes,
   * a little turn and size from the seat's number `k`.
   */
  private spectators(
    o: CircuitWorldOptions,
  ): (seat: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    s: number;
    k: number;
    near?: boolean;
  }) => void {
    const variants = 3;
    if (this.crowdKinds === 0) {
      const mats = crowdMaterial(this.crowdTime);
      this.materials.push(mats);
      for (let v = 0; v < variants; v++) {
        const g = spectatorGeometry(v);
        this.geometries.push(g);
        const farMat = crowdMaterial(this.crowdTime);
        crowdSwapMaterial(farMat, this.crowdEye, false);
        this.materials.push(farMat);
        o.props.define({
          id: `crowd-far-${v}`,
          castShadow: false,
          gridCell: 16,
          lods: [{ geometry: g, material: farMat, maxDistance: 650 }],
        });
        o.props.define({
          id: `crowd-${v}`,
          castShadow: false,
          receiveShadow: true,
          lods: [{ geometry: g, material: mats, maxDistance: 650 }],
        });
      }
      const nearMat = createPropKitMaterial({ swayTime: this.crowdTime });
      crowdSwapMaterial(nearMat, this.crowdEye, true);
      this.materials.push(nearMat);
      for (let v = 0; v < variants; v++) {
        const lods = o.propKit?.lodsFor(`crowd-seated-${v}`, {
          baseMaterial: nearMat,
          slotColors: { clothing: [1, 1, 1] },
        });
        if (!lods) continue;
        for (const l of lods) l.geometry.translate(0, -0.5, 0);
        o.props.define({
          id: `crowd-near-${v}`,
          castShadow: false,
          gridCell: 16,
          lods: lods.map((l) => ({ ...l, maxDistance: Math.min(l.maxDistance, 65) })),
        });
      }
      this.crowdKinds = variants;
    }
    return (seat) => {
      const c = CLOTHING[Math.floor(hash01(seat.k, 3) * CLOTHING.length)] as [
        number,
        number,
        number,
      ];
      const placement = {
        x: seat.x,
        y: seat.y,
        z: seat.z,
        s: seat.s,
        yaw: seat.yaw + (hash01(seat.k, 4) - 0.5) * 0.5,
        scale: 0.94 + hash01(seat.k, 5) * 0.12,
        colour: c,
      };
      const v = seat.k % variants;
      const near = seat.near !== false && o.propKit?.has(`crowd-seated-${v}`);
      if (near) {
        o.props.place(`crowd-near-${v}`, placement);
        o.props.place(`crowd-far-${v}`, placement);
      } else o.props.place(`crowd-${v}`, placement);
    };
  }

  /** Start gantry, bridges, historic banking, trackside furniture and place-dependent surface decals. */
  private placeFurnitureAndDecals(o: CircuitWorldOptions): void {
    const { track, dressing, quality, props } = o;
    const mobile = quality.world.terrain !== 'high';
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
    const gantry = buildStartGantry(track, brandTex, 0, o.propKit, props);
    this.startGantry = gantry;
    this.geometries.push(...gantry.geometries);
    this.materials.push(...gantry.materials);
    this.group.add(gantry.group);

    // Over-track bridges from OSM + authored config (chunked per bridge).
    const bridges = buildTrackBridges(track, dressing, this.lap, brandTex, o.propKit, props);
    this.geometries.push(...bridges.geometries);
    this.materials.push(...bridges.materials);
    if (bridges.count > 0) {
      this.group.add(bridges.group);
      for (const child of bridges.group.children) {
        const m = child as Mesh;
        if (!m.isMesh) continue;
        m.castShadow = m.castShadow && quality.sceneryShadows;
        const bs = m.geometry.boundingSphere;
        if (bs) {
          this.addWorldChunk(
            m,
            [bs.center.x, bs.center.y, bs.center.z],
            bs.radius,
            FAR_BRIDGES,
            240,
          );
        }
      }
    }
    this.counts.bridges = bridges.count;

    if (o.propKit)
      this.counts.kitBarriers = placeKitBarriers(
        track,
        this.lap,
        o.propKit,
        props,
        this.theme.street !== null,
      );

    // Historic banked oval concrete where mapped (e.g., Monza's Sopraelevata).
    const banking = buildHistoricBanking(dressing.mapped.raceway, this.heightAt, this.lap);
    if (banking.mesh && banking.geometry && banking.material) {
      this.geometries.push(banking.geometry);
      this.materials.push(banking.material);
      banking.mesh.castShadow = quality.sceneryShadows;
      this.group.add(banking.mesh);
      const bs = banking.geometry.boundingSphere;
      if (bs) {
        this.addWorldChunk(
          banking.mesh,
          [bs.center.x, bs.center.y, bs.center.z],
          bs.radius,
          FAR_STANDS,
          220,
        );
      }
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
      propKit: o.propKit ?? null,
      brandAtlasTex: brandTex,
      signageAtlasTex: signTex,
      fenceTex,
      castShadows: quality.sceneryShadows,
      mobile,
      geometries: this.geometries,
      materials: this.materials,
      textures: this.textures,
      street: this.theme.street !== null,
    });
    Object.assign(this.counts, furnCounts);

    // A street circuit's walls, debris fencing, floodlight masts and temporary stands (street.ts).
    const street = this.theme.street;
    if (street && o.propKit) {
      const boards = brandHoardingMaterial(brandTex, true);
      this.materials.push(boards);
      const res = placeStreetCircuit({
        track,
        lap: this.lap,
        props,
        kit: o.propKit,
        street,
        obstacles: [...dressing.mapped.building, ...dressing.mapped.water],
        // On the ground the lamp map is baked on: the track's own by the track.
        heightAt: streetGround(track, this.lap, this.heightAt),
        night: o.night ?? false,
        mobile,
        castShadows: quality.sceneryShadows,
        boardMaterial: boards,
        materials: this.materials,
        spectator: this.spectators(o),
        crowd: quality.world.crowd,
      });
      Object.assign(this.counts, {
        ...res.counts,
        crowd: (this.counts.crowd ?? 0) + (res.counts.crowd ?? 0),
      });
      this.localLights.push(...res.lights);
    }

    // Surface decals (start/finish chequer, grid numbers, pit-lane lines, painted run-off chevrons).
    const decals = buildSurfaceDecals(track, quality.anisotropy);
    this.geometries.push(...decals.geometries);
    this.materials.push(...decals.materials);
    this.textures.push(...decals.textures);
    this.group.add(decals.group);
    for (const child of decals.group.children) {
      const m = child as Mesh;
      if (!m.isMesh) continue;
      m.matrixAutoUpdate = false;
      const bs = m.geometry.boundingSphere;
      if (bs) {
        this.addWorldChunk(m, [bs.center.x, bs.center.y, bs.center.z], bs.radius, FAR_DECALS, 0);
      }
    }
  }

  /** Per frame: wind, crowd motion, and chunk distance / shadow-cascade gating. */
  update(time: number, eye?: Vector3): void {
    for (const t of this.trees) t.time.value = time;
    if (eye) this.treeSwap.eye.value.copy(eye);
    this.crowdTime.value = time;
    if (eye) this.crowdEye.value.copy(eye);
    if (!eye) return;
    for (const c of this.worldChunks) {
      const dist = c.centre.distanceTo(eye) - c.radius;
      const vis = dist < c.maxDistance;
      c.mesh.visible = vis;
      c.mesh.castShadow = vis && c.castShadow && dist < c.shadowMaxDistance;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.cover?.dispose();
    this.group.removeFromParent();
  }
}

import type { Species } from './tree-atlas';

/**
 * What makes one circuit's surroundings look like its region, beyond what its dressing file maps:
 * the tree species, the building colours, which kit models stand in for the pit building, the
 * stands and the street furniture, and whether the circuit runs between street walls under
 * floodlights. `CircuitWorld` reads the theme for the track's id and stays circuit-agnostic;
 * a circuit without an entry gets the default (Monza's) look.
 */

/** Atlas tiles (tree-atlas.ts SPECIES order) for each kind of tree. */
export interface TreeMix {
  /** Woods and scrub where the map says broadleaved or nothing. */
  wood: readonly number[];
  /** Tree rows along roads and paths. */
  row: readonly number[];
  /** Single park trees. */
  park: readonly number[];
}

/**
 * Conifers in the woods: spruce cards at a distance, the kit's spruce and fir models up close
 * (where the presets draw near trees as geometry). The share of conifers in a wood follows its
 * mapped `leaf_type`; woods the map leaves untyped take `untyped`.
 */
export interface ConiferWoods {
  /** Atlas tiles for the conifer cards. */
  tiles: readonly number[];
  /** Kit models for the near conifers (prop catalogue ids), picked per tree. */
  kit: readonly string[];
  /** Conifer share in needleleaved, mixed and untyped woods. */
  needleleaved: number;
  mixed: number;
  untyped: number;
}

export interface BuildingPalette {
  /** Wall colours (sRGB hex), one per building by hash. */
  walls: readonly string[];
  /** Flat roof colours (sRGB hex). */
  roofs: readonly string[];
}

export interface WorldTheme {
  id: string;
  trees: TreeMix;
  /** The region's form of atlas species, by name (tree-atlas.ts SPECIES). */
  species: Readonly<Record<string, Partial<Species>>>;
  conifers: ConiferWoods | null;
  buildings: BuildingPalette;
  /**
   * The pit building: the built-up modern block (`building`) or a row of the kit's hill pit
   * garage modules, one per bay (`kit-garages`).
   */
  pit: 'building' | 'kit-garages';
}

/** Lombardy plaster, ochre and brick, kept below white so facades read as painted render in sun. */
const LOMBARDY: BuildingPalette = {
  walls: ['#c9b896', '#d0ad7f', '#b98d66', '#c8bba0', '#a89a86', '#c49c6c', '#d3c3a2', '#9a7a62'],
  roofs: ['#8e4b33', '#9a5a3c', '#7d4430', '#5d5a57', '#6b6762', '#8a8580'],
};

/**
 * Ardennes: whitewashed render, grey limestone and dark schist, slate roofs (with a few
 * weathered tile ones on barns).
 */
const ARDENNES: BuildingPalette = {
  walls: ['#cfccc3', '#bdb8ad', '#a39d92', '#8d8780', '#d6d2c8', '#9b9184', '#b5ab9b', '#77726c'],
  roofs: ['#3d4045', '#45484d', '#36393e', '#4e5156', '#5a5650', '#6e4a3a'],
};

export const DEFAULT_THEME: WorldTheme = {
  id: 'default',
  trees: {
    wood: [0, 1, 3, 6, 1, 0, 7, 5],
    row: [4, 4, 1, 2],
    park: [2, 0, 3, 6],
  },
  species: {},
  conifers: null,
  buildings: LOMBARDY,
  pit: 'building',
};

const THEMES: Readonly<Record<string, WorldTheme>> = {
  monza: { ...DEFAULT_THEME, id: 'monza' },
  spa: {
    id: 'spa',
    // Beech and oak in the broadleaved woods (the young tree for regrowth and edges); the
    // conifer plantations come from `conifers`.
    trees: {
      wood: [1, 0, 6, 1, 7, 3, 1, 6],
      row: [1, 0, 6, 4],
      park: [0, 6, 1, 2],
    },
    // Plantation spruce: as slim as the kit's spruce and fir that take over from the cards up
    // close (crown half-width 0.14 and 0.2 of the height), with as many clumps per area.
    species: { spruce: { crownRx: 0.16, clumps: 300 } },
    conifers: {
      tiles: [5],
      kit: ['forest-spruce', 'forest-fir'],
      needleleaved: 0.92,
      mixed: 0.5,
      untyped: 0.45,
    },
    buildings: ARDENNES,
    pit: 'kit-garages',
  },
};

export function worldTheme(circuit: string): WorldTheme {
  return THEMES[circuit] ?? DEFAULT_THEME;
}

/** Conifer share of a mapped wood (by its `leaf_type`), 0 when the theme has no conifers. */
export function coniferShare(
  theme: WorldTheme,
  tags: Readonly<Record<string, string>> = {},
): number {
  const c = theme.conifers;
  if (!c) return 0;
  const leaf = tags.leaf_type;
  if (leaf === 'needleleaved') return c.needleleaved;
  if (leaf === 'mixed') return c.mixed;
  if (leaf === 'broadleaved') return 0.04;
  return c.untyped;
}

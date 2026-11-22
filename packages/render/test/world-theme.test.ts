import { describe, expect, it } from 'vitest';
import catalogJson from '../data/props.catalog.json';
import spaDressingJson from '../data/spa.dressing.json';
import {
  WORLD_CATALOG_PROP_IDS,
  nearTreePropIds,
  selectCatalogLods,
  worldCatalogPropIds,
  type PropCatalogEntry,
} from '../src/props/catalog';
import { buildBuildings } from '../src/world/buildings';
import { decodeTerrain, gridHeight, type DressingFile } from '../src/world/dressing';
import { SPECIES } from '../src/world/tree-atlas';
import { DEFAULT_THEME, coniferShare, worldTheme } from '../src/world/theme';

const spaDressing = spaDressingJson as unknown as DressingFile;
const HIGH = { world: { treeCloud: 95 } };
const MOBILE = { world: { treeCloud: 0 } };

describe('circuit themes', () => {
  it("keeps Monza's trees and buildings as they were, and gives unknown circuits the same", () => {
    const monza = worldTheme('monza');
    expect(monza.trees).toEqual({
      wood: [0, 1, 3, 6, 1, 0, 7, 5],
      row: [4, 4, 1, 2],
      park: [2, 0, 3, 6],
    });
    expect(monza.conifers).toBeNull();
    expect(monza.species).toEqual({});
    expect(monza.pit).toBe('building');
    expect(monza.buildings).toBe(DEFAULT_THEME.buildings);
    expect(worldTheme('nowhere')).toBe(DEFAULT_THEME);
  });

  it('plants Spa conifers by the wood’s mapped leaf type, none at Monza', () => {
    const spa = worldTheme('spa');
    expect(coniferShare(spa, { leaf_type: 'needleleaved' })).toBeGreaterThan(0.85);
    expect(coniferShare(spa, { leaf_type: 'mixed' })).toBeCloseTo(0.5);
    expect(coniferShare(spa, { leaf_type: 'broadleaved' })).toBeLessThan(0.1);
    expect(coniferShare(spa, {})).toBeGreaterThan(0.3);
    expect(coniferShare(worldTheme('monza'), { leaf_type: 'needleleaved' })).toBe(0);
  });

  it('names only real atlas tiles and species', () => {
    const names = new Set(SPECIES.map((s) => s.name));
    for (const id of ['monza', 'spa']) {
      const t = worldTheme(id);
      for (const tile of [
        ...t.trees.wood,
        ...t.trees.row,
        ...t.trees.park,
        ...(t.conifers?.tiles ?? []),
      ])
        expect(tile >= 0 && tile < SPECIES.length, `${id} tile ${tile}`).toBe(true);
      for (const name of Object.keys(t.species)) expect(names.has(name), name).toBe(true);
    }
    expect(SPECIES[worldTheme('spa').conifers!.tiles[0]!]!.name).toBe('spruce');
  });
});

describe('prop ids per circuit', () => {
  const catalogIds = new Set((catalogJson as { props: { id: string }[] }).props.map((p) => p.id));

  it('loads only the common props at Monza, on every preset', () => {
    expect(worldCatalogPropIds('monza', HIGH)).toEqual([...WORLD_CATALOG_PROP_IDS]);
    expect(worldCatalogPropIds('monza', MOBILE)).toEqual([...WORLD_CATALOG_PROP_IDS]);
  });

  it("adds Spa's garages everywhere and its kit conifers only where near trees are drawn", () => {
    const high = worldCatalogPropIds('spa', HIGH);
    const mobile = worldCatalogPropIds('spa', MOBILE);
    expect(high).toContain('hill-pit-garage');
    expect(mobile).toContain('hill-pit-garage');
    expect(high).toEqual(expect.arrayContaining(['forest-spruce', 'forest-fir']));
    expect(mobile).not.toContain('forest-spruce');
    expect(mobile).not.toContain('forest-fir');
    for (const id of high) expect(catalogIds.has(id), id).toBe(true);
    for (const kit of worldTheme('spa').conifers!.kit) expect(high).toContain(kit);
  });
});

describe('near-tree models', () => {
  it('load without their far level, which the cards replace', () => {
    expect([...nearTreePropIds('spa')].sort()).toEqual(['forest-fir', 'forest-spruce']);
    expect(nearTreePropIds('monza').size).toBe(0);
    const spruce = (catalogJson as unknown as { props: PropCatalogEntry[] }).props.find(
      (p) => p.id === 'forest-spruce',
    )!;
    const all = selectCatalogLods(spruce, { name: 'high' });
    const near = selectCatalogLods(spruce, { name: 'high' }, true);
    expect(all.some((l) => l.file.endsWith('_far.glb'))).toBe(true);
    expect(near.map((l) => l.file.replace(/^.*_/, ''))).toEqual(['high.glb', 'mobile.glb']);
  });
});

describe('Spa dressing', () => {
  it('has typed woods for the conifers and a finite, canopy-free terrain grid', () => {
    const types = new Set(spaDressing.mapped.wood.map((f) => f.t?.leaf_type ?? ''));
    expect(types.has('needleleaved')).toBe(true);
    expect(types.has('broadleaved')).toBe(true);
    const grid = decodeTerrain(spaDressing.terrain);
    // The track datum is the start line; the land around it lies within the valley's range.
    for (const [x, z] of [
      [0, 0],
      [1500, -1500],
      [-2000, 2500],
    ] as const) {
      const h = gridHeight(grid, x, z);
      expect(Number.isFinite(h)).toBe(true);
      expect(Math.abs(h)).toBeLessThan(250);
    }
  });

  it('paints the buildings in the theme’s colours', () => {
    const square = {
      id: 'w/1',
      p: [0, 0, 20, 0, 20, 20, 0, 20, 0, 0],
      t: { building: 'yes' },
    };
    const colours = (walls: string[]): number[] => {
      const { geometry } = buildBuildings([square], () => 0, undefined, {
        walls,
        roofs: ['#000000'],
      });
      return Array.from(geometry.getAttribute('color').array.slice(0, 3));
    };
    const grey = colours(['#808080']);
    const white = colours(['#ffffff']);
    expect(grey[0]).toBeCloseTo(grey[1]!, 6);
    expect(white[0]).toBeGreaterThan(grey[0]! * 3);
  });
});

import compounds from '../../../../../design/compounds.json';

/** The tyres as the HUD shows them, when the session models them. SI units (K, kg). */
export interface HudTyres {
  /** Compound fitted: 'soft', 'medium' or 'hard'. */
  compound: string;
  /** Tread temperature per tyre, K: front left, front right, rear left, rear right. */
  temp: ArrayLike<number>;
  /** Wear per tyre, 0 new to 1 the tread gone. */
  wear: ArrayLike<number>;
  /** The compound's working range, K. */
  low: number;
  high: number;
}

export type TyreBand = 'cold' | 'ok' | 'warm' | 'hot';

/** Over the window by up to this much a tread is warm, past it hot, K. */
const WARM = 10;

/** Where a tread temperature sits against its compound's working range. */
export function tyreBand(temp: number, low: number, high: number): TyreBand {
  if (temp < low) return 'cold';
  if (temp <= high) return 'ok';
  return temp <= high + WARM ? 'warm' : 'hot';
}

/** A tread temperature for the HUD: whole °C. */
export function formatTyreTemp(kelvin: number): string {
  return `${Math.round(kelvin - 273.15)}°`;
}

/** Fuel on board for the HUD, kg to a tenth. */
export function formatFuel(kg: number): string {
  return `${Math.max(0, kg).toFixed(1)} kg`;
}

export interface CompoundMark {
  code: string;
  colour: string;
  slots: readonly number[];
}

/** A compound's code, colour and tick slots (design/compounds.json); medium when unknown. */
export function compoundMark(id: string): CompoundMark {
  const c =
    compounds.compounds.find((k) => k.id === id) ??
    compounds.compounds.find((k) => k.id === 'medium') ??
    compounds.compounds[0]!;
  return { code: c.code, colour: c.colour, slots: c.slots };
}

/** Saved generator state: four unsigned 32-bit words. */
export type RngState = readonly [number, number, number, number];

/**
 * A seeded pseudo-random generator. The simulation never calls `Math.random()`;
 * it is handed one of these so that a seed reproduces a session on one machine.
 */
export interface Rng {
  /** Next unsigned 32-bit integer in [0, 2^32). */
  nextUint32(): number;
  /** Next float in [0, 1), with 32 bits of resolution. */
  next(): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max], both ends inclusive. */
  int(min: number, max: number): number;
  /** Copy of the current state, for snapshots and replays. */
  getState(): RngState;
  /** Restore a state previously returned by `getState`. */
  setState(state: RngState): void;
}

const TWO_POW_32 = 4294967296;

/** splitmix32: spreads a single seed into well-mixed words, so seed 0 is fine. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/**
 * Create a generator from a 32-bit seed. The algorithm is sfc32 (Chris Doty-Humphrey's
 * Small Fast Counting generator), seeded through splitmix32 and warmed up for 12 rounds.
 */
export function createRng(seed: number): Rng {
  const mix = splitmix32(seed);
  let a = mix();
  let b = mix();
  let c = mix();
  let d = mix();

  const nextUint32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };

  for (let i = 0; i < 12; i++) nextUint32();

  const next = (): number => nextUint32() / TWO_POW_32;

  return {
    nextUint32,
    next,
    range(min, max) {
      return min + (max - min) * next();
    },
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`int(${min}, ${max}) needs integers with min <= max`);
      }
      return min + Math.floor(next() * (max - min + 1));
    },
    getState() {
      return [a, b, c, d];
    },
    setState(state) {
      [a, b, c, d] = state.map((w) => w >>> 0) as [number, number, number, number];
    },
  };
}

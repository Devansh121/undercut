/** Short git hash of the build, injected by vite.config.ts. */
declare const __BUILD_HASH__: string;

interface ImportMetaEnv {
  /** Optional build-time override of the rooms service URL. Defaults to same-origin /rooms. */
  readonly VITE_ROOMS_URL?: string;
}

/** The circuit catalog built from packages/track/data by vite.config.ts. */
declare module 'virtual:undercut/circuits' {
  import type { CircuitSummary } from './ui/data/circuit-summary';
  export const CIRCUITS: CircuitSummary[];
}

/** A text file bundled as a string (Vite `?raw`): the credits screen reads CREDITS.md. */
declare module '*.md?raw' {
  const text: string;
  export default text;
}

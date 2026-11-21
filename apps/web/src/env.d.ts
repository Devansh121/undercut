/** Short git hash of the build, injected by vite.config.ts. */
declare const __BUILD_HASH__: string;

interface ImportMetaEnv {
  /** Optional build-time override of the rooms service URL. Defaults to same-origin /rooms. */
  readonly VITE_ROOMS_URL?: string;
}

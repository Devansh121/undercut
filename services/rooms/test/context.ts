/** What the rooms global setup provides to tests (see global-setup.ts). */
import type { RoomTimings } from '@undercut/protocol';

declare module 'vitest' {
  export interface ProvidedContext {
    roomsUrl: string;
    /** File collecting the service's own log output (errors only). */
    roomsLog: string;
    roomTimings: Partial<RoomTimings>;
  }
}

export {};

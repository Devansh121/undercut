import type { TestProject } from 'vitest/node';
import { freePort } from '../../../tools/serve/ports.mjs';
import { startRooms } from '../../../tools/serve/rooms.mjs';

declare module 'vitest' {
  export interface ProvidedContext {
    roomsUrl: string;
  }
}

/** Starts the rooms Worker on the local Workers runtime once for the whole run. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const port = await freePort();
  const rooms = await startRooms({ port, quiet: true, log: () => {} });
  project.provide('roomsUrl', rooms.url);
  return () => rooms.stop();
}

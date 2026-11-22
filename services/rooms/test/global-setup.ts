import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';
import type { RoomTimings } from '@undercut/protocol';
import { freePort } from '../../../tools/serve/ports.mjs';
import { startRooms } from '../../../tools/serve/rooms.mjs';
import './context';

/**
 * Room timings for tests: the real sequence (countdown, grid, formation, five lights,
 * random hold, grace periods) compressed so a race and its aftermath fit in seconds.
 */
export const TEST_TIMINGS: Partial<RoomTimings> = {
  readyCountdownMs: 300,
  gridTimeoutMs: 5000,
  formationMs: 600,
  lightIntervalMs: 200,
  holdMinMs: 100,
  holdMaxMs: 400,
  finishWindowMinMs: 4000,
  resultsLingerMs: 20_000,
  staleMs: 1000,
  awayMs: 3000,
  graceMs: 2500,
  joinTimeoutMs: 5000,
  roomLingerMs: 5000,
};

/** Starts the rooms Worker on the local Workers runtime once for the whole run. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const port = await freePort();
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-log-')), 'service.log');
  fs.writeFileSync(logFile, '');
  // No `persistTo`: the service then keeps its state in a private directory on memory
  // (/dev/shm) where there is one. On disk, the room's storage fsyncs about ten times a second
  // during a race, and each one stalls its snapshot relay: on a slow CI disk that showed up as
  // relayed-frame stalls of 140 to 320 ms and failed the soak's remote-car error bounds.
  const rooms = await startRooms({
    port,
    quiet: true,
    log: (text: string) => fs.appendFileSync(logFile, text),
    vars: {
      ROOM_TIMINGS: JSON.stringify(TEST_TIMINGS),
      // Per client address; every test creates rooms from its own address.
      CREATE_LIMIT: '20/60000',
    },
  });
  project.provide('roomsUrl', rooms.url);
  project.provide('roomsLog', logFile);
  project.provide('roomTimings', TEST_TIMINGS);
  return async () => {
    await rooms.stop();
    fs.rmSync(path.dirname(logFile), { recursive: true, force: true });
  };
}

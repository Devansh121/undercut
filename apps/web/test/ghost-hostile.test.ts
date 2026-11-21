import { createRng } from '@undercut/core';
import { createCarPose, type CarPose } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import {
  GHOST_RATE,
  Ghost,
  GhostRecorder,
  MAX_GHOST_SECONDS,
  decodeGhost,
  encodeGhost,
} from '../src/game/ghost';
import { MemoryStorage } from '@undercut/input';
import { RecordStore, memoryStorage } from '../src/game/records';
import { DriveSession } from '../src/game/session';
import { loadMonza } from './fixtures';

const STRIDE = 9;
const HEADER = 20;

function validGhost(seconds = 4): Ghost {
  const rec = new GhostRecorder();
  rec.begin();
  const p = createCarPose();
  for (let i = 0; i <= seconds * 240; i++) {
    const t = i / 240;
    p.x = 50 * t;
    p.yaw = 0.01 * t;
    rec.sample(t, 50 * t, p, i === seconds * 240);
  }
  return rec.finish(seconds);
}

/** Encode raw samples with an arbitrary header, bypassing the recorder's own checks. */
function encodeRaw(count: number, lapTime: number, samples: number[]): string {
  const bytes = new Uint8Array(HEADER + samples.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x55474831, true);
  view.setUint32(4, count, true);
  view.setUint32(8, STRIDE, true);
  view.setFloat64(12, lapTime, true);
  samples.forEach((v, i) => view.setFloat32(HEADER + i * 4, v, true));
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

const sample = (t: number, d: number): number[] => [t, d, d, 0.1, 0, 0, 0, 0, 0];

function finitePose(p: CarPose): boolean {
  return [p.x, p.y, p.z, p.yaw, p.pitch, p.roll, p.steerAngle, ...p.wheelY, ...p.wheelAngle].every(
    Number.isFinite,
  );
}

/** Every playback query either declines or answers with finite numbers. */
function playbackIsSafe(g: Ghost): boolean {
  const out = createCarPose();
  for (const t of [
    -1,
    0,
    1e-9,
    0.01,
    0.5,
    1,
    2,
    g.lapTime / 2,
    g.lapTime,
    g.lapTime + 1,
    NaN,
    Infinity,
  ]) {
    if (g.poseAt(t, out) && !finitePose(out)) return false;
  }
  for (const d of [-1, 0, 1, 100, 1e9, NaN]) {
    const t = g.timeAtDistance(d);
    if (t !== null && !Number.isFinite(t)) return false;
  }
  return true;
}

describe('decodeGhost rejects malformed stored ghosts', () => {
  it('rejects too few samples', () => {
    expect(decodeGhost(encodeRaw(0, 1, []))).toBeNull();
    expect(decodeGhost(encodeRaw(1, 1, sample(0, 0)))).toBeNull();
  });

  it('rejects non-finite or non-positive lap times', () => {
    const two = [...sample(0, 0), ...sample(1, 10)];
    for (const lap of [NaN, Infinity, -Infinity, 0, -5])
      expect(decodeGhost(encodeRaw(2, lap, two))).toBeNull();
  });

  it('rejects timestamps that run backwards, start before zero or end past the lap', () => {
    expect(
      decodeGhost(encodeRaw(3, 2, [...sample(0, 0), ...sample(1, 5), ...sample(0.5, 9)])),
    ).toBeNull();
    expect(decodeGhost(encodeRaw(2, 2, [...sample(-1, 0), ...sample(1, 5)]))).toBeNull();
    expect(decodeGhost(encodeRaw(2, 2, [...sample(0, 0), ...sample(5, 5)]))).toBeNull();
    // Distance must not run backwards either.
    expect(decodeGhost(encodeRaw(2, 2, [...sample(0, 5), ...sample(1, 1)]))).toBeNull();
  });

  it('rejects a header whose count disagrees with the data', () => {
    expect(decodeGhost(encodeRaw(5, 2, [...sample(0, 0), ...sample(1, 5)]))).toBeNull();
  });

  it('accepts a well-formed two-sample ghost and plays it back finitely', () => {
    const g = decodeGhost(encodeRaw(2, 1, [...sample(0, 0), ...sample(1, 10)]));
    expect(g).not.toBeNull();
    expect(playbackIsSafe(g as Ghost)).toBe(true);
  });
});

describe('Ghost playback with undersized recordings', () => {
  it('declines instead of returning NaN poses', () => {
    const out = createCarPose();
    expect(new Ghost(1, new Float32Array(sample(0, 0))).poseAt(0.5, out)).toBe(false);
    expect(new Ghost(1, new Float32Array(0)).poseAt(0.5, out)).toBe(false);
    expect(new Ghost(1, new Float32Array(0)).timeAtDistance(0)).toBeNull();
  });
});

describe('hostile stored ghosts and records (fuzz)', () => {
  const good = encodeGhost(validGhost());
  const rng = createRng(4242);
  const bytesOf = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  const textOf = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

  it('never throws, never plays a non-finite pose', () => {
    const cases: string[] = ['', '=', '****', 'AAAA', good.slice(0, 30), good + 'AAAA'];
    for (let i = 0; i < 400; i++) {
      const b = bytesOf(good);
      const kind = i % 4;
      if (kind === 0) {
        // Random byte flips anywhere, header included.
        for (let k = 0; k < 1 + (i % 7); k++)
          b[Math.floor(rng.next() * b.length)] = Math.floor(rng.next() * 256);
      } else if (kind === 1) {
        // Poison one float with NaN, Infinity or a huge value.
        const view = new DataView(b.buffer);
        const at = HEADER + 4 * Math.floor(rng.next() * ((b.length - HEADER) / 4));
        view.setFloat32(at, [NaN, Infinity, -Infinity, 3e38, -3e38][i % 5] as number, true);
      } else if (kind === 2) {
        // Truncate or extend.
        cases.push(textOf(b.slice(0, Math.floor(rng.next() * b.length))));
        continue;
      } else {
        // Random garbage of random length.
        const n = Math.floor(rng.next() * 200);
        cases.push(textOf(Uint8Array.from({ length: n }, () => Math.floor(rng.next() * 256))));
        continue;
      }
      cases.push(textOf(b));
    }
    for (const text of cases) {
      let g: Ghost | null = null;
      expect(() => (g = decodeGhost(text))).not.toThrow();
      if (g) expect(playbackIsSafe(g)).toBe(true);
    }
  });

  it('a session given a hostile record falls back to no ghost and stays finite', async () => {
    const track = loadMonza();
    const raws: unknown[] = [
      {
        version: 2,
        lap: 90,
        lapSectors: [30, 30, 30],
        bestSectors: [30, 30, 30],
        ghost: encodeRaw(1, 1, sample(0, 0)),
        date: '',
      },
      {
        version: 2,
        lap: 90,
        lapSectors: [30, 30, 30],
        bestSectors: [30, 30, 30],
        ghost: 'not a ghost',
        date: '',
      },
      {
        version: 2,
        lap: 90,
        lapSectors: [30, 30, 30],
        bestSectors: [30, 30, 30],
        ghost: 12,
        date: '',
      },
      { version: 2, lap: 'x', lapSectors: [30], bestSectors: [30] },
      {
        version: 2,
        lap: 90,
        lapSectors: [30, 30, 30],
        bestSectors: [30, 30, 30],
        ghost: encodeRaw(2, Infinity, [...sample(0, 0), ...sample(1, 1)]),
        date: '',
      },
      null,
      [],
      'string',
    ];
    for (const raw of raws) {
      const port = new MemoryStorage();
      await port.save('records.monza', JSON.stringify(raw));
      const record = await new RecordStore(memoryStorage(port)).load('monza');
      let session: DriveSession | null = null;
      expect(() => (session = new DriveSession({ track, seed: 1, record }))).not.toThrow();
      const s = session as unknown as DriveSession;
      expect(s.ghost).toBeNull();
      s.start();
      const out = createCarPose();
      expect(s.ghostPoseAt(1, out)).toBe(false);
      expect(s.liveDelta()).toBeNull();
    }
  });
});

describe('ghost recording limits', () => {
  it('stops recording an abandoned lap at the documented cap, bounding memory', () => {
    const rec = new GhostRecorder();
    rec.begin();
    const p = createCarPose();
    // A car parked for an hour on a running lap, offered every 240 Hz tick.
    for (let i = 0; i < 3600 * 240; i += 1) rec.sample(i / 240, 0, p);
    expect(rec.recording).toBe(false);
    expect(rec.sampleCount).toBeLessThanOrEqual(MAX_GHOST_SECONDS * GHOST_RATE + 2);
    expect(MAX_GHOST_SECONDS).toBeLessThanOrEqual(600);
  });
});

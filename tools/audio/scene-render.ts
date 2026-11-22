/**
 * Offline renders of the scene layer: other cars, circuit ambience, start lights and menu cues.
 * `npm run audio:render scene` writes WAVs, spectrograms and a summary to artifacts/audio/ and
 * short Ogg excerpts, the spectrograms and the summary to docs/evidence/m6-audio/.
 * The player's car is silent in these renders (engine off), so only the scene is heard.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { AudioCore, type AudioScene, type OtherCarSound } from '@undercut/audio';
import { dcOffset, integratedLoudness, truePeak, toDb, maxStep } from '@undercut/audio/analysis';
import { encodeWav } from './wav';
import { spectrogramPng } from './spectrogram-image';

const FS = 48000;
/** Scene updates per second, as the game sends them (one per drawn frame). */
const RATE = 60;
const rpm = (r: number) => (r * Math.PI) / 30;

interface Scenario {
  name: string;
  seconds: number;
  /** What a listener should hear, for the summary. */
  listen: string;
  /** Excerpt to commit: start and length, s. */
  excerpt: [number, number];
  scene(t: number, cars: OtherCarSound[]): AudioScene;
  cues?: [number, Parameters<AudioCore['cue']>[0]][];
}

const base = (extra: Partial<AudioScene>): AudioScene => ({
  cars: [],
  ambience: 'none',
  crowdLeft: 0,
  crowdRight: 0,
  lights: -1,
  ...extra,
});

const SCENARIOS: Scenario[] = [
  {
    name: 'grid-start',
    seconds: 14,
    listen:
      'From the back of the grid, a stand to the left. Lamp tones at 1 s intervals over the field idling at 6000 rpm; lights out at 6 s: a 2 kHz tone, a cheer, the field revs to 11 500 rpm and pulls away, the cars sweep down in pitch as they leave and the far field takes over from the nearest six.',
    excerpt: [4, 8],
    scene(t, cars) {
      const go = 6;
      for (let i = 0; i < 19; i++) {
        // Two columns 6 m apart, rows 8 m apart, staggered 4 m; the listener is last on the
        // grid (right column), so slot i of 0–18 sits ahead of it.
        const row = Math.floor(i / 2);
        const gridX = (9 - row) * 8 + (i % 2 ? 0 : 4);
        const gridZ = i % 2 ? 0 : -6;
        const run = Math.max(0, t - go);
        // Each car launches at 9–11 m/s² (front rows harder) and the listener stays put.
        const a = 11 - (i / 19) * 2;
        const c = cars[i]!;
        c.x = gridX + 0.5 * a * run * run;
        c.z = gridZ;
        c.vx = a * run;
        c.vz = 0;
        c.engineSpeed = rpm(
          t < go ? 6000 + 300 * Math.sin(3 * t + i) : Math.min(11500, 9000 + 1800 * run),
        );
        c.throttle = t < go ? 0.25 : 1;
      }
      const lights = t < 0.5 ? 0 : t < go ? Math.min(5, Math.floor(t - 0.5) + 1) : 6;
      return base({ cars, ambience: 'park', crowdLeft: 1.2, crowdRight: 0.35, lights });
    },
  },
  {
    name: 'opponent-pass',
    seconds: 8,
    listen:
      'One car 4 m to the right closing at 50 m/s from 200 m ahead, passing at 4 s, gone 200 m behind: pitch from 527 Hz down to 393 Hz (firing frequency at 9000 rpm with Doppler), right of centre, darker once behind.',
    excerpt: [1, 6],
    scene(t, cars) {
      const c = cars[0]!;
      Object.assign(c, {
        x: 200 - 50 * t,
        z: 4,
        vx: -50,
        vz: 0,
        engineSpeed: rpm(9000),
        throttle: 1,
      });
      return base({ cars: [c] });
    },
  },
  {
    name: 'forest-leaving-stands',
    seconds: 12,
    listen:
      'Spa: leaving the start-straight stands for the forest. Crowd fades from both sides over 8 s; wind in the trees with slow gusts and bird calls remain.',
    excerpt: [3, 8],
    scene(t) {
      const crowd = Math.max(0, 1 - t / 8);
      return base({ ambience: 'forest', crowdLeft: crowd, crowdRight: 0.7 * crowd });
    },
  },
  {
    name: 'city-night',
    seconds: 10,
    listen:
      'Singapore at night: low traffic rumble, floodlight hum at 100, 200 and 300 Hz, insects at 5 kHz in slow waves, a stand on the right.',
    excerpt: [2, 6],
    scene() {
      return base({ ambience: 'city-night', crowdLeft: 0.15, crowdRight: 0.5 });
    },
  },
  {
    name: 'menu-cues',
    seconds: 4,
    listen: 'Menus: focus ticks, accept (rising), back (falling), focus, accept.',
    excerpt: [0, 4],
    scene() {
      return base({});
    },
    cues: [
      [0.3, 'focus'],
      [0.8, 'focus'],
      [1.3, 'accept'],
      [2.0, 'back'],
      [2.7, 'focus'],
      [3.2, 'accept'],
    ],
  },
];

export async function main(): Promise<void> {
  const out = 'artifacts/audio';
  const evidence = 'docs/evidence/m6-audio';
  mkdirSync(out, { recursive: true });
  mkdirSync(evidence, { recursive: true });
  const reports = [];
  for (const s of SCENARIOS) {
    const core = new AudioCore({ sampleRate: FS, seed: 71 });
    const total = Math.round(s.seconds * FS);
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    const cars = Array.from({ length: 19 }, () => ({
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      engineSpeed: 0,
      throttle: 0,
    }));
    const cues = [...(s.cues ?? [])];
    const start = performance.now();
    let frame = 0;
    let updates = 0;
    while (frame < total) {
      const t = frame / FS;
      core.setScene(s.scene(t, cars));
      while (cues.length > 0 && cues[0]![0] <= t) core.cue(cues.shift()![1]);
      updates++;
      const next = Math.min(total, Math.round((updates * FS) / RATE));
      for (let f = frame; f < next; f += 128) {
        const n = Math.min(128, next - f);
        core.process([left.subarray(f, f + n), right.subarray(f, f + n)], n);
      }
      frame = next;
    }
    const processMs = performance.now() - start;
    const report = {
      name: s.name,
      seconds: s.seconds,
      listen: s.listen,
      integratedLufs: Number(integratedLoudness([left, right], FS).toFixed(1)),
      truePeakDbtp: Number(toDb(Math.max(truePeak(left), truePeak(right))).toFixed(2)),
      dcOffset: Number(dcOffset(left).toExponential(2)),
      maxStep: Number(Math.max(maxStep(left), maxStep(right)).toFixed(4)),
      realTimeFactor: Number(((s.seconds * 1000) / processMs).toFixed(0)),
    };
    assert(report.truePeakDbtp < 0, `${s.name}: true peak`);
    assert(Math.abs(report.dcOffset) < 0.001, `${s.name}: DC`);
    const png = spectrogramPng(
      { sampleRate: FS, left, right, trace: [], processMs, layers: {}, limiterMinGainDb: 0 },
      s.name,
    );
    writeFileSync(`${out}/${s.name}.wav`, encodeWav([left, right], FS));
    writeFileSync(`${out}/${s.name}.png`, png);
    writeFileSync(`${evidence}/${s.name}.png`, png);
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-ss',
      String(s.excerpt[0]),
      '-t',
      String(s.excerpt[1]),
      '-i',
      `${out}/${s.name}.wav`,
      '-c:a',
      'libvorbis',
      '-q:a',
      '2',
      `${evidence}/${s.name}-excerpt.ogg`,
    ]);
    reports.push(report);
  }
  for (const dir of [out, evidence])
    writeFileSync(`${dir}/scene-summary.json`, JSON.stringify(reports, null, 2) + '\n');
  process.stdout.write(JSON.stringify(reports, null, 2) + '\n');
}

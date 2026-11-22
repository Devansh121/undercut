import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { AudioCore, type AudioScene } from '@undercut/audio';
import { dcOffset, integratedLoudness, truePeak, toDb, maxStep } from '@undercut/audio/analysis';
import { encodeWav } from './wav';
import { spectrogramPng } from './spectrogram-image';

export async function main(): Promise<void> {
  const out = 'artifacts/audio';
  const evidence = 'docs/evidence/m6-audio';
  mkdirSync(out, { recursive: true });
  mkdirSync(evidence, { recursive: true });
  const reports = [];
  for (const name of ['opponent-pass', 'forest-stands', 'city-night', 'start-ui']) {
    const core = new AudioCore({ sampleRate: 48000, seed: 71 });
    const left = new Float32Array(48000 * 12),
      right = new Float32Array(left.length);
    const cars = Array.from({ length: 19 }, () => ({
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      engineSpeed: 0,
      throttle: 0,
    }));
    const scene: AudioScene = {
      cars: [],
      circuit: name === 'city-night' ? 'city' : 'forest',
      progress: 0.5,
      lights: -1,
    };
    for (let frame = 0; frame < left.length; frame += 400) {
      const t = frame / 48000;
      scene.progress = name === 'forest-stands' ? Math.max(0, 0.13 - t * 0.013) : 0.5;
      if (name === 'opponent-pass') {
        scene.cars = cars;
        cars.forEach((c, i) =>
          Object.assign(c, {
            x: 150 - t * 30 + i * 15,
            z: i % 2 ? -5 : 5,
            vx: -30,
            vz: 0,
            engineSpeed: ((7000 + 300 * i) * Math.PI) / 30,
            throttle: (Math.sin(t + i) + 1) / 2,
          }),
        );
      }
      if (name === 'start-ui') {
        scene.circuit = 'park';
        scene.lights = t < 6 ? Math.floor(t) : 6;
        if (frame === 8 * 48000) core.cue('accept');
        if (frame === 9 * 48000) core.cue('back');
        if (frame === 10 * 48000) core.cue('focus');
      }
      core.setScene(scene);
      core.process([left.subarray(frame, frame + 400), right.subarray(frame, frame + 400)], 400);
    }
    const report = {
      name,
      durationS: 12,
      lufs: integratedLoudness([left, right], 48000),
      truePeakDbtp: toDb(Math.max(truePeak(left), truePeak(right))),
      dc: dcOffset(left),
      maxStep: maxStep(left),
    };
    assert(report.truePeakDbtp < 0);
    assert(Math.abs(report.dc) < 0.001);
    const png = spectrogramPng(
      { sampleRate: 48000, left, right, trace: [], processMs: 0, layers: {}, limiterMinGainDb: 0 },
      name,
    );
    writeFileSync(`${out}/${name}.wav`, encodeWav([left, right], 48000));
    writeFileSync(`${out}/${name}.png`, png);
    writeFileSync(`${evidence}/${name}.png`, png);
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      `${out}/${name}.wav`,
      '-c:a',
      'libvorbis',
      '-q:a',
      '3',
      `${evidence}/${name}-excerpt.ogg`,
    ]);
    reports.push(report);
  }
  for (const dir of [out, evidence])
    writeFileSync(`${dir}/scene-summary.json`, JSON.stringify(reports, null, 2) + '\n');
  process.stdout.write(JSON.stringify(reports, null, 2) + '\n');
}

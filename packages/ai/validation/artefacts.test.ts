import { createCarParams } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import { REFERENCE_SKILL } from '../src/driver/reference';
import { referenceLineConfig } from '../src/reference-setup';
import { MONZA, carFor, envelopeFingerprint, lineFingerprint, loadEnvelope } from './lib/index';

// The artefacts' staleness hashes are behavioural: they hash what the sim, the track and the
// line code compute, not their source text. These tests change behaviour without touching the
// committed files and check that the hash notices.
describe('artefact fingerprints', () => {
  const envelope = loadEnvelope(MONZA);
  const config = referenceLineConfig(carFor(MONZA));
  const track = MONZA.track();
  const base = lineFingerprint(track, envelope, config, REFERENCE_SKILL);

  it('are deterministic', () => {
    expect(lineFingerprint(MONZA.track(), envelope, config, REFERENCE_SKILL)).toBe(base);
  });

  it('notice a change in how the track computes its elevation', () => {
    const changed = MONZA.track();
    const ground = changed.ground.bind(changed);
    // A varying elevation offset, as a change to Track.ground / Track.heightAt would make.
    changed.ground = (s, d, out) => {
      const g = ground(s, d, out);
      g.height += 0.5 * Math.sin(s / 50);
      return g;
    };
    expect(lineFingerprint(changed, envelope, config, REFERENCE_SKILL)).not.toBe(base);
  });

  it('notice a change in the track surface grip', () => {
    const changed = MONZA.track();
    const ground = changed.ground.bind(changed);
    changed.ground = (s, d, out) => {
      const g = ground(s, d, out);
      if (Math.abs(d) > 4) g.highKerb = true;
      return g;
    };
    expect(lineFingerprint(changed, envelope, config, REFERENCE_SKILL)).not.toBe(base);
  });

  it('notice a change in the line configuration or the envelope', () => {
    const wider = { ...config, corridor: { ...config.corridor, margin: 0.2 } };
    expect(lineFingerprint(track, envelope, wider, REFERENCE_SKILL)).not.toBe(base);
    const grippier = {
      ...envelope,
      lateral: envelope.lateral.map((row) => row.map((v) => v * 1.01)),
    };
    expect(lineFingerprint(track, grippier, config, REFERENCE_SKILL)).not.toBe(base);
  });

  it('notice a change in the car', () => {
    const now = envelopeFingerprint(MONZA);
    const params = createCarParams(MONZA.trim, { tyre: { muY: 1.85 } });
    const changed = envelopeFingerprint(MONZA, params);
    expect(changed.hash).not.toBe(now.hash);
    expect(now.hash).toBe(envelopeFingerprint(MONZA).hash);
  });
});

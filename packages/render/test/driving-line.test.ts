import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Track } from '@undercut/track';
import raw from '@undercut/track/data/monza.json' with { type: 'json' };
import { DRIVING_LINE_CUE, DrivingLineRibbon, type DrivingLineSource } from '../src/driving-line';

const track = Track.fromJSON(raw);
const zeros = new Float64Array(track.lap.count);

function constantSource(cue: number): DrivingLineSource {
  return {
    fill(_s, _speed, _from, _spacing, out) {
      out.fill(cue);
      return out;
    },
  };
}

/** Brake whenever `s + from + k * spacing` reaches a speed-dependent point before `cornerS`. */
function chicaneSource(cornerS: number): DrivingLineSource {
  return {
    fill(s, speed, from, spacing, out) {
      const brakeDist = (speed * speed) / 40;
      for (let k = 0; k < out.length; k++) {
        const at = s + from + k * spacing;
        const remain = cornerS - at;
        if (remain <= brakeDist) out[k] = DRIVING_LINE_CUE.Brake;
        else if (remain <= brakeDist + 20) out[k] = DRIVING_LINE_CUE.Lift;
        else out[k] = DRIVING_LINE_CUE.Throttle;
      }
      return out;
    },
  };
}

describe('DrivingLineRibbon', () => {
  it('stays hidden in off mode and when braking mode sees only throttle cues', () => {
    const ribbon = new DrivingLineRibbon(track, zeros);
    const p = track.pointAt(200, 0, { x: 0, y: 0, z: 0 });

    ribbon.setSource(constantSource(DRIVING_LINE_CUE.Throttle));
    ribbon.setMode('off');
    ribbon.update(p.x, p.z, 60);
    expect(ribbon.mesh.visible).toBe(false);
    expect(ribbon.snapshot().visible).toBe(false);

    ribbon.setMode('braking');
    ribbon.update(p.x, p.z, 60);
    expect(ribbon.mesh.visible).toBe(false);
    expect(ribbon.snapshot().throttleCount).toBeGreaterThan(0);
    expect(ribbon.snapshot().brakeCount).toBe(0);

    ribbon.setMode('full');
    ribbon.update(p.x, p.z, 60);
    expect(ribbon.mesh.visible).toBe(true);
    expect(ribbon.snapshot().visible).toBe(true);
    ribbon.dispose();
  });

  it('shows red earlier when approaching a corner faster', () => {
    const ribbon = new DrivingLineRibbon(track, zeros);
    ribbon.setSource(chicaneSource(600));
    ribbon.setMode('braking');
    const p = track.pointAt(350, 0, { x: 0, y: 0, z: 0 });

    ribbon.update(p.x, p.z, 50); // 180 km/h
    const slowDist = ribbon.snapshot().firstBrakeDistance;
    const slowBrakes = ribbon.snapshot().brakeCount;

    ribbon.update(p.x, p.z, 90); // 324 km/h
    const fastDist = ribbon.snapshot().firstBrakeDistance;
    const fastBrakes = ribbon.snapshot().brakeCount;

    expect(ribbon.mesh.visible).toBe(true);
    expect(slowDist).not.toBeNull();
    expect(fastDist).not.toBeNull();
    expect(fastDist!).toBeLessThan(slowDist!);
    expect(fastBrakes).toBeGreaterThan(slowBrakes);
    ribbon.dispose();
  });

  it('builds upward-facing triangles lifted above the asphalt and wraps cleanly across start/finish', () => {
    const ribbon = new DrivingLineRibbon(track, zeros, { lift: 0.05 });
    ribbon.setSource(constantSource(DRIVING_LINE_CUE.Brake));
    ribbon.setMode('full');
    // Start 40 m before the end of the lap so the 230 m ribbon crosses s = 0.
    const sStart = track.length - 40;
    const p = track.pointAt(sStart, 0, { x: 0, y: 0, z: 0 });
    ribbon.update(p.x, p.z, 70);

    const pos = ribbon.mesh.geometry.getAttribute('position');
    const idx = ribbon.mesh.geometry.getIndex()!;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const ab = new Vector3();
    const ac = new Vector3();
    const n = new Vector3();

    for (let t = 0; t < idx.count; t += 3) {
      a.fromBufferAttribute(pos, idx.getX(t));
      b.fromBufferAttribute(pos, idx.getX(t + 1));
      c.fromBufferAttribute(pos, idx.getX(t + 2));
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      n.crossVectors(ab, ac);
      expect(n.y).toBeGreaterThan(0);
    }

    // Samples past the start/finish line still sit 0.05 m above the wrapped track surface.
    const pastWrap = ribbon.sampleCenter(30);
    const groundY = track.groundHeightAt(pastWrap.x, pastWrap.z);
    expect(pastWrap.y - groundY).toBeCloseTo(0.05, 2);
    ribbon.dispose();
  });
});

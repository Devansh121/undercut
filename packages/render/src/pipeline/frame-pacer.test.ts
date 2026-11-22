import { describe, expect, it } from 'vitest';
import { FramePacer, type Fences } from './frame-pacer';

/** Fences that complete when the test says so, in submission order like a GPU queue. */
class FakeGpu implements Fences<number> {
  next = 0;
  done = -1;
  released: number[] = [];
  failInsert = false;
  insert(): number | null {
    return this.failInsert ? null : this.next++;
  }
  signaled(f: number): boolean {
    return f <= this.done;
  }
  release(f: number): void {
    this.released.push(f);
  }
  /** The GPU finishes every frame submitted so far. */
  catchUp(): void {
    this.done = this.next - 1;
  }
}

describe('FramePacer', () => {
  it('draws while the GPU keeps up', () => {
    const gpu = new FakeGpu();
    const pacer = new FramePacer(gpu);
    for (let i = 0; i < 10; i++) {
      expect(pacer.ready()).toBe(true);
      pacer.submitted();
      gpu.catchUp();
    }
    expect(pacer.ready()).toBe(true);
    expect(pacer.skipped).toBe(0);
    expect(pacer.inFlight).toBe(0);
  });

  it('allows two frames in flight, then skips until the older one completes', () => {
    const gpu = new FakeGpu();
    const pacer = new FramePacer(gpu);
    expect(pacer.ready()).toBe(true);
    pacer.submitted(); // frame 0
    expect(pacer.ready()).toBe(true);
    pacer.submitted(); // frame 1
    expect(pacer.ready()).toBe(false);
    expect(pacer.ready()).toBe(false);
    expect(pacer.skipped).toBe(2);
    gpu.done = 0; // frame 0 completes
    expect(pacer.ready()).toBe(true);
    expect(gpu.released).toEqual([0]);
    pacer.submitted(); // frame 2
    expect(pacer.inFlight).toBe(2);
  });

  it('bounds the GPU queue however slow the GPU is', () => {
    const gpu = new FakeGpu();
    const pacer = new FramePacer(gpu);
    let drawn = 0;
    // One GPU frame completes every fifth animation frame.
    for (let i = 1; i <= 1000; i++) {
      if (pacer.ready()) {
        pacer.submitted();
        drawn++;
      }
      if (i % 5 === 0 && gpu.done < gpu.next - 1) gpu.done++;
      expect(gpu.next - 1 - gpu.done).toBeLessThanOrEqual(2);
    }
    expect(drawn).toBeGreaterThanOrEqual(200);
    expect(drawn).toBeLessThanOrEqual(202);
  });

  it('draws unpaced when fences are unavailable', () => {
    const gpu = new FakeGpu();
    gpu.failInsert = true;
    const pacer = new FramePacer(gpu);
    for (let i = 0; i < 5; i++) {
      expect(pacer.ready()).toBe(true);
      pacer.submitted();
    }
    expect(pacer.inFlight).toBe(0);
  });

  it('forgets its fences without touching GL when the context is lost', () => {
    const gpu = new FakeGpu();
    const pacer = new FramePacer(gpu);
    pacer.submitted();
    pacer.submitted();
    pacer.abandon();
    expect(gpu.released).toEqual([]);
    expect(pacer.inFlight).toBe(0);
    expect(pacer.ready()).toBe(true);
  });

  it('releases outstanding fences on dispose', () => {
    const gpu = new FakeGpu();
    const pacer = new FramePacer(gpu);
    pacer.submitted();
    pacer.submitted();
    pacer.dispose();
    expect(gpu.released).toEqual([0, 1]);
    expect(pacer.inFlight).toBe(0);
  });
});

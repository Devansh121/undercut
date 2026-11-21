import { FixedStepAccumulator } from '@undercut/core';
import { createWorld, stepWorld } from '@undercut/sim';

/** Sim step: 240 Hz, fine enough for tyre dynamics later. */
const SIM_STEP = 1 / 240;

/**
 * The game loop shell: fixed-step simulation, rendering interpolated between the
 * last two sim states. Long gaps (background tab, debugger) are clamped by the
 * accumulator, so the sim never tries to catch up on them.
 */
export function startLoop(seed: number, render: (time: number) => void): () => void {
  const world = createWorld({ step: SIM_STEP, seed });
  const clock = new FixedStepAccumulator({ step: SIM_STEP, maxFrameTime: 0.25 });
  let last: number | null = null;
  let handle = 0;

  const frame = (now: number): void => {
    const elapsed = last === null ? 0 : (now - last) / 1000;
    last = now;
    const steps = clock.advance(elapsed);
    for (let i = 0; i < steps; i++) stepWorld(world);
    const previousTime = Math.max(0, world.time - world.step);
    render(previousTime + clock.alpha * world.step);
    handle = requestAnimationFrame(frame);
  };
  handle = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(handle);
}

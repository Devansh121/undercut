import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCarState } from '../src/dsp/state';
import {
  createAudioEngine,
  type AudioContextLike,
  type AudioNodeLike,
  type VisibilitySource,
} from '../src/web/engine';
import { PROCESSOR_NAME, type ToProcessor } from '../src/web/messages';

class FakeContext implements AudioContextLike {
  state = 'suspended';
  sampleRate = 48_000;
  destination = {};
  calls: string[] = [];
  audioWorklet: AudioContextLike['audioWorklet'] = {
    addModule: async (url: string) => {
      this.calls.push(`addModule ${url}`);
    },
  };
  async resume() {
    this.calls.push('resume');
    this.state = 'running';
  }
  async suspend() {
    this.calls.push('suspend');
    this.state = 'suspended';
  }
  async close() {
    this.calls.push('close');
    this.state = 'closed';
  }
}

class FakeNode implements AudioNodeLike {
  sent: ToProcessor[] = [];
  connected = false;
  port = { postMessage: (m: ToProcessor) => this.sent.push(m) };
  connect() {
    this.connected = true;
    return undefined;
  }
  disconnect() {
    this.connected = false;
  }
}

class FakeDocument implements VisibilitySource {
  visibilityState = 'visible';
  private listener: (() => void) | undefined;
  addEventListener(_: 'visibilitychange', l: () => void) {
    this.listener = l;
  }
  removeEventListener() {
    this.listener = undefined;
  }
  set(state: 'visible' | 'hidden') {
    this.visibilityState = state;
    this.listener?.();
  }
}

function setup(overrides: Partial<{ context: FakeContext }> = {}) {
  const context = overrides.context ?? new FakeContext();
  const nodes: FakeNode[] = [];
  const doc = new FakeDocument();
  const fallbacks: string[] = [];
  const engine = createAudioEngine({
    workletUrl: '/assets/processor.js',
    fadeMs: 1,
    createContext: () => context,
    createNode: (_c, name) => {
      expect(name).toBe(PROCESSOR_NAME);
      const n = new FakeNode();
      nodes.push(n);
      return n;
    },
    visibility: doc,
    onFallback: (r) => fallbacks.push(r),
  });
  return { engine, context, nodes, doc, fallbacks };
}

afterEach(() => vi.unstubAllGlobals());

describe('createAudioEngine', () => {
  it('falls back to silent where Web Audio is missing, and every call is safe', async () => {
    const reasons: string[] = [];
    const engine = createAudioEngine({
      workletUrl: 'x',
      visibility: null,
      onFallback: (r) => reasons.push(r),
    });
    expect(engine.status).toBe('silent');
    expect(reasons).toHaveLength(1);
    engine.setCarState(defaultCarState());
    engine.setVolume('master', 0.5);
    await engine.resume();
    await engine.suspend();
    await engine.dispose();
    expect(engine.status).toBe('silent');
  });

  it('waits for resume, then loads the worklet, connects and sends queued state', async () => {
    const { engine, context, nodes } = setup();
    engine.setVolume('engine', 0.7);
    engine.setCarState({ ...defaultCarState(), engineOn: true, engineSpeed: 900 });
    expect(engine.status).toBe('idle');
    expect(nodes).toHaveLength(0);
    await engine.resume();
    expect(engine.status).toBe('running');
    expect(context.calls).toContain('addModule /assets/processor.js');
    const node = nodes[0] as FakeNode;
    expect(node.connected).toBe(true);
    expect(node.sent.find((m) => m.type === 'gain')).toEqual({
      type: 'gain',
      id: 'engine',
      value: 0.7,
    });
    const state = node.sent.find((m) => m.type === 'state');
    expect(state?.type === 'state' && state.packed[1]).toBe(900);
    engine.setCarState({ ...defaultCarState(), engineSpeed: 1000 });
    const last = node.sent[node.sent.length - 1];
    expect(last?.type === 'state' && last.packed[1]).toBe(1000);
  });

  it('fades and suspends when the tab is hidden, and comes back when shown', async () => {
    const { engine, context, nodes, doc } = setup();
    await engine.resume();
    doc.set('hidden');
    await new Promise((r) => setTimeout(r, 20));
    expect(nodes[0]?.sent).toContainEqual({ type: 'pause', paused: true });
    expect(context.state).toBe('suspended');
    expect(engine.status).toBe('suspended');
    doc.set('visible');
    await new Promise((r) => setTimeout(r, 20));
    expect(context.state).toBe('running');
    expect(engine.status).toBe('running');
    expect(nodes[0]?.sent[nodes[0].sent.length - 1]).toEqual({ type: 'pause', paused: false });
  });

  it('suspend() fades first and resume() restarts', async () => {
    const { engine, context, nodes } = setup();
    await engine.resume();
    await engine.suspend();
    const sent = nodes[0]?.sent ?? [];
    expect(sent[sent.length - 1]).toEqual({ type: 'pause', paused: true });
    expect(context.state).toBe('suspended');
    await engine.resume();
    expect(context.state).toBe('running');
    expect(nodes).toHaveLength(1);
  });

  it('falls back to silent when the worklet cannot load', async () => {
    const context = new FakeContext();
    context.audioWorklet = {
      addModule: () => Promise.reject(new Error('blocked by policy')),
    };
    const { engine, fallbacks } = setup({ context });
    await engine.resume();
    expect(engine.status).toBe('silent');
    expect(fallbacks).toEqual(['blocked by policy']);
    expect(context.state).toBe('closed');
    engine.setCarState(defaultCarState());
    await engine.dispose();
  });

  it('falls back to silent without AudioWorklet support', async () => {
    const context = new FakeContext();
    context.audioWorklet = undefined;
    const { engine, fallbacks } = setup({ context });
    await engine.resume();
    expect(engine.status).toBe('silent');
    expect(fallbacks[0]).toMatch(/AudioWorklet/);
  });

  it('dispose fades out, disconnects and closes', async () => {
    const { engine, context, nodes } = setup();
    await engine.resume();
    await engine.dispose();
    expect(nodes[0]?.sent).toContainEqual({ type: 'pause', paused: true });
    expect(nodes[0]?.connected).toBe(false);
    expect(context.calls).toContain('close');
    expect(engine.status).toBe('silent');
  });
});

describe('worklet processor', () => {
  it('registers, takes messages and renders the core into its outputs', async () => {
    let registered: { name: string; ctor: new (o?: object) => unknown } | undefined;
    class FakeProcessor {
      readonly port = { onmessage: null as ((e: { data: ToProcessor }) => void) | null };
    }
    vi.stubGlobal('sampleRate', 48_000);
    vi.stubGlobal('AudioWorkletProcessor', FakeProcessor);
    vi.stubGlobal('registerProcessor', (name: string, ctor: new (o?: object) => unknown) => {
      registered = { name, ctor };
    });
    await import('../src/web/processor');
    expect(registered?.name).toBe(PROCESSOR_NAME);
    const processor = new (registered as NonNullable<typeof registered>).ctor({
      processorOptions: { seed: 3 },
    }) as {
      port: { onmessage: (e: { data: ToProcessor }) => void };
      process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
    };
    const packed = new Float64Array(17);
    packed[0] = 1; // engine on
    packed[1] = 1000; // rad/s
    packed[2] = 1;
    packed[3] = 1;
    processor.port.onmessage({ data: { type: 'state', packed } });
    processor.port.onmessage({ data: { type: 'gain', id: 'master', value: 0.5 } });
    const out = [new Float32Array(128), new Float32Array(128)];
    let peak = 0;
    for (let i = 0; i < 100; i++) {
      expect(processor.process([], [out])).toBe(true);
      for (const v of out[0] as Float32Array) peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeGreaterThan(0.01);
    expect(peak).toBeLessThan(1);
    // Pause fades to exact silence.
    processor.port.onmessage({ data: { type: 'pause', paused: true } });
    for (let i = 0; i < 40; i++) processor.process([], [out]);
    expect(Math.max(...(out[0] as Float32Array).map(Math.abs))).toBe(0);
  });
});

describe('unsupported sample rates', () => {
  it('falls back to silent when the context runs below the supported rate', async () => {
    const context = new FakeContext();
    context.sampleRate = 16_000;
    const { engine, fallbacks, nodes } = setup({ context });
    await engine.resume();
    expect(engine.status).toBe('silent');
    expect(nodes).toHaveLength(0);
    expect(fallbacks[0]).toMatch(/sample rate/);
  });
});

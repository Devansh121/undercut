/**
 * Main-thread facade over the audio worklet. The game talks to an `AudioEngine`; when the
 * browser has no Web Audio or no AudioWorklet, or loading fails, it gets a silent engine with
 * the same interface, and the game runs without sound instead of crashing.
 */
import { MIN_SAMPLE_RATE } from '../dsp/core';
import { CAR_STATE_LENGTH, packCarState, type AudioCarState } from '../dsp/state';
import type { GainId } from '../dsp/voice';
import { PROCESSOR_NAME, type ProcessorOptions, type ToProcessor } from './messages';

export type AudioEngineStatus =
  /** No sound: unsupported, failed to start, or disposed. */
  | 'silent'
  /** Created; waiting for `resume()` from a user gesture. */
  | 'idle'
  | 'starting'
  | 'running'
  | 'suspended';

export interface AudioEngine {
  readonly status: AudioEngineStatus;
  /**
   * Start or restart sound. Call it from the first user gesture (click, key, touch): browsers
   * keep audio blocked until then. Resolves once running, or once it has fallen back to silent.
   */
  resume(): Promise<void>;
  /** Fade out and suspend the audio context (tab hidden, game paused). */
  suspend(): Promise<void>;
  /** Latest state of the player's car. Cheap; call every sim step (60–240 Hz). */
  setCarState(state: AudioCarState): void;
  /** Bus volume, 0–1 (up to 2 is accepted): master, engine, effects or ui. */
  setVolume(id: GainId, value: number): void;
  /** Fade out, stop and release everything. The engine is silent afterwards. */
  dispose(): Promise<void>;
}

/** The parts of an AudioContext this facade uses, so tests can supply a fake. */
export interface AudioContextLike {
  readonly state: string;
  readonly sampleRate: number;
  readonly destination: unknown;
  readonly audioWorklet?: { addModule(url: string): Promise<void> } | undefined;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

/** The parts of an AudioWorkletNode this facade uses. */
export interface AudioNodeLike {
  readonly port: { postMessage(message: ToProcessor): void };
  connect(destination: never): unknown;
  disconnect(): void;
}

/** The parts of `document` used to follow tab visibility. */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface AudioEngineOptions {
  /** URL of the bundled worklet module. */
  workletUrl: string;
  /** Seed for the core's noise. */
  seed: number;
  /** Fade time before suspending, ms. */
  fadeMs: number;
  /** Builds the context. Defaults to `new AudioContext({ latencyHint: 'interactive' })`. */
  createContext?: () => AudioContextLike;
  /** Builds the worklet node. Defaults to `new AudioWorkletNode(...)`. */
  createNode?: (
    context: AudioContextLike,
    name: string,
    options: AudioWorkletNodeOptions,
  ) => AudioNodeLike;
  /** Where to watch tab visibility. Defaults to `document` when there is one; null disables. */
  visibility?: VisibilitySource | null;
  /** Called once if audio cannot start, with the reason. Defaults to `console.warn`. */
  onFallback?: (reason: string) => void;
}

/** Null object: the same interface, no sound. */
export class SilentAudioEngine implements AudioEngine {
  readonly status = 'silent' as const;
  resume(): Promise<void> {
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    return Promise.resolve();
  }
  setCarState(): void {}
  setVolume(): void {}
  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The real engine. Every public call records what the game wants (running, suspended or
 * disposed) and then reconciles: one serialised step at a time, each step waiting for the
 * worklet if it is still loading and then moving the node and context to the wanted state.
 * So a suspend, a dispose or a hidden tab during the asynchronous load is honoured when the
 * load completes, and the processor is created paused so it is silent until told to run.
 */
class WorkletAudioEngine implements AudioEngine {
  status: AudioEngineStatus = 'idle';
  private context: AudioContextLike | undefined;
  private node: AudioNodeLike | undefined;
  private loading: Promise<void> | undefined;
  /** The game asked for sound (resume) and has not asked to stop (suspend). */
  private wanted = false;
  private disposed = false;
  /** The processor is currently unpaused. */
  private playing = false;
  private chain: Promise<void> = Promise.resolve();
  private readonly packed = new Float64Array(CAR_STATE_LENGTH);
  private hasState = false;
  private readonly gains = new Map<GainId, number>();
  private readonly onVisibility = () => void this.reconcile();

  constructor(
    private readonly options: AudioEngineOptions & {
      createContext: () => AudioContextLike;
      createNode: NonNullable<AudioEngineOptions['createNode']>;
    },
  ) {
    options.visibility?.addEventListener('visibilitychange', this.onVisibility);
  }

  resume(): Promise<void> {
    if (this.status === 'silent' || this.disposed) return Promise.resolve();
    this.wanted = true;
    if (!this.context) {
      // Create and resume the context inside the user gesture that called resume(); some
      // browsers only let a context start from there. The module loads meanwhile.
      try {
        this.context = this.options.createContext();
      } catch (error) {
        this.fallBack(error);
        return Promise.resolve();
      }
      if (this.hidden()) void this.context.suspend().catch(() => undefined);
      else void this.context.resume().catch(() => undefined);
      this.status = 'starting';
      this.loading = this.load(this.context);
    }
    // Reconcile now, and again once the worklet has loaded: whatever was asked for while it
    // loaded (suspend, a hidden tab) is applied then.
    const now = this.reconcile();
    return this.loading ? this.loading.then(() => this.reconcile()) : now;
  }

  suspend(): Promise<void> {
    this.wanted = false;
    return this.reconcile();
  }

  setCarState(state: AudioCarState): void {
    if (this.status === 'silent') return;
    packCarState(state, this.packed);
    this.hasState = true;
    // postMessage copies the array, so the scratch can be reused next step.
    if (this.node) this.post({ type: 'state', packed: this.packed });
  }

  setVolume(id: GainId, value: number): void {
    if (this.status === 'silent') return;
    this.gains.set(id, value);
    if (this.node) this.post({ type: 'gain', id, value });
  }

  dispose(): Promise<void> {
    this.disposed = true;
    this.wanted = false;
    this.options.visibility?.removeEventListener('visibilitychange', this.onVisibility);
    return this.reconcile();
  }

  private hidden(): boolean {
    return this.options.visibility?.visibilityState === 'hidden';
  }

  /** Queue one reconcile step after any in progress. Never rejects. */
  private reconcile(): Promise<void> {
    const step = this.chain
      .then(() => this.apply())
      .catch((error: unknown) => this.fallBack(error));
    this.chain = step;
    return step;
  }

  private async apply(): Promise<void> {
    if (this.disposed) {
      await this.teardown();
      return;
    }
    const context = this.context;
    if (this.status === 'silent' || !context) return;
    const run = this.wanted && !this.hidden();
    if (!this.node) {
      // Still loading. Stopping takes effect at once; starting waits for the load, after
      // which resume() reconciles again.
      if (!run) {
        await context.suspend();
        if (!this.disposed && this.isNot('silent')) this.status = 'suspended';
      }
      return;
    }
    if (run) {
      this.post({ type: 'pause', paused: false });
      this.playing = true;
      await context.resume();
      // A later call may have changed the intent meanwhile; its own step follows this one.
      if (this.isNot('silent')) this.status = 'running';
    } else {
      if (this.playing) {
        this.post({ type: 'pause', paused: true });
        this.playing = false;
        await wait(this.options.fadeMs);
      }
      await context.suspend();
      if (this.isNot('silent')) this.status = 'suspended';
    }
  }

  /** Status check that TypeScript does not narrow across awaits. */
  private isNot(status: AudioEngineStatus): boolean {
    return this.status !== status;
  }

  private async load(context: AudioContextLike): Promise<void> {
    try {
      if (!context.audioWorklet) throw new Error('AudioWorklet is not supported');
      if (!(context.sampleRate >= MIN_SAMPLE_RATE)) {
        throw new Error(`sample rate ${context.sampleRate} Hz is below ${MIN_SAMPLE_RATE} Hz`);
      }
      await context.audioWorklet.addModule(this.options.workletUrl);
      // Disposed (or failed) while loading: never create the node.
      if (this.disposed || !this.isNot('silent')) return;
      const processorOptions: ProcessorOptions = { seed: this.options.seed, startPaused: true };
      const node = this.options.createNode(context, PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions,
      });
      this.node = node;
      for (const [id, value] of this.gains) this.post({ type: 'gain', id, value });
      if (this.hasState) this.post({ type: 'state', packed: this.packed });
      // Connected paused: silent until a reconcile step decides it should run.
      node.connect(context.destination as never);
    } catch (error) {
      this.fallBack(error);
    } finally {
      this.loading = undefined;
    }
  }

  private async teardown(): Promise<void> {
    const node = this.node;
    const context = this.context;
    this.node = undefined;
    this.context = undefined;
    this.status = 'silent';
    if (node) {
      if (this.playing) {
        node.port.postMessage({ type: 'pause', paused: true });
        this.playing = false;
        await wait(this.options.fadeMs);
      }
      try {
        node.disconnect();
      } catch {
        // Already gone.
      }
    }
    await context?.close().catch(() => undefined);
    this.status = 'silent';
  }

  private post(message: ToProcessor): void {
    try {
      this.node?.port.postMessage(message);
    } catch (error) {
      this.fallBack(error);
    }
  }

  private fallBack(error: unknown): void {
    if (this.status === 'silent') return;
    this.status = 'silent';
    this.options.visibility?.removeEventListener('visibilitychange', this.onVisibility);
    try {
      this.node?.disconnect();
    } catch {
      // Already gone.
    }
    this.node = undefined;
    void this.context?.close().catch(() => undefined);
    this.context = undefined;
    const reason = error instanceof Error ? error.message : String(error);
    (this.options.onFallback ?? ((r: string) => console.warn(`Audio disabled: ${r}`)))(reason);
  }
}

/**
 * Create the audio engine. Never throws. Returns a silent engine at once when the browser
 * has no AudioContext or AudioWorkletNode; otherwise an engine that starts on `resume()` and
 * falls back to silent if anything fails on the way.
 */
export function createAudioEngine(
  options: Partial<AudioEngineOptions> & Pick<AudioEngineOptions, 'workletUrl'>,
): AudioEngine {
  const g = globalThis as {
    AudioContext?: new (options?: AudioContextOptions) => AudioContextLike;
    AudioWorkletNode?: new (
      context: never,
      name: string,
      options?: AudioWorkletNodeOptions,
    ) => AudioNodeLike;
    document?: VisibilitySource;
  };
  const AudioContextCtor = g.AudioContext;
  const NodeCtor = g.AudioWorkletNode;
  const createContext =
    options.createContext ??
    (AudioContextCtor && (() => new AudioContextCtor({ latencyHint: 'interactive' })));
  const createNode =
    options.createNode ??
    (NodeCtor &&
      ((context: AudioContextLike, name: string, o: AudioWorkletNodeOptions) =>
        new NodeCtor(context as never, name, o)));
  if (!createContext || !createNode) {
    (options.onFallback ?? ((r: string) => console.warn(`Audio disabled: ${r}`)))(
      'Web Audio worklets are not available',
    );
    return new SilentAudioEngine();
  }
  return new WorkletAudioEngine({
    workletUrl: options.workletUrl,
    seed: options.seed ?? 1,
    fadeMs: options.fadeMs ?? 40,
    createContext,
    createNode,
    visibility: options.visibility === undefined ? (g.document ?? null) : options.visibility,
    ...(options.onFallback ? { onFallback: options.onFallback } : {}),
  });
}

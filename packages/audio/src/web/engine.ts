/**
 * Main-thread facade over the audio worklet. The game talks to an `AudioEngine`; when the
 * browser has no Web Audio or no AudioWorklet, or loading fails, it gets a silent engine with
 * the same interface, and the game runs without sound instead of crashing.
 */
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

class WorkletAudioEngine implements AudioEngine {
  status: AudioEngineStatus = 'idle';
  private context: AudioContextLike | undefined;
  private node: AudioNodeLike | undefined;
  private starting: Promise<void> | undefined;
  private wanted = false;
  private readonly packed = new Float64Array(CAR_STATE_LENGTH);
  private hasState = false;
  private readonly gains = new Map<GainId, number>();
  private readonly onVisibility = () => {
    if (!this.options.visibility) return;
    if (this.options.visibility.visibilityState === 'hidden') void this.pause();
    else if (this.wanted) void this.start();
  };

  constructor(
    private readonly options: AudioEngineOptions & {
      createContext: () => AudioContextLike;
      createNode: NonNullable<AudioEngineOptions['createNode']>;
    },
  ) {
    options.visibility?.addEventListener('visibilitychange', this.onVisibility);
  }

  resume(): Promise<void> {
    if (this.status === 'silent') return Promise.resolve();
    this.wanted = true;
    return this.start();
  }

  async suspend(): Promise<void> {
    this.wanted = false;
    await this.pause();
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

  async dispose(): Promise<void> {
    if (this.status === 'silent') return;
    this.options.visibility?.removeEventListener('visibilitychange', this.onVisibility);
    this.wanted = false;
    if (this.node) {
      this.post({ type: 'pause', paused: true });
      await wait(this.options.fadeMs);
      this.node.disconnect();
    }
    await this.context?.close().catch(() => undefined);
    this.node = undefined;
    this.context = undefined;
    this.status = 'silent';
  }

  private start(): Promise<void> {
    if (!this.context) {
      // Create the context inside the user gesture that called resume(); some browsers only
      // let a context start from there.
      try {
        this.context = this.options.createContext();
      } catch (error) {
        this.fallBack(error);
        return Promise.resolve();
      }
    }
    const context = this.context;
    if (!this.starting) {
      this.status = 'starting';
      this.starting = this.load(context);
    }
    return this.starting.then(async () => {
      if (!this.node || !this.wanted) return;
      if (this.options.visibility?.visibilityState === 'hidden') return;
      this.post({ type: 'pause', paused: false });
      await context.resume().catch((error: unknown) => this.fallBack(error));
      if (this.node) this.status = 'running';
    });
  }

  private async load(context: AudioContextLike): Promise<void> {
    try {
      // Ask for resume now, while still inside the gesture; the module loads meanwhile.
      const resumed = context.resume().catch(() => undefined);
      if (!context.audioWorklet) throw new Error('AudioWorklet is not supported');
      await context.audioWorklet.addModule(this.options.workletUrl);
      const processorOptions: ProcessorOptions = { seed: this.options.seed };
      const node = this.options.createNode(context, PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions,
      });
      node.connect(context.destination as never);
      this.node = node;
      for (const [id, value] of this.gains) this.post({ type: 'gain', id, value });
      if (this.hasState) this.post({ type: 'state', packed: this.packed });
      await resumed;
    } catch (error) {
      this.fallBack(error);
    }
  }

  private async pause(): Promise<void> {
    if (!this.node || !this.context || this.status === 'silent') return;
    this.post({ type: 'pause', paused: true });
    await wait(this.options.fadeMs);
    // A resume may have come in while fading.
    if (this.wanted && this.options.visibility?.visibilityState !== 'hidden') return;
    await this.context.suspend().catch(() => undefined);
    // A fallback may have happened while suspending.
    if ((this.status as AudioEngineStatus) !== 'silent') this.status = 'suspended';
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

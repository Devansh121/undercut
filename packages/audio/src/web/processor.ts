/**
 * AudioWorklet entry: hosts the DSP core on the audio thread. Loaded with
 * `audioWorklet.addModule()`; see `worklet-url.ts` for how the bundler finds it.
 */
import { AudioCore } from '../dsp/core';
import { PROCESSOR_NAME, type ProcessorOptions, type ToProcessor } from './messages';

/** The parts of AudioWorkletGlobalScope this file uses (TypeScript's DOM types lack it). */
interface WorkletScope {
  readonly sampleRate: number;
  readonly AudioWorkletProcessor: new () => { readonly port: MessagePort };
  registerProcessor(
    name: string,
    ctor: new (options?: { processorOptions?: ProcessorOptions }) => unknown,
  ): void;
}

const scope = globalThis as unknown as WorkletScope;

export class CarAudioProcessor extends scope.AudioWorkletProcessor {
  private readonly core: AudioCore;

  constructor(options?: { processorOptions?: ProcessorOptions }) {
    super();
    this.core = new AudioCore({
      sampleRate: scope.sampleRate,
      seed: options?.processorOptions?.seed ?? 1,
    });
    // Paused before the first render quantum, so a processor connected while its context
    // is still meant to be suspended produces exact silence.
    if (options?.processorOptions?.startPaused) this.core.setPaused(true);
    this.port.onmessage = (event: MessageEvent<ToProcessor>) => this.receive(event.data);
  }

  private receive(message: ToProcessor): void {
    switch (message.type) {
      case 'state':
        this.core.setCarState(message.packed);
        break;
      case 'gain':
        this.core.setGain(message.id, message.value);
        break;
      case 'pause':
        this.core.setPaused(message.paused);
        break;
      case 'view':
        this.core.setView(message.view);
        break;
    }
  }

  /** Called by the browser for every render quantum (128 frames). Allocates nothing. */
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (out && out.length > 0) this.core.process(out, (out[0] as Float32Array).length);
    return true;
  }
}

scope.registerProcessor(PROCESSOR_NAME, CarAudioProcessor);

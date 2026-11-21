/**
 * Engine and road audio. This entry is the pure DSP core, safe to import anywhere (browser,
 * worklet, Node). The browser facade is `@undercut/audio/web`; offline measurement helpers
 * are `@undercut/audio/analysis`.
 */
export * from './dsp/index';

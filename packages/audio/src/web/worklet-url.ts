/**
 * URL of the bundled worklet module. Vite builds `processor.ts` and its imports into a
 * separate file and hands back its URL; nothing is fetched from elsewhere.
 */
import url from './processor?worker&url';

export const WORKLET_URL: string = url;

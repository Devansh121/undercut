import './styles.css';
import { mountLaunchScreen } from './launch';
import { startLoop } from './loop';
import { createStage } from './scene';

const app = document.getElementById('app');
const canvas = document.getElementById('view');
if (!(app instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
  throw new Error('index.html is missing #app or #view');
}

mountLaunchScreen(app, { buildHash: __BUILD_HASH__ });

const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
try {
  const stage = createStage(canvas);
  startLoop(seed, stage.render);
} catch (error) {
  // No WebGL 2: the menu still works; the driving screen will explain in M1.
  document.documentElement.dataset.webgl = 'unavailable';
  console.warn('3D view unavailable', error);
}

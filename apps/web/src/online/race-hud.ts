/**
 * The online race's own strip over the drive HUD, top centre: the start lights during the start,
 * then running position and lap; a line when the connection is being restored. Built once; each
 * frame writes only what changed.
 */
import { Text, el, setClass, setData } from '../ui/dom';

export interface RaceHudState {
  /** Lamps lit (0 to `lamps`), or null when the lights are not showing. */
  lights: number | null;
  lamps: number;
  /** One short line under the lights or beside the standings ('' for none). */
  caption: string;
  position: number | null;
  cars: number;
  lap: number;
  laps: number;
  finished: boolean;
  reconnecting: boolean;
}

export class RaceHud {
  readonly root: HTMLElement;
  private readonly lightsEl: HTMLElement;
  private readonly lamps: HTMLElement[] = [];
  private readonly caption: Text;
  private readonly standing: HTMLElement;
  private readonly pos: Text;
  private readonly lap: Text;
  private readonly net: HTMLElement;

  constructor() {
    const root = el('div', 'online-race');
    root.dataset.testid = 'online-race';
    this.root = root;
    this.lightsEl = el('div', 'online-lights');
    this.lightsEl.setAttribute('role', 'img');
    this.lightsEl.setAttribute('aria-label', 'Start lights');
    for (let i = 0; i < 5; i++) {
      const lamp = el('span', 'online-lights__lamp');
      lamp.append(el('span', 'online-lights__dot'), el('span', 'online-lights__dot'));
      this.lamps.push(lamp);
      this.lightsEl.append(lamp);
    }
    const cap = el('div', 'online-race__caption label');
    cap.dataset.testid = 'online-caption';
    this.caption = new Text(cap);
    this.standing = el('div', 'online-standing');
    const pos = el('span', 'online-standing__pos num');
    pos.dataset.testid = 'online-position';
    const lap = el('span', 'online-standing__lap num');
    lap.dataset.testid = 'online-lap';
    this.pos = new Text(pos);
    this.lap = new Text(lap);
    this.standing.append(pos, el('span', 'online-standing__sep'), lap);
    this.net = el('div', 'online-race__net label', 'Reconnecting to the room');
    root.append(this.lightsEl, this.standing, cap, this.net);
  }

  update(s: RaceHudState): void {
    const showLights = s.lights !== null;
    setClass(this.lightsEl, 'is-on', showLights);
    if (showLights) {
      this.lamps.forEach((lamp, i) => {
        setClass(lamp, 'is-lit', i < (s.lights ?? 0));
        lamp.hidden = i >= s.lamps;
      });
    }
    setClass(this.standing, 'is-on', !showLights && s.position !== null);
    this.pos.set(s.position === null ? '' : `P${s.position} / ${s.cars}`);
    this.lap.set(
      s.finished ? 'Finished' : `Lap ${Math.min(s.laps, Math.max(1, s.lap))} / ${s.laps}`,
    );
    this.caption.set(s.caption);
    setClass(this.caption.node, 'is-on', s.caption !== '');
    setData(this.root, 'net', s.reconnecting ? 'reconnecting' : 'ok');
  }
}

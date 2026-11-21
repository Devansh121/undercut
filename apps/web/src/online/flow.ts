import { webSocketTransport } from '@undercut/protocol';
import { Track } from '@undercut/track';
import monza from '@undercut/track/data/monza.json';
import type { DriveExtension, DriveHandle } from '../drive';
import { roomsUrl } from '../settings';
import { RoomScreens } from './screens';
import { OnlineSession } from './session';
import { OnlineRace } from './race';

/** Owns the connection across lobby, race, results and rematch. */
export class OnlineFlow {
  readonly session: OnlineSession;
  race: OnlineRace | null = null;
  private drive: DriveHandle | null = null;
  private loading = false;
  private generation = 0;
  private screens: RoomScreens;
  constructor(
    private readonly host: HTMLElement,
    code: string | null,
    private readonly start: (extension: DriveExtension, quit: () => void) => Promise<DriveHandle>,
    private readonly back: () => void,
  ) {
    let storage: Storage | null = null;
    try {
      storage = sessionStorage;
    } catch {
      /* A seat still works without reload recovery. */
    }
    this.session = new OnlineSession({
      roomsUrl: roomsUrl(),
      fetch,
      storage,
      transport: webSocketTransport((url) => new WebSocket(url)),
      timers: {
        now: () => performance.now(),
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (id) => window.clearTimeout(id as number),
      },
      random: Math.random,
    });
    this.screens = new RoomScreens(this.session, code, () => this.close());
    void fetch('/network-info')
      .then((r) => r.json())
      .then((info: { origins?: unknown }) => {
        if (Array.isArray(info.origins) && info.origins.every((o) => typeof o === 'string'))
          this.screens.setNetworkOrigins(info.origins);
      })
      .catch(() => undefined);
    this.session.on('change', () => this.changed());
    this.session.on('notice', (n) => this.screens.say(n));
    this.changed();
  }
  private changed(): void {
    const s = this.session.state;
    if (s.ended || s.stage === 'results' || s.stage === 'lobby' || s.stage === 'countdown') {
      if (this.drive) {
        const d = this.drive;
        this.drive = null;
        d.quit();
      }
    }
    if (!s.ended && s.stage === 'loading' && !this.drive && !this.loading) {
      this.loading = true;
      const gen = ++this.generation;
      this.race = new OnlineRace(
        this.session,
        Track.fromJSON(monza),
        (t) => performance.timeOrigin + t,
      );
      void this.start(this.race, () => {
        this.drive = null;
        if (
          !['results', 'lobby', 'countdown'].includes(this.session.state.stage ?? '') &&
          !this.session.state.ended
        )
          this.session.leave();
        this.render();
      })
        .then((d) => {
          this.loading = false;
          if (gen !== this.generation) d.quit();
          else {
            this.drive = d;
            this.changed();
          }
        })
        .catch(() => {
          this.loading = false;
          this.session.leave();
          this.screens.say('Could not load the race');
        });
    }
    if (!this.drive && !this.loading) this.render();
  }
  private render(): void {
    if (this.drive || this.loading) return;
    this.host.replaceChildren(this.screens.root);
    this.screens.show();
  }
  close(): void {
    ++this.generation;
    this.session.leave();
    this.session.dispose();
    this.back();
  }
}

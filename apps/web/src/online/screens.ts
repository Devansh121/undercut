import { el } from '../ui/dom';
import { ONLINE_CIRCUITS, onlineCircuit } from './circuits';
import { displayCode, inviteLink, networkOrigin } from './invite';
import { onlineDriverName } from './race-rules';
import type { OnlineSession } from './session';

/** Room screens share the game's typography and buttons; all data comes from the session. */
export class RoomScreens {
  readonly root = el('main', 'online-screen');
  private name = 'Driver';
  private code: string;
  private notice = '';
  private origins: string[] = [];
  setNetworkOrigins(origins: string[]): void {
    this.origins = origins;
    this.show();
  }
  constructor(
    private readonly session: OnlineSession,
    code: string | null,
    private readonly back: () => void,
  ) {
    this.code = code ?? '';
  }
  show(): void {
    // The screen is rebuilt on every change: keep the focused field's caret and selection too, or
    // typing over a selected name just as it redraws appends to it ("DriverHost").
    const active = document.activeElement as HTMLInputElement | null;
    const focus = active?.id;
    const selection =
      active instanceof HTMLInputElement && active.selectionStart !== null
        ? {
            start: active.selectionStart,
            end: active.selectionEnd ?? active.selectionStart,
            direction: active.selectionDirection ?? 'none',
          }
        : null;
    const s = this.session.state;
    const title = el(
      'h1',
      '',
      s.results ? 'Race results' : s.room ? 'Room ' + displayCode(s.code ?? '') : 'Online rooms',
    );
    const content = el('div', 'online-screen__content');
    const button = (text: string, action: () => void, disabled = false): HTMLButtonElement => {
      const b = el('button', 'btn btn--secondary', text);
      b.type = 'button';
      b.disabled = disabled;
      b.id = 'online-' + text.toLowerCase().replaceAll(' ', '-');
      b.onclick = action;
      return b;
    };
    const field = (label: string, value: string, change: (v: string) => void): HTMLLabelElement => {
      const l = el('label', 'online-field', label);
      const i = el('input');
      i.id = 'online-' + label.toLowerCase().replaceAll(' ', '-');
      i.value = value;
      i.maxLength = label === 'Driver name' ? 24 : 7;
      i.oninput = () => change(i.value);
      l.append(i);
      return l;
    };
    if (s.ended) content.append(el('h2', '', s.ended.title), el('p', '', s.ended.detail));
    if (!s.room || s.ended) {
      content.append(
        field('Driver name', this.name, (v) => (this.name = v)),
        field('Room code', this.code, (v) => (this.code = v)),
        button('Create room', () => void this.session.create(this.name), s.busy),
        button('Join room', () => void this.session.join(this.code, this.name), s.busy),
        button('Back', this.back),
      );
    } else {
      const invite = inviteLink(
        location.href,
        s.code!,
        networkOrigin(location.href, this.origins) ?? undefined,
      );
      const link = el('a', '', invite);
      link.href = invite;
      link.dataset.testid = 'invite';
      content.append(
        link,
        button('Copy invite', () => {
          if (!navigator.clipboard) {
            this.say('Select the invite link to copy it');
            return;
          }
          void navigator.clipboard
            ?.writeText(invite)
            .then(() => this.say('Invite copied'))
            .catch(() => this.say('Select the invite link to copy it'));
        }),
        el(
          'p',
          '',
          this.origins.length > 0
            ? 'Share this Wi-Fi invite with a driver on the same network.'
            : 'Share this invite to bring another driver into the room.',
        ),
      );
      const list = el('ul', 'online-members');
      for (const m of s.members) {
        const row = el(
          'li',
          '',
          m.name +
            (m.you ? ' · You' : '') +
            (m.host ? ' · Host' : '') +
            ' · ' +
            m.livery.teamName +
            ' · ' +
            (m.connected ? (m.ready ? 'Ready' : 'Not ready') : 'Reconnecting'),
        );
        row.style.borderLeft = '4px solid ' + m.livery.primary;
        list.append(row);
      }
      content.append(list);
      if (s.results) {
        const order = el('ol', 'online-results');
        order.dataset.testid = 'online-results';
        for (const r of s.results.rows)
          order.append(
            el(
              'li',
              '',
              onlineDriverName(r.name, r.aiIndex, r.seat) +
                ' · ' +
                r.laps +
                ' laps · ' +
                r.status +
                ' · ' +
                (r.timeMs === null ? '—' : (r.timeMs / 1000).toFixed(3) + ' s'),
            ),
          );
        content.append(order);
        if (s.isHost)
          content.append(
            button('Rematch', () => {
              this.session.rematch();
            }),
          );
        else content.append(el('p', '', 'Waiting for the host to choose rematch'));
      } else {
        const currentCircuit = onlineCircuit(s.room.settings.circuit.id);
        const circuitRow = el('div', 'pause__setting online-circuit');
        circuitRow.append(el('span', 'pause__key', 'Circuit'));
        const circuitChoices = el('div', 'seg');
        circuitChoices.setAttribute('role', 'radiogroup');
        circuitChoices.setAttribute('aria-label', 'Circuit');
        for (const c of ONLINE_CIRCUITS) {
          const b = el('button', 'seg__opt', c.name);
          b.type = 'button';
          b.id = 'online-circuit-' + c.id;
          b.setAttribute('role', 'radio');
          const selected = currentCircuit.id === c.id;
          b.setAttribute('aria-checked', String(selected));
          b.classList.toggle('is-on', selected);
          b.disabled = !s.isHost || s.stage !== 'lobby';
          b.onclick = () => this.session.setCircuit(c.id);
          circuitChoices.append(b);
        }
        circuitRow.append(circuitChoices);

        const laps = field('Laps', String(s.room.settings.laps), (v) =>
          this.session.setLaps(Number(v)),
        );
        const i = laps.querySelector('input')!;
        i.type = 'number';
        i.min = '1';
        i.max = '99';
        i.disabled = !s.isHost || s.stage !== 'lobby';
        const aiText =
          s.room.settings.aiCount > 0 ? `AI fill: ${s.room.settings.aiCount}` : 'AI fill off';
        content.append(
          el('p', '', `${currentCircuit.name} · Equal cars · Team assigned by seat · ${aiText}`),
          circuitRow,
          laps,
        );
        for (const key of Object.keys(
          s.room.settings.assists,
        ) as (keyof typeof s.room.settings.assists)[]) {
          const labels = {
            abs: 'Anti-lock brakes',
            tractionControl: 'Traction control',
            autoGears: 'Automatic gears',
            racingLine: 'Racing line',
            steeringAssist: 'Steering help',
            stability: 'Stability help',
            brakingHelp: 'Braking help',
          };
          const l = el('div', 'pause__setting online-assist');
          l.append(el('span', 'pause__key', labels[key]));
          const choices = el('div', 'seg');
          choices.setAttribute('role', 'radiogroup');
          choices.setAttribute('aria-label', labels[key]);
          for (const on of [false, true]) {
            const b = el('button', 'seg__opt', on ? 'Allowed' : 'Off');
            b.type = 'button';
            b.id = 'online-' + key + '-' + on;
            b.setAttribute('role', 'radio');
            // A room from before stability and braking help existed allows them.
            const allowed = s.room.settings.assists[key] ?? true;
            b.setAttribute('aria-checked', String(allowed === on));
            b.classList.toggle('is-on', allowed === on);
            b.disabled = !s.isHost || s.stage !== 'lobby';
            b.onclick = () => this.session.setAssists({ [key]: on });
            choices.append(b);
          }
          l.append(choices);
          content.append(l);
        }
        const me = s.members.find((m) => m.you);
        content.append(
          button(
            me?.ready ? 'Not ready' : s.isHost ? 'Ready to start' : 'Ready',
            () => {
              this.session.setReady(!me?.ready);
            },
            s.status !== 'joined',
          ),
          el(
            'p',
            '',
            s.stage === 'countdown'
              ? 'Starting shortly'
              : 'The countdown begins when everyone is ready',
          ),
        );
      }
      content.append(button('Leave room', () => this.session.leave()));
    }
    const connection = {
      idle: 'Create a room or enter an invite code',
      connecting: 'Connecting to the room',
      joined: 'Connected',
      reconnecting: 'Reconnecting to the room',
      closed: 'Disconnected',
    };
    const status = el('p', '', s.busy ? 'Connecting to the room' : connection[s.status]);
    status.setAttribute('role', 'status');
    this.root.replaceChildren(title, status, content, el('p', 'online-notice', this.notice));
    const next = focus ? document.getElementById(focus) : null;
    next?.focus();
    if (selection && next instanceof HTMLInputElement && next.selectionStart !== null)
      next.setSelectionRange(selection.start, selection.end, selection.direction);
  }
  say(message: string): void {
    this.notice = message;
    this.show();
  }
}

import { MAX_CARS } from '@undercut/protocol';
import { formatLapTime, formatRaceStatus, lapsText } from '../game/format';
import { classificationGrid, teamBar } from '../ui/classification';
import { el } from '../ui/dom';
import { button, card, segmented, settingRow } from '../ui/kit/components';
import { focusFirst, navigate, showFocusRing, type NavAction } from '../ui/kit/nav';
import { ONLINE_CIRCUITS, onlineCircuit } from './circuits';
import { displayCode, inviteLink, networkOrigin } from './invite';
import { seatLivery } from './liveries';
import { onlineDriverName } from './race-rules';
import type { OnlineSession } from './session';

/** Room screens use the same cards, controls and classification as the local menus. */
export class RoomScreens {
  readonly root = el('main', 'online-screen');
  private name = 'Driver';
  private code: string;
  private notice = '';
  private view = '';
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
  action(action: NavAction, nativeAccept: boolean): void {
    showFocusRing(true);
    if (action === 'menuBack') {
      // Back leaves a room before returning to the hub, just like the visible action.
      if (this.session.state.room) this.session.leave();
      else this.back();
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLInputElement) {
      // Keep native keyboard editing; a pad adjusts numeric room settings with left/right.
      if (action === 'menuLeft' || action === 'menuRight') {
        if (!nativeAccept && active.type === 'number' && !active.disabled) {
          if (action === 'menuRight') active.stepUp();
          else active.stepDown();
          active.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return;
      }
    }
    navigate(this.root, action, nativeAccept);
  }
  show(): void {
    // A room update must preserve both focus and the selection being typed over.
    const active = document.activeElement;
    const focus = this.root.contains(active) ? (active as HTMLElement).id : null;
    const selection =
      active instanceof HTMLInputElement && active.selectionStart !== null
        ? {
            start: active.selectionStart,
            end: active.selectionEnd ?? active.selectionStart,
            direction: active.selectionDirection ?? 'none',
          }
        : null;
    const s = this.session.state;
    const view = s.results ? 'results' : s.room && !s.ended ? 'room' : 'entry';
    const scroll =
      this.view === view ? (this.root.querySelector('.online-screen__content')?.scrollTop ?? 0) : 0;
    this.view = view;
    const title = el(
      'h1',
      '',
      s.results ? 'Race results' : s.room && !s.ended ? 'Room lobby' : 'Online rooms',
    );
    const header = el('header', 'online-screen__head');
    const connection = {
      idle: 'Create a room or enter an invite code',
      connecting: 'Connecting to the room',
      joined: 'Connected',
      reconnecting: 'Reconnecting to the room',
      closed: 'Disconnected',
    };
    const status = el(
      'p',
      'online-screen__status',
      s.busy ? connection.connecting : connection[s.status],
    );
    status.setAttribute('role', 'status');
    header.append(
      el('span', 'label', 'Online / ' + (s.results ? 'Classification' : 'Rooms')),
      title,
      status,
    );
    const content = el('div', 'online-screen__content');
    const actions = el('footer', 'online-screen__actions');
    const action = (
      label: string,
      onClick: () => void,
      disabled = false,
      primary = false,
    ): HTMLButtonElement => {
      const b = button({
        label,
        onClick,
        disabled,
        variant: primary ? 'primary' : 'secondary',
        ...(primary
          ? { glyph: 'menuAccept' as const }
          : label === 'Back' || label === 'Leave room'
            ? { glyph: 'menuBack' as const }
            : {}),
      });
      b.id = 'online-' + label.toLowerCase().replaceAll(' ', '-');
      return b;
    };
    const field = (label: string, value: string, change: (v: string) => void): HTMLLabelElement => {
      const l = el('label', 'online-field');
      l.append(el('span', 'label', label));
      const i = el('input');
      i.dataset.nav = '';
      i.id = 'online-' + label.toLowerCase().replaceAll(' ', '-');
      i.value = value;
      i.maxLength = label === 'Driver name' ? 24 : 7;
      i.autocomplete = 'off';
      i.oninput = () => change(i.value);
      l.append(i);
      return l;
    };
    if (!s.room || s.ended) {
      const entry = card({ title: 'Join the grid', className: 'online-entry' });
      if (s.ended) entry.body.append(el('h2', '', s.ended.title), el('p', '', s.ended.detail));
      entry.body.append(field('Driver name', this.name, (v) => (this.name = v)));
      const create = action('Create room', () => void this.session.create(this.name), s.busy, true);
      const join = el('div', 'online-entry__join');
      join.append(
        field('Room code', this.code, (v) => (this.code = v)),
        action('Join room', () => void this.session.join(this.code, this.name), s.busy),
      );
      entry.body.append(
        create,
        el('p', 'online-help', 'Or enter the code shared by another driver.'),
        join,
      );
      content.append(entry.root);
      actions.append(action('Back', this.back));
    } else if (s.results) {
      const results = card({ title: 'Official classification', aside: lapsText(s.results.laps) });
      const table = classificationGrid({
        kind: 'race',
        rows: s.results.rows,
        columns: [
          { head: 'Pos', num: true, cell: (r) => String(r.position) },
          { head: 'Driver', cell: (r) => onlineDriverName(r.name, r.aiIndex, r.seat) },
          { head: 'Team', colClass: 'col-team', cell: (r) => seatLivery(r.seat).teamName },
          {
            head: 'Distance · Status',
            cell: (r) => `${lapsText(r.laps)} · ${formatRaceStatus(r.status) || 'Finished'}`,
          },
          {
            head: 'Time',
            num: true,
            cell: (r) => (r.timeMs === null ? '—' : formatLapTime(r.timeMs / 1000)),
          },
          {
            head: 'Best lap',
            num: true,
            colClass: 'col-best',
            cell: (r) => formatLapTime(r.bestLapMs === null ? null : r.bestLapMs / 1000),
          },
          {
            head: 'Pen',
            num: true,
            colClass: 'col-pen',
            cell: (r) => (r.penaltyMs > 0 ? `+${(r.penaltyMs / 1000).toFixed(0)} s` : ''),
          },
        ],
        colour: (r) => seatLivery(r.seat).primary,
        rowClass: (r) => (r.kind === 'human' && r.member === s.you ? 'is-player' : ''),
      });
      table.dataset.testid = 'online-results';
      results.body.append(table);
      content.append(results.root);
      if (s.isHost) actions.append(action('Rematch', () => this.session.rematch(), false, true));
      else actions.append(el('p', 'online-help', 'Waiting for the host to choose rematch'));
      actions.append(action('Leave room', () => this.session.leave()));
    } else {
      const invite = inviteLink(
        location.href,
        s.code!,
        networkOrigin(location.href, this.origins) ?? undefined,
      );
      const drivers = card({
        title: 'Drivers',
        aside: `${s.members.length} / ${MAX_CARS}`,
        className: 'online-drivers',
      });
      const code = el('div', 'online-invite');
      const link = el('a', 'online-code num', displayCode(s.code ?? ''));
      link.href = invite;
      link.dataset.testid = 'invite';
      link.dataset.nav = '';
      link.id = 'online-invite';
      link.setAttribute('aria-label', 'Room code ' + displayCode(s.code ?? ''));
      code.append(
        link,
        action('Copy invite', () => {
          if (!navigator.clipboard) {
            this.say('Select the room code link to copy the invite');
            return;
          }
          void navigator.clipboard
            .writeText(invite)
            .then(() => this.say('Invite copied'))
            .catch(() => this.say('Select the room code link to copy the invite'));
        }),
      );
      drivers.body.append(
        el('span', 'label', 'Room code'),
        code,
        el(
          'p',
          'online-help',
          this.origins.length > 0
            ? 'Share this Wi-Fi invite with a driver on the same network.'
            : 'Share this invite to bring another driver into the room.',
        ),
      );
      const list = el('ul', 'online-members');
      for (const m of s.members) {
        const row = el('li', 'online-member');
        const identity = el('div', 'online-member__identity');
        identity.append(el('strong', '', m.name), el('span', 'online-help', m.livery.teamName));
        const roles = [
          m.you && m.name.toLowerCase() !== 'you' ? 'You' : '',
          m.host && m.name.toLowerCase() !== 'host' ? 'Host' : '',
        ].filter(Boolean);
        const state = el('div', 'online-member__state');
        state.append(
          el('span', 'label', roles.join(' · ')),
          el(
            'span',
            m.ready ? 'online-ready' : '',
            m.connected ? (m.ready ? 'Ready' : 'Not ready') : 'Reconnecting',
          ),
        );
        row.append(teamBar(m.livery.primary), identity, state);
        list.append(row);
      }
      drivers.body.append(list);
      const currentCircuit = onlineCircuit(s.room.settings.circuit.id);
      const settings = card({
        title: 'Race settings',
        aside: s.isHost ? 'Host controls' : 'Set by host',
        className: 'online-settings',
      });
      const locked = !s.isHost || s.stage !== 'lobby';
      const circuits = segmented({
        label: 'Circuit',
        choices: ONLINE_CIRCUITS.map((c) => ({ value: c.id, label: c.name })),
        value: currentCircuit.id,
        onChange: (id) => this.session.setCircuit(id),
      });
      circuits.setDisabled(locked);
      for (const b of circuits.root.querySelectorAll<HTMLElement>('[data-value]'))
        b.id = 'online-circuit-' + b.dataset.value;
      settings.body.append(settingRow('Circuit', circuits.root));
      const numeric = (
        label: string,
        value: number,
        min: number,
        max: number,
        change: (v: number) => void,
      ): HTMLLabelElement => {
        const l = field(label, String(value), (v) => change(Number(v)));
        const i = l.querySelector('input')!;
        i.type = 'number';
        i.min = String(min);
        i.max = String(max);
        i.disabled = locked;
        return l;
      };
      const maxAi = Math.max(0, MAX_CARS - s.members.length);
      const aiCount = Math.min(maxAi, s.room.settings.aiCount);
      const counts = el('div', 'online-counts');
      const fill = action(
        aiCount === maxAi && maxAi > 0 ? 'Clear AI' : 'Fill grid',
        () => this.session.setAiCount(aiCount === maxAi ? 0 : maxAi),
        locked || maxAi === 0,
      );
      fill.id = 'online-ai-fill';
      counts.append(
        numeric('Laps', s.room.settings.laps, 1, 99, (v) => this.session.setLaps(v)),
        numeric('AI cars', aiCount, 0, maxAi, (v) => this.session.setAiCount(v)),
        fill,
      );
      settings.body.append(
        counts,
        el(
          'p',
          'online-help',
          `${lapsText(s.room.settings.laps)} · Equal cars · ${aiCount > 0 ? `AI fill: ${aiCount}` : 'AI fill off'}`,
        ),
      );
      const labels = {
        abs: 'Anti-lock brakes',
        tractionControl: 'Traction control',
        autoGears: 'Automatic gears',
        racingLine: 'Racing line',
        steeringAssist: 'Steering help',
        stability: 'Stability help',
        brakingHelp: 'Braking help',
      };
      for (const key of Object.keys(s.room.settings.assists) as (keyof typeof labels)[]) {
        const choices = segmented({
          label: labels[key],
          choices: [
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'Allowed' },
          ],
          value: (s.room.settings.assists[key] ?? true) ? 'on' : 'off',
          onChange: (v) => this.session.setAssists({ [key]: v === 'on' }),
        });
        choices.setDisabled(locked);
        for (const b of choices.root.querySelectorAll<HTMLElement>('[data-value]'))
          b.id = `online-${key}-${b.dataset.value === 'on'}`;
        settings.body.append(settingRow(labels[key], choices.root));
      }
      content.append(drivers.root, settings.root);
      const me = s.members.find((m) => m.you);
      actions.append(
        action(
          me?.ready ? 'Not ready' : s.isHost ? 'Ready to start' : 'Ready',
          () => this.session.setReady(!me?.ready),
          s.status !== 'joined',
          true,
        ),
        action('Leave room', () => this.session.leave()),
        el(
          'p',
          'online-help',
          s.stage === 'countdown'
            ? 'Starting shortly'
            : 'The countdown begins when everyone is ready',
        ),
      );
    }
    const notice = el('p', 'online-notice', this.notice);
    notice.setAttribute('role', 'status');
    this.root.replaceChildren(header, content, notice, actions);
    content.scrollTop = scroll;
    const next = focus ? this.root.querySelector<HTMLElement>(`[id="${CSS.escape(focus)}"]`) : null;
    if (next && !(next as HTMLButtonElement).disabled) next.focus({ preventScroll: true });
    else focusFirst(actions.children.length ? actions : content);
    if (selection && next instanceof HTMLInputElement && next.selectionStart !== null)
      next.setSelectionRange(selection.start, selection.end, selection.direction);
  }
  say(message: string): void {
    this.notice = message;
    this.show();
  }
}

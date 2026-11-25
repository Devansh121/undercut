/**
 * Living gallery for the design system (apps/web/ui-gallery.html): tokens, type scale, icon set,
 * prompt glyphs across devices, and every kit component with its states. Linked from nowhere in
 * the game; used for visual review and browser tests.
 */
import './gallery.css';
import { GAME_NAME } from '@undercut/core';
import { defaultBindings, type ActionId, type DeviceKind } from '@undercut/input';
import compoundsData from '../../../../design/compounds.json';
import { TEAMS } from '../ui/data/teams';
import { el } from '../ui/dom';
import {
  Toaster,
  button,
  card,
  chip,
  dialog,
  iconButton,
  listRow,
  segmented,
  settingRow,
  slider,
  tabStrip,
  table,
  toggle,
  tooltip,
} from '../ui/kit/components';
import { glyph, setGlyphContext } from '../ui/kit/glyph';
import { ICON_KEYS, brandMark, icon } from '../ui/kit/icons';
import { S } from '../ui/strings';
import { TimingTower, type TowerRow } from '../ui/hud/tower';

const host = document.getElementById('gallery');
if (!(host instanceof HTMLElement)) throw new Error('ui-gallery.html is missing #gallery');

const bindings = defaultBindings();
setGlyphContext('keyboard', bindings);

const root = el('main', 'gallery');
const toaster = new Toaster();

// ---- Header & global mode toggles
const head = el('header', 'gallery__head');
const brand = el('div', 'gallery__brand');
const word = el('div', 'wordmark');
word.style.display = 'flex';
word.style.alignItems = 'center';
word.style.gap = '12px';
word.style.fontWeight = '800';
word.style.letterSpacing = '0.14em';
word.style.fontSize = '20px';
const mark = brandMark();
mark.style.width = '22px';
mark.style.height = '22px';
word.append(mark, el('span', '', GAME_NAME));
brand.append(word, el('span', 'label', S.gallery.title));

const controls = el('div', 'gallery__controls');
const deviceSeg = segmented<DeviceKind>({
  label: 'Input device',
  id: 'gallery-device',
  choices: [
    { value: 'keyboard', label: S.menu.deviceNames.keyboard },
    { value: 'gamepad', label: S.menu.deviceNames.gamepad },
    { value: 'touch', label: S.menu.deviceNames.touch },
  ],
  value: 'keyboard',
  onChange: (d) => setGlyphContext(d, bindings),
});
const cbSeg = segmented<'off' | 'on'>({
  label: 'Timing palette',
  id: 'gallery-cb',
  choices: [
    { value: 'off', label: 'Standard timing' },
    { value: 'on', label: 'Colour-blind safe' },
  ],
  value: 'off',
  onChange: (v) => {
    if (v === 'on') document.documentElement.dataset.cb = 'on';
    else delete document.documentElement.dataset.cb;
  },
});
const motionSeg = segmented<'normal' | 'reduce'>({
  label: 'Motion',
  id: 'gallery-motion',
  choices: [
    { value: 'normal', label: 'Motion on' },
    { value: 'reduce', label: 'Reduced motion' },
  ],
  value: 'normal',
  onChange: (v) => {
    if (v === 'reduce') document.documentElement.dataset.motion = 'reduce';
    else delete document.documentElement.dataset.motion;
  },
});
controls.append(deviceSeg.root, cbSeg.root, motionSeg.root);
head.append(brand, controls);

// ---- Colour tokens
const tokensCard = card({ title: 'Colour tokens', aside: 'design/mock/tokens.css' });
const swatches = el('div', 'swatches');
for (const [name, cssVar] of [
  ['Ink 0', 'var(--c-ink-0)'],
  ['Ink 1', 'var(--c-ink-1)'],
  ['Ink 2', 'var(--c-ink-2)'],
  ['Ink 3', 'var(--c-ink-3)'],
  ['Ink 4', 'var(--c-ink-4)'],
  ['Text 1', 'var(--c-text-1)'],
  ['Text 2', 'var(--c-text-2)'],
  ['Text 3', 'var(--c-text-3)'],
  ['Brand', 'var(--c-brand)'],
  ['Overall best', 'var(--c-time-overall)'],
  ['Personal best', 'var(--c-time-personal)'],
  ['Slower', 'var(--c-time-slower)'],
  ['Invalid', 'var(--c-time-invalid)'],
  ['DRS', 'var(--c-drs)'],
  ['ERS', 'var(--c-ers)'],
  ['Yellow flag', 'var(--c-flag-yellow)'],
] as const) {
  const s = el('div', 'swatch');
  const c = el('div', 'swatch__chip');
  c.style.background = cssVar;
  s.append(c, el('span', 'swatch__name', name));
  swatches.append(s);
}
for (const cmp of compoundsData.compounds) {
  const s = el('div', 'swatch');
  const c = el('div', 'swatch__chip');
  c.style.background = cmp.colour;
  s.append(c, el('span', 'swatch__name', `${cmp.name} (${cmp.code})`));
  swatches.append(s);
}
tokensCard.body.append(swatches);

// ---- Team palettes
const teamsCard = card({ title: 'Team colours', aside: `${TEAMS.length} teams` });
const teamSwatches = el('div', 'team-swatches');
for (const t of TEAMS) {
  const item = el('div', 'team-swatch');
  const bars = el('div', 'team-swatch__bars');
  for (const hex of [t.colours.primary, t.colours.secondary, t.colours.tower]) {
    const b = el('span');
    b.style.background = hex;
    bars.append(b);
  }
  const meta = el('div', 'team-swatch__meta');
  meta.append(el('span', '', t.name), el('span', 'label', t.code));
  item.append(bars, meta);
  teamSwatches.append(item);
}
teamsCard.body.append(teamSwatches);

// ---- Typography
const typeCard = card({ title: 'Typography', aside: 'Archivo and Barlow Semi Condensed' });
const typeList = el('div', 'type-list');
const addType = (label: string, sample: string, size: string, cls = '', weight = '700'): void => {
  const row = el('div', 'type-row');
  const s = el('span', cls, sample);
  s.style.fontSize = size;
  s.style.fontWeight = weight;
  s.style.lineHeight = '1.1';
  row.append(s, el('span', 'label', label));
  typeList.append(row);
};
addType('Display 44', 'MONZA', 'var(--fs-44)', '', '800');
addType('Heading 32', 'SESSION SETUP', 'var(--fs-32)', '', '800');
addType('Title 20', 'Time Trial', 'var(--fs-20)', '', '700');
addType(
  'Body 16',
  'Hot laps against your ghost and your record on this device.',
  'var(--fs-16)',
  '',
  '400',
);
addType('Label 11', 'CURRENT LAP', 'var(--fs-11)', 'label', '600');
addType('Tabular 32', '1:19.482  -0.148  342', 'var(--fs-32)', 'num', '600');
typeCard.body.append(typeList);

// ---- Components
const compGrid = el('div', 'gallery__grid');

// Buttons, icon buttons, chips, tooltip
const btnCard = card({ title: 'Buttons, chips and tooltips' });
const btnStack = el('div', 'gallery__stack');
const btnRow1 = el('div', 'gallery__row');
btnRow1.append(
  button({ label: 'Start session', variant: 'primary', glyph: 'menuAccept' }),
  button({ label: 'Back', variant: 'secondary', glyph: 'menuBack' }),
  button({ label: 'Change circuit', variant: 'quiet', next: true }),
  button({ label: 'Disabled', variant: 'primary', disabled: true }),
  button({ label: 'Disabled', variant: 'secondary', disabled: true }),
);
const btnRow2 = el('div', 'gallery__row');
const tipTarget = button({ label: 'Hover or focus', icon: 'info' });
btnRow2.append(
  iconButton({ icon: 'settings', label: 'Settings' }),
  iconButton({ icon: 'edit', label: 'Edit' }),
  tipTarget,
  chip('sun', 'Afternoon'),
  chip('route', 'Clockwise'),
  chip('drop', 'Dry'),
);
tooltip(tipTarget, 'Short explanation shown on hover and focus.');
btnStack.append(btnRow1, btnRow2);
btnCard.body.append(btnStack);

// Value controls
const valCard = card({ title: 'Toggles, segmented controls and sliders' });
const valStack = el('div', 'gallery__stack');
const tOn = toggle({ label: 'Anti-lock brakes', value: true, onChange: () => {} });
const tOff = toggle({ label: 'Subtitles', value: false, onChange: () => {} });
const tDis = toggle({ label: 'Unavailable toggle', value: false, onChange: () => {} });
tDis.setDisabled(true);
const seg = segmented({
  label: 'Traction control',
  choices: [
    { value: 0, label: 'Off' },
    { value: 1, label: 'Low' },
    { value: 2, label: 'Medium' },
    { value: 3, label: 'High' },
  ],
  value: 1,
  onChange: () => {},
});
const segDis = segmented({
  label: 'Steering help',
  choices: [
    { value: 0, label: 'Off' },
    { value: 1, label: 'Low' },
    { value: 2, label: 'High' },
  ],
  value: 0,
  onChange: () => {},
});
segDis.setDisabled(true);
const sld = slider({
  label: 'Engine volume',
  min: 0,
  max: 100,
  step: 5,
  value: 70,
  format: (v) => `${v}%`,
  onChange: () => {},
});
valStack.append(
  settingRow('Anti-lock brakes', tOn.root),
  settingRow('Subtitles', tOff.root),
  settingRow('Locked option', tDis.root, 'Disabled state'),
  settingRow('Traction control', seg.root),
  settingRow('Steering help', segDis.root, 'Sticks and touch only'),
  settingRow('Engine volume', sld.root),
);
valCard.body.append(valStack);

// List rows, tabs, dialog and toasts
const navCard = card({ title: 'List rows, tabs, dialogs and toasts' });
const navStack = el('div', 'gallery__stack');
const tabs = tabStrip({
  label: 'Settings sections',
  tabs: [
    { id: 'display', label: 'Graphics' },
    { id: 'audio', label: 'Audio' },
    { id: 'controls', label: 'Controls' },
    { id: 'access', label: 'Accessibility' },
  ],
  value: 'display',
  onChange: () => {},
});
const r1 = listRow({
  title: 'Time Trial',
  desc: 'Hot laps against your ghost and your record on this device.',
  icon: 'stopwatch',
});
r1.setAttribute('aria-current', 'true');
const r2 = listRow({
  title: 'Quick Race',
  desc: 'One race on one circuit, five laps to full distance.',
  icon: 'flag',
  badge: 'Next',
});
const sampleDialog = dialog({
  title: 'Sample dialog',
  subtitle: 'Focus stays inside until Back',
  testid: 'gallery-dialog',
});
sampleDialog.body.append(
  el('p', '', 'Dialogs trap keyboard and gamepad navigation and return focus on close.'),
);
const dlgRow = el('div', 'gallery__row');
dlgRow.append(
  button({ label: 'Open dialog', onClick: () => sampleDialog.show() }),
  button({
    label: 'Info toast',
    onClick: () => toaster.show('Session settings saved.', 'info'),
  }),
  button({
    label: 'Warning toast',
    onClick: () => toaster.show('Records last until the page closes.', 'warn'),
  }),
);
navStack.append(tabs.root, r1, r2, dlgRow);
navCard.body.append(navStack);

// Table
const tableCard = card({ title: 'Table', aside: 'Classification sample' });
interface SampleRow {
  pos: number;
  driver: string;
  team: string;
  lap: string;
  player?: boolean;
}
const sampleTable = table<SampleRow>({
  label: 'Sample classification',
  rows: [
    {
      pos: 1,
      driver: `${TEAMS[2]!.drivers[0]!.first[0]}. ${TEAMS[2]!.drivers[0]!.last}`,
      team: TEAMS[2]!.name,
      lap: '1:19.482',
    },
    {
      pos: 2,
      driver: `${TEAMS[8]!.drivers[0]!.first[0]}. ${TEAMS[8]!.drivers[0]!.last}`,
      team: TEAMS[8]!.name,
      lap: '+0.184',
      player: true,
    },
    {
      pos: 3,
      driver: `${TEAMS[5]!.drivers[0]!.first[0]}. ${TEAMS[5]!.drivers[0]!.last}`,
      team: TEAMS[5]!.name,
      lap: '+0.412',
    },
  ],
  rowClass: (r) => (r.player ? 'is-player' : ''),
  columns: [
    { label: 'Pos', cell: (r) => String(r.pos), num: true },
    { label: 'Driver', cell: (r) => r.driver },
    { label: 'Team', cell: (r) => r.team },
    { label: 'Time', cell: (r) => r.lap, align: 'end', num: true },
  ],
});
tableCard.body.append(sampleTable);

compGrid.append(btnCard.root, valCard.root, navCard.root, tableCard.root);

// ---- Prompt glyphs
const glyphCard = card({ title: 'Prompt glyphs', aside: 'Switch device in header' });
const glyphGrid = el('div', 'glyph-grid');
const GLYPH_ACTIONS: readonly [ActionId, string][] = [
  ['menuAccept', 'Accept'],
  ['menuBack', 'Back'],
  ['menuTabPrev', 'Previous tab'],
  ['menuTabNext', 'Next tab'],
  ['throttle', 'Throttle'],
  ['brake', 'Brake'],
  ['steerLeft', 'Steer left'],
  ['steerRight', 'Steer right'],
  ['gearUp', 'Gear up'],
  ['gearDown', 'Gear down'],
  ['drs', 'DRS'],
  ['overtake', 'Overtake'],
  ['pause', 'Pause'],
  ['nextCamera', 'Camera'],
  ['resetToTrack', 'Reset to track'],
];
for (const [id, label] of GLYPH_ACTIONS) {
  const cell = el('div', 'glyph-cell');
  cell.append(el('span', '', label), glyph(id));
  glyphGrid.append(cell);
}
glyphCard.body.append(glyphGrid);

// ---- Icon set
const iconCard = card({ title: 'Icon set', aside: `${ICON_KEYS.length} icons, 24 px grid` });
const iconGrid = el('div', 'icon-grid');
for (const k of ICON_KEYS) {
  const cell = el('div', 'icon-cell');
  cell.append(icon(k), el('span', '', k));
  iconGrid.append(cell);
}
iconCard.body.append(iconGrid);

// ---- Timing tower: a scripted sequence of standings, as the race screen will feed it
const towerCard = card({ title: 'Timing tower', aside: 'Scripted standings' });
towerCard.root.dataset.testid = 'gallery-tower';
const tower = new TimingTower({ label: 'Race' });
const car = (id: string, code: string, team: string): Omit<TowerRow, 'position' | 'value'> => ({
  id,
  code,
  teamColour: TEAMS.find((t) => t.id === team)?.colours.tower ?? '#888',
  compound: { code: 'M', colour: '#F2902F' },
});
const cars = {
  a: car('a', 'VEL', 'kestrel'),
  b: car('b', 'CAS', 'sable'),
  c: car('c', 'HOL', 'norrland'),
  d: car('d', 'COR', 'terraluce'),
  e: car('e', 'ASH', 'aldermoor'),
  f: { ...car('f', 'TAI', 'calder'), player: true },
};
type Step = {
  lap: number;
  flag: 'green' | 'yellow';
  text: string;
  order: (keyof typeof cars)[];
  values: string[];
  tones?: Record<string, TowerRow['tone']>;
  fastest?: string;
};
const STEPS: Step[] = [
  {
    lap: 12,
    flag: 'green',
    text: 'Green flag',
    order: ['a', 'b', 'c', 'd', 'e', 'f'],
    values: ['Leader', '+1.204', '+0.512', '+2.880', '+0.391', '+0.844'],
  },
  {
    lap: 13,
    flag: 'yellow',
    text: 'Yellow flag · Sector 2',
    order: ['a', 'c', 'b', 'd', 'f', 'e'],
    values: ['Leader', '+1.010', '+0.402', '+2.115', '+0.640', 'Pit'],
    tones: { e: 'pit' },
    fastest: 'c',
  },
  {
    lap: 14,
    flag: 'green',
    text: 'Green flag',
    order: ['a', 'c', 'f', 'b', 'd', 'e'],
    values: ['Leader', '+0.988', '+0.733', '+0.120', '+1.904', '+9.402'],
    fastest: 'f',
  },
];
let step = 0;
const showStep = (): void => {
  const st = STEPS[step] as Step;
  tower.setLap(st.lap, 53);
  tower.setStatus(st.flag, st.text);
  tower.update(
    st.order.map((k, i) => ({
      ...cars[k],
      position: i + 1,
      value: st.values[i] ?? '',
      tone: st.tones?.[k] ?? '',
      fastest: st.fastest === k,
    })),
  );
  towerCard.root.dataset.step = String(step);
};
const towerRow = el('div', 'gallery__row gallery__tower');
towerRow.append(
  tower.root,
  button({
    label: 'Next standings',
    action: 'tower-next',
    onClick: () => {
      step = (step + 1) % STEPS.length;
      showStep();
    },
  }),
);
towerCard.body.append(towerRow);
showStep();

root.append(
  head,
  tokensCard.root,
  teamsCard.root,
  typeCard.root,
  compGrid,
  glyphCard.root,
  towerCard.root,
  iconCard.root,
  sampleDialog.root,
  toaster.root,
);
host.replaceChildren(root);

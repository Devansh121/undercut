/**
 * Every string the game shows, in one place so the copy can be reviewed in one read. Plain and
 * specific: no exclamation marks, no filler, no real series, team, driver or sponsor names. The
 * game's name is never written here; it comes from GAME_NAME.
 *
 * Functions build strings that carry numbers or names; numbers arrive already formatted.
 */

const WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];
/** Small counts in words, as prose writes them; larger ones as figures. */
export const words = (n: number): string => WORDS[n] ?? String(n);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const S = {
  launch: {
    tagline: (teams: number, drivers: number) =>
      `Open-wheel racing on measured circuits. ${cap(words(teams))} teams, ${words(drivers)} drivers, one car built to the regulations.`,
    press: 'Press any key or tap to start',
    pressTouch: 'Tap to start',
    build: 'Build',
  },

  menu: {
    main: 'Main',
    settings: 'Settings',
    back: 'Back',
    loading: 'Loading',
    modes: 'Modes',
    records: 'Best laps on this device',
    noRecord: 'No lap yet',
    recordsMemory: 'Records last until the page closes: storage is blocked',
    deviceNames: { keyboard: 'Keyboard', gamepad: 'Gamepad', touch: 'Touch' },
    usingDevice: (device: string) => `Using ${device}`,
  },

  modes: {
    timeTrial: {
      name: 'Time Trial',
      desc: 'Hot laps against your ghost and your record on this device.',
      start: 'Start session',
    },
    quickRace: {
      name: 'Quick Race',
      desc: 'One race on one circuit, five laps to full distance.',
      start: 'Start race',
    },
    weekend: {
      name: 'Race Weekend',
      desc: 'Practice, qualifying and the race on one circuit.',
      start: 'Start weekend',
    },
    championship: {
      name: 'Championship',
      desc: 'Points and standings across every circuit in this build.',
      start: 'Start championship',
    },
    online: {
      name: 'Online Rooms',
      desc: 'Private room by invite code, up to eight drivers.',
      start: 'Open rooms',
    },
  },

  notices: {
    racesTitle: 'Race sessions open in the next update',
    racesBody:
      'The race rules are built: start lights, flags, track limits, penalties, pit stops and points. The race screen that runs them is not in this build yet. Time Trial runs on the same rules today.',
    onlineTitle: 'Online rooms open in a later update',
    onlineBody:
      'The rooms service runs beside this build, but the lobby screen is not in it yet. Nothing here connects to it.',
    unavailable: 'Not in this build yet',
  },

  circuit: {
    title: 'Circuit',
    change: 'Change circuit',
    select: 'Circuit select',
    round: (n: number, country: string) => `Round ${n} · ${country}`,
    length: 'Length',
    turns: 'Turns',
    laps: 'Race laps',
    drs: 'DRS zones',
    direction: 'Direction',
    clockwise: 'Clockwise',
    anticlockwise: 'Anticlockwise',
    record: 'Record on this device',
    dry: 'Dry',
    air: (celsius: number) => `Air ${celsius}°`,
    km: 'km',
    onlyOne: 'More circuits arrive with their track data.',
  },

  timeOfDay: {
    label: 'Time of day',
    'monza-afternoon': 'Afternoon',
    'overcast-day': 'Overcast',
    'night-floodlit': 'Night',
  } as Record<string, string>,

  team: {
    title: 'Team',
    driver: 'Driver',
    select: 'Team and driver',
    number: (n: number) => `No. ${n}`,
    livery: (team: string) => `${team} livery`,
    tiersOn: 'Performance tiers on',
    equalCars: 'Equal cars',
  },

  setup: {
    title: 'Session settings',
    edit: 'Edit settings',
    preset: (device: string) => `Preset: ${device}`,
    assists: 'Assists',
    resetPreset: 'Reset to preset',
    tractionControl: 'Traction control',
    abs: 'Anti-lock brakes',
    gears: 'Gears',
    steering: 'Steering help',
    levels: { off: 'Off', low: 'Low', medium: 'Medium', high: 'High' },
    gearChoices: { auto: 'Automatic', manual: 'Manual' },
    on: 'On',
    off: 'Off',
    done: 'Done',
    summaryTimeTrial: (tod: string, device: string) => `${tod} · ${device} assists`,
    assistsFor: (device: string) => `${device} assists`,
    steeringKeyboard: 'Sticks and touch only',
  },

  summary: {
    timeTrial: (circuit: string) => `${circuit} · Time trial`,
    car: (team: string, number: number, last: string) => `${team} · #${number} ${last}`,
  },

  loading: {
    preparing: 'Loading track and car',
    stopped: 'Stopped',
    retry: 'Try again',
    back: 'Back',
    failedDownload: (path: string) =>
      `Could not download ${path}. Check the connection and try again.`,
    failedPrepare: 'Could not prepare the track and car. Check the connection and try again.',
    restoring: 'Restoring graphics',
    graphics: (preset: string) => `Graphics: ${preset}`,
    timeTrial: 'Time trial',
    mb: (loaded: string, total: string) => `${loaded} / ${total} MB`,
  },

  hud: {
    timeTrial: 'Time trial',
    lap: 'Lap',
    lapN: (n: number) => `Lap ${n}`,
    outLap: 'Out lap',
    record: 'Record',
    currentLap: 'Current lap',
    last: 'Last',
    best: 'Best',
    ghost: 'Ghost',
    ghostActive: 'Active',
    ghostOff: 'No ghost yet',
    rpm: 'RPM',
    kmh: 'km/h',
    mph: 'mph',
    ers: 'ERS',
    drs: 'DRS',
    tyres: 'Tyres',
    noData: 'No data',
    tyreModel: 'Tyre temperatures and wear arrive with the tyre model',
    trackMap: 'Track map',
    car: 'Car',
    session: 'Session',
    lapTiming: 'Lap timing',
    lapInvalid: 'Lap invalid',
    trackLimits: 'Track limits',
    resetToTrack: 'Reset to track',
    storage: 'Storage',
    recordsUntilClose: 'Records last until the page closes',
    recordKept: 'Record kept until the page closes',
    camera: 'Camera',
    ersModes: { off: 'Off', balanced: 'Balanced', overtake: 'Overtake' },
    wrongWay: 'Wrong way',
    turnAround: 'Turn the car around',
    stopped: 'Car stopped',
    resetPrompt: 'to reset to the track',
    sectors: (i: number) => `S${i}`,
  },

  results: {
    lapN: (n: number) => `Lap ${n}`,
    invalid: 'Invalid',
    record: 'Record',
    sessionBest: 'Session best',
  },

  pause: {
    title: 'Paused',
    resume: 'Resume',
    restartLap: 'Restart lap',
    resetToTrack: 'Reset to track',
    quit: 'Quit to menu',
    camera: 'Camera',
    graphics: 'Graphics',
    volume: 'Volume',
    engine: 'Engine',
    effects: 'Effects',
    controls: 'Controls',
    controlLabels: {
      steer: 'Steer',
      throttle: 'Throttle',
      brake: 'Brake',
      shift: 'Shift',
      drs: 'DRS',
      ers: 'ERS',
      camera: 'Camera',
      reset: 'Reset',
      pause: 'Pause',
    },
    assistsNote: (circuit: string, device: string) => `${circuit} · ${device} assists`,
    recordsNote: 'Records last until the page closes',
  },

  gallery: {
    title: 'Interface kit',
  },
} as const;

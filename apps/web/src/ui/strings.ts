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
  intro: {
    title: 'First lap',
    controls: (steer: string, brake: string, throttle: string, pause: string) =>
      `Steer: ${steer} · Brake: ${brake} · Throttle: ${throttle} · Pause: ${pause}`,
    brakeNow: 'Brake now',
    next: 'Next tip',
    skip: 'Skip intro',
    replay: 'Replay intro',
    brake: (input: string) =>
      `Brake in a straight line before turning in. The driving line turns red where you need to brake. Brake: ${input}.`,
    limits:
      'Four wheels past the white lines invalidates this lap. It cannot set a record. Keep driving for a clean lap.',
    limitsRace:
      'Four wheels past the white lines is a track-limits strike. Strikes bring warnings, then the black and white flag, then a time penalty. Keep at least one wheel inside.',
    pause: (input: string) =>
      `Pause with ${input} for controls and settings. Skip or replay this intro from the pause menu.`,
    row: 'First-lap intro',
    rotate: 'Rotate your phone to drive',
    rotateHelp: 'Use landscape for room to steer and brake. The session is paused.',
    fullscreen: 'Fullscreen',
    display: 'Display',
  },
  update: {
    ready: 'A new version is ready.',
    reload: 'Reload',
  },
  homeScreen: {
    hint: 'For full screen, add the game to your Home Screen: tap Share, then Add to Home Screen.',
    close: 'Close',
  },
  launch: {
    tagline: (teams: number, drivers: number) =>
      `Open-wheel racing on measured circuits. ${cap(words(teams))} teams, ${words(drivers)} drivers, one car built to the regulations.`,
    press: 'Press any key or tap to start',
    pressTouch: 'Tap to start',
    build: 'Build',
    mapData: 'Map data ',
    osm: '© OpenStreetMap contributors',
    heights: '. Heights: Copernicus WorldDEM-30.',
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
    quickRaceTitle: 'Five laps against nineteen cars',
    onlineTitle: 'Private rooms',
    onlineBody:
      'Create a room and share its invite, or join one with a room code. Up to eight drivers race at Monza on equal cars; the host sets the laps and which assists are allowed.',
    unavailable: 'Not in this build yet',
    notYet: 'Not yet available',
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
    timeTrialOnly: 'Time Trial only',
    /** In a race every car, the player's included, runs the trim the circuit's racing line was built for. */
    raceDownforce: {
      low: 'Low downforce',
      medium: 'Medium downforce',
      high: 'High downforce',
    } as Record<string, string>,
    noRaceLine: (name: string) =>
      `The AI drivers have no racing line at ${name} yet, so race modes are not available there. Time Trial is.`,
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
    previous: 'Previous team',
    next: 'Next team',
    onlineNote:
      'The room gives each driver a team and car by seat, on equal cars. Choose your name in the lobby.',
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
    stability: 'Stability help',
    braking: 'Braking help',
    brakingNoLine: 'Needs a driving line for this car: Monza only for now',
    drivingLine: 'Driving line',
    lineChoices: { off: 'Off', braking: 'Braking', full: 'Full' },
    help: {
      tractionControl: 'Reduces engine drive when the rear tyres slip.',
      abs: 'Eases braking to prevent wheel locking.',
      gears: 'Shifts automatically at the engine speed limits.',
      steering: 'Reduces analog steering lock as speed rises. Keys use their own ramps.',
      stability: 'Brakes one wheel and trims the engine when the car starts to slide or push.',
      braking:
        'Brakes for you when you arrive at a corner faster than the driving line. On by default for keys (Low) and touch (Medium).',
      drivingLine: 'Shows the racing line and where to lift or brake.',
    },
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
    quickRace: 'Quick race',
    mb: (loaded: string, total: string) => `${loaded} / ${total} MB`,
  },

  hud: {
    timeTrial: 'Time trial',
    quickRace: 'Quick race',
    lap: 'Lap',
    lapN: (n: number) => `Lap ${n}`,
    outLap: 'Out lap',
    record: 'Record',
    currentLap: 'Current lap',
    last: 'Last',
    best: 'Best',
    ghost: 'Ghost',
    ghostActive: 'Active',
    ghostOnTrack: 'On track',
    greenFlag: 'Green flag',
    you: 'You',
    recordCode: 'REC',
    noTime: 'No time',
    outLapShort: 'Out',
    ghostOff: 'After a valid lap',
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
    blockingGhostOn: 'Cars held up behind you pass through your car',
    blockingGhostOff: 'Your car is solid again',
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
    uiAudio: 'Interface volume',
    ambience: 'Ambience volume',
    units: 'Speed units',
    mph: 'mph',
    autoGraphics: 'Auto',
    resetDefaults: 'Reset settings',
    defaults: 'Defaults',

    title: 'Paused',
    resume: 'Resume',
    restartLap: 'Restart lap',
    restartRace: 'Restart race',
    skipToResults: 'Skip to results',
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

  controls: {
    title: 'Controls',
    hintTag: 'Controls',
    rows: {
      steer: 'Steer',
      throttle: 'Throttle',
      brake: 'Brake',
      gearUp: 'Gear up',
      gearDown: 'Gear down',
      drs: 'DRS',
      overtake: 'Overtake',
      pitLimiter: 'Pit limiter',
      camera: 'Camera',
      lookBack: 'Look back',
      resetToTrack: 'Reset to track',
      pause: 'Pause',
    },
    notBound: 'Not bound',
    pauseMenu: 'Pause menu',
    arrowKeys: 'arrow keys',
    leftOnly: (c: string) => `${c} (left)`,
    rightOnly: (c: string) => `${c} (right)`,
    gearDownWord: 'gear down',
    gearUpWord: 'gear up',
    reverse: (down: string, up: string) =>
      `Reverse, with automatic gears: stop, then press ${down} twice. Press ${up} twice to return to first.`,
    hint: (brake: string, throttle: string, pause: string) =>
      `Brake: ${brake} · Throttle: ${throttle} · ${pause}, then Controls for all inputs`,
  },

  gallery: {
    title: 'Interface kit',
  },
} as const;

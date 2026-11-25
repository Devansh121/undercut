export const PROOF_CIRCUITS = ['monza', 'spa', 'singapore'];
export const PROOF_GROUPS = [
  'start-a',
  'start-b',
  'race-a',
  'race-b',
  'race-c',
  'race-d',
  'race-e',
  'default',
];

export function proofCases(circuit, group) {
  if (!PROOF_CIRCUITS.includes(circuit)) throw new Error(`unknown circuit ${circuit}`);
  let seeds;
  let laps;
  if (group === 'default') {
    // The telemetry command's own settings (pit stops on, no tyre model, the default start fuel).
    return [1, 4, 7].map((seed) => ({ circuit, seed, laps: 5, settings: 'default' }));
  }
  if (group === 'start-a' || group === 'start-b') {
    seeds = Array.from({ length: 10 }, (_, i) => (group === 'start-a' ? 101 : 111) + i);
    if (circuit === 'monza' && group === 'start-a') seeds.push(1022, 7307);
    laps = 1;
  } else {
    const index = PROOF_GROUPS.indexOf(group) - 2;
    if (index < 0 || index >= 5) throw new Error(`unknown proof group ${group}`);
    seeds = [2 * index + 1, 2 * index + 2];
    laps = 5;
  }
  return seeds.map((seed) => ({ circuit, seed, laps }));
}

export function summarizeRace(spec, run) {
  return {
    ...spec,
    cars: run.cars.length,
    passes: run.racing.overtakes,
    byLap: run.racing.overtakesByLap ?? [],
    laterPasses: (run.racing.overtakesByLap ?? []).slice(1).reduce((n, k) => n + (k ?? 0), 0),
    clean: run.cars.filter((car) => car.turnOne === 'clean').length,
    spins: run.cars.reduce((n, car) => n + car.spins, 0),
    contactTicks: run.cars.reduce((n, car) => n + car.contactTicks, 0),
    peak: Math.max(...run.cars.map((car) => car.maxContactSpeed)),
    classified: run.result.entries.filter(
      (car) => car.status === 'finished' && car.laps === spec.laps,
    ).length,
    findings: run.result.anomalies,
    beyondBarrier: Math.max(...run.cars.map((car) => car.beyondBarrier)),
    longestContact: Math.max(...run.cars.map((car) => car.longestContact)),
    allOffTicks: run.cars.reduce((n, car) => n + (car.allOffTicks ?? 0), 0),
    maxOffset: Math.max(0, ...run.cars.map((car) => car.maxOffset ?? 0)),
    wallHits: run.cars.reduce((n, car) => n + (car.wallHits ?? 0), 0),
    wallPeak: Math.max(0, ...run.cars.map((car) => car.maxWallSpeed ?? 0)),
  };
}

const sum = (rows, key) => rows.reduce((n, row) => n + row[key], 0);
const both = (pairs, key) => [
  sum(
    pairs.map((p) => p.baseline),
    key,
  ),
  sum(
    pairs.map((p) => p.head),
    key,
  ),
];
const peak = (rows) => Math.max(0, ...rows.map((row) => row.peak));
const key = (row) =>
  `${row.circuit}/${row.seed}/${row.laps}${row.settings ? `/${row.settings}` : ''}`;

export function proofReport(baseline, head) {
  const failures = [];
  const circuits = [];
  const baseByKey = new Map(baseline.map((row) => [key(row), row]));
  const headByKey = new Map(head.map((row) => [key(row), row]));
  const pairs = [];
  for (const circuit of PROOF_CIRCUITS) {
    for (const spec of PROOF_GROUPS.flatMap((group) => proofCases(circuit, group))) {
      const base = baseByKey.get(key(spec));
      const changed = headByKey.get(key(spec));
      if (!base || !changed) {
        failures.push(`${key(spec)}: missing ${!base ? 'baseline' : 'head'} result`);
        continue;
      }
      pairs.push({ ...spec, baseline: base, head: changed });
      if (changed.classified !== changed.cars || changed.cars !== 20 || changed.findings.length)
        failures.push(`${key(spec)}: classification or watchdog failure`);
      if (changed.beyondBarrier > 0 || changed.longestContact >= 5)
        failures.push(`${key(spec)}: barrier or persistent contact failure`);
      if ((spec.laps === 1 || spec.settings) && changed.clean < Math.min(18, base.clean))
        failures.push(`${key(spec)}: start below its acceptance floor`);
    }
    const races = pairs.filter(
      (pair) => pair.circuit === circuit && pair.laps === 5 && !pair.settings,
    );
    const defaults = pairs.filter((pair) => pair.circuit === circuit && pair.settings);
    const all = pairs.filter((pair) => pair.circuit === circuit);
    const starts = pairs.filter(
      (pair) => pair.circuit === circuit && pair.laps === 1 && pair.seed >= 101 && pair.seed <= 120,
    );
    const a = races.map((pair) => pair.baseline),
      b = races.map((pair) => pair.head);
    const x = starts.map((pair) => pair.baseline),
      y = starts.map((pair) => pair.head);
    const laterRaces = b.filter((row) => row.byLap.slice(1).some((n) => n > 0)).length;
    const aggregate = {
      circuit,
      races: races.length,
      starts: starts.length,
      passes: [sum(a, 'passes'), sum(b, 'passes')],
      contacts: [sum(a, 'contactTicks'), sum(b, 'contactTicks')],
      peak: [peak(a), peak(b)],
      spins: [sum(a, 'spins'), sum(b, 'spins')],
      cleanStarts: [sum(x, 'clean'), sum(y, 'clean')],
      startContacts: [sum(x, 'contactTicks'), sum(y, 'contactTicks')],
      startPeak: [peak(x), peak(y)],
      startSpins: [sum(x, 'spins'), sum(y, 'spins')],
      racesWithLaterPasses: laterRaces,
      laterPasses: [sum(a, 'laterPasses'), sum(b, 'laterPasses')],
      defaults: defaults.length,
      defaultPasses: both(defaults, 'passes'),
      defaultLaterPasses: both(defaults, 'laterPasses'),
      defaultContacts: both(defaults, 'contactTicks'),
      defaultPeak: [peak(defaults.map((p) => p.baseline)), peak(defaults.map((p) => p.head))],
      defaultSpins: both(defaults, 'spins'),
      defaultClean: both(defaults, 'clean'),
      // Every case at the circuit: barrier hits and ticks with all four wheels off the road.
      wallHits: both(all, 'wallHits'),
      allOffTicks: both(all, 'allOffTicks'),
    };
    circuits.push(aggregate);
    if (races.length === 10) {
      if (aggregate.passes[1] < 30 || laterRaces < 8)
        failures.push(
          `${circuit}: passing target not met (three per race and later passes in eight of ten races)`,
        );
      if (
        aggregate.contacts[1] > aggregate.contacts[0] ||
        aggregate.peak[1] > aggregate.peak[0] ||
        aggregate.spins[1] > aggregate.spins[0]
      )
        failures.push(`${circuit}: five-lap contact or spin totals rose`);
    }
    if (all.length === PROOF_GROUPS.flatMap((group) => proofCases(circuit, group)).length) {
      if (aggregate.wallHits[1] > aggregate.wallHits[0])
        failures.push(`${circuit}: wall hits rose`);
      if (aggregate.allOffTicks[1] > aggregate.allOffTicks[0])
        failures.push(`${circuit}: time with four wheels off the road rose`);
      if (
        aggregate.defaultContacts[1] > aggregate.defaultContacts[0] ||
        aggregate.defaultPeak[1] > aggregate.defaultPeak[0] ||
        aggregate.defaultSpins[1] > aggregate.defaultSpins[0]
      )
        failures.push(`${circuit}: contact or spin totals rose with the default settings`);
    }
    if (
      starts.length === 20 &&
      (aggregate.cleanStarts[1] < aggregate.cleanStarts[0] ||
        aggregate.startContacts[1] > aggregate.startContacts[0] ||
        aggregate.startPeak[1] > aggregate.startPeak[0] ||
        aggregate.startSpins[1] > aggregate.startSpins[0])
    )
      failures.push(`${circuit}: start sweep regressed`);
  }
  return { circuits, pairs, failures };
}

const number = (n) => Number(n.toFixed(4));
const pair = (row, field) => `${number(row.baseline[field])} / ${number(row.head[field])}`;
export function proofMarkdown(report, baseSha, headSha) {
  const lines = [
    `Baseline: ${baseSha}. Head: ${headSha}. Each pair below is master / head.`,
    '',
    'Twenty cars, mediums after formation warm-up, five-lap start fuel, no stops (the default-settings table excepted). Passes are the existing on-track position-swap metric, sampled every 0.25 s from 20 s after lights out. Contacts count car-ticks touching another car; peak closing speed is m/s. No failed car or watchdog finding is filtered out.',
    '',
    '| Circuit | Passes per five-lap race | Passes on laps 2–5 | Later-pass races at head | Contact ticks | Peak contact, m/s | Spins | Clean through turn one, start sweep |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.circuits.map(
      (r) =>
        `| ${r.circuit} | ${number(r.passes[0] / Math.max(1, r.races))} / ${number(r.passes[1] / Math.max(1, r.races))} | ${r.laterPasses.join(' / ')} | ${r.racesWithLaterPasses}/${r.races} | ${r.contacts.join(' / ')} | ${r.peak.map(number).join(' / ')} | ${r.spins.join(' / ')} | ${r.cleanStarts.join(' / ')} |`,
    ),
    '',
    "The telemetry command's default settings (pit stops on, no tyre model, the default start fuel), seeds 1, 4 and 7. Clean through turn one is summed over the three races.",
    '',
    '| Circuit | Passes | Passes on laps 2–5 | Contact ticks | Peak contact, m/s | Spins | Clean through turn one |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.circuits.map(
      (r) =>
        `| ${r.circuit} | ${r.defaultPasses.join(' / ')} | ${r.defaultLaterPasses.join(' / ')} | ${r.defaultContacts.join(' / ')} | ${r.defaultPeak.map(number).join(' / ')} | ${r.defaultSpins.join(' / ')} | ${r.defaultClean.join(' / ')} of ${20 * r.defaults} |`,
    ),
    '',
    'Every case at the circuit: separate barrier hits (a hit ends after 0.5 s clear of the barrier) and car-ticks with all four wheels off the road.',
    '',
    '| Circuit | Wall hits | All-off ticks |',
    '| --- | ---: | ---: |',
    ...report.circuits.map(
      (r) => `| ${r.circuit} | ${r.wallHits.join(' / ')} | ${r.allOffTicks.join(' / ')} |`,
    ),
    '',
    '| Circuit | Seed | Laps | Passes | Head passes on laps 1–5 | Contact ticks | Peak, m/s | Clean turn one | Spins | Wall hits | All-off ticks | Classified | Findings |',
    '| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.pairs.map(
      (r) =>
        `| ${r.circuit} | ${r.seed}${r.settings ? ' (default)' : ''} | ${r.laps} | ${pair(r, 'passes')} | ${Array.from({ length: r.laps }, (_, i) => r.head.byLap[i] ?? 0).join(', ')} | ${pair(r, 'contactTicks')} | ${pair(r, 'peak')} | ${pair(r, 'clean')} | ${pair(r, 'spins')} | ${pair(r, 'wallHits')} | ${pair(r, 'allOffTicks')} | ${pair(r, 'classified')} | ${r.baseline.findings.length} / ${r.head.findings.length} |`,
    ),
    '',
    ...(report.failures.length
      ? ['Unmet checks:', '', ...report.failures.map((f) => `- ${f}`)]
      : ['All proof checks passed.']),
  ];
  return lines.join('\n') + '\n';
}

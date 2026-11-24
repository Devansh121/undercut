export const PROOF_CIRCUITS = ['monza', 'spa', 'singapore'];
export const PROOF_GROUPS = [
  'start-a',
  'start-b',
  'race-a',
  'race-b',
  'race-c',
  'race-d',
  'race-e',
];

export function proofCases(circuit, group) {
  if (!PROOF_CIRCUITS.includes(circuit)) throw new Error(`unknown circuit ${circuit}`);
  let seeds;
  let laps;
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
  };
}

const sum = (rows, key) => rows.reduce((n, row) => n + row[key], 0);
const peak = (rows) => Math.max(0, ...rows.map((row) => row.peak));
const key = (row) => `${row.circuit}/${row.seed}/${row.laps}`;

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
      if (spec.laps === 1 && changed.clean < Math.min(18, base.clean))
        failures.push(`${key(spec)}: start below its acceptance floor`);
    }
    const races = pairs.filter((pair) => pair.circuit === circuit && pair.laps === 5);
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
    'Twenty cars, mediums after formation warm-up, five-lap start fuel, no stops. Passes are the existing on-track position-swap metric, sampled every 0.25 s from 20 s after lights out. Contacts count car-ticks touching another car; peak closing speed is m/s. No failed car or watchdog finding is filtered out.',
    '',
    '| Circuit | Passes per five-lap race | Contact ticks | Peak contact, m/s | Spins | Clean through turn one, start sweep | Later-pass races at head |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.circuits.map(
      (r) =>
        `| ${r.circuit} | ${number(r.passes[0] / Math.max(1, r.races))} / ${number(r.passes[1] / Math.max(1, r.races))} | ${r.contacts.join(' / ')} | ${r.peak.map(number).join(' / ')} | ${r.spins.join(' / ')} | ${r.cleanStarts.join(' / ')} | ${r.racesWithLaterPasses}/${r.races} |`,
    ),
    '',
    '| Circuit | Seed | Laps | Passes | Head passes on laps 1–5 | Contact ticks | Peak, m/s | Clean turn one | Spins | Classified | Findings |',
    '| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.pairs.map(
      (r) =>
        `| ${r.circuit} | ${r.seed} | ${r.laps} | ${pair(r, 'passes')} | ${Array.from({ length: r.laps }, (_, i) => r.head.byLap[i] ?? 0).join(', ')} | ${pair(r, 'contactTicks')} | ${pair(r, 'peak')} | ${pair(r, 'clean')} | ${pair(r, 'spins')} | ${pair(r, 'classified')} | ${r.baseline.findings.length} / ${r.head.findings.length} |`,
    ),
    '',
    ...(report.failures.length
      ? ['Unmet checks:', '', ...report.failures.map((f) => `- ${f}`)]
      : ['All proof checks passed.']),
  ];
  return lines.join('\n') + '\n';
}

/**
 * Which racing line a circuit races on, from the line files a build has
 * (`packages/ai/data/<circuit>-<trim>.line.json`). One rule for the menus (the Vite config, from
 * the files on disk) and the drive screen (from the build's glob of them), so the trim the card
 * names is the trim the race runs. With more than one trim for a circuit, the first by name.
 * Pure: names and paths only, nothing read.
 */

const SUFFIX = '.line.json';

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** The race line among `files` (names or paths) for `circuit`, or null. */
export function raceLineFile(circuit: string, files: readonly string[]): string | null {
  let best: string | null = null;
  let bestName = '';
  for (const f of files) {
    const name = baseName(f);
    if (!name.endsWith(SUFFIX) || !name.startsWith(`${circuit}-`)) continue;
    // The trim is one word after the circuit's id: `spa2-low` is not Spa's.
    const trim = name.slice(circuit.length + 1, -SUFFIX.length);
    if (trim.length === 0 || trim.includes('-')) continue;
    if (best === null || name < bestName) {
      best = f;
      bestName = name;
    }
  }
  return best;
}

/** The trim a race line file (name or path) for `circuit` was built for. */
export function raceLineTrim(circuit: string, file: string): string {
  return baseName(file).slice(circuit.length + 1, -SUFFIX.length);
}

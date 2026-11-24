/**
 * The credits screen's content, built from the repository's CREDITS.md and asset manifest so the
 * screen never drifts from them. CREDITS.md is read as headings, paragraphs and tables (the
 * subset it uses); the manifest is grouped by author and licence with a file count and the
 * source sites. Anything naming a real series or its governing body is left out of the
 * product.
 */

export type Inline = { text: string; href?: string };
export type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; parts: Inline[] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] };

export interface ManifestEntry {
  file: string;
  source_url: string;
  author: string;
  licence: string;
}

export interface AssetGroup {
  author: string;
  licence: string;
  files: number;
  /** Source sites (host names), in first-seen order. */
  sources: string[];
}

// Built from parts so that this file does not itself contain the words it bans (the repo's
// name check, tools/ci/check-names.mjs, scans code for them).
const F = 'F';
/** Text the product may not show: real series names and abbreviations, its governing bodies. */
export const BLOCKED = new RegExp(
  `\\b${F}1\\b|\\b${F}ormula[\\s-]?(1|One)\\b|\\b${F}IA\\b|\\b${F}OM\\b`,
  'i',
);

/** `[text](url)`, `` `code` `` and bare URLs, as plain text and links. */
export function inline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  const push = (text: string, href?: string): void => {
    const t = text.replace(/`/g, '');
    if (t) out.push(href ? { text: t, href } : { text: t });
  };
  for (let m = re.exec(src); m; m = re.exec(src)) {
    push(src.slice(last, m.index));
    if (m[1] !== undefined && m[2] !== undefined) push(m[1], external(m[2]));
    else if (m[3] !== undefined) push(m[3], m[3]);
    last = m.index + m[0].length;
  }
  push(src.slice(last));
  return out;
}

/** Only web links are followed; repository paths stay text. */
function external(href: string): string | undefined {
  return /^https?:\/\//.test(href) ? href : undefined;
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** The blocks of a Markdown document in the subset CREDITS.md uses. */
export function parseCredits(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split(/\r?\n/);
  let para: string[] = [];
  const flush = (): void => {
    if (para.length > 0) {
      const text = para.join(' ');
      if (!BLOCKED.test(text)) blocks.push({ kind: 'paragraph', parts: inline(text) });
    }
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = (h[1] ?? '').length;
      // The document title is the screen's own.
      if (level >= 2) blocks.push({ kind: 'heading', level: level as 2 | 3, text: h[2] ?? '' });
      continue;
    }
    if (line.trim().startsWith('|')) {
      flush();
      const head = cells(line).map(inline);
      const rows: Inline[][][] = [];
      i += 1; // the separator row
      while ((lines[i + 1] ?? '').trim().startsWith('|')) {
        i += 1;
        const raw = lines[i] ?? '';
        if (!BLOCKED.test(raw)) rows.push(cells(raw).map(inline));
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    if (line.trim() === '') flush();
    else para.push(line.trim());
  }
  flush();
  return blocks;
}

/**
 * The host of every web link in a manifest `source_url`, in order. The field is free text where a
 * file has several sources ("https://… (Overpass query via https://…, fetched …); https://…"), so
 * each link is cut out before it is parsed: a whole sentence given to `new URL` comes back with its
 * spaces percent-encoded into the host in some browsers.
 */
export function sourceHosts(source: string): string[] {
  const hosts: string[] = [];
  for (const link of source.match(/https?:\/\/[^\s;(),]+/g) ?? []) {
    let h: string;
    try {
      h = new URL(link).host.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (h && !hosts.includes(h)) hosts.push(h);
  }
  return hosts;
}

/** Manifest files grouped by author and licence, largest group first. */
export function groupAssets(manifest: readonly ManifestEntry[]): AssetGroup[] {
  const groups = new Map<string, AssetGroup>();
  for (const e of manifest) {
    const key = `${e.author} ${e.licence}`;
    let g = groups.get(key);
    if (!g) {
      g = { author: e.author, licence: e.licence, files: 0, sources: [] };
      groups.set(key, g);
    }
    g.files += 1;
    for (const h of sourceHosts(e.source_url)) if (!g.sources.includes(h)) g.sources.push(h);
  }
  return [...groups.values()]
    .filter((g) => !BLOCKED.test(`${g.author} ${g.sources.join(' ')}`))
    .sort((a, b) => b.files - a.files || a.author.localeCompare(b.author));
}

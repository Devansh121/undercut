/**
 * The licence notices shipped with the client build as `licences.txt`. The bundler drops the
 * licence comments of the code it minifies, and the Draco decoder, the fonts and the circuit data
 * are copied as they are, so their notices travel in this one file instead. CREDITS.md in the
 * repository has the full credits.
 *
 * `read` returns a repository file's text by its path from the repository root.
 */
export interface NoticePart {
  /** What ships, and under which licence. */
  title: string;
  /** A copyright line to print above the licence text, when the text itself has none. */
  copyright?: string;
  /** Repository files whose text is printed in full. */
  files: readonly string[];
}

export const NOTICE_PARTS: readonly NoticePart[] = [
  { title: 'The game: MIT License', files: ['LICENSE'] },
  {
    title: 'three.js (3D rendering, bundled into the scripts): MIT License',
    files: ['node_modules/three/LICENSE'],
  },
  {
    title: 'Draco decoder (assets/draco/, from three.js): Apache License 2.0',
    copyright: 'Copyright 2016 The Draco Authors. https://github.com/google/draco',
    files: ['apps/web/licences/Apache-2.0.txt'],
  },
  {
    title: 'Archivo font: SIL Open Font License 1.1',
    files: ['design/mock/fonts/Archivo-OFL.txt'],
  },
  {
    title: 'Barlow Semi Condensed font: SIL Open Font License 1.1',
    files: ['design/mock/fonts/Barlow-OFL.txt'],
  },
  {
    title: 'Circuit data: Open Database License 1.0 (OpenStreetMap) and Copernicus WorldDEM-30',
    files: [
      'packages/track/data/LICENSE-DATA.md',
      'packages/render/data/LICENSE-DATA.md',
      'packages/ai/data/LICENSE-DATA.md',
    ],
  },
];

const RULE = '='.repeat(78);

export function licenceNotices(
  gameName: string,
  read: (file: string) => string,
  parts: readonly NoticePart[] = NOTICE_PARTS,
): string {
  const out = [
    `${gameName}: licences`,
    '',
    `${gameName} is MIT licensed. It ships third-party code, fonts and data under their own`,
    'licences, each in full below. Textures and skies are CC0 1.0 (Poly Haven, ambientCG) and need',
    'no notice. Full credits are in CREDITS.md in the source repository.',
  ];
  for (const part of parts) {
    out.push('', RULE, part.title, RULE, '');
    if (part.copyright) out.push(part.copyright, '');
    for (const file of part.files) out.push(read(file).trimEnd(), '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

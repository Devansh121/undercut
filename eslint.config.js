import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Package layers, lowest first. A package may import only packages in lower layers
 * (never its own layer's siblings, never higher). services/rooms is separate: it may
 * use core and protocol only. Change this together with AGENTS.md.
 */
const LAYERS = [
  ['core'],
  ['sim'],
  ['track', 'ai'],
  ['race'],
  ['protocol'],
  ['input', 'audio', 'render'],
];
const ALL = LAYERS.flat();

// track and ai share a layer, but ai drives cars on a track, so it may read track.
const EXTRA_ALLOWED = { ai: ['track'] };

function restrictImports(allowed, extraPatterns = []) {
  const denied = ALL.filter((name) => !allowed.includes(name));
  const patterns = [...extraPatterns];
  if (denied.length > 0) {
    patterns.push({
      group: denied.map((name) => `@undercut/${name}`),
      message: 'Package dependency direction: see AGENTS.md (lower layers may not import higher).',
    });
  }
  patterns.push({
    group: ['**/packages/*/src/**', '**/apps/*/src/**', '**/services/*/src/**'],
    message: 'Import other packages by name (@undercut/<name>), not by path.',
  });
  return { 'no-restricted-imports': ['error', { patterns }] };
}

const NO_RENDERER = {
  group: ['three', 'three/*'],
  message: 'Only render and apps/web may use three.js.',
};

const layerConfigs = LAYERS.flatMap((layer, index) =>
  layer.map((name) => {
    const allowed = [...LAYERS.slice(0, index).flat(), ...(EXTRA_ALLOWED[name] ?? [])];
    const extra = ['render'].includes(name) ? [] : [NO_RENDERER];
    return {
      files: [`packages/${name}/**/*.ts`],
      rules: restrictImports(allowed, extra),
    };
  }),
);

// Pure packages: no wall clock, no unseeded randomness, no DOM.
const PURE = ['core', 'sim', 'track', 'ai', 'race', 'protocol'];
const pureConfig = {
  files: PURE.map((name) => `packages/${name}/src/**/*.ts`),
  rules: {
    'no-restricted-properties': [
      'error',
      { object: 'Math', property: 'random', message: 'Use the seeded Rng from @undercut/core.' },
      {
        object: 'Date',
        property: 'now',
        message: 'Time is passed in; the sim never reads the clock.',
      },
      {
        object: 'performance',
        property: 'now',
        message: 'Time is passed in; the sim never reads the clock.',
      },
    ],
    'no-restricted-globals': [
      'error',
      ...['window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame'].map(
        (name) => ({
          name,
          message: 'Pure packages have no DOM.',
        }),
      ),
    ],
  },
};

// The client finds services through settings, never a hard-coded host.
const noLocalhost = {
  files: ['apps/web/src/**/*.ts', 'packages/*/src/**/*.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'Literal[value=/localhost|127\\.0\\.0\\.1/]',
        message: 'Do not hard-code a local host; use the rooms URL setting.',
      },
      {
        selector: 'TemplateElement[value.raw=/localhost|127\\.0\\.0\\.1/]',
        message: 'Do not hard-code a local host; use the rooms URL setting.',
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/.wrangler/',
      '.cache/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      // Static design mocks, not shipped code.
      'design/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.{js,mjs}', '*.config.ts', 'apps/web/vite.config.ts', '**/test/**', 'tests/**'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    files: [
      'apps/web/src/**/*.ts',
      'packages/{render,audio,input}/src/**/*.ts',
      'tests/browser/**',
    ],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['tests/browser/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              message:
                "Import test and expect from './base' or './fixtures' so the software-WebGL preset guard runs (type-only imports are allowed).",
              allowTypeImports: true,
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportExpression[source.value="@playwright/test"], CallExpression[callee.name="require"][arguments.0.value="@playwright/test"]',
          message:
            "Import test and expect from './base' or './fixtures' so the software-WebGL preset guard runs.",
        },
      ],
    },
  },
  {
    files: ['services/rooms/src/**/*.ts'],
    languageOptions: { globals: { ...globals.serviceworker } },
    rules: restrictImports(['core', 'protocol']),
  },
  ...layerConfigs,
  pureConfig,
  noLocalhost,
);

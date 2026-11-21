import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();
const SPEC_PATH = 'tests/browser/__guard_check__.spec.ts';

async function lintSpec(code) {
  const [result] = await eslint.lintText(code, { filePath: SPEC_PATH });
  return result.messages;
}

describe('browser spec Playwright import guard', () => {
  it('rejects default, named, namespace, side-effect, dynamic, and require imports of @playwright/test', async () => {
    const forbidden = [
      "import test from '@playwright/test';\nvoid test;\n",
      "import { test } from '@playwright/test';\nvoid test;\n",
      "import { test as t } from '@playwright/test';\nvoid t;\n",
      "import * as pw from '@playwright/test';\nvoid pw;\n",
      "import '@playwright/test';\n",
      "export const load = () => import('@playwright/test');\n",
      "export const pw = require('@playwright/test');\n",
    ];

    for (const code of forbidden) {
      const messages = await lintSpec(code);
      const hits = messages.filter(
        (m) =>
          m.ruleId === '@typescript-eslint/no-restricted-imports' ||
          m.ruleId === 'no-restricted-syntax',
      );
      expect(hits.length, `expected ESLint to reject: ${code.trim()}`).toBeGreaterThan(0);
    }
  });

  it('allows type-only imports from @playwright/test and value imports from ./base and ./fixtures', async () => {
    const allowed = [
      "import type { Page } from '@playwright/test';\nexport type P = Page;\n",
      "import { type Page } from '@playwright/test';\nexport type P = Page;\n",
      "import { expect, test } from './base';\nvoid expect;\nvoid test;\n",
      "import { expect, test } from './fixtures';\nvoid expect;\nvoid test;\n",
    ];

    for (const code of allowed) {
      const messages = await lintSpec(code);
      const errors = messages.filter((m) => m.severity === 2);
      expect(errors, `unexpected ESLint errors for: ${code.trim()}`).toEqual([]);
    }
  });
});

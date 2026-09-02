import { expect } from 'vitest';
import type { Locator } from 'playwright';

// `playwright` (the library) ships no assertion helpers of its own — those live in
// `@playwright/test`, which this project does not depend on. Tests use plain vitest,
// so we register a minimal `toBeVisible` matcher that polls a Locator the same way
// Playwright's own assertion does, instead of pulling in the whole test-runner package.
const VISIBLE_TIMEOUT_MS = 5_000;

expect.extend({
  async toBeVisible(locator: Locator) {
    try {
      await locator.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
      return {
        pass: true,
        message: () => `expected locator not to be visible`,
      };
    } catch {
      return {
        pass: false,
        message: () => `expected locator to be visible within ${VISIBLE_TIMEOUT_MS}ms`,
      };
    }
  },
});

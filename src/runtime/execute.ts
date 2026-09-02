import type { Page } from 'playwright';
import type { Command, Script } from '../parser/types.js';
import { resolveTarget, TargetNotFoundError } from './targets.js';
import { UserError } from '../errors.js';

export { TargetNotFoundError } from './targets.js';

const TYPE_DELAY_MS = 60;

// `wait <target>` exists precisely to wait for something slow to appear, so it
// gets Playwright's own actionability budget rather than resolveTarget's
// shorter default.
const WAIT_TARGET_TIMEOUT_MS = 30_000;

// Playwright reports an unreachable URL with a multi-line call log naming
// internal frames - the single most likely thing to go wrong on a first run,
// rendered as a stack trace. Translate the two DNS/connection failures into the
// one sentence that actually tells the user what to do.
const UNREACHABLE = ['ERR_CONNECTION_REFUSED', 'ERR_NAME_NOT_RESOLVED'];

function hostLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

async function visit(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'load' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (UNREACHABLE.some((code) => message.includes(code))) {
      throw new UserError(
        `Nothing is running at ${hostLabel(url)} — start your dev server first, maybe \`npm run dev\`?`,
      );
    }
    throw error;
  }
}

async function runCommand(page: Page, command: Command): Promise<void> {
  switch (command.kind) {
    case 'visit':
      await visit(page, command.url);
      return;

    case 'viewport':
      await page.setViewportSize({ width: command.width, height: command.height });
      return;

    case 'click':
      await (await resolveTarget(page, command.target)).click();
      return;

    case 'type':
      await (await resolveTarget(page, command.target)).pressSequentially(command.text, {
        delay: TYPE_DELAY_MS,
      });
      return;

    case 'press':
      await page.keyboard.press(command.key);
      return;

    case 'hover':
      await (await resolveTarget(page, command.target)).hover();
      return;

    case 'scroll': {
      if ('to' in command) {
        await (await resolveTarget(page, command.to)).scrollIntoViewIfNeeded();
        return;
      }
      const amount = command.amount ?? 400;
      const delta = command.direction === 'down' ? amount : -amount;
      await page.mouse.wheel(0, delta);
      return;
    }

    case 'wait': {
      if ('ms' in command) {
        await page.waitForTimeout(command.ms);
        return;
      }
      if ('idle' in command) {
        await page.waitForLoadState('networkidle');
        return;
      }
      await (await resolveTarget(page, command.target, WAIT_TARGET_TIMEOUT_MS)).waitFor({
        state: 'visible',
        timeout: WAIT_TARGET_TIMEOUT_MS,
      });
      return;
    }

    case 'theme':
      await page.emulateMedia({ colorScheme: command.mode });
      return;

    // The overlay layer lands in Plan 2. Until then these are no-ops so that a
    // script written today keeps working unchanged once overlays exist.
    case 'zoom':
    case 'resetZoom':
    case 'highlight':
    case 'caption':
      return;

    case 'output':
      return;
  }
}

export async function executeScript(page: Page, script: Script): Promise<void> {
  for (const command of script.commands) {
    await runCommand(page, command);
  }
}

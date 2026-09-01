import type { Page } from 'playwright';
import type { Command, Script } from '../parser/types.js';
import { resolveTarget, TargetNotFoundError } from './targets.js';

export { TargetNotFoundError } from './targets.js';

const TYPE_DELAY_MS = 60;

async function runCommand(page: Page, command: Command): Promise<void> {
  switch (command.kind) {
    case 'visit':
      await page.goto(command.url, { waitUntil: 'load' });
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
      if (command.ms !== undefined) {
        await page.waitForTimeout(command.ms);
        return;
      }
      if (command.idle) {
        await page.waitForLoadState('networkidle');
        return;
      }
      if (command.target !== undefined) {
        await (await resolveTarget(page, command.target)).waitFor({ state: 'visible' });
      }
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

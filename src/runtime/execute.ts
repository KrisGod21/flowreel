import type { Locator, Page } from 'playwright';
import type { Command, Script } from '../parser/types.js';
import { resolveTarget, TargetNotFoundError } from './targets.js';
import { UserError } from '../errors.js';
import type { Overlay } from '../overlay/api.js';
import type { Point } from '../overlay/types.js';

export { TargetNotFoundError } from './targets.js';

const TYPE_DELAY_MS = 60;
const CLICK_SETTLE_MS = 140;
const ZOOM_SCALE = 1.6;
// The chip must outlive pressSequentially's own delay budget
// (text.length * TYPE_DELAY_MS) or it fades away mid-keystroke; the tail is
// slack on top of that so it lingers briefly after the last character too.
const CHIP_TAIL_MS = 300;

async function centreOf(locator: Locator): Promise<Point | null> {
  const box = await locator.boundingBox();
  return box ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) } : null;
}

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

async function runCommand(page: Page, command: Command, overlay?: Overlay): Promise<void> {
  switch (command.kind) {
    case 'visit':
      await visit(page, command.url);
      return;

    case 'viewport':
      await page.setViewportSize({ width: command.width, height: command.height });
      return;

    case 'click': {
      const locator = await resolveTarget(page, command.target);
      // Scroll before measuring, not after: centreOf reads boundingBox(),
      // which for a below-fold target returns a point outside the viewport.
      // The cursor would then glide to (and vanish past) that point, and only
      // afterwards would locator.click()'s own scrollIntoViewIfNeeded jump the
      // page - an unexplained cut in the recording. Guarded on overlay so the
      // no-overlay path stays byte-identical to today.
      if (overlay) await locator.scrollIntoViewIfNeeded();
      const point = overlay ? await centreOf(locator) : null;
      if (overlay && point) {
        await overlay.showCursor(true);
        await overlay.moveTo(point);
        await overlay.ripple(point);
        await page.waitForTimeout(CLICK_SETTLE_MS);
      }
      await locator.click();
      return;
    }

    case 'type': {
      const locator = await resolveTarget(page, command.target);
      if (overlay) await locator.scrollIntoViewIfNeeded();
      const point = overlay ? await centreOf(locator) : null;
      if (overlay && point) {
        await overlay.showCursor(true);
        await overlay.moveTo(point);
        await overlay.chip(command.text, point, command.text.length * TYPE_DELAY_MS + CHIP_TAIL_MS);
      }
      await locator.pressSequentially(command.text, { delay: TYPE_DELAY_MS });
      return;
    }

    case 'press': {
      // cursorPosition() defaults to {0, 0} until something has moved the
      // cursor, so a chip drawn before that would be clipped in the corner.
      if (overlay && overlay.cursorShown) {
        const at = await overlay.cursorPosition();
        await overlay.chip(command.key, at);
      }
      await page.keyboard.press(command.key);
      return;
    }

    case 'hover': {
      const locator = await resolveTarget(page, command.target);
      if (overlay) await locator.scrollIntoViewIfNeeded();
      const point = overlay ? await centreOf(locator) : null;
      if (overlay && point) {
        await overlay.showCursor(true);
        await overlay.moveTo(point);
      }
      await locator.hover();
      return;
    }

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

    case 'zoom': {
      if (!overlay) return;
      const locator = await resolveTarget(page, command.target);
      await locator.scrollIntoViewIfNeeded();
      const point = await centreOf(locator);
      if (point) await overlay.zoom(ZOOM_SCALE, point);
      return;
    }

    case 'resetZoom':
      if (overlay) await overlay.resetZoom();
      return;

    case 'highlight': {
      if (!overlay) return;
      const locator = await resolveTarget(page, command.target);
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      if (box) {
        await overlay.highlight({
          x: Math.round(box.x) - 4,
          y: Math.round(box.y) - 4,
          width: Math.round(box.width) + 8,
          height: Math.round(box.height) + 8,
        });
      }
      return;
    }

    case 'resetHighlight':
      if (overlay) await overlay.highlight(null);
      return;

    case 'caption':
      if (overlay) await overlay.caption(command.text);
      return;

    case 'output':
      return;
  }
}

export async function executeScript(page: Page, script: Script, overlay?: Overlay): Promise<void> {
  for (const command of script.commands) {
    await runCommand(page, command, overlay);
  }
}

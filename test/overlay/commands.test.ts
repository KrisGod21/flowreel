import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { Overlay } from '../../src/overlay/api.js';
import { executeScript } from '../../src/runtime/execute.js';
import { parse } from '../../src/parser/parse.js';

const FIXTURE = pathToFileURL(resolve('test/fixtures/app/index.html')).href;

let browser: Browser;
let page: Page;
let overlay: Overlay;

beforeAll(async () => {
  const choice = await resolveBrowser(systemProbe);
  browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
  page = await browser.newPage();
  await page.setViewportSize({ width: 800, height: 600 });
  overlay = await Overlay.install(page);
});

afterAll(async () => {
  await browser?.close();
});

describe('overlay-driven commands', () => {
  it('moves the cursor onto the element it clicks', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\nclick "Sign in"`), overlay);

    const box = await page.locator('#signin').boundingBox();
    const cursor = await overlay.cursorPosition();
    expect(box).not.toBeNull();
    expect(cursor.x).toBeGreaterThanOrEqual(box!.x - 2);
    expect(cursor.x).toBeLessThanOrEqual(box!.x + box!.width + 2);
    expect(cursor.y).toBeGreaterThanOrEqual(box!.y - 2);
    expect(cursor.y).toBeLessThanOrEqual(box!.y + box!.height + 2);
  });

  it('renders a caption from the caption command', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\ncaption "Hello there"`), overlay);
    expect(await overlay.captionText()).toBe('Hello there');
  });

  it('applies and reverts zoom from zoom / reset zoom', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\nzoom "#signin"`), overlay);
    await page.waitForTimeout(250);
    // setZoom transforms document.body (a sibling of the overlay host), not
    // documentElement - see src/overlay/browser.ts.
    expect(await page.evaluate(() => document.body.style.transform)).toContain('scale(');

    await executeScript(page, parse('reset zoom'), overlay);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.body.style.transform)).toBe('');
  });

  it('highlights the element named by highlight', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\nhighlight "#register"`), overlay);
    const style = await page.evaluate(
      () =>
        (window as never as { __flowreelOverlay: { root: ShadowRoot } })
          .__flowreelOverlay.root.querySelector('.fr-highlight')!.getAttribute('style') ?? '',
    );
    expect(style).toContain('opacity: 1');
  });

  it('still works with no overlay at all', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\nclick "Sign in"\ncaption "ignored"\nzoom "#signin"`));
    await expect(page.locator('#dashboard')).toBeVisible();
  });
});

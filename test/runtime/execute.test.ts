import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { executeScript, TargetNotFoundError } from '../../src/runtime/execute.js';
import { resolveTarget } from '../../src/runtime/targets.js';
import { startScreencast } from '../../src/capture/screencast.js';
import { parse } from '../../src/parser/parse.js';

const FIXTURE = pathToFileURL(resolve('test/fixtures/app/index.html')).href;
const DELAYED_FIXTURE = pathToFileURL(resolve('test/fixtures/app/delayed.html')).href;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  const choice = await resolveBrowser(systemProbe);
  browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
});

describe('executeScript', () => {
  it('runs a script and changes the page', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\nviewport 800x600\nclick "Sign in"\nwait 200`));
    await expect(page.locator('#dashboard')).toBeVisible();
  });

  it('types into a field found by CSS selector', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\ntype "#email" "demo@example.com"`));
    expect(await page.locator('#email').inputValue()).toBe('demo@example.com');
  });

  it('resolves a CSS-selector target to the visible match, not a hidden decoy that matches first', async () => {
    await page.goto(FIXTURE);
    // .cta matches both #hidden-cta (display: none, first in document order) and
    // #signin (visible). A presence-only resolver would return the hidden one.
    const locator = await resolveTarget(page, '.cta');
    expect(await locator.getAttribute('id')).toBe('signin');
  });

  it('names the visible buttons when a target is not found', async () => {
    await page.goto(FIXTURE);
    let err: unknown;
    try {
      await executeScript(page, parse('click "Log out"'));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TargetNotFoundError);
    expect((err as Error).message).toContain('Log out');
    expect((err as Error).message).toContain('Sign in');
    expect((err as Error).message).toContain('Register');
    expect((err as Error).message).not.toContain('Hidden decoy');
  });
});

describe('resolveTarget auto-wait', () => {
  // The archetypal `npx flowreel` target is a dev server whose framework mounts
  // after `load` fires. A point-in-time resolver throws before the button
  // exists; a polling one waits for it.
  it('waits for a target that appears after load', async () => {
    await page.goto(DELAYED_FIXTURE, { waitUntil: 'load' });
    await executeScript(page, parse('click "Later"'));
    expect(await page.locator('#later').count()).toBe(1);
  });

  it('still reports a genuinely absent target, naming what it did find', async () => {
    await page.goto(DELAYED_FIXTURE, { waitUntil: 'load' });
    let err: unknown;
    try {
      await resolveTarget(page, 'Never appears', 1_000);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TargetNotFoundError);
    expect((err as Error).message).toContain('Never appears');
    expect((err as Error).message).toContain('Ready');
  });
});

describe('startScreencast', () => {
  it('captures frames with dimensions', async () => {
    await page.goto(FIXTURE);
    await page.setViewportSize({ width: 800, height: 600 });
    const screencast = await startScreencast(page);
    await executeScript(page, parse('click "Sign in"\nwait 600'));
    const frameSet = await screencast.stop();

    expect(frameSet.frames.length).toBeGreaterThan(0);
    expect(frameSet.width).toBe(800);
    expect(frameSet.height).toBe(600);
    expect(frameSet.frames[0]!.data.byteLength).toBeGreaterThan(0);
  });
});

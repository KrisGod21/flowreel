import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { Overlay } from '../../src/overlay/api.js';
import { resolveTarget, TargetNotFoundError } from '../../src/runtime/targets.js';

const FIXTURE = pathToFileURL(resolve('test/fixtures/app/index.html')).href;

let browser: Browser;
let page: Page;
let overlay: Overlay;

beforeAll(async () => {
  const choice = await resolveBrowser(systemProbe);
  browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
  page = await browser.newPage();
  overlay = await Overlay.install(page);
  await page.goto(FIXTURE);
});

afterAll(async () => {
  await browser?.close();
});

describe('Overlay host', () => {
  it('installs into the page', async () => {
    expect(await overlay.isInstalled()).toBe(true);
  });

  it('survives a navigation', async () => {
    await page.goto(FIXTURE);
    expect(await overlay.isInstalled()).toBe(true);
  });

  it('is invisible to document.querySelector', async () => {
    const found = await page.evaluate(() => document.querySelector('.fr-cursor') !== null);
    expect(found).toBe(false);
  });

  it('does not let overlay text become a click target', async () => {
    await overlay.caption('Sign in');
    // The caption now reads "Sign in", the same text as the real button.
    // resolveTarget must still find the real button, not the caption.
    const locator = await resolveTarget(page, 'Sign in');
    expect(await locator.getAttribute('id')).toBe('signin');
    await overlay.caption('');
  });

  it('does not appear among the visible buttons in a not-found error', async () => {
    await overlay.caption('Log out');
    let message = '';
    try {
      await resolveTarget(page, 'Nonexistent Thing', 500);
    } catch (error) {
      if (error instanceof TargetNotFoundError) message = error.message;
    }
    expect(message).not.toContain('Log out');
    await overlay.caption('');
  });

  it('overlay elements are unreachable by Playwright locators', async () => {
    await overlay.caption('Unreachable');
    // Playwright's css engine pierces OPEN shadow roots. If the root were open,
    // these would find our elements. Closed roots are opaque to it, so both must
    // be 0 - this is the assertion that actually pins mode: 'closed'.
    expect(await page.locator('.fr-caption').count()).toBe(0);
    expect(await page.locator('.fr-cursor').count()).toBe(0);
    await overlay.caption('');
  });

  it('does not intercept real clicks', async () => {
    await page.goto(FIXTURE);
    await page.locator('#signin').click();
    await expect(page.locator('#dashboard')).toBeVisible();
  });
});

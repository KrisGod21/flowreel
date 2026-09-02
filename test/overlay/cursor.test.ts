import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { Overlay } from '../../src/overlay/api.js';

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
  await page.goto(FIXTURE);
});

afterAll(async () => {
  await browser?.close();
});

describe('cursor', () => {
  it('starts hidden and can be shown', async () => {
    await overlay.showCursor(true);
    const opacity = await page.evaluate(
      () => (window as never as { __flowreelOverlay: { root: ShadowRoot } })
        .__flowreelOverlay.root.querySelector('.fr-cursor')!.getAttribute('style'),
    );
    expect(opacity).toContain('opacity: 1');
  });

  it('lands exactly on the requested point', async () => {
    await overlay.moveTo({ x: 400, y: 300 }, 120);
    expect(await overlay.cursorPosition()).toEqual({ x: 400, y: 300 });
  });

  it('passes through intermediate positions rather than teleporting', async () => {
    await overlay.moveTo({ x: 0, y: 0 }, 0);

    const seen: number[] = [];
    const sampler = setInterval(() => {
      void overlay.cursorPosition().then((p) => seen.push(p.x)).catch(() => {});
    }, 15);

    await overlay.moveTo({ x: 600, y: 400 }, 400);
    clearInterval(sampler);

    const intermediate = seen.filter((x) => x > 0 && x < 600);
    expect(intermediate.length).toBeGreaterThan(0);
  });

  it('takes roughly the requested duration', async () => {
    await overlay.moveTo({ x: 10, y: 10 }, 0);
    const started = Date.now();
    await overlay.moveTo({ x: 500, y: 400 }, 300);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    // One frame plus a round-trip of slack, not a 5x allowance - the loose
    // bound here is what let a 2x overshoot pass unnoticed.
    expect(elapsed).toBeLessThan(650);
  });

  it('moves instantly when the duration is zero', async () => {
    await overlay.moveTo({ x: 123, y: 45 }, 0);
    expect(await overlay.cursorPosition()).toEqual({ x: 123, y: 45 });
  });
});

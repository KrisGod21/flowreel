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

const count = (selector: string) =>
  page.evaluate(
    (s) =>
      (window as never as { __flowreelOverlay: { root: ShadowRoot } })
        .__flowreelOverlay.root.querySelectorAll(s).length,
    selector,
  );

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

describe('ripple', () => {
  it('appears and then cleans itself up', async () => {
    await overlay.ripple({ x: 200, y: 200 }, 150);
    expect(await count('.fr-ripple')).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(await count('.fr-ripple')).toBe(0);
  });
});

describe('chip', () => {
  it('shows the typed text and then cleans itself up', async () => {
    await overlay.chip('demo@example.com', { x: 300, y: 200 }, 150);
    const text = await page.evaluate(
      () =>
        (window as never as { __flowreelOverlay: { root: ShadowRoot } })
          .__flowreelOverlay.root.querySelector('.fr-chip')?.textContent ?? '',
    );
    expect(text).toBe('demo@example.com');
    await page.waitForTimeout(500);
    expect(await count('.fr-chip')).toBe(0);
  });
});

describe('caption', () => {
  it('shows text and clears on empty string', async () => {
    await overlay.caption('One command, zero setup');
    expect(await overlay.captionText()).toBe('One command, zero setup');
    await overlay.caption('');
    expect(await overlay.captionText()).toBe('');
  });

  it('replaces the previous caption rather than stacking', async () => {
    await overlay.caption('first');
    await overlay.caption('second');
    expect(await overlay.captionText()).toBe('second');
    expect(await count('.fr-caption')).toBe(1);
    await overlay.caption('');
  });
});

describe('highlight', () => {
  it('positions over the given rect and clears on null', async () => {
    await overlay.highlight({ x: 40, y: 60, width: 120, height: 30 });
    const style = await page.evaluate(
      () =>
        (window as never as { __flowreelOverlay: { root: ShadowRoot } })
          .__flowreelOverlay.root.querySelector('.fr-highlight')!.getAttribute('style') ?? '',
    );
    expect(style).toContain('left: 40px');
    expect(style).toContain('width: 120px');
    expect(style).toContain('opacity: 1');

    await overlay.highlight(null);
    const cleared = await page.evaluate(
      () =>
        (window as never as { __flowreelOverlay: { root: ShadowRoot } })
          .__flowreelOverlay.root.querySelector('.fr-highlight')!.getAttribute('style') ?? '',
    );
    expect(cleared).toContain('opacity: 0');
  });
});

describe('zoom', () => {
  it('applies a scale transform and fully reverts', async () => {
    await overlay.zoom(1.6, { x: 400, y: 300 }, 50);
    await page.waitForTimeout(200);
    // The overlay host is a sibling of document.body (both children of
    // documentElement), so setZoom transforms body - see the comment on
    // setZoom in src/overlay/browser.ts for why that matters.
    const zoomed = await page.evaluate(() => document.body.style.transform);
    expect(zoomed).toContain('scale(1.6)');

    await overlay.resetZoom(50);
    await page.waitForTimeout(200);
    const reset = await page.evaluate(() => document.body.style.transform);
    expect(reset).toBe('');
  });

  it('keeps overlay elements at viewport coordinates while zoomed', async () => {
    // The zoom origin and the cursor's target point are deliberately far
    // apart on both axes: a point close to the transform origin barely moves
    // under a scale, which would let this test pass even with the bug
    // present (verified empirically - see the F1 section of the fix report).
    // The wait after zoom must clear the transition comfortably: at 200ms
    // (4x a 50ms transition) this was observed to be racy under load, letting
    // the assertion below sometimes read a mid-transition value and pass by
    // accident even with the bug present.
    await overlay.zoom(1.6, { x: 700, y: 50 }, 50);
    await page.waitForTimeout(800);
    await overlay.moveTo({ x: 50, y: 550 }, 0);

    // cursorAt() returns the number we asked for and so can never see this
    // bug; the rendered rect is what the screencast actually captures. If
    // setZoom transformed documentElement instead of body, the host would sit
    // inside the transformed subtree and this rect would land at roughly
    // origin + (point - origin) * 1.6, far from (50, 550).
    const rect = await page.evaluate(() => {
      const root = (window as unknown as { __flowreelOverlay: { root: ShadowRoot } })
        .__flowreelOverlay.root;
      const { x, y } = root.querySelector('.fr-cursor')!.getBoundingClientRect();
      return { x, y };
    });

    expect(Math.abs(rect.x - 50)).toBeLessThan(6);
    expect(Math.abs(rect.y - 550)).toBeLessThan(6);

    await overlay.resetZoom(50);
    await page.waitForTimeout(200);
  });
});

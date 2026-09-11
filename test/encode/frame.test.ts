import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { renderFrameAssets } from '../../src/encode/frame.js';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buffer: Buffer): boolean {
  return buffer.subarray(0, 8).equals(PNG_MAGIC);
}

describe('renderFrameAssets', () => {
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

  it('renders a backdrop and a mask as real PNGs', async () => {
    const assets = await renderFrameAssets(page, { width: 900, captureWidth: 1280, captureHeight: 800 });

    expect(isPng(assets.backdrop)).toBe(true);
    expect(isPng(assets.mask)).toBe(true);
    expect(assets.backdrop.length).toBeGreaterThan(0);
    expect(assets.mask.length).toBeGreaterThan(0);
  });

  it('places the window strictly inside the canvas with positive padding on every side', async () => {
    const assets = await renderFrameAssets(page, { width: 900, captureWidth: 1280, captureHeight: 800 });
    const { window, canvas } = assets;

    expect(window.x).toBeGreaterThan(0);
    expect(window.y).toBeGreaterThan(0);
    expect(window.x + window.width).toBeLessThan(canvas.width);
    expect(window.y + window.height).toBeLessThan(canvas.height);
  });

  it('keeps the window at the requested width and the capture aspect ratio', async () => {
    const assets = await renderFrameAssets(page, { width: 900, captureWidth: 1280, captureHeight: 800 });
    expect(assets.window.width).toBe(900);
    expect(assets.window.height).toBe(Math.round((900 * 800) / 1280));
  });

  it('re-renders at a different width when asked, e.g. for byte-budget degradation', async () => {
    const wide = await renderFrameAssets(page, { width: 900, captureWidth: 1280, captureHeight: 800 });
    const narrow = await renderFrameAssets(page, { width: 600, captureWidth: 1280, captureHeight: 800 });

    expect(narrow.window.width).toBe(600);
    expect(narrow.canvas.width).toBeLessThan(wide.canvas.width);
  });
});

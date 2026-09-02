import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { Overlay } from '../../src/overlay/api.js';
import { startScreencast } from '../../src/capture/screencast.js';
import { executeScript } from '../../src/runtime/execute.js';
import { parse } from '../../src/parser/parse.js';
import { runScript } from '../../src/run.js';

const FIXTURE = pathToFileURL(resolve('test/fixtures/app/index.html')).href;
// Scratch stays inside the repo so nothing is written off the D: drive.
const SCRATCH = resolve('.tmp/overlay-captured');
const SCRIPT = [`visit ${FIXTURE}`, 'caption "Overlay is visible"', 'wait 400'].join('\n');

let browser: Browser;

const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

async function captureLastFrame(withOverlay: boolean): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: 800, height: 600 });
    const overlay = withOverlay ? await Overlay.install(page) : undefined;
    const screencast = await startScreencast(page);
    await executeScript(page, parse(SCRIPT), overlay);
    const frames = (await screencast.stop()).frames;
    expect(frames.length).toBeGreaterThan(0);
    return hash(frames[frames.length - 1]!.data);
  } finally {
    await page.close();
  }
}

beforeAll(async () => {
  await mkdir(SCRATCH, { recursive: true });
  const choice = await resolveBrowser(systemProbe);
  browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
});

afterAll(async () => {
  await browser?.close();
});

describe('the overlay reaches the captured pixels', () => {
  it('produces different frames with the overlay than without it', async () => {
    const withoutOverlay = await captureLastFrame(false);
    const withOverlay = await captureLastFrame(true);
    expect(withOverlay).not.toBe(withoutOverlay);
  }, 60_000);

  it('is installed by a real runScript call', async () => {
    const installSpy = vi.spyOn(Overlay, 'install');
    try {
      const outputs = await runScript(
        [
          `visit ${FIXTURE}`,
          'viewport 800x600',
          'caption "Recording with overlay"',
          'click "Sign in"',
          'wait 500',
          'output overlaid.gif',
        ].join('\n'),
        { cwd: SCRATCH },
      );

      // The spy calls through, so the overlay is really installed - this
      // asserts that runScript is the thing that installs it. Without it,
      // nothing pins the wiring in run.ts and deleting that line leaves the
      // whole suite green.
      expect(installSpy).toHaveBeenCalledTimes(1);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.bytes).toBeGreaterThan(0);
    } finally {
      installSpy.mockRestore();
    }
  }, 60_000);
});

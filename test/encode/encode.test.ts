import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { encodeOutput, assertSupported, scratchDirFor } from '../../src/encode/encode.js';
import { renderFrameAssets } from '../../src/encode/frame.js';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { probeFfmpeg, ffmpegBinary, type FfmpegCapabilities } from '../../src/encode/probe.js';
import { execFile } from 'node:child_process';
import type { Frame } from '../../src/capture/types.js';

// Scratch stays inside the repo so nothing is written off the D: drive.
const SCRATCH = resolve('.tmp/encode-test');

// A tiny valid JPEG, solid color, 8x8.
const JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAIAAgBAREA/8QAFQABAQAAAAAA' +
  'AAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9k=';

function frames(count: number, fps: number): Frame[] {
  const data = Buffer.from(JPEG_BASE64, 'base64');
  return Array.from({ length: count }, (_, i) => ({
    data,
    timestampMs: Math.round((i * 1000) / fps),
  }));
}

// Probed once, up front, so the encoder checks can be `it.skipIf` conditions.
// An early `return` inside a test body makes a skipped test report as a *pass*,
// which is how a whole encoder path can silently go untested.
const caps = await probeFfmpeg();

// ffmpeg-static ships no ffprobe, so read the dimensions back out of ffmpeg's
// own stream banner. `ffmpeg -i <file>` with no output exits non-zero by design;
// the banner on stderr is what we want.
async function videoSize(path: string): Promise<string> {
  const stderr = await new Promise<string>((done) => {
    execFile(ffmpegBinary(), ['-hide_banner', '-i', path], (_error, _stdout, err) => done(err));
  });
  const match = /Video: .*?, (\d+)x(\d+)/.exec(stderr);
  return match ? `${match[1]}x${match[2]}` : `unparsed: ${stderr}`;
}

beforeAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true });
  await mkdir(SCRATCH, { recursive: true });
});

describe('encodeOutput', () => {
  it.skipIf(!caps.gif)('writes a GIF that exists and is non-empty', async () => {
    const out = resolve(SCRATCH, 'out.gif');
    const result = await encodeOutput(frames(15, 15), {
      format: 'gif',
      width: 320,
      fps: 15,
      maxBytes: 5_000_000,
    }, out);

    expect(result.bytes).toBeGreaterThan(0);
    expect((await stat(out)).size).toBe(result.bytes);
  });

  // The spec is "capture at native resolution, downscale per output": a preset
  // wider than the capture must not upscale it and pass the blur off as detail.
  it.skipIf(!caps.h264)('never upscales a capture narrower than the preset width', async () => {
    const out = resolve(SCRATCH, 'narrow.mp4');
    await encodeOutput(frames(15, 15), { format: 'mp4', width: 320, fps: 15, maxBytes: 10_000_000 }, out);

    // The source frames are 8x8; width 320 would have blown them up 40x.
    expect(await videoSize(out)).toBe('8x8');
  });

  it.skipIf(!caps.h264)('writes an MP4 that exists and is non-empty', async () => {
    const out = resolve(SCRATCH, 'out.mp4');
    const result = await encodeOutput(frames(15, 15), {
      format: 'mp4',
      width: 320,
      fps: 15,
      maxBytes: 10_000_000,
    }, out);

    expect(result.bytes).toBeGreaterThan(0);
  });

  it.skipIf(!caps.gif)('returns the file even when the byte budget cannot be met', async () => {
    const out = resolve(SCRATCH, 'over.gif');
    const result = await encodeOutput(frames(30, 15), {
      format: 'gif',
      width: 320,
      fps: 15,
      maxBytes: 1, // impossible on purpose
    }, out);

    // A valid file that missed its budget is reported, not thrown away.
    expect(result.bytes).toBeGreaterThan(1);
    expect((await stat(out)).size).toBe(result.bytes);
  });
});

describe('encodeOutput with framing', () => {
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

  // The discriminating check: framing adds padding around the window, so the
  // framed output must be wider than the requested width, while encoding the
  // very same frames without a renderFrame factory must come out at exactly
  // that width. If the two came out equal, framing did not actually apply.
  it.skipIf(!caps.h264)('produces a canvas wider than the requested width, unlike an unframed encode', async () => {
    const requestedWidth = 8; // matches the fixture JPEG's own native size

    const unframedOut = resolve(SCRATCH, 'unframed.mp4');
    await encodeOutput(frames(10, 15), { format: 'mp4', width: requestedWidth, fps: 15, maxBytes: 10_000_000 }, unframedOut);
    expect(await videoSize(unframedOut)).toBe(`${requestedWidth}x${requestedWidth}`);

    const framedOut = resolve(SCRATCH, 'framed.mp4');
    const renderFrame = (width: number) =>
      renderFrameAssets(page, { width, captureWidth: requestedWidth, captureHeight: requestedWidth });
    const result = await encodeOutput(
      frames(10, 15),
      { format: 'mp4', width: requestedWidth, fps: 15, maxBytes: 10_000_000 },
      framedOut,
      renderFrame,
    );

    expect(result.bytes).toBeGreaterThan(0);
    const size = await videoSize(framedOut);
    const match = /^(\d+)x(\d+)/.exec(size);
    expect(match).not.toBeNull();
    const framedWidth = Number(match![1]);
    expect(framedWidth).toBeGreaterThan(requestedWidth);
  });

  it.skipIf(!caps.gif)('still applies palettegen/paletteuse after the overlay for GIF', async () => {
    const requestedWidth = 8;
    const out = resolve(SCRATCH, 'framed.gif');
    const renderFrame = (width: number) =>
      renderFrameAssets(page, { width, captureWidth: requestedWidth, captureHeight: requestedWidth });

    const result = await encodeOutput(
      frames(10, 15),
      { format: 'gif', width: requestedWidth, fps: 15, maxBytes: 5_000_000 },
      out,
      renderFrame,
    );

    expect(result.bytes).toBeGreaterThan(0);
    expect((await stat(out)).size).toBe(result.bytes);
  });
});

describe('scratchDirFor', () => {
  it('keeps scratch inside the .flowreel directory .gitignore already covers', () => {
    const dir = scratchDirFor(resolve(SCRATCH, 'demo.gif'));
    expect(dir).toBe(resolve(SCRATCH, '.flowreel', 'tmp', 'demo.gif'));
  });

  it('gives each concurrent output its own scratch directory', () => {
    expect(scratchDirFor(resolve(SCRATCH, 'demo.gif'))).not.toBe(
      scratchDirFor(resolve(SCRATCH, 'demo.mp4')),
    );
  });
});

describe('assertSupported', () => {
  // A fabricated capabilities object, not this machine's real ffmpeg probe —
  // ffmpeg-static ships the same prebuilt binary to every install, which
  // means every format here is available on essentially every machine and in
  // CI. A test of the missing-encoder path must not depend on this build
  // actually lacking an encoder, or it silently asserts nothing everywhere.
  const caps: FfmpegCapabilities = { h264: true, webp: true, gif: true, vp9: false };

  it('throws a friendly error for a format this build cannot encode', () => {
    expect(() => assertSupported(caps, 'webm')).toThrow(/no webm encoder/i);
  });

  it('does not throw for a format this build can encode', () => {
    expect(() => assertSupported(caps, 'gif')).not.toThrow();
  });
});

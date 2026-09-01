import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodeOutput } from '../../src/encode/encode.js';
import { probeFfmpeg } from '../../src/encode/probe.js';
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

beforeAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true });
  await mkdir(SCRATCH, { recursive: true });
});

describe('encodeOutput', () => {
  it('writes a GIF that exists and is non-empty', async () => {
    const caps = await probeFfmpeg();
    if (!caps.gif) return;

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

  it('writes an MP4 that exists and is non-empty', async () => {
    const caps = await probeFfmpeg();
    if (!caps.h264) return;

    const out = resolve(SCRATCH, 'out.mp4');
    const result = await encodeOutput(frames(15, 15), {
      format: 'mp4',
      width: 320,
      fps: 15,
      maxBytes: 10_000_000,
    }, out);

    expect(result.bytes).toBeGreaterThan(0);
  });

  it('reports a friendly error when the format is unsupported by this build', async () => {
    const caps = await probeFfmpeg();
    // If this build can do webm there is no missing-encoder path to exercise.
    if (caps.vp9) return;

    await expect(
      encodeOutput(frames(3, 15), {
        format: 'webm',
        width: 320,
        fps: 15,
        maxBytes: 10_000_000,
      }, resolve(SCRATCH, 'tiny.webm')),
    ).rejects.toThrow(/no webm encoder/i);
  });

  it('returns the file even when the byte budget cannot be met', async () => {
    const caps = await probeFfmpeg();
    if (!caps.gif) return;

    const out = resolve(SCRATCH, 'over.gif');
    const result = await encodeOutput(frames(30, 15), {
      format: 'gif',
      width: 320,
      fps: 15,
      maxBytes: 1, // impossible on purpose
    }, out);

    // A valid file that missed its budget is reported, not thrown away.
    expect(result.bytes).toBeGreaterThan(1);
  });
});

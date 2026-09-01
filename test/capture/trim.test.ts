import { describe, it, expect } from 'vitest';
import { trimIdle, resampleToFps } from '../../src/capture/trim.js';
import type { Frame } from '../../src/capture/types.js';

const frame = (timestampMs: number, tag = 'x'): Frame => ({
  data: Buffer.from(tag),
  timestampMs,
});

describe('trimIdle', () => {
  it('leaves a tight sequence untouched', () => {
    const frames = [frame(0), frame(100), frame(200)];
    expect(trimIdle(frames, 500).map((f) => f.timestampMs)).toEqual([0, 100, 200]);
  });

  it('collapses a long gap down to the threshold', () => {
    const frames = [frame(0), frame(100), frame(5100), frame(5200)];
    expect(trimIdle(frames, 500).map((f) => f.timestampMs)).toEqual([0, 100, 600, 700]);
  });

  it('collapses several gaps cumulatively', () => {
    const frames = [frame(0), frame(3000), frame(6000)];
    expect(trimIdle(frames, 500).map((f) => f.timestampMs)).toEqual([0, 500, 1000]);
  });

  it('handles an empty sequence', () => {
    expect(trimIdle([], 500)).toEqual([]);
  });
});

describe('resampleToFps', () => {
  it('produces frames at a constant interval', () => {
    const frames = [frame(0, 'a'), frame(500, 'b'), frame(1000, 'c')];
    const out = resampleToFps(frames, 2);
    expect(out.map((f) => f.timestampMs)).toEqual([0, 500, 1000]);
  });

  it('holds each source frame until the next one arrives', () => {
    // Sample-and-hold is the correct semantics for a screencast: a frame stays
    // on screen until the browser sends a new one.
    const frames = [frame(0, 'a'), frame(900, 'b')];
    const out = resampleToFps(frames, 2);
    expect(out.map((f) => f.data.toString())).toEqual(['a', 'a']);
  });

  it('holds the last frame when the source is sparse', () => {
    const frames = [frame(0, 'a'), frame(2000, 'b')];
    const out = resampleToFps(frames, 1);
    expect(out.map((f) => f.data.toString())).toEqual(['a', 'a', 'b']);
  });

  it('returns an empty array for no input', () => {
    expect(resampleToFps([], 15)).toEqual([]);
  });
});

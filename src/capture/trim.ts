import type { Frame } from './types.js';

export type { Frame, FrameSet } from './types.js';

export function trimIdle(frames: Frame[], thresholdMs: number): Frame[] {
  if (frames.length === 0) return [];

  const out: Frame[] = [{ ...frames[0]!, timestampMs: 0 }];
  let previousSource = frames[0]!.timestampMs;
  let previousOutput = 0;

  for (let i = 1; i < frames.length; i++) {
    const source = frames[i]!;
    const gap = source.timestampMs - previousSource;
    const cappedGap = Math.min(gap, thresholdMs);
    const timestampMs = previousOutput + cappedGap;

    out.push({ ...source, timestampMs });
    previousSource = source.timestampMs;
    previousOutput = timestampMs;
  }

  return out;
}

export function resampleToFps(frames: Frame[], fps: number): Frame[] {
  if (frames.length === 0) return [];

  const interval = 1000 / fps;
  const duration = frames[frames.length - 1]!.timestampMs;
  const slots = Math.floor(duration / interval) + 1;

  const out: Frame[] = [];
  let cursor = 0;

  for (let slot = 0; slot < slots; slot++) {
    const target = slot * interval;
    while (cursor + 1 < frames.length && frames[cursor + 1]!.timestampMs <= target) {
      cursor++;
    }
    out.push({ data: frames[cursor]!.data, timestampMs: Math.round(target) });
  }

  return out;
}

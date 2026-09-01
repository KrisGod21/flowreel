import { describe, it, expect } from 'vitest';
import { PRESETS } from '../../src/encode/presets.js';
import { degrade } from '../../src/encode/budget.js';
import type { OutputSpec } from '../../src/encode/presets.js';

const spec: OutputSpec = { format: 'gif', width: 900, fps: 15, maxBytes: 5_000_000 };

describe('PRESETS', () => {
  it('has a default preset that emits both an image and a video', () => {
    const formats = PRESETS.default!.outputs.map((o) => o.format);
    expect(formats).toContain('mp4');
    expect(formats.some((f) => f === 'webp' || f === 'gif')).toBe(true);
  });

  it('matches the spec values for github-readme', () => {
    const [output] = PRESETS['github-readme']!.outputs;
    expect(output!.width).toBe(900);
    expect(output!.fps).toBe(15);
    expect(output!.maxBytes).toBe(5_000_000);
  });

  it('matches the spec values for producthunt', () => {
    const [output] = PRESETS.producthunt!.outputs;
    expect(output!.format).toBe('gif');
    expect(output!.width).toBe(1270);
    expect(output!.maxBytes).toBe(3_000_000);
  });
});

describe('degrade', () => {
  it('drops the framerate first', () => {
    expect(degrade(spec, 1)).toEqual({ ...spec, fps: 12 });
  });

  it('drops width once framerate is exhausted', () => {
    expect(degrade(spec, 3)!.width).toBeLessThan(900);
  });

  it('never returns a framerate below 8', () => {
    for (let attempt = 1; attempt < 10; attempt++) {
      const next = degrade(spec, attempt);
      if (next) expect(next.fps).toBeGreaterThanOrEqual(8);
    }
  });

  it('gives up eventually', () => {
    expect(degrade(spec, 99)).toBeNull();
  });

  it('never changes the format', () => {
    expect(degrade(spec, 2)!.format).toBe('gif');
  });
});

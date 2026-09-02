import { describe, it, expect } from 'vitest';
import { easeInOutCubic, lerp } from '../../src/overlay/ease.js';

describe('easeInOutCubic', () => {
  it('is pinned at both ends', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it('passes through the midpoint', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 5);
  });

  it('starts slower than linear and ends faster', () => {
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
  });

  it('is monotonic across the range', () => {
    let previous = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const value = easeInOutCubic(i / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('clamps out-of-range input', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe('lerp', () => {
  it('returns the endpoints', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it('interpolates the middle', () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it('handles a descending range', () => {
    expect(lerp(20, 10, 0.5)).toBe(15);
  });
});

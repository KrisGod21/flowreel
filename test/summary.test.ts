import { describe, it, expect } from 'vitest';
import { formatSummary } from '../src/summary.js';

describe('formatSummary', () => {
  it('lists each output with its size and destination', () => {
    const text = formatSummary([
      { path: 'demo.gif', bytes: 1_800_000, format: 'gif', overBudget: false },
      { path: 'demo.mp4', bytes: 740_000, format: 'mp4', overBudget: false },
    ]);

    expect(text).toContain('demo.gif');
    expect(text).toContain('1.8 MB');
    expect(text).toContain('README');
    expect(text).toContain('demo.mp4');
    expect(text).toContain('740 KB');
  });

  it('includes a paste-ready README snippet for the image output', () => {
    const text = formatSummary([{ path: 'demo.gif', bytes: 100, format: 'gif', overBudget: false }]);
    expect(text).toContain('![demo](demo.gif)');
  });

  it('derives the snippet alt text from the output filename, not a hardcoded label', () => {
    const text = formatSummary([{ path: 'shot.gif', bytes: 100, format: 'gif', overBudget: false }]);
    expect(text).toContain('![shot](shot.gif)');
  });

  it('flags an output that missed its budget', () => {
    const text = formatSummary([
      { path: 'demo.gif', bytes: 9_000_000, format: 'gif', overBudget: true },
    ]);
    expect(text).toMatch(/over budget/i);
  });

  it('omits the README snippet when only a video was produced', () => {
    const text = formatSummary([{ path: 'demo.mp4', bytes: 100, format: 'mp4', overBudget: false }]);
    expect(text).not.toContain('![');
  });
});

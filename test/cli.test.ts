import { describe, it, expect } from 'vitest';
import { version } from '../src/cli.js';

describe('cli', () => {
  it('exposes the package version', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

import { describe, it, expect } from 'vitest';
import { resolveBrowser, launchOptionsFor, type BrowserProbe } from '../../src/browser/resolve.js';

function probe(available: string[], bundled: boolean): BrowserProbe {
  return {
    channelAvailable: async (channel) => available.includes(channel),
    bundledAvailable: async () => bundled,
  };
}

describe('resolveBrowser', () => {
  it('prefers system Chrome over everything else', async () => {
    const choice = await resolveBrowser(probe(['chrome', 'msedge'], true));
    expect(choice).toEqual({ kind: 'channel', channel: 'chrome' });
  });

  it('falls back to Edge when Chrome is absent', async () => {
    const choice = await resolveBrowser(probe(['msedge'], true));
    expect(choice).toEqual({ kind: 'channel', channel: 'msedge' });
  });

  it('falls back to bundled Chromium when no system browser exists', async () => {
    const choice = await resolveBrowser(probe([], true));
    expect(choice).toEqual({ kind: 'bundled' });
  });

  it('reports missing when there is nothing at all', async () => {
    const choice = await resolveBrowser(probe([], false));
    expect(choice).toEqual({ kind: 'missing' });
  });
});

describe('launchOptionsFor', () => {
  it('passes the channel through for a system browser', () => {
    expect(launchOptionsFor({ kind: 'channel', channel: 'chrome' })).toEqual({ channel: 'chrome' });
  });

  it('passes no channel for bundled Chromium', () => {
    expect(launchOptionsFor({ kind: 'bundled' })).toEqual({});
  });
});

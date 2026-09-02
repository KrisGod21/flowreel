import { describe, it, expect } from 'vitest';
import { resolveBrowser, launchOptionsFor, candidatePaths, type BrowserProbe } from '../../src/browser/resolve.js';

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

describe('candidatePaths', () => {
  it('includes per-user Chrome path when LOCALAPPDATA is set', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' };
    const paths = candidatePaths('chrome', env);
    expect(paths).toContain('C:\\Users\\Test\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe');
  });

  it('uses ProgramFiles from environment when set to non-C drive', () => {
    const env = { 'ProgramFiles': 'D:\\Program Files' };
    const paths = candidatePaths('chrome', env);
    expect(paths).toContain('D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  });

  it('does not emit paths with undefined when env vars are missing', () => {
    const env: NodeJS.ProcessEnv = {};
    const paths = candidatePaths('chrome', env);
    const hasUndefined = paths.some(p => p.includes('undefined'));
    expect(hasUndefined).toBe(false);
  });

  it('includes per-user Edge path when LOCALAPPDATA is set', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' };
    const paths = candidatePaths('msedge', env);
    expect(paths).toContain('C:\\Users\\Test\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe');
  });

  it('always includes macOS and Linux paths regardless of environment', () => {
    const env: NodeJS.ProcessEnv = {};
    const chromePaths = candidatePaths('chrome', env);
    const edgePaths = candidatePaths('msedge', env);

    expect(chromePaths).toContain('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    expect(chromePaths).toContain('/usr/bin/google-chrome');
    expect(edgePaths).toContain('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    expect(edgePaths).toContain('/usr/bin/microsoft-edge');
  });
});

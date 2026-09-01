import { access } from 'node:fs/promises';
import { chromium } from 'playwright';

export type Channel = 'chrome' | 'msedge';

export type BrowserChoice =
  | { kind: 'channel'; channel: Channel }
  | { kind: 'bundled' }
  | { kind: 'missing' };

export interface BrowserProbe {
  channelAvailable(channel: Channel): Promise<boolean>;
  bundledAvailable(): Promise<boolean>;
}

const CHANNEL_ORDER: Channel[] = ['chrome', 'msedge'];

export async function resolveBrowser(probe: BrowserProbe): Promise<BrowserChoice> {
  for (const channel of CHANNEL_ORDER) {
    if (await probe.channelAvailable(channel)) {
      return { kind: 'channel', channel };
    }
  }
  return (await probe.bundledAvailable()) ? { kind: 'bundled' } : { kind: 'missing' };
}

export function launchOptionsFor(choice: BrowserChoice): { channel?: Channel } {
  return choice.kind === 'channel' ? { channel: choice.channel } : {};
}

const CHANNEL_PATHS: Record<Channel, string[]> = {
  chrome: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ],
  msedge: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/microsoft-edge',
  ],
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export const systemProbe: BrowserProbe = {
  async channelAvailable(channel) {
    for (const path of CHANNEL_PATHS[channel]) {
      if (await exists(path)) return true;
    }
    return false;
  },
  async bundledAvailable() {
    try {
      return await exists(chromium.executablePath());
    } catch {
      return false;
    }
  },
};

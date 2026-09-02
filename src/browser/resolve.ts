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

export function candidatePaths(channel: Channel, env: NodeJS.ProcessEnv): string[] {
  const paths: string[] = [];

  // Windows paths - derive from environment variables
  const localAppData = env.LOCALAPPDATA;
  const programFiles = env['ProgramFiles'];
  const programFilesX86 = env['ProgramFiles(x86)'];

  if (channel === 'chrome') {
    if (localAppData) {
      paths.push(`${localAppData}\\Google\\Chrome\\Application\\chrome.exe`);
    }
    if (programFiles) {
      paths.push(`${programFiles}\\Google\\Chrome\\Application\\chrome.exe`);
    }
    if (programFilesX86) {
      paths.push(`${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`);
    }
  } else if (channel === 'msedge') {
    if (localAppData) {
      paths.push(`${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe`);
    }
    if (programFilesX86) {
      paths.push(`${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`);
    }
    if (programFiles) {
      paths.push(`${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`);
    }
  }

  // macOS and Linux paths - platform-independent
  if (channel === 'chrome') {
    paths.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    paths.push('/usr/bin/google-chrome');
  } else if (channel === 'msedge') {
    paths.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    paths.push('/usr/bin/microsoft-edge');
  }

  return paths;
}

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
    const paths = candidatePaths(channel, process.env);
    for (const path of paths) {
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

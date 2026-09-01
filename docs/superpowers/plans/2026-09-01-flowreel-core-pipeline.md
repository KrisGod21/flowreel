# flowreel Core Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the end-to-end pipeline so that `flowreel demo.reel` turns a hand-written script into a real `demo.webp` and `demo.mp4`.

**Architecture:** A `.reel` script is parsed into a typed `Script`. A runtime executes those commands against a Playwright-driven Chromium page while a CDP screencast captures frames with timestamps. Frames are trimmed of dead time, resampled to a target framerate, and encoded by ffmpeg into every format the preset asks for, in parallel, under a byte budget. Every stage is a pure function over data wherever possible, so the browser is needed only in the two integration tasks.

**Tech Stack:** Node 20+, TypeScript, Playwright, `ffmpeg-static`, Vitest, tsc.

**Spec:** `docs/superpowers/specs/2026-09-01-flowreel-design.md`

## Global Constraints

- Node 20+ (`"engines": { "node": ">=20" }`). TypeScript, ESM (`"type": "module"`).
- npm package name is `flowreel`. Binary is `flowreel`.
- **All work stays on the `D:` drive.** Never write scratch files to `C:`, `os.tmpdir()`, or `/tmp`. Runtime scratch goes in `<cwd>/.flowreel/tmp`; test scratch goes in `<repo>/.tmp`. Both are gitignored and cleaned up.
- **Commits are authored as `Krishna <krishnar.sharmanew@gmail.com>` with no `Co-Authored-By` trailer of any kind.** Never add a Claude co-author line.
- Exit codes: `0` success, `1` script or runtime error, `2` internal error.
- Errors state the fix in plain language, never a stack trace. A failing selector must list what *was* found on the page.
- No telemetry, no network calls, no accounts. The only process spawned is ffmpeg, and the only network access is the user's own localhost.
- Preset values, copied verbatim from the spec:
  - `default` — emits both; 900px image, 1280px video; under 5MB / under 10MB
  - `github-readme` — WebP or GIF; 900px wide, 15fps, looped; under 5MB
  - `docs` — WebM with MP4 fallback; 1280px wide; under 10MB
  - `twitter` — MP4; 1280x720; under 15MB
  - `producthunt` — GIF; 1270px wide; under 3MB
- A preset may be named in the script's `output` line or passed as a CLI flag. **The CLI flag wins.** An explicit file extension always overrides the preset's format choice.

---

## File Structure

| path | responsibility |
|------|----------------|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | project config |
| `src/cli.ts` | binary entry, flag parsing, error presentation, exit codes |
| `src/parser/tokenize.ts` | one line of `.reel` source into tokens, quote-aware |
| `src/parser/types.ts` | `Command`, `Script`, `ReelParseError` |
| `src/parser/parse.ts` | source into a typed `Script` |
| `src/browser/resolve.ts` | choose system Chrome, system Edge, or bundled Chromium |
| `src/encode/probe.ts` | which encoders this ffmpeg build actually has |
| `src/capture/types.ts` | `Frame`, `FrameSet` |
| `src/capture/screencast.ts` | CDP screencast into a `FrameSet` |
| `src/capture/trim.ts` | dead-time trimming, framerate resampling (pure) |
| `src/runtime/targets.ts` | plain-English target into a Playwright locator |
| `src/runtime/execute.ts` | run a `Script` against a page |
| `src/encode/presets.ts` | the preset table as data |
| `src/encode/budget.ts` | the quality-degradation ladder (pure) |
| `src/encode/encode.ts` | a `FrameSet` into one output file via ffmpeg |
| `src/run.ts` | orchestration: parse, launch, execute, capture, encode all outputs |
| `src/summary.ts` | the paste-ready result block (pure) |
| `test/fixtures/app/index.html` | the bundled static demo app tests run against |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/cli.ts`
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable ESM TypeScript package with a `flowreel` binary and a working Vitest setup. Later tasks add modules under `src/`.

- [ ] **Step 1: Write the failing test**

Create `test/cli.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { version } from '../src/cli.js';

describe('cli', () => {
  it('exposes the package version', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli.test.ts`
Expected: FAIL — cannot resolve `../src/cli.js`.

- [ ] **Step 3: Write minimal implementation**

Create `package.json`:

```json
{
  "name": "flowreel",
  "version": "0.1.0",
  "description": "Record a polished demo of your web app by clicking through it once.",
  "type": "module",
  "bin": { "flowreel": "./dist/cli.js" },
  "main": "./dist/cli.js",
  "files": ["dist"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "license": "MIT",
  "dependencies": {
    "ffmpeg-static": "^5.2.0",
    "playwright": "^1.49.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
```

Create `.gitignore`:

```
node_modules/
dist/
.tmp/
.flowreel/
*.log
```

Create `src/cli.ts`:

```ts
export const version = '0.1.0';

export async function main(_argv: string[]): Promise<number> {
  process.stdout.write(`flowreel ${version}\n`);
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm install && npx vitest run test/cli.test.ts && npx tsc --noEmit`
Expected: PASS, and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/cli.ts test/cli.test.ts package-lock.json
git commit -m "chore: scaffold flowreel package"
```

---

## Task 2: Quote-aware tokenizer

**Files:**
- Create: `src/parser/tokenize.ts`
- Test: `test/parser/tokenize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `tokenize(line: string): string[]` — splits on whitespace, treats double-quoted runs as one token with the quotes stripped, and strips `#` comments outside quotes. Task 3 uses it.

- [ ] **Step 1: Write the failing test**

Create `test/parser/tokenize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/parser/tokenize.js';

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('click Sign')).toEqual(['click', 'Sign']);
  });

  it('keeps quoted strings together and strips the quotes', () => {
    expect(tokenize('click "Sign in"')).toEqual(['click', 'Sign in']);
  });

  it('handles several quoted arguments', () => {
    expect(tokenize('type "#email" "a b@c.com"')).toEqual(['type', '#email', 'a b@c.com']);
  });

  it('strips comments outside quotes', () => {
    expect(tokenize('click "Go" # then wait')).toEqual(['click', 'Go']);
  });

  it('keeps a hash inside quotes', () => {
    expect(tokenize('click "#main"')).toEqual(['click', '#main']);
  });

  it('returns an empty array for blank and comment-only lines', () => {
    expect(tokenize('   ')).toEqual([]);
    expect(tokenize('# just a note')).toEqual([]);
  });

  it('throws on an unterminated quote', () => {
    expect(() => tokenize('click "Sign in')).toThrow(/unterminated/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/parser/tokenize.test.ts`
Expected: FAIL — cannot resolve `tokenize.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/parser/tokenize.ts`:

```ts
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let hasCurrent = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      inQuotes = !inQuotes;
      hasCurrent = true;
      continue;
    }

    if (!inQuotes && ch === '#') break;

    if (!inQuotes && /\s/.test(ch)) {
      if (hasCurrent) {
        tokens.push(current);
        current = '';
        hasCurrent = false;
      }
      continue;
    }

    current += ch;
    hasCurrent = true;
  }

  if (inQuotes) throw new Error('Unterminated quote');
  if (hasCurrent) tokens.push(current);

  return tokens;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/parser/tokenize.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/parser/tokenize.ts test/parser/tokenize.test.ts
git commit -m "feat: quote-aware tokenizer for .reel scripts"
```

---

## Task 3: `.reel` parser

**Files:**
- Create: `src/parser/types.ts`, `src/parser/parse.ts`
- Test: `test/parser/parse.test.ts`

**Interfaces:**
- Consumes: `tokenize` from Task 2.
- Produces:
  - `type Command` — the discriminated union below.
  - `interface Script { commands: Command[] }`
  - `class ReelParseError extends Error { line: number }`
  - `function parse(source: string): Script`

  Task 7 consumes `Script` and `Command`. Task 9 reads the `output` command.

- [ ] **Step 1: Write the failing test**

Create `test/parser/parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parse, ReelParseError } from '../../src/parser/parse.js';

describe('parse', () => {
  it('parses a full script', () => {
    const src = [
      '# a demo',
      'visit http://localhost:3000',
      'viewport 1280x800',
      '',
      'click "Sign in"',
      'type "#email" "demo@example.com"',
      'press Enter',
      'hover ".card"',
      'scroll down 400',
      'scroll to "#footer"',
      'wait 500',
      'wait idle',
      'wait "#dashboard"',
      'zoom "#dashboard"',
      'reset zoom',
      'highlight ".cta"',
      'caption "One command, zero setup"',
      'theme dark',
      'output demo',
    ].join('\n');

    expect(parse(src).commands).toEqual([
      { kind: 'visit', url: 'http://localhost:3000' },
      { kind: 'viewport', width: 1280, height: 800 },
      { kind: 'click', target: 'Sign in' },
      { kind: 'type', target: '#email', text: 'demo@example.com' },
      { kind: 'press', key: 'Enter' },
      { kind: 'hover', target: '.card' },
      { kind: 'scroll', direction: 'down', amount: 400 },
      { kind: 'scroll', to: '#footer' },
      { kind: 'wait', ms: 500 },
      { kind: 'wait', idle: true },
      { kind: 'wait', target: '#dashboard' },
      { kind: 'zoom', target: '#dashboard' },
      { kind: 'resetZoom' },
      { kind: 'highlight', target: '.cta' },
      { kind: 'caption', text: 'One command, zero setup' },
      { kind: 'theme', mode: 'dark' },
      { kind: 'output', name: 'demo' },
    ]);
  });

  it('parses an output line with a preset', () => {
    expect(parse('output demo --preset twitter').commands).toEqual([
      { kind: 'output', name: 'demo', preset: 'twitter' },
    ]);
  });

  it('defaults scroll amount to undefined when omitted', () => {
    expect(parse('scroll up').commands).toEqual([
      { kind: 'scroll', direction: 'up' },
    ]);
  });

  it('reports the line number of an unknown command', () => {
    let err: unknown;
    try {
      parse('visit http://x\nfrobnicate now');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReelParseError);
    expect((err as ReelParseError).line).toBe(2);
    expect((err as ReelParseError).message).toMatch(/frobnicate/);
  });

  it('rejects a malformed viewport', () => {
    expect(() => parse('viewport wide')).toThrow(/viewport/i);
  });

  it('rejects click with no target', () => {
    expect(() => parse('click')).toThrow(/needs/i);
  });

  it('rejects an unknown theme', () => {
    expect(() => parse('theme neon')).toThrow(/light.*dark/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/parser/parse.test.ts`
Expected: FAIL — cannot resolve `parse.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/parser/types.ts`:

```ts
export type Command =
  | { kind: 'visit'; url: string }
  | { kind: 'viewport'; width: number; height: number }
  | { kind: 'click'; target: string }
  | { kind: 'type'; target: string; text: string }
  | { kind: 'press'; key: string }
  | { kind: 'hover'; target: string }
  | { kind: 'scroll'; direction: 'up' | 'down'; amount?: number }
  | { kind: 'scroll'; to: string }
  | { kind: 'wait'; ms?: number; target?: string; idle?: boolean }
  | { kind: 'zoom'; target: string }
  | { kind: 'resetZoom' }
  | { kind: 'highlight'; target: string }
  | { kind: 'caption'; text: string }
  | { kind: 'theme'; mode: 'light' | 'dark' }
  | { kind: 'output'; name: string; preset?: string };

export interface Script {
  commands: Command[];
}
```

Create `src/parser/parse.ts`:

```ts
import { tokenize } from './tokenize.js';
import type { Command, Script } from './types.js';

export type { Command, Script } from './types.js';

export class ReelParseError extends Error {
  constructor(
    public readonly line: number,
    message: string,
  ) {
    super(`Line ${line}: ${message}`);
    this.name = 'ReelParseError';
  }
}

function need(tokens: string[], index: number, line: number, what: string): string {
  const value = tokens[index];
  if (value === undefined) {
    throw new ReelParseError(line, `${tokens[0]} needs ${what}`);
  }
  return value;
}

function parseLine(tokens: string[], line: number): Command {
  const [command] = tokens;

  switch (command) {
    case 'visit':
      return { kind: 'visit', url: need(tokens, 1, line, 'a URL') };

    case 'viewport': {
      const size = need(tokens, 1, line, 'a size like 1280x800');
      const match = /^(\d+)x(\d+)$/.exec(size);
      if (!match) throw new ReelParseError(line, `viewport needs a size like 1280x800, got "${size}"`);
      return { kind: 'viewport', width: Number(match[1]), height: Number(match[2]) };
    }

    case 'click':
      return { kind: 'click', target: need(tokens, 1, line, 'something to click') };

    case 'type':
      return {
        kind: 'type',
        target: need(tokens, 1, line, 'a field to type into'),
        text: need(tokens, 2, line, 'the text to type'),
      };

    case 'press':
      return { kind: 'press', key: need(tokens, 1, line, 'a key') };

    case 'hover':
      return { kind: 'hover', target: need(tokens, 1, line, 'something to hover') };

    case 'scroll': {
      const arg = need(tokens, 1, line, 'up, down, or "to <target>"');
      if (arg === 'to') {
        return { kind: 'scroll', to: need(tokens, 2, line, 'a scroll target') };
      }
      if (arg !== 'up' && arg !== 'down') {
        throw new ReelParseError(line, `scroll needs up, down, or "to <target>", got "${arg}"`);
      }
      const amount = tokens[2];
      return amount === undefined
        ? { kind: 'scroll', direction: arg }
        : { kind: 'scroll', direction: arg, amount: Number(amount) };
    }

    case 'wait': {
      const arg = need(tokens, 1, line, 'a duration, "idle", or a target');
      if (arg === 'idle') return { kind: 'wait', idle: true };
      if (/^\d+$/.test(arg)) return { kind: 'wait', ms: Number(arg) };
      return { kind: 'wait', target: arg };
    }

    case 'zoom':
      return { kind: 'zoom', target: need(tokens, 1, line, 'something to zoom to') };

    case 'reset':
      if (tokens[1] !== 'zoom') throw new ReelParseError(line, 'the only reset is "reset zoom"');
      return { kind: 'resetZoom' };

    case 'highlight':
      return { kind: 'highlight', target: need(tokens, 1, line, 'something to highlight') };

    case 'caption':
      return { kind: 'caption', text: need(tokens, 1, line, 'some text') };

    case 'theme': {
      const mode = need(tokens, 1, line, 'light or dark');
      if (mode !== 'light' && mode !== 'dark') {
        throw new ReelParseError(line, `theme must be light or dark, got "${mode}"`);
      }
      return { kind: 'theme', mode };
    }

    case 'output': {
      const name = need(tokens, 1, line, 'an output name');
      const flagIndex = tokens.indexOf('--preset');
      if (flagIndex === -1) return { kind: 'output', name };
      const preset = tokens[flagIndex + 1];
      if (preset === undefined) throw new ReelParseError(line, '--preset needs a preset name');
      return { kind: 'output', name, preset };
    }

    default:
      throw new ReelParseError(line, `I don't know the command "${command}"`);
  }
}

export function parse(source: string): Script {
  const commands: Command[] = [];

  source.split(/\r?\n/).forEach((raw, index) => {
    const lineNumber = index + 1;
    let tokens: string[];
    try {
      tokens = tokenize(raw);
    } catch (error) {
      throw new ReelParseError(lineNumber, (error as Error).message);
    }
    if (tokens.length === 0) return;
    commands.push(parseLine(tokens, lineNumber));
  });

  return { commands };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/parser/parse.test.ts && npx tsc --noEmit`
Expected: PASS, 7 tests, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/parser/types.ts src/parser/parse.ts test/parser/parse.test.ts
git commit -m "feat: parse .reel scripts into a typed Script"
```

---

## Task 4: Browser resolution

**Files:**
- Create: `src/browser/resolve.ts`
- Test: `test/browser/resolve.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type BrowserChoice = { kind: 'channel'; channel: 'chrome' | 'msedge' } | { kind: 'bundled' } | { kind: 'missing' }`
  - `interface BrowserProbe { channelAvailable(channel: 'chrome' | 'msedge'): Promise<boolean>; bundledAvailable(): Promise<boolean> }`
  - `function resolveBrowser(probe: BrowserProbe): Promise<BrowserChoice>`
  - `function launchOptionsFor(choice: BrowserChoice): { channel?: 'chrome' | 'msedge' }`

  Task 7 calls `resolveBrowser` with the real probe and passes `launchOptionsFor` into `chromium.launch`.

This is the spec's "Chromium problem" mitigation: prefer a browser already on the machine so `npx flowreel` does not trigger a 150MB download.

- [ ] **Step 1: Write the failing test**

Create `test/browser/resolve.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/browser/resolve.test.ts`
Expected: FAIL — cannot resolve `resolve.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/browser/resolve.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/browser/resolve.test.ts && npx tsc --noEmit`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/browser/resolve.ts test/browser/resolve.test.ts
git commit -m "feat: prefer an already-installed Chrome or Edge over bundled Chromium"
```

---

## Task 5: ffmpeg capability probe

**Files:**
- Create: `src/encode/probe.ts`
- Test: `test/encode/probe.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface FfmpegCapabilities { h264: boolean; webp: boolean; gif: boolean; vp9: boolean }`
  - `function parseEncoders(output: string): FfmpegCapabilities` — pure
  - `function probeFfmpeg(): Promise<FfmpegCapabilities>` — spawns the real binary

  Task 8 uses capabilities to pick an encoder and to fail with a friendly message when a format is unavailable.

`ffmpeg-static` builds differ across platforms, so the encoder set must be discovered, not assumed.

- [ ] **Step 1: Write the failing test**

Create `test/encode/probe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseEncoders } from '../../src/encode/probe.js';

const SAMPLE = `Encoders:
 V..... = Video
 ------
 V....D gif                  GIF (Graphics Interchange Format)
 V....D libx264              libx264 H.264 / AVC (codec h264)
 V....D libwebp_anim         libwebp animated WebP (codec webp)
 V....D libwebp              libwebp WebP image (codec webp)
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 A....D aac                  AAC (Advanced Audio Coding)
`;

describe('parseEncoders', () => {
  it('detects the encoders we need', () => {
    expect(parseEncoders(SAMPLE)).toEqual({ h264: true, webp: true, gif: true, vp9: true });
  });

  it('reports missing encoders as false', () => {
    expect(parseEncoders(' V....D gif   GIF\n')).toEqual({
      h264: false,
      webp: false,
      gif: true,
      vp9: false,
    });
  });

  it('does not mistake a substring for an encoder', () => {
    expect(parseEncoders(' V....D libx264rgb  something\n').h264).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/encode/probe.test.ts`
Expected: FAIL — cannot resolve `probe.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/encode/probe.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);

export interface FfmpegCapabilities {
  h264: boolean;
  webp: boolean;
  gif: boolean;
  vp9: boolean;
}

function hasEncoder(output: string, name: string): boolean {
  return new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(output);
}

export function parseEncoders(output: string): FfmpegCapabilities {
  return {
    h264: hasEncoder(output, 'libx264'),
    webp: hasEncoder(output, 'libwebp_anim') || hasEncoder(output, 'libwebp'),
    gif: hasEncoder(output, 'gif'),
    vp9: hasEncoder(output, 'libvpx-vp9'),
  };
}

export function ffmpegBinary(): string {
  if (!ffmpegPath) {
    throw new Error('ffmpeg is missing from this install. Try reinstalling flowreel.');
  }
  return ffmpegPath;
}

export async function probeFfmpeg(): Promise<FfmpegCapabilities> {
  const { stdout } = await run(ffmpegBinary(), ['-hide_banner', '-encoders']);
  return parseEncoders(stdout);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/encode/probe.test.ts && npx tsc --noEmit`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/encode/probe.ts test/encode/probe.test.ts
git commit -m "feat: discover which encoders this ffmpeg build has"
```

---

## Task 6: Frame trimming and resampling

**Files:**
- Create: `src/capture/types.ts`, `src/capture/trim.ts`
- Test: `test/capture/trim.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Frame { data: Buffer; timestampMs: number }`
  - `interface FrameSet { frames: Frame[]; width: number; height: number }`
  - `function trimIdle(frames: Frame[], thresholdMs: number): Frame[]` — collapses gaps longer than the threshold down to the threshold, rebasing later timestamps
  - `function resampleToFps(frames: Frame[], fps: number): Frame[]` — nearest-frame resampling onto a constant-rate timeline

  Task 7 produces a `FrameSet`. Task 8 consumes the resampled frames.

Constant-rate output is what lets Task 8 hand ffmpeg a plain numbered image sequence instead of a concat demuxer file.

- [ ] **Step 1: Write the failing test**

Create `test/capture/trim.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/capture/trim.test.ts`
Expected: FAIL — cannot resolve `trim.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/capture/types.ts`:

```ts
export interface Frame {
  data: Buffer;
  timestampMs: number;
}

export interface FrameSet {
  frames: Frame[];
  width: number;
  height: number;
}
```

Create `src/capture/trim.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/capture/trim.test.ts && npx tsc --noEmit`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/capture/types.ts src/capture/trim.ts test/capture/trim.test.ts
git commit -m "feat: trim dead time and resample frames to a constant framerate"
```

---

## Task 7: Runtime and capture (integration)

**Files:**
- Create: `test/fixtures/app/index.html`, `src/runtime/targets.ts`, `src/runtime/execute.ts`, `src/capture/screencast.ts`
- Test: `test/runtime/execute.test.ts`

**Interfaces:**
- Consumes: `Script`/`Command` (Task 3), `resolveBrowser`/`launchOptionsFor`/`systemProbe` (Task 4), `Frame`/`FrameSet` (Task 6).
- Produces:
  - `class TargetNotFoundError extends Error`
  - `function resolveTarget(page: Page, target: string): Promise<Locator>`
  - `function startScreencast(page: Page): Promise<Screencast>` where `interface Screencast { stop(): Promise<FrameSet> }`
  - `function executeScript(page: Page, script: Script): Promise<void>`

  Task 9 orchestrates these into a full run.

This is the first task that needs a real browser. Tests run against the checked-in static app, so they need no network and no user project.

- [ ] **Step 1: Write the failing test**

Create `test/fixtures/app/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>flowreel fixture</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; padding: 40px; }
      #dashboard { display: none; margin-top: 400px; height: 300px; background: #eef; }
      .shown { display: block !important; }
    </style>
  </head>
  <body>
    <h1>Fixture App</h1>
    <input id="email" placeholder="Email" />
    <button id="signin">Sign in</button>
    <button id="register">Register</button>
    <div id="dashboard">Dashboard</div>
    <script>
      document.getElementById('signin').addEventListener('click', () => {
        document.getElementById('dashboard').classList.add('shown');
      });
    </script>
  </body>
</html>
```

Create `test/runtime/execute.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { executeScript, TargetNotFoundError } from '../../src/runtime/execute.js';
import { startScreencast } from '../../src/capture/screencast.js';
import { parse } from '../../src/parser/parse.js';

const FIXTURE = pathToFileURL(resolve('test/fixtures/app/index.html')).href;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  const choice = await resolveBrowser(systemProbe);
  browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
});

describe('executeScript', () => {
  it('runs a script and changes the page', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\nviewport 800x600\nclick "Sign in"\nwait 200`));
    await expect(page.locator('#dashboard')).toBeVisible();
  });

  it('types into a field found by CSS selector', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\ntype "#email" "demo@example.com"`));
    expect(await page.locator('#email').inputValue()).toBe('demo@example.com');
  });

  it('names the visible buttons when a target is not found', async () => {
    await page.goto(FIXTURE);
    let err: unknown;
    try {
      await executeScript(page, parse('click "Log out"'));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TargetNotFoundError);
    expect((err as Error).message).toContain('Log out');
    expect((err as Error).message).toContain('Sign in');
    expect((err as Error).message).toContain('Register');
  });
});

describe('startScreencast', () => {
  it('captures frames with dimensions', async () => {
    await page.goto(FIXTURE);
    await page.setViewportSize({ width: 800, height: 600 });
    const screencast = await startScreencast(page);
    await executeScript(page, parse('click "Sign in"\nwait 600'));
    const frameSet = await screencast.stop();

    expect(frameSet.frames.length).toBeGreaterThan(0);
    expect(frameSet.width).toBe(800);
    expect(frameSet.height).toBe(600);
    expect(frameSet.frames[0]!.data.byteLength).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/runtime/execute.test.ts`
Expected: FAIL — cannot resolve `execute.js` and `screencast.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/runtime/targets.ts`:

```ts
import type { Locator, Page } from 'playwright';

export class TargetNotFoundError extends Error {
  constructor(target: string, visible: string[]) {
    const seen = visible.length > 0 ? visible.map((v) => `"${v}"`).join(', ') : 'nothing clickable';
    super(`Couldn't find "${target}" on the page. Visible buttons: ${seen}.`);
    this.name = 'TargetNotFoundError';
  }
}

async function visibleButtonNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"], a'))
      .map((el) => (el.textContent ?? '').trim())
      .filter((text) => text.length > 0)
      .slice(0, 8),
  );
}

export async function resolveTarget(page: Page, target: string): Promise<Locator> {
  const candidates: Locator[] = [
    page.getByRole('button', { name: target, exact: true }),
    page.getByText(target, { exact: true }),
    page.locator(target),
  ];

  for (const candidate of candidates) {
    try {
      if ((await candidate.count()) > 0) return candidate.first();
    } catch {
      // An invalid CSS selector is not an error here; try the next strategy.
    }
  }

  throw new TargetNotFoundError(target, await visibleButtonNames(page));
}
```

Create `src/runtime/execute.ts`:

```ts
import type { Page } from 'playwright';
import type { Command, Script } from '../parser/types.js';
import { resolveTarget, TargetNotFoundError } from './targets.js';

export { TargetNotFoundError } from './targets.js';

const TYPE_DELAY_MS = 60;

async function runCommand(page: Page, command: Command): Promise<void> {
  switch (command.kind) {
    case 'visit':
      await page.goto(command.url, { waitUntil: 'load' });
      return;

    case 'viewport':
      await page.setViewportSize({ width: command.width, height: command.height });
      return;

    case 'click':
      await (await resolveTarget(page, command.target)).click();
      return;

    case 'type':
      await (await resolveTarget(page, command.target)).pressSequentially(command.text, {
        delay: TYPE_DELAY_MS,
      });
      return;

    case 'press':
      await page.keyboard.press(command.key);
      return;

    case 'hover':
      await (await resolveTarget(page, command.target)).hover();
      return;

    case 'scroll': {
      if ('to' in command) {
        await (await resolveTarget(page, command.to)).scrollIntoViewIfNeeded();
        return;
      }
      const amount = command.amount ?? 400;
      const delta = command.direction === 'down' ? amount : -amount;
      await page.mouse.wheel(0, delta);
      return;
    }

    case 'wait': {
      if (command.ms !== undefined) {
        await page.waitForTimeout(command.ms);
        return;
      }
      if (command.idle) {
        await page.waitForLoadState('networkidle');
        return;
      }
      if (command.target !== undefined) {
        await (await resolveTarget(page, command.target)).waitFor({ state: 'visible' });
      }
      return;
    }

    case 'theme':
      await page.emulateMedia({ colorScheme: command.mode });
      return;

    // The overlay layer lands in Plan 2. Until then these are no-ops so that a
    // script written today keeps working unchanged once overlays exist.
    case 'zoom':
    case 'resetZoom':
    case 'highlight':
    case 'caption':
      return;

    case 'output':
      return;
  }
}

export async function executeScript(page: Page, script: Script): Promise<void> {
  for (const command of script.commands) {
    await runCommand(page, command);
  }
}
```

Create `src/capture/screencast.ts`:

```ts
import type { Page } from 'playwright';
import type { Frame, FrameSet } from './types.js';

export interface Screencast {
  stop(): Promise<FrameSet>;
}

export async function startScreencast(page: Page): Promise<Screencast> {
  const client = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  const startedAt = Date.now();

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  client.on('Page.screencastFrame', (event) => {
    frames.push({
      data: Buffer.from(event.data, 'base64'),
      timestampMs: Date.now() - startedAt,
    });
    void client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {
      // The session can close mid-flight; a dropped ack is not fatal.
    });
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    everyNthFrame: 1,
  });

  return {
    async stop(): Promise<FrameSet> {
      try {
        await client.send('Page.stopScreencast');
      } catch {
        // Already detached.
      }
      await client.detach().catch(() => {});
      return { frames, width: viewport.width, height: viewport.height };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/runtime/execute.test.ts && npx tsc --noEmit`
Expected: PASS, 4 tests. If Playwright reports no browser, run `npx playwright install chromium` once.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/app/index.html src/runtime/targets.ts src/runtime/execute.ts src/capture/screencast.ts test/runtime/execute.test.ts
git commit -m "feat: execute .reel scripts against a page and capture frames"
```

---

## Task 8: Encoder with byte budgeting

**Files:**
- Create: `src/encode/presets.ts`, `src/encode/budget.ts`, `src/encode/encode.ts`
- Test: `test/encode/budget.test.ts`, `test/encode/encode.test.ts`

**Interfaces:**
- Consumes: `Frame` (Task 6), `FfmpegCapabilities`/`ffmpegBinary` (Task 5).
- Produces:
  - `type OutputFormat = 'webp' | 'gif' | 'mp4' | 'webm'`
  - `interface OutputSpec { format: OutputFormat; width: number; fps: number; maxBytes: number }`
  - `interface Preset { name: string; outputs: OutputSpec[] }`
  - `const PRESETS: Record<string, Preset>`
  - `function degrade(spec: OutputSpec, attempt: number): OutputSpec | null`
  - `function encodeOutput(frames: Frame[], spec: OutputSpec, outPath: string): Promise<{ path: string; bytes: number }>`

  Task 9 calls `encodeOutput` once per output in the preset.

- [ ] **Step 1: Write the failing test**

Create `test/encode/budget.test.ts`:

```ts
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
```

Create `test/encode/encode.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodeOutput } from '../../src/encode/encode.js';
import { probeFfmpeg } from '../../src/encode/probe.js';
import type { Frame } from '../../src/capture/types.js';

// Scratch stays inside the repo so nothing is written off the D: drive.
const SCRATCH = resolve('.tmp/encode-test');

// A tiny valid JPEG, solid color, 8x8.
const JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAIAAgBAREA/8QAFQABAQAAAAAA' +
  'AAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9k=';

function frames(count: number, fps: number): Frame[] {
  const data = Buffer.from(JPEG_BASE64, 'base64');
  return Array.from({ length: count }, (_, i) => ({
    data,
    timestampMs: Math.round((i * 1000) / fps),
  }));
}

beforeAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true });
  await mkdir(SCRATCH, { recursive: true });
});

describe('encodeOutput', () => {
  it('writes a GIF that exists and is non-empty', async () => {
    const caps = await probeFfmpeg();
    if (!caps.gif) return;

    const out = resolve(SCRATCH, 'out.gif');
    const result = await encodeOutput(frames(15, 15), {
      format: 'gif',
      width: 320,
      fps: 15,
      maxBytes: 5_000_000,
    }, out);

    expect(result.bytes).toBeGreaterThan(0);
    expect((await stat(out)).size).toBe(result.bytes);
  });

  it('writes an MP4 that exists and is non-empty', async () => {
    const caps = await probeFfmpeg();
    if (!caps.h264) return;

    const out = resolve(SCRATCH, 'out.mp4');
    const result = await encodeOutput(frames(15, 15), {
      format: 'mp4',
      width: 320,
      fps: 15,
      maxBytes: 10_000_000,
    }, out);

    expect(result.bytes).toBeGreaterThan(0);
  });

  it('reports a friendly error when the format is unsupported by this build', async () => {
    const caps = await probeFfmpeg();
    // If this build can do webm there is no missing-encoder path to exercise.
    if (caps.vp9) return;

    await expect(
      encodeOutput(frames(3, 15), {
        format: 'webm',
        width: 320,
        fps: 15,
        maxBytes: 10_000_000,
      }, resolve(SCRATCH, 'tiny.webm')),
    ).rejects.toThrow(/no webm encoder/i);
  });

  it('returns the file even when the byte budget cannot be met', async () => {
    const caps = await probeFfmpeg();
    if (!caps.gif) return;

    const out = resolve(SCRATCH, 'over.gif');
    const result = await encodeOutput(frames(30, 15), {
      format: 'gif',
      width: 320,
      fps: 15,
      maxBytes: 1, // impossible on purpose
    }, out);

    // A valid file that missed its budget is reported, not thrown away.
    expect(result.bytes).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/encode/`
Expected: FAIL — cannot resolve `presets.js`, `budget.js`, `encode.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/encode/presets.ts`:

```ts
export type OutputFormat = 'webp' | 'gif' | 'mp4' | 'webm';

export interface OutputSpec {
  format: OutputFormat;
  width: number;
  fps: number;
  maxBytes: number;
}

export interface Preset {
  name: string;
  outputs: OutputSpec[];
}

const MB = 1_000_000;

// The README image format is decided empirically in Task 10. Until that test
// is run this stays 'gif', the format guaranteed to render inline on GitHub.
export const README_IMAGE_FORMAT: OutputFormat = 'gif';

export const PRESETS: Record<string, Preset> = {
  default: {
    name: 'default',
    outputs: [
      { format: README_IMAGE_FORMAT, width: 900, fps: 15, maxBytes: 5 * MB },
      { format: 'mp4', width: 1280, fps: 30, maxBytes: 10 * MB },
    ],
  },
  'github-readme': {
    name: 'github-readme',
    outputs: [{ format: README_IMAGE_FORMAT, width: 900, fps: 15, maxBytes: 5 * MB }],
  },
  docs: {
    name: 'docs',
    outputs: [{ format: 'webm', width: 1280, fps: 30, maxBytes: 10 * MB }],
  },
  twitter: {
    name: 'twitter',
    outputs: [{ format: 'mp4', width: 1280, fps: 30, maxBytes: 15 * MB }],
  },
  producthunt: {
    name: 'producthunt',
    outputs: [{ format: 'gif', width: 1270, fps: 15, maxBytes: 3 * MB }],
  },
};
```

Create `src/encode/budget.ts`:

```ts
import type { OutputSpec } from './presets.js';

const FPS_LADDER = [12, 10, 8];
const WIDTH_SCALE = [0.85, 0.7, 0.6];

export function degrade(spec: OutputSpec, attempt: number): OutputSpec | null {
  if (attempt <= FPS_LADDER.length) {
    return { ...spec, fps: FPS_LADDER[attempt - 1]! };
  }

  const widthStep = attempt - FPS_LADDER.length - 1;
  if (widthStep < WIDTH_SCALE.length) {
    return {
      ...spec,
      fps: FPS_LADDER[FPS_LADDER.length - 1]!,
      width: Math.round(spec.width * WIDTH_SCALE[widthStep]!),
    };
  }

  return null;
}
```

Create `src/encode/encode.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Frame } from '../capture/types.js';
import { ffmpegBinary, probeFfmpeg, type FfmpegCapabilities } from './probe.js';
import { resampleToFps } from '../capture/trim.js';
import { degrade } from './budget.js';
import type { OutputSpec } from './presets.js';

const run = promisify(execFile);

const MAX_ATTEMPTS = 7;

function supports(caps: FfmpegCapabilities, format: OutputSpec['format']): boolean {
  switch (format) {
    case 'gif': return caps.gif;
    case 'webp': return caps.webp;
    case 'mp4': return caps.h264;
    case 'webm': return caps.vp9;
  }
}

async function writeFrames(frames: Frame[], dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all(
    frames.map((frame, i) =>
      writeFile(resolve(dir, `${String(i + 1).padStart(6, '0')}.jpg`), frame.data),
    ),
  );
}

function argsFor(spec: OutputSpec, dir: string, outPath: string): string[] {
  const input = ['-y', '-framerate', String(spec.fps), '-i', resolve(dir, '%06d.jpg')];
  const scale = `scale=${spec.width}:-2:flags=lanczos`;

  switch (spec.format) {
    case 'gif':
      return [
        ...input,
        '-filter_complex', `${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer`,
        '-loop', '0',
        outPath,
      ];
    case 'webp':
      return [...input, '-vf', scale, '-c:v', 'libwebp_anim', '-loop', '0', '-q:v', '75', outPath];
    case 'mp4':
      return [...input, '-vf', scale, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath];
    case 'webm':
      return [...input, '-vf', scale, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', outPath];
  }
}

export async function encodeOutput(
  frames: Frame[],
  spec: OutputSpec,
  outPath: string,
): Promise<{ path: string; bytes: number }> {
  const caps = await probeFfmpeg();
  if (!supports(caps, spec.format)) {
    throw new Error(
      `This ffmpeg build has no ${spec.format} encoder, so I couldn't get a ${spec.format} out of it. Try a different --preset.`,
    );
  }

  const scratch = resolve(dirname(outPath), '.flowreel-frames');
  let current: OutputSpec | null = spec;
  let attempt = 0;
  let last = 0;

  try {
    while (current) {
      await rm(scratch, { recursive: true, force: true });
      await writeFrames(resampleToFps(frames, current.fps), scratch);
      await run(ffmpegBinary(), ['-hide_banner', '-loglevel', 'error', ...argsFor(current, scratch, outPath)]);

      last = (await stat(outPath)).size;
      if (last <= current.maxBytes) return { path: outPath, bytes: last };

      attempt++;
      if (attempt >= MAX_ATTEMPTS) break;
      current = degrade(spec, attempt);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  // Budget could not be met. The file is still valid, so return it and let the
  // caller report the overage rather than failing the whole run.
  return { path: outPath, bytes: last };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/encode/ && npx tsc --noEmit`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/encode/presets.ts src/encode/budget.ts src/encode/encode.ts test/encode/budget.test.ts test/encode/encode.test.ts
git commit -m "feat: encode frames to gif, webp, mp4 and webm under a byte budget"
```

---

## Task 9: Orchestration, summary, and CLI wiring

**Files:**
- Create: `src/summary.ts`, `src/run.ts`
- Modify: `src/cli.ts`
- Test: `test/summary.test.ts`, `test/run.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3-8.
- Produces:
  - `interface EmittedOutput { path: string; bytes: number; format: OutputFormat; overBudget: boolean }`
  - `function formatSummary(outputs: EmittedOutput[]): string`
  - `function runScript(source: string, options: { presetOverride?: string; cwd: string }): Promise<EmittedOutput[]>`
  - `main(argv)` returns the spec's exit codes.

- [ ] **Step 1: Write the failing test**

Create `test/summary.test.ts`:

```ts
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
```

Create `test/run.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runScript } from '../src/run.js';

const SCRATCH = resolve('.tmp/run-test');
const FIXTURE = pathToFileURL(resolve('test/fixtures/app/index.html')).href;

beforeAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true });
  await mkdir(SCRATCH, { recursive: true });
});

describe('runScript', () => {
  it('produces both an image and a video from one run', async () => {
    const outputs = await runScript(
      [`visit ${FIXTURE}`, 'viewport 800x600', 'click "Sign in"', 'wait 600', 'output demo'].join('\n'),
      { cwd: SCRATCH },
    );

    expect(outputs.length).toBe(2);
    for (const output of outputs) {
      expect((await stat(output.path)).size).toBeGreaterThan(0);
    }
    expect(outputs.map((o) => o.format)).toContain('mp4');
  });

  it('honours a preset override from the caller', async () => {
    const outputs = await runScript(
      [`visit ${FIXTURE}`, 'viewport 800x600', 'wait 400', 'output shot'].join('\n'),
      { cwd: SCRATCH, presetOverride: 'twitter' },
    );

    expect(outputs.map((o) => o.format)).toEqual(['mp4']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/summary.test.ts test/run.test.ts`
Expected: FAIL — cannot resolve `summary.js` and `run.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/summary.ts`:

```ts
import { basename } from 'node:path';
import type { OutputFormat } from './encode/presets.js';

export interface EmittedOutput {
  path: string;
  bytes: number;
  format: OutputFormat;
  overBudget: boolean;
}

const DESTINATIONS: Record<OutputFormat, string> = {
  gif: 'README, GitHub, npm',
  webp: 'README, GitHub, npm',
  mp4: 'X, docs sites, Product Hunt',
  webm: 'docs sites',
};

const IMAGE_FORMATS: OutputFormat[] = ['gif', 'webp'];

export function humanBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

export function formatSummary(outputs: EmittedOutput[]): string {
  const lines = outputs.map((output) => {
    const name = basename(output.path).padEnd(12);
    const size = humanBytes(output.bytes).padStart(8);
    const note = output.overBudget ? '  (over budget)' : '';
    return `  ${name}${size}   ${DESTINATIONS[output.format]}${note}`;
  });

  const image = outputs.find((output) => IMAGE_FORMATS.includes(output.format));
  if (image) {
    const name = basename(image.path);
    lines.push('', '  Paste into your README:', `  ![demo](${name})`);
  }

  return lines.join('\n');
}
```

Create `src/run.ts`:

```ts
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { parse } from './parser/parse.js';
import { resolveBrowser, launchOptionsFor, systemProbe } from './browser/resolve.js';
import { executeScript } from './runtime/execute.js';
import { startScreencast } from './capture/screencast.js';
import { trimIdle } from './capture/trim.js';
import { encodeOutput } from './encode/encode.js';
import { PRESETS } from './encode/presets.js';
import type { EmittedOutput } from './summary.js';

const IDLE_THRESHOLD_MS = 500;

export interface RunOptions {
  cwd: string;
  presetOverride?: string;
}

export async function runScript(source: string, options: RunOptions): Promise<EmittedOutput[]> {
  const script = parse(source);

  const outputCommand = script.commands.find((c) => c.kind === 'output');
  const name = outputCommand?.kind === 'output' ? outputCommand.name : 'demo';
  const presetName = options.presetOverride ?? (outputCommand?.kind === 'output' ? outputCommand.preset : undefined) ?? 'default';

  const preset = PRESETS[presetName];
  if (!preset) {
    throw new Error(
      `I don't have a preset called "${presetName}". Try one of: ${Object.keys(PRESETS).join(', ')}.`,
    );
  }

  const choice = await resolveBrowser(systemProbe);
  if (choice.kind === 'missing') {
    throw new Error(
      'I couldn\'t find Chrome, Edge, or a bundled Chromium. Install Chrome, or run `npx playwright install chromium`.',
    );
  }

  const browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
  try {
    const page = await browser.newPage();
    const screencast = await startScreencast(page);
    await executeScript(page, script);
    const frameSet = await screencast.stop();

    const frames = trimIdle(frameSet.frames, IDLE_THRESHOLD_MS);

    return await Promise.all(
      preset.outputs.map(async (spec): Promise<EmittedOutput> => {
        const outPath = resolve(options.cwd, `${name}.${spec.format}`);
        const result = await encodeOutput(frames, spec, outPath);
        return {
          path: result.path,
          bytes: result.bytes,
          format: spec.format,
          overBudget: result.bytes > spec.maxBytes,
        };
      }),
    );
  } finally {
    await browser.close();
  }
}
```

Replace `src/cli.ts` entirely:

```ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runScript } from './run.js';
import { formatSummary } from './summary.js';
import { ReelParseError } from './parser/parse.js';
import { TargetNotFoundError } from './runtime/execute.js';

export const version = '0.1.0';

function presetFlag(argv: string[]): string | undefined {
  const index = argv.indexOf('--preset');
  return index === -1 ? undefined : argv[index + 1];
}

export async function main(argv: string[]): Promise<number> {
  const scriptPath = argv.find((arg) => arg.endsWith('.reel'));

  if (!scriptPath) {
    process.stdout.write(
      `flowreel ${version}\n\nUsage: flowreel <script.reel> [--preset <name>]\n\nRecord mode and the zero-argument flow arrive in the next milestone.\n`,
    );
    return 0;
  }

  try {
    const source = await readFile(resolve(scriptPath), 'utf8');
    const outputs = await runScript(source, {
      cwd: process.cwd(),
      presetOverride: presetFlag(argv),
    });
    process.stdout.write(`\n${formatSummary(outputs)}\n\n`);
    return 0;
  } catch (error) {
    if (error instanceof ReelParseError || error instanceof TargetNotFoundError) {
      process.stderr.write(`\n${error.message}\n\n`);
      return 1;
    }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      process.stderr.write(`\nI couldn't find ${scriptPath}.\n\n`);
      return 1;
    }
    process.stderr.write(`\n${(error as Error).message}\n\n`);
    return 2;
  }
}

const invokedDirectly = process.argv[1]?.endsWith('cli.js');
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS across the whole suite.

- [ ] **Step 5: Commit**

```bash
git add src/summary.ts src/run.ts src/cli.ts test/summary.test.ts test/run.test.ts
git commit -m "feat: end-to-end run from .reel script to image and video"
```

---

## Task 10: Decide the README image format empirically

**Files:**
- Create: `docs/decisions/2026-09-01-readme-image-format.md`
- Modify: `src/encode/presets.ts` (the `README_IMAGE_FORMAT` constant)
- Test: `test/encode/budget.test.ts` (already asserts the default preset emits an image; no change needed unless the format changes)

**Interfaces:**
- Consumes: `encodeOutput` from Task 8.
- Produces: a recorded decision and the final value of `README_IMAGE_FORMAT`.

The spec makes this an explicit milestone-1 test rather than a guess: sources
disagree on whether GitHub renders animated WebP inline, and the difference is
roughly 3.5x on the single most-viewed file in the project.

- [ ] **Step 1: Produce the three candidate files**

Create `scratch.reel` in the repo root (it is gitignored via `.tmp/`, so put it
under `.tmp/scratch.reel`):

```
visit file:///D:/PROJECT%20MANIA/start-project/test/fixtures/app/index.html
viewport 900x600
wait 300
click "Sign in"
wait 800
output candidate
```

Build, then encode the same run three ways:

```bash
npm run build
node dist/cli.js .tmp/scratch.reel --preset github-readme
```

That produces the GIF candidate. For the WebP candidate, change
`README_IMAGE_FORMAT` to `'webp'` in `src/encode/presets.ts`, run
`npm run build`, and re-run the same command. For the AVIF candidate, run
ffmpeg directly on the same frames:

```bash
node -e "console.log(require('ffmpeg-static'))"
```

then use that binary with `-c:v libaom-av1 -still-picture 0`. If this ffmpeg
build has no AV1 encoder, record AVIF as "not testable" and move on — it is the
least important of the three.

Record the byte size of each candidate file.

- [ ] **Step 2: Publish the candidates and observe**

Commit the three files to a scratch branch and push. Then check, and write down
a yes/no for each:

1. Does the animated WebP autoplay inline in a README on the GitHub **web UI**?
2. Does it autoplay in the GitHub **mobile app**?
3. Does it render on the **npm package page**?
4. Same three questions for the GIF (expected: yes to all).

- [ ] **Step 3: Record the decision**

Create `docs/decisions/2026-09-01-readme-image-format.md` containing: the three
file sizes, the six yes/no answers, the chosen format, and one sentence of
reasoning. This file is the reason the constant has the value it has.

- [ ] **Step 4: Set the constant**

If WebP rendered everywhere, set `README_IMAGE_FORMAT = 'webp'` in
`src/encode/presets.ts`. If it failed anywhere, leave it as `'gif'`.

Then run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. The preset tests assert an image format is present, not which
one, so either outcome keeps them green.

- [ ] **Step 5: Commit**

```bash
git add docs/decisions/2026-09-01-readme-image-format.md src/encode/presets.ts
git commit -m "docs: record the README image format decision and set the default"
```

---

## Done when

- `npx vitest run` is green and `npx tsc --noEmit` is clean.
- `node dist/cli.js demo.reel` against a real local dev server writes both `demo.<image>` and `demo.mp4`, and prints the paste-ready summary.
- A missing selector prints the names of the buttons that *were* on the page, and exits `1`.
- No file has been written outside the `D:` drive.
- `git log` shows every commit authored by `Krishna <krishnar.sharmanew@gmail.com>` with no co-author trailer.

## Deliberately deferred

These are real spec requirements handled by later plans, not oversights:

- **Plan 2 — the polish layer.** Synthetic cursor, click ripples, keystroke chips, auto-zoom, captions, highlight, browser and device framing. Task 7 parses and accepts `zoom`, `reset zoom`, `highlight` and `caption` as no-ops so scripts written now keep working unchanged.
- **Plan 3 — record mode and the friendly CLI.** `flowreel record`, the zero-argument flow that scans dev ports, `--watch`, and `flowreel init`.
- **Plan 4 — distribution.** `action.yml`, the self-demonstrating README, npm publish, launch.

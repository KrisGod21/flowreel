import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { main, version, presetFlag, outFlag } from '../src/cli.js';

const requireCjs = createRequire(import.meta.url);
const SCRATCH = resolve('.tmp/cli-test');

let stdout = '';
let stderr = '';

beforeAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true });
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(resolve(SCRATCH, 'broken.reel'), 'frobnicate the widget\n', 'utf8');
  await writeFile(resolve(SCRATCH, 'fine.reel'), 'visit http://localhost:1\n', 'utf8');
  await writeFile(resolve(SCRATCH, 'invalid-url.reel'), 'visit __APP__\n', 'utf8');

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('version', () => {
  it('matches package.json rather than a hardcoded copy', () => {
    const manifest = requireCjs('../package.json') as { version: string };
    expect(version).toBe(manifest.version);
  });
});

describe('--help / -h', () => {
  it('prints usage mentioning both forms and every flag, and exits 0', async () => {
    stdout = '';
    const code = await main(['--help']);

    expect(code).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('flowreel record <url>');
    expect(stdout).toContain('flowreel <script.reel>');
    expect(stdout).toContain('--out');
    expect(stdout).toContain('--preset');
    expect(stdout).toContain('--help');
    expect(stdout).toContain('--version');
    expect(stdout).toContain(version);
  });

  it('accepts the short form -h', async () => {
    stdout = '';
    const code = await main(['-h']);

    expect(code).toBe(0);
    expect(stdout).toContain('Usage:');
  });
});

describe('--version / -v', () => {
  it('prints the version from package.json and exits 0', async () => {
    stdout = '';
    const code = await main(['--version']);

    expect(code).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(stdout).toContain(version);
  });

  it('accepts the short form -v', async () => {
    stdout = '';
    const code = await main(['-v']);

    expect(code).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });
});

describe('main with no arguments', () => {
  // These tests point the dev-server scan at ports the OS assigns for a
  // throwaway net server, via FLOWREEL_PORTS (see the comment on
  // portsFromEnv in src/cli.ts) - never at the real common ports - so the
  // test can't be flaky depending on what happens to be running on the
  // machine, and can't false-positive against a real dev server.
  const originalPorts = process.env.FLOWREEL_PORTS;
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise((r) => server!.close(() => r(undefined)));
      server = undefined;
    }
    if (originalPorts === undefined) delete process.env.FLOWREEL_PORTS;
    else process.env.FLOWREEL_PORTS = originalPorts;
  });

  it('finds a running dev server on an injected port and offers the record command', async () => {
    server = createServer((socket) => socket.end());
    const port = await new Promise<number>((resolvePort) => {
      server!.listen(0, '127.0.0.1', () => {
        const address = server!.address();
        resolvePort(typeof address === 'object' && address ? address.port : 0);
      });
    });
    process.env.FLOWREEL_PORTS = String(port);

    stdout = '';
    const code = await main([]);

    expect(code).toBe(0);
    expect(stdout).toContain('Found your app');
    expect(stdout).toContain(`http://localhost:${port}`);
    expect(stdout).toContain(`flowreel record http://localhost:${port}`);
  });

  it('prints a plain sentence and still exits 0 when nothing is listening', async () => {
    // A port in the ephemeral range that nothing binds to on purpose.
    process.env.FLOWREEL_PORTS = '65533';

    stdout = '';
    const code = await main([]);

    expect(code).toBe(0);
    expect(stdout).toContain('flowreel record <url>');
    expect(stdout).toContain('.reel');
    expect(stdout).not.toContain('Usage:');
  });
});

describe('main', () => {
  it('reports a missing script as a user error, not an internal one', async () => {
    stderr = '';
    const code = await main([resolve(SCRATCH, 'nope.reel')]);

    expect(code).toBe(1);
    expect(stderr).toContain('nope.reel');
    // Plain language, not a stack trace.
    expect(stderr).toContain("I couldn't find");
    expect(stderr).not.toContain('node:internal');
  });

  it('reports a malformed script as a user error', async () => {
    stderr = '';
    const code = await main([resolve(SCRATCH, 'broken.reel')]);

    expect(code).toBe(1);
    expect(stderr).toContain('frobnicate');
    expect(stderr).toContain('Line 1');
  });

  it('reports an unknown preset as a user error, naming the real ones', async () => {
    stderr = '';
    const code = await main([resolve(SCRATCH, 'fine.reel'), '--preset', 'bogus']);

    expect(code).toBe(1);
    expect(stderr).toContain('bogus');
    expect(stderr).toContain('github-readme');
  });

  // Regression for the raw Playwright call log ("page.goto: Protocol error
  // (Page.navigate): Cannot navigate to invalid URL" / "Call log: ...") that
  // used to escape to exit code 2 for a script with a non-URL `visit` target -
  // exactly the mistake a typo'd placeholder like `__APP__` produces.
  it('reports an invalid visit URL as a plain-language user error, not a call log', async () => {
    stderr = '';
    const code = await main([resolve(SCRATCH, 'invalid-url.reel')]);

    expect(code).toBe(1);
    expect(stderr).toContain("isn't a URL I can open");
    expect(stderr).not.toContain('Call log');
    expect(stderr).not.toContain('Protocol error');
  });

  it('reports --preset with no value in plain language', async () => {
    stderr = '';
    const code = await main([resolve(SCRATCH, 'fine.reel'), '--preset']);

    expect(code).toBe(1);
    expect(stderr).toContain('--preset needs a preset name');
  });

  it('rejects `record --out --foo`, refusing to swallow a following flag as the name', async () => {
    stderr = '';
    const code = await main(['record', 'http://localhost:1', '--out', '--foo']);

    expect(code).toBe(1);
    expect(stderr).toContain('--out needs a name after it');
  });
});

describe('presetFlag', () => {
  it('returns undefined when the flag is absent', () => {
    expect(presetFlag(['demo.reel'])).toBeUndefined();
  });

  it('reads the value that follows the flag', () => {
    expect(presetFlag(['demo.reel', '--preset', 'twitter'])).toBe('twitter');
  });

  it('throws when another flag follows instead of a value', () => {
    expect(() => presetFlag(['demo.reel', '--preset', '--verbose'])).toThrow(/preset name/);
  });
});

describe('outFlag', () => {
  it('returns undefined when the flag is absent', () => {
    expect(outFlag(['record', 'http://localhost:1'])).toBeUndefined();
  });

  it('reads the value that follows the flag', () => {
    expect(outFlag(['record', 'http://localhost:1', '--out', 'demo'])).toBe('demo');
  });

  it('throws when no value follows', () => {
    expect(() => outFlag(['record', 'http://localhost:1', '--out'])).toThrow(/name after it/);
  });

  it('throws when another flag follows instead of a value', () => {
    expect(() => outFlag(['record', 'http://localhost:1', '--out', '--foo'])).toThrow(/name after it/);
  });
});

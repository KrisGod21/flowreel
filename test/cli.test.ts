import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { main, version, presetFlag } from '../src/cli.js';

const requireCjs = createRequire(import.meta.url);
const SCRATCH = resolve('.tmp/cli-test');

let stdout = '';
let stderr = '';

beforeAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true });
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(resolve(SCRATCH, 'broken.reel'), 'frobnicate the widget\n', 'utf8');
  await writeFile(resolve(SCRATCH, 'fine.reel'), 'visit http://localhost:1\n', 'utf8');

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

describe('main', () => {
  it('prints usage and succeeds when given no arguments', async () => {
    stdout = '';
    const code = await main([]);

    expect(code).toBe(0);
    expect(stdout).toContain('Usage: flowreel');
    expect(stdout).toContain(version);
  });

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

  it('reports --preset with no value in plain language', async () => {
    stderr = '';
    const code = await main([resolve(SCRATCH, 'fine.reel'), '--preset']);

    expect(code).toBe(1);
    expect(stderr).toContain('--preset needs a preset name');
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

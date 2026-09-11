import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, rm, readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { record } from '../../src/record/index.js';
import { parse } from '../../src/parser/parse.js';
import { main } from '../../src/cli.js';

const APP = pathToFileURL(resolve('demo/app.html')).href;
// Scratch stays inside the repo so nothing is written off the D: drive.
const SCRATCH = resolve('.tmp/record-cli');

beforeAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true });
  await mkdir(SCRATCH, { recursive: true });
});

describe('record', () => {
  it('writes a script that parses, and renders outputs from it', async () => {
    const result = await record(APP, {
      cwd: SCRATCH,
      outputName: 'rec',
      headless: true,
      onReady: async (page) => {
        await page.click('#new-project');
        await page.fill('#project-name', 'Launch');
        await page.click('#create');
        await page.waitForTimeout(300);
        await page.locator('[data-flowreel-stop]').click();
      },
    });

    expect(result.scriptPath).toBe(resolve(SCRATCH, 'rec.reel'));
    const source = await readFile(result.scriptPath, 'utf8');
    const script = parse(source);
    expect(script.commands[0]).toMatchObject({ kind: 'visit' });
    expect(script.commands.some((c) => c.kind === 'click' && c.target === 'New project')).toBe(true);
    expect(script.commands.some((c) => c.kind === 'type' && c.text === 'Launch')).toBe(true);
    expect(script.commands.some((c) => c.kind === 'caption')).toBe(true);

    expect(result.outputs.length).toBeGreaterThanOrEqual(2);
    for (const output of result.outputs) expect((await stat(output.path)).size).toBeGreaterThan(0);
  }, 120_000);
});

describe('cli record', () => {
  it('prints usage and returns 1 when no url is given', async () => {
    const chunks: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => { chunks.push(String(s)); return true; }) as never;
    try {
      expect(await main(['record'])).toBe(1);
    } finally {
      process.stderr.write = original;
    }
    expect(chunks.join('')).toMatch(/flowreel record <url>/);
  });
});

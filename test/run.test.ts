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

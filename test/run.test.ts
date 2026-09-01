import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, rm, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  runScript,
  assertFramesCaptured,
  EmptyCaptureError,
  planOutputs,
  initialViewport,
} from '../src/run.js';
import { PRESETS } from '../src/encode/presets.js';
import { UserError } from '../src/errors.js';
import { parse } from '../src/parser/parse.js';
import { ffmpegBinary } from '../src/encode/probe.js';
import { execFile } from 'node:child_process';

const SCRATCH = resolve('.tmp/run-test');

// ffmpeg-static ships no ffprobe, so read the dimensions back out of ffmpeg's
// own stream banner. `ffmpeg -i <file>` with no output exits non-zero by
// design; the banner on stderr is what we want.
async function videoSize(path: string): Promise<string> {
  const stderr = await new Promise<string>((done) => {
    execFile(ffmpegBinary(), ['-hide_banner', '-i', path], (_error, _stdout, err) => done(err));
  });
  const match = /Video: .*?, (\d+)x(\d+)/.exec(stderr);
  return match ? `${match[1]}x${match[2]}` : `unparsed: ${stderr}`;
}
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
    expect(outputs.map((o) => o.format).sort()).toEqual(['gif', 'mp4']);
  });

  it('honours a preset override from the caller', async () => {
    const outputs = await runScript(
      [`visit ${FIXTURE}`, 'viewport 800x600', 'wait 400', 'output shot'].join('\n'),
      { cwd: SCRATCH, presetOverride: 'twitter' },
    );

    expect(outputs.map((o) => o.format)).toEqual(['mp4']);
  });

  // The canonical script sets the viewport *after* visit, i.e. after the
  // screencast has already started. If that size were applied mid-capture the
  // frame sequence would change dimensions partway through - and ffmpeg 6 does
  // not error on that, it silently encodes everything at the *first* frame's
  // size, distorting the rest. Hence the dimension assertion below rather than a
  // bare "it encoded" check.
  it('encodes cleanly when the script sets a viewport after visiting', async () => {
    const outputs = await runScript(
      // The `wait` is what makes this deterministic: a file:// fixture otherwise
      // loads fast enough that no frame lands at the pre-resize size and the bug
      // hides. A real dev server is always slow enough for frames to land first.
      [`visit ${FIXTURE}`, 'wait 500', 'viewport 1000x700', 'click "Toggle"', 'wait 600', 'output sized'].join(
        '\n',
      ),
      { cwd: SCRATCH, presetOverride: 'twitter' },
    );

    expect(outputs.map((o) => o.format)).toEqual(['mp4']);
    expect((await stat(outputs[0]!.path)).size).toBeGreaterThan(0);

    // The real tell. The capture is uniformly 1000x700 and the preset never
    // upscales, so the video is 1000x700. Applied mid-capture instead, the
    // encoder latches onto the pre-resize 1280x720 first frame and everything
    // after it is squeezed into the wrong aspect ratio - this assertion reads
    // 1280x720 in that case.
    expect(await videoSize(outputs[0]!.path)).toBe('1000x700');
  });

  // An explicit extension overrides the preset's format choice: one file,
  // named exactly what the user asked for, with no doubled extension.
  it('emits exactly one file when the output name carries an extension', async () => {
    const outputs = await runScript(
      [`visit ${FIXTURE}`, 'viewport 800x600', 'wait 400', 'output single.gif'].join('\n'),
      { cwd: SCRATCH },
    );

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.format).toBe('gif');
    expect(basename(outputs[0]!.path)).toBe('single.gif');
    expect((await stat(resolve(SCRATCH, 'single.gif'))).size).toBeGreaterThan(0);
    await expect(stat(resolve(SCRATCH, 'single.gif.gif'))).rejects.toThrow();
    await expect(stat(resolve(SCRATCH, 'single.gif.mp4'))).rejects.toThrow();
  });
});

describe('planOutputs', () => {
  it('expands to the preset bundle when no extension is given', () => {
    const planned = planOutputs('demo', PRESETS.default!);
    expect(planned.map((p) => p.fileName)).toEqual(['demo.gif', 'demo.mp4']);
  });

  it('keeps the preset width, fps and budget when an extension narrows the format', () => {
    const planned = planOutputs('demo.gif', PRESETS.default!);
    const source = PRESETS.default!.outputs.find((o) => o.format === 'gif')!;

    expect(planned).toHaveLength(1);
    expect(planned[0]!.fileName).toBe('demo.gif');
    expect(planned[0]!.spec).toEqual(source);
  });

  it('rejects an unknown extension in plain language, listing the real ones', () => {
    expect(() => planOutputs('demo.avi', PRESETS.default!)).toThrow(UserError);
    expect(() => planOutputs('demo.avi', PRESETS.default!)).toThrow(/\.gif.*\.webp.*\.mp4.*\.webm/);
  });
});

describe('initialViewport', () => {
  it('finds a viewport set after visit, so it can be applied before capture', () => {
    expect(initialViewport(parse('visit http://x\nviewport 1000x700'))).toEqual({
      width: 1000,
      height: 700,
    });
  });

  it('returns undefined when the script never sets one', () => {
    expect(initialViewport(parse('visit http://x'))).toBeUndefined();
  });
});

describe('assertFramesCaptured', () => {
  it('throws a plain-language error when nothing was captured', () => {
    expect(() => assertFramesCaptured([])).toThrow(EmptyCaptureError);
    expect(() => assertFramesCaptured([])).toThrow(/wait/i);
  });

  it('does not throw when frames exist', () => {
    expect(() =>
      assertFramesCaptured([{ data: Buffer.from('x'), timestampMs: 0 }]),
    ).not.toThrow();
  });
});

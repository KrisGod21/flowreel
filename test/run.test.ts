import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { createHash } from 'node:crypto';
import {
  runScript,
  assertFramesCaptured,
  EmptyCaptureError,
  planOutputs,
  initialViewport,
  initialVisit,
  captureFrames,
} from '../src/run.js';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../src/browser/resolve.js';
import { startScreencast } from '../src/capture/screencast.js';
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

  it('produces an MP4 wider than the viewport width when the script asks for a frame', async () => {
    const outputs = await runScript(
      [`visit ${FIXTURE}`, 'viewport 400x300', 'frame window', 'wait 400', 'output framed'].join('\n'),
      { cwd: SCRATCH, presetOverride: 'twitter' },
    );

    expect(outputs.map((o) => o.format)).toEqual(['mp4']);
    const size = await videoSize(outputs[0]!.path);
    const match = /^(\d+)x(\d+)/.exec(size);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(400);
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

describe('initialVisit', () => {
  it('finds a leading visit, skipping past a leading viewport', () => {
    expect(initialVisit(parse('viewport 800x600\nvisit http://x'))).toBe('http://x');
  });

  it('finds a leading visit with no viewport at all', () => {
    expect(initialVisit(parse('visit http://x\nwait 100'))).toBe('http://x');
  });

  it('returns undefined when visit is not the first real command', () => {
    expect(initialVisit(parse('wait 100\nvisit http://x'))).toBeUndefined();
  });

  it('returns undefined when the script never visits', () => {
    expect(initialVisit(parse('viewport 800x600'))).toBeUndefined();
  });
});

describe('captureFrames (blank-first-frame fix)', () => {
  let browser: Browser;

  beforeAll(async () => {
    const choice = await resolveBrowser(systemProbe);
    browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');

  async function newSizedPage(): Promise<Page> {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 800, height: 600 });
    return page;
  }

  // Before the fix, the screencast starts on about:blank and only then does
  // the script's leading `visit` navigate - so the first captured frame (and,
  // measured on a real recording, the first 3 frames at 15fps) is pure white.
  // A cheap, deterministic way to prove the first frame is the *loaded* app
  // rather than that blank warm-up frame: capture a page that has genuinely
  // never navigated (still about:blank) through the very same "keep the
  // first frame" path startScreencast's alreadyNavigated option uses for the
  // real hoist, and assert the visited script's first frame is not
  // byte-identical to that known-blank reference. (A script with no `visit`
  // at all is not a usable reference here: with nothing ever repainting
  // about:blank, the ordinary discard-the-first-frame path correctly ends up
  // with zero frames, not a blank one to compare against.) Reverting the
  // hoist in captureFrames makes this fail - see the task report for that run.
  it('captures the loaded page in the first frame, not a blank warm-up frame', async () => {
    const visitPage = await newSizedPage();
    const blankPage = await newSizedPage();
    try {
      const visited = await captureFrames(visitPage, parse(`visit ${FIXTURE}\nwait 300`));
      expect(visited.frames.length).toBeGreaterThan(0);

      const blankScreencast = await startScreencast(blankPage, { alreadyNavigated: true });
      const blankFrameSet = await blankScreencast.stop();
      expect(blankFrameSet.frames.length).toBeGreaterThan(0);

      expect(hash(visited.frames[0]!.data)).not.toBe(hash(blankFrameSet.frames[0]!.data));
    } finally {
      await visitPage.close();
      await blankPage.close();
    }
  });

  // The hoisted `visit` must not run a second time when executeScript runs
  // the rest of the script - a repeated navigation after recording has begun
  // would itself flash blank, just moved a few frames later, not eliminated.
  // A script with exactly one `visit` and nothing else that navigates should
  // therefore fire the page's 'load' event exactly once for the whole capture.
  it('does not re-navigate the hoisted visit when the script executes', async () => {
    const page = await newSizedPage();
    let loadCount = 0;
    page.on('load', () => {
      loadCount += 1;
    });
    try {
      await captureFrames(page, parse(`visit ${FIXTURE}\nwait 300`));
      expect(loadCount).toBe(1);
    } finally {
      await page.close();
    }
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

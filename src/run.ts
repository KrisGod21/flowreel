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
import type { Frame } from './capture/types.js';

const IDLE_THRESHOLD_MS = 500;

export interface RunOptions {
  cwd: string;
  presetOverride?: string;
}

// Thrown when the capture produced nothing to encode - most commonly because
// the script's `wait` after `visit` was too short for the page to render.
// This is a script problem the user can fix, not an internal failure, so it
// is handled alongside ReelParseError and TargetNotFoundError in cli.ts.
export class EmptyCaptureError extends Error {
  constructor() {
    super(
      "Nothing was captured. The page may not have rendered in time - try adding a longer `wait` after `visit`.",
    );
    this.name = 'EmptyCaptureError';
  }
}

// Pulled out as its own pure function so the zero-frame guard can be tested
// deterministically, rather than by trying to provoke a real zero-frame
// capture (timing-dependent, and would flake).
export function assertFramesCaptured(frames: Frame[]): void {
  if (frames.length === 0) {
    throw new EmptyCaptureError();
  }
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
    assertFramesCaptured(frames);

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

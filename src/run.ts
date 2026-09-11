import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { parse } from './parser/parse.js';
import { resolveBrowser, launchOptionsFor, systemProbe } from './browser/resolve.js';
import { executeScript, visit } from './runtime/execute.js';
import { startScreencast } from './capture/screencast.js';
import { Overlay } from './overlay/api.js';
import { trimIdle } from './capture/trim.js';
import { encodeOutput } from './encode/encode.js';
import { PRESETS } from './encode/presets.js';
import type { OutputFormat, OutputSpec, Preset } from './encode/presets.js';
import { UserError } from './errors.js';
import type { EmittedOutput } from './summary.js';
import type { Frame, FrameSet } from './capture/types.js';
import type { Command, Script } from './parser/types.js';

const IDLE_THRESHOLD_MS = 500;

const EXTENSION_FORMATS: Record<string, OutputFormat> = {
  '.gif': 'gif',
  '.webp': 'webp',
  '.mp4': 'mp4',
  '.webm': 'webm',
};

export interface RunOptions {
  cwd: string;
  presetOverride?: string;
}

// Thrown when the capture produced nothing to encode - most commonly because
// the script's `wait` after `visit` was too short for the page to render.
// This is a script problem the user can fix, not an internal failure, so it
// is a UserError and exits 1.
export class EmptyCaptureError extends UserError {
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

export interface PlannedOutput {
  spec: OutputSpec;
  fileName: string;
}

// An explicit file extension always overrides the preset's format choice, so
// `output demo.gif` emits exactly demo.gif - not the whole bundle plus a
// doubled extension. The preset still supplies width, fps and byte budget:
// the user picked a container, not a quality level.
export function planOutputs(name: string, preset: Preset): PlannedOutput[] {
  const extension = extname(name).toLowerCase();
  if (extension === '') {
    return preset.outputs.map((spec) => ({ spec, fileName: `${name}.${spec.format}` }));
  }

  const format = EXTENSION_FORMATS[extension];
  if (!format) {
    throw new UserError(
      `I don't know how to write a "${extension}" file. Use one of: ${Object.keys(EXTENSION_FORMATS).join(', ')} - or drop the extension and let the preset choose.`,
    );
  }

  // Prefer the preset's own settings for this format when it has them; fall
  // back to its first output so a format the preset doesn't emit still gets
  // that preset's width, fps and budget rather than an invented default.
  const source = preset.outputs.find((spec) => spec.format === format) ?? preset.outputs[0]!;
  return [{ spec: { ...source, format }, fileName: name }];
}

// The screencast is started before the script runs, and CDP emits frames at
// whatever the page size is at that moment. The canonical script puts
// `viewport` *after* `visit`, i.e. mid-capture - which would hand ffmpeg an
// image sequence whose dimensions change partway through. ffmpeg 6 survives
// that by latching onto the *first* frame's size and squeezing everything after
// it into the wrong aspect ratio; other builds reject it outright. Either way
// the output is wrong, so the size is applied up front. The command is
// deliberately left in the execution sequence too: re-applying the same size is
// a no-op, and removing it would make the script and what actually ran
// disagree. It also makes FrameSet.width/height truthful for the first time.
export function initialViewport(script: Script): { width: number; height: number } | undefined {
  const command = script.commands.find((c) => c.kind === 'viewport');
  return command?.kind === 'viewport' ? { width: command.width, height: command.height } : undefined;
}

// The screencast is started before the script runs (see startScreencast's own
// warm-up nudge), so a script whose first real command is `visit` records its
// opening frames against about:blank - a measured 3 frames of pure white at
// 15fps before the app ever appears, in the flagship artifact. `viewport` is
// hoisted the same way above, so a leading `visit` gets the same treatment:
// navigate before the screencast starts, so its warm-up nudge fires against
// the real, loaded page instead of about:blank. Only a genuinely *leading*
// visit qualifies (skipping past any leading `viewport`, which does not
// change the document) - a `visit` reached later in the script, after other
// commands have already run, must still happen mid-capture like today.
export function initialVisit(script: Script): string | undefined {
  const leading = script.commands.find((c) => c.kind !== 'viewport');
  return leading?.kind === 'visit' ? leading.url : undefined;
}

// Drops the one leading `visit` that was already executed ahead of the
// screencast by initialVisit, so executeScript does not navigate to it a
// second time. Unlike `viewport` - where re-applying the same size mid-script
// is a harmless no-op - re-running `visit` is not harmless: it would force a
// real second navigation after recording has already begun, reproducing the
// very blank-frame flash this hoist exists to remove, just moved a few frames
// later instead of eliminated.
function dropLeadingVisit(script: Script): Script {
  const index = script.commands.findIndex((c) => c.kind !== 'viewport');
  if (index === -1 || script.commands[index]?.kind !== 'visit') return script;
  const commands: Command[] = script.commands.filter((_, i) => i !== index);
  return { ...script, commands };
}

// Pulled out of runScript so the blank-first-frame fix can be exercised
// directly against a real page and a real screencast, without paying for
// ffmpeg encoding on every assertion.
export async function captureFrames(page: Page, script: Script, overlay?: Overlay): Promise<FrameSet> {
  const leadingVisitUrl = initialVisit(script);
  if (leadingVisitUrl) await visit(page, leadingVisitUrl);

  const screencast = await startScreencast(page, { alreadyNavigated: leadingVisitUrl !== undefined });
  await executeScript(page, leadingVisitUrl ? dropLeadingVisit(script) : script, overlay);
  return screencast.stop();
}

export async function runScript(source: string, options: RunOptions): Promise<EmittedOutput[]> {
  const script = parse(source);

  const outputCommand = script.commands.find((c) => c.kind === 'output');
  const name = outputCommand?.kind === 'output' ? outputCommand.name : 'demo';
  const presetName = options.presetOverride ?? (outputCommand?.kind === 'output' ? outputCommand.preset : undefined) ?? 'default';

  const preset = PRESETS[presetName];
  if (!preset) {
    throw new UserError(
      `I don't have a preset called "${presetName}". Try one of: ${Object.keys(PRESETS).join(', ')}.`,
    );
  }

  const planned = planOutputs(name, preset);

  const choice = await resolveBrowser(systemProbe);
  if (choice.kind === 'missing') {
    throw new UserError(
      'I couldn\'t find Chrome, Edge, or a bundled Chromium. Install Chrome, or run `npx playwright install chromium` (~150MB).',
    );
  }

  // `output docs/demo` should create docs/, not fail with a raw ENOENT from
  // ffmpeg after the whole capture has already been paid for.
  const outputDir = dirname(resolve(options.cwd, name));
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
  try {
    const page = await browser.newPage();

    const viewport = initialViewport(script);
    if (viewport) await page.setViewportSize(viewport);

    // Installed before the screencast so the first captured frame already has
    // the overlay, and before any visit (including the hoisted one inside
    // captureFrames) so addInitScript covers every document.
    const overlay = await Overlay.install(page);

    const frameSet = await captureFrames(page, script, overlay);

    const frames = trimIdle(frameSet.frames, IDLE_THRESHOLD_MS);
    assertFramesCaptured(frames);

    return await Promise.all(
      planned.map(async ({ spec, fileName }): Promise<EmittedOutput> => {
        const outPath = resolve(options.cwd, fileName);
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

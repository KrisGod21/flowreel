import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { Frame } from '../capture/types.js';
import { ffmpegBinary, probeFfmpeg, type FfmpegCapabilities } from './probe.js';
import { resampleToFps } from '../capture/trim.js';
import { degrade, MAX_ATTEMPTS } from './budget.js';
import type { OutputFormat, OutputSpec } from './presets.js';
import type { FrameAssets, Rect } from './frame.js';
import { UserError } from '../errors.js';

/** Renders the frame assets for one attempt's (possibly degraded) width. */
export type RenderFrame = (width: number) => Promise<FrameAssets>;

const run = promisify(execFile);

function supports(caps: FfmpegCapabilities, format: OutputFormat): boolean {
  switch (format) {
    case 'gif': return caps.gif;
    case 'webp': return caps.webp;
    case 'mp4': return caps.h264;
    case 'webm': return caps.vp9;
  }
}

// Pulled out as its own pure function so the friendly-error path can be
// tested deterministically against a fabricated FfmpegCapabilities object,
// rather than depending on this machine's actual ffmpeg build happening to
// lack an encoder.
export function assertSupported(caps: FfmpegCapabilities, format: OutputFormat): void {
  if (!supports(caps, format)) {
    throw new UserError(
      `This ffmpeg build has no ${format} encoder, so I couldn't get a ${format} out of it. Try a different --preset.`,
    );
  }
}

// Under .flowreel/ because that is the one directory .gitignore covers: the old
// sibling `.flowreel-frames-*` name meant a Ctrl-C mid-encode left an untracked
// directory sitting in the user's project. Still keyed by outPath's own basename
// so that concurrent encodeOutput calls writing into the same directory - one
// preset can emit several formats from a single capture - never share a scratch
// directory and stomp on each other's frame files.
export function scratchDirFor(outPath: string): string {
  return resolve(dirname(outPath), '.flowreel', 'tmp', basename(outPath));
}

async function writeFrames(frames: Frame[], dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all(
    frames.map((frame, i) =>
      writeFile(resolve(dir, `${String(i + 1).padStart(6, '0')}.jpg`), frame.data),
    ),
  );
}

interface FrameArgs {
  backdropPath: string;
  maskPath: string;
  window: Rect;
}

// Writes the two rendered stills into the same per-output scratch directory
// as the frame sequence, so the whole thing is cleaned up together in
// encodeOutput's `finally`.
async function writeFrameAssets(assets: FrameAssets, dir: string): Promise<FrameArgs> {
  const backdropPath = resolve(dir, 'backdrop.png');
  const maskPath = resolve(dir, 'mask.png');
  await Promise.all([writeFile(backdropPath, assets.backdrop), writeFile(maskPath, assets.mask)]);
  return { backdropPath, maskPath, window: assets.window };
}

function argsFor(spec: OutputSpec, dir: string, outPath: string, frameCount: number, frame?: FrameArgs): string[] {
  const input = ['-y', '-framerate', String(spec.fps), '-i', resolve(dir, '%06d.jpg')];

  if (!frame) {
    // min(width, iw): capture at native resolution and downscale per output,
    // never upscale. A 900px-wide preset must not blow an 800px viewport up to
    // 900 and call the blur a feature.
    const scale = `scale='min(${spec.width},iw)':-2:flags=lanczos`;

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

  // Framed path: three inputs - the frame sequence (index 0, finite length),
  // and the backdrop and mask stills (indices 1 and 2). `-loop 1` alone makes
  // an image input last forever, which does not just overrun the output -
  // with an infinite main input feeding overlay (whose default eof_action
  // only bounds the *secondary* pad), the whole filter graph never reaches
  // EOF and ffmpeg hangs encoding frames forever, confirmed by hand against
  // this exact filter graph. So each still is bounded with `-t` to a little
  // more than the recording's own duration - long enough to always cover it,
  // short enough to guarantee an end - and `-shortest` trims any excess so
  // the output ends exactly when the recording does.
  //
  // The mask is the full canvas (it has to line up with the backdrop for the
  // final overlay), but alphamerge requires both its inputs to be the same
  // size, so it is cropped down to just the window rect first - which is
  // also exactly what gives the composited video its rounded corners: the
  // crop keeps the mask's anti-aliased corner arcs, so alphamerge fades the
  // video's own corners to transparent there instead of leaving them square.
  // The image sequence is scaled to exactly that same window size, merged
  // against the cropped mask, then overlaid onto the backdrop at the
  // window's position.
  const { window } = frame;
  // +1 frame of slack: a still bounded to exactly the recording's own
  // duration can end fractionally before the last frame under rounding,
  // trimming it; `-shortest` below is what actually makes the output end on
  // time, this padding only prevents the still from being the short one.
  const stillDuration = ((frameCount + 1) / spec.fps).toFixed(3);
  const stillInput = (path: string): string[] => ['-loop', '1', '-framerate', String(spec.fps), '-t', stillDuration, '-i', path];
  const extraInputs = [...stillInput(frame.backdropPath), ...stillInput(frame.maskPath)];
  const composite =
    `[0:v]scale=${window.width}:${window.height}:flags=lanczos[scaled];` +
    `[2:v]crop=${window.width}:${window.height}:${window.x}:${window.y}[maskc];` +
    `[scaled][maskc]alphamerge[keyed];` +
    `[1:v][keyed]overlay=${window.x}:${window.y}[comp]`;

  switch (spec.format) {
    case 'gif':
      // alphamerge needs an RGBA intermediate before palettegen, so the
      // palette step still runs after the overlay, not in place of it.
      return [
        ...input, ...extraInputs,
        '-filter_complex', `${composite};[comp]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer[out]`,
        '-map', '[out]',
        '-shortest',
        '-loop', '0',
        outPath,
      ];
    case 'webp':
      return [...input, ...extraInputs, '-filter_complex', composite, '-map', '[comp]', '-shortest', '-c:v', 'libwebp_anim', '-loop', '0', '-q:v', '75', outPath];
    case 'mp4':
      return [...input, ...extraInputs, '-filter_complex', composite, '-map', '[comp]', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath];
    case 'webm':
      return [...input, ...extraInputs, '-filter_complex', composite, '-map', '[comp]', '-shortest', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', outPath];
  }
}

export async function encodeOutput(
  frames: Frame[],
  spec: OutputSpec,
  outPath: string,
  renderFrame?: RenderFrame,
): Promise<{ path: string; bytes: number }> {
  const caps = await probeFfmpeg();
  assertSupported(caps, spec.format);

  const scratch = scratchDirFor(outPath);
  let current: OutputSpec | null = spec;
  let attempt = 0;
  let last = 0;

  try {
    while (current) {
      await rm(scratch, { recursive: true, force: true });
      const resampled = resampleToFps(frames, current.fps);
      await writeFrames(resampled, scratch);
      // Re-rendered per attempt: when byte-budget degradation shrinks the
      // width, the frame assets (sized to the old width) would no longer
      // match the scaled recording, so a fresh render is required rather
      // than reusing one captured before the first attempt.
      const frameArgs = renderFrame ? await writeFrameAssets(await renderFrame(current.width), scratch) : undefined;
      await run(ffmpegBinary(), [
        '-hide_banner', '-loglevel', 'error',
        ...argsFor(current, scratch, outPath, resampled.length, frameArgs),
      ]);

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

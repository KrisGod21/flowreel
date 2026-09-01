import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { Frame } from '../capture/types.js';
import { ffmpegBinary, probeFfmpeg, type FfmpegCapabilities } from './probe.js';
import { resampleToFps } from '../capture/trim.js';
import { degrade, MAX_ATTEMPTS } from './budget.js';
import type { OutputFormat, OutputSpec } from './presets.js';
import { UserError } from '../errors.js';

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
  assertSupported(caps, spec.format);

  // Named after outPath's own basename (not a fixed constant) so that
  // concurrent encodeOutput calls writing into the same output directory -
  // one preset can emit several formats from a single capture - never share
  // a scratch directory and stomp on each other's frame files.
  const scratch = resolve(dirname(outPath), `.flowreel-frames-${basename(outPath)}`);
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

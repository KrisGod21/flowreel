import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { UserError } from '../errors.js';

const requireCjs = createRequire(import.meta.url);
// ffmpeg-static@5.3.0's shipped .d.ts uses ESM `export default` syntax but the package
// has no "type": "module" and its real index.js does `module.exports = binaryPath`
// (CommonJS export=). That mismatch makes every static import form resolve to the wrong
// type under NodeNext. createRequire's require() bypasses the broken .d.ts, so we restore
// the real type by hand to match the package's documented runtime contract.
const ffmpegPath: string | null = requireCjs('ffmpeg-static');

const run = promisify(execFile);

export interface FfmpegCapabilities {
  h264: boolean;
  webp: boolean;
  gif: boolean;
  vp9: boolean;
}

function hasEncoder(output: string, name: string): boolean {
  return new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(output);
}

export function parseEncoders(output: string): FfmpegCapabilities {
  return {
    h264: hasEncoder(output, 'libx264'),
    // flowreel only ever emits *animated* webp (the README motion format), so
    // `webp` here means specifically that libwebp_anim is present. The plain,
    // static-only `libwebp` encoder can't produce what this tool needs, and
    // reporting it as support would let a caller pass the pre-encode check and
    // then have ffmpeg reject an unrecognized/unusable codec name.
    webp: hasEncoder(output, 'libwebp_anim'),
    gif: hasEncoder(output, 'gif'),
    vp9: hasEncoder(output, 'libvpx-vp9'),
  };
}

export function ffmpegBinary(): string {
  if (!ffmpegPath) {
    throw new UserError('ffmpeg is missing from this install. Try reinstalling flowreel.');
  }
  return ffmpegPath;
}

// Memoized on the promise, not the result, so that the parallel encodes of a
// single `default` run share one spawn instead of racing two. The answer is a
// property of the binary on disk and cannot change within a run.
let probed: Promise<FfmpegCapabilities> | undefined;

export async function probeFfmpeg(): Promise<FfmpegCapabilities> {
  probed ??= run(ffmpegBinary(), ['-hide_banner', '-encoders']).then(
    ({ stdout }) => parseEncoders(stdout),
    (error: unknown) => {
      // Do not cache a failure: a transient spawn error should not poison every
      // later call in the process.
      probed = undefined;
      throw error;
    },
  );
  return probed;
}

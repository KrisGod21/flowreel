import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

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
    webp: hasEncoder(output, 'libwebp_anim') || hasEncoder(output, 'libwebp'),
    gif: hasEncoder(output, 'gif'),
    vp9: hasEncoder(output, 'libvpx-vp9'),
  };
}

export function ffmpegBinary(): string {
  if (!ffmpegPath) {
    throw new Error('ffmpeg is missing from this install. Try reinstalling flowreel.');
  }
  return ffmpegPath;
}

export async function probeFfmpeg(): Promise<FfmpegCapabilities> {
  const { stdout } = await run(ffmpegBinary(), ['-hide_banner', '-encoders']);
  return parseEncoders(stdout);
}

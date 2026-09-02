import { describe, it, expect } from 'vitest';
import { parseEncoders } from '../../src/encode/probe.js';

const SAMPLE = `Encoders:
 V..... = Video
 ------
 V....D gif                  GIF (Graphics Interchange Format)
 V....D libx264              libx264 H.264 / AVC (codec h264)
 V....D libwebp_anim         libwebp animated WebP (codec webp)
 V....D libwebp              libwebp WebP image (codec webp)
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 A....D aac                  AAC (Advanced Audio Coding)
`;

describe('parseEncoders', () => {
  it('detects the encoders we need', () => {
    expect(parseEncoders(SAMPLE)).toEqual({ h264: true, webp: true, gif: true, vp9: true });
  });

  it('reports missing encoders as false', () => {
    expect(parseEncoders(' V....D gif   GIF\n')).toEqual({
      h264: false,
      webp: false,
      gif: true,
      vp9: false,
    });
  });

  it('does not mistake a substring for an encoder', () => {
    expect(parseEncoders(' V....D libx264rgb  something\n').h264).toBe(false);
  });

  it('reports webp as unsupported when only the static (non-animated) encoder is present', () => {
    // flowreel only ever needs animated webp. A build with just the static
    // libwebp encoder cannot produce that, so `webp` must stay false here
    // even though ffmpeg does list a webp-family encoder.
    expect(parseEncoders(' V....D libwebp              libwebp WebP image (codec webp)\n').webp).toBe(false);
  });
});

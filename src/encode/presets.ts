export type OutputFormat = 'webp' | 'gif' | 'mp4' | 'webm';

export interface OutputSpec {
  format: OutputFormat;
  width: number;
  fps: number;
  maxBytes: number;
}

export interface Preset {
  name: string;
  outputs: OutputSpec[];
}

const MB = 1_000_000;

// The README image format is decided empirically in Task 10. Until that test
// is run this stays 'gif', the format guaranteed to render inline on GitHub.
export const README_IMAGE_FORMAT: OutputFormat = 'gif';

export const PRESETS: Record<string, Preset> = {
  default: {
    name: 'default',
    outputs: [
      { format: README_IMAGE_FORMAT, width: 900, fps: 15, maxBytes: 5 * MB },
      { format: 'mp4', width: 1280, fps: 30, maxBytes: 10 * MB },
    ],
  },
  'github-readme': {
    name: 'github-readme',
    outputs: [{ format: README_IMAGE_FORMAT, width: 900, fps: 15, maxBytes: 5 * MB }],
  },
  docs: {
    name: 'docs',
    outputs: [{ format: 'webm', width: 1280, fps: 30, maxBytes: 10 * MB }],
  },
  twitter: {
    name: 'twitter',
    outputs: [{ format: 'mp4', width: 1280, fps: 30, maxBytes: 15 * MB }],
  },
  producthunt: {
    name: 'producthunt',
    outputs: [{ format: 'gif', width: 1270, fps: 15, maxBytes: 3 * MB }],
  },
};

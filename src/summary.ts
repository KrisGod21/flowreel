import { basename, extname } from 'node:path';
import type { OutputFormat } from './encode/presets.js';

export interface EmittedOutput {
  path: string;
  bytes: number;
  format: OutputFormat;
  overBudget: boolean;
}

const DESTINATIONS: Record<OutputFormat, string> = {
  gif: 'README, GitHub, npm',
  webp: 'README, GitHub, npm',
  mp4: 'X, docs sites, Product Hunt',
  webm: 'docs sites',
};

const IMAGE_FORMATS: OutputFormat[] = ['gif', 'webp'];

export function humanBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

export function formatSummary(outputs: EmittedOutput[]): string {
  // Width from the widest name rather than a fixed 12, or `my-product-demo.gif`
  // pushes its own size column out of line with every other row.
  const column = Math.max(0, ...outputs.map((output) => basename(output.path).length));

  const lines = outputs.map((output) => {
    const name = basename(output.path).padEnd(column);
    const size = humanBytes(output.bytes).padStart(8);
    const note = output.overBudget ? '  (over budget)' : '';
    return `  ${name}${size}   ${DESTINATIONS[output.format]}${note}`;
  });

  const image = outputs.find((output) => IMAGE_FORMATS.includes(output.format));
  if (image) {
    const name = basename(image.path);
    const alt = basename(image.path, extname(image.path));
    lines.push('', '  Paste into your README:', `  ![${alt}](${name})`);
  }

  return lines.join('\n');
}

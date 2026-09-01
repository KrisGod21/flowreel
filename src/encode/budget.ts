import type { OutputSpec } from './presets.js';

const FPS_LADDER = [12, 10, 8];
const WIDTH_SCALE = [0.85, 0.7, 0.6];

export function degrade(spec: OutputSpec, attempt: number): OutputSpec | null {
  if (attempt < FPS_LADDER.length) {
    return { ...spec, fps: FPS_LADDER[attempt - 1]! };
  }

  const widthStep = attempt - FPS_LADDER.length;
  if (widthStep < WIDTH_SCALE.length) {
    return {
      ...spec,
      fps: FPS_LADDER[FPS_LADDER.length - 1]!,
      width: Math.round(spec.width * WIDTH_SCALE[widthStep]!),
    };
  }

  return null;
}

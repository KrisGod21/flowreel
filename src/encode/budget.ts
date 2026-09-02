import type { OutputSpec } from './presets.js';

const FPS_LADDER = [12, 10, 8];
const WIDTH_SCALE = [0.85, 0.7, 0.6];

// One more than the total number of rungs across both ladders, so a caller
// looping on `degrade` can bound its retries without the cap ever cutting a
// call short of the `null` that `degrade` itself would eventually return.
// Derived from the ladder lengths so lengthening either ladder later can't
// silently desync this bound from what `degrade` actually does.
export const MAX_ATTEMPTS = FPS_LADDER.length + WIDTH_SCALE.length + 1;

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

import { defineConfig } from 'vitest/config';

// Most files here launch a real Chromium in beforeAll and several run real
// ffmpeg encodes. Two things follow from that:
//
// - hookTimeout matches testTimeout. Vitest's 10s default is sized for unit
//   tests; a browser launch under load on a 2-core CI runner can take longer,
//   and a launch that eventually succeeds must not be reported as a failure.
// - On CI, test files run one at a time. Launching ten browsers at once on two
//   cores is what produced the flakes, not any test in isolation. Local runs
//   keep parallelism so the suite stays fast on a developer machine.
const onCI = Boolean(process.env.CI);

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: !onCI,
  },
});

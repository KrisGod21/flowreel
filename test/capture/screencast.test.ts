import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Page } from 'playwright';
import { startScreencast } from '../../src/capture/screencast.js';

// A minimal stand-in for the CDP session `startScreencast` talks to. Real
// Chrome delivers a `Page.screencastFrame` event asynchronously whenever a
// compositor frame is produced; this fake produces one every time `evaluate`
// runs, mirroring the comment in screencast.ts that a style write forces a
// compositor frame even on a blank page. `send`/`detach` are recorded but
// otherwise inert.
class FakeCdpSession extends EventEmitter {
  sent: string[] = [];
  async send(method: string): Promise<Record<string, never>> {
    this.sent.push(method);
    return {};
  }
  async detach(): Promise<void> {}
}

// A page whose only source of a compositor frame is `evaluate` - it never
// repaints spontaneously. This isolates exactly the property under test:
// does something call `evaluate` (and thus produce a frame) after a
// cross-document navigation, or only at start-up?
function makeFakePage(cdp: FakeCdpSession): Page {
  const emitter = new EventEmitter();
  let evalCount = 0;

  const page = {
    viewportSize: () => ({ width: 800, height: 600 }),
    context: () => ({ newCDPSession: async () => cdp }),
    evaluate: async () => {
      evalCount += 1;
      const sessionId = `session-${evalCount}`;
      // Asynchronous, like a real CDP event - never synchronous with the
      // evaluate() call that triggered it.
      queueMicrotask(() => {
        cdp.emit('Page.screencastFrame', {
          sessionId,
          data: Buffer.from(`frame-${evalCount}`).toString('base64'),
        });
      });
    },
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
  };

  return page as unknown as Page;
}

describe('startScreencast', () => {
  it('captures a frame from a cross-document navigation, not just from start-up', async () => {
    const cdp = new FakeCdpSession();
    const page = makeFakePage(cdp);

    const screencast = await startScreencast(page);

    // Simulate the caller's `visit` command: a cross-document navigation
    // fires Playwright's `load` event. This fake page never repaints on its
    // own, so the only way a frame can appear here is if startScreencast
    // itself reacts to the navigation - exactly what a script that just
    // navigates and then sits still (no click/type/hover) relies on.
    (page as unknown as EventEmitter).emit('load');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const { frames } = await screencast.stop();
    expect(frames.length).toBeGreaterThan(0);
  });
});

// The leading-`visit` hoist in run.ts (fix for recordings opening on a blank
// frame) navigates the page *before* calling startScreencast, then tells it
// so via `alreadyNavigated`. These two tests pin the exact mechanism that
// makes that fix work, deterministically - no real Chrome timing involved,
// unlike the "measured 3 blank frames on a real recording" symptom, which
// depends on real navigation latency and isn't reliably reproducible against
// a fast local fixture (confirmed by hand: reverting the run.ts hoist alone
// did not flip a real-browser version of this assertion, because Chrome's own
// warm-up latency already happens to swallow the sole blank frame for a
// fast navigation - see the task report for that finding). Reverting either
// half of the actual code change - dropping the `alreadyNavigated` branch, or
// not passing the option true - makes exactly one of these two fail.
describe('startScreencast alreadyNavigated', () => {
  it('keeps the warm-up frame instead of discarding it when the page was already navigated', async () => {
    const cdp = new FakeCdpSession();
    const page = makeFakePage(cdp);

    const screencast = await startScreencast(page, { alreadyNavigated: true });
    const { frames } = await screencast.stop();

    // This fake page's only source of a frame at all is the warm-up
    // `evaluate` call inside startScreencast - so if this frame were
    // discarded (the default, about:blank behaviour), frames would be empty.
    expect(frames).toHaveLength(1);
  });

  it('discards that same warm-up frame by default, matching the about:blank case', async () => {
    const cdp = new FakeCdpSession();
    const page = makeFakePage(cdp);

    const screencast = await startScreencast(page);
    const { frames } = await screencast.stop();

    expect(frames).toHaveLength(0);
  });
});

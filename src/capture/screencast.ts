import type { Page } from 'playwright';
import type { Frame, FrameSet } from './types.js';

export interface Screencast {
  stop(): Promise<FrameSet>;
}

// Chrome's screencast pipeline has warm-up latency: the very first frame of a
// brand-new session can take several hundred milliseconds to arrive, no
// matter what triggers it. Left unhandled, a script that starts recording and
// then does something quick (navigate, then a short wait) can call `stop()`
// before that first frame is even delivered, silently producing zero frames.
// So this latency is absorbed here, before the caller's script starts
// running: force a throwaway repaint and wait for the resulting frame (or a
// bounded timeout) before returning control.
const WARMUP_TIMEOUT_MS = 2000;

export async function startScreencast(page: Page): Promise<Screencast> {
  const client = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  let startedAt = Date.now();
  let warmedUp = false;
  let onWarm: (() => void) | undefined;

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  client.on('Page.screencastFrame', (event) => {
    void client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {
      // The session can close mid-flight; a dropped ack is not fatal.
    });

    if (!warmedUp) {
      warmedUp = true;
      onWarm?.();
      return;
    }

    frames.push({
      data: Buffer.from(event.data, 'base64'),
      timestampMs: Date.now() - startedAt,
    });
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    everyNthFrame: 1,
  });

  const warmup = new Promise<void>((resolveWarm) => {
    onWarm = resolveWarm;
  });
  // Best-effort nudge: a style write forces a compositor frame even on a
  // blank page, so the warm-up frame arrives promptly instead of waiting for
  // whatever the caller's script happens to do first.
  await page
    .evaluate(() => {
      document.documentElement.style.colorScheme = document.documentElement.style.colorScheme ? '' : 'normal';
    })
    .catch(() => {});
  await Promise.race([
    warmup,
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, WARMUP_TIMEOUT_MS)),
  ]);
  warmedUp = true;
  startedAt = Date.now();

  return {
    async stop(): Promise<FrameSet> {
      try {
        await client.send('Page.stopScreencast');
      } catch {
        // Already detached.
      }
      await client.detach().catch(() => {});
      return { frames, width: viewport.width, height: viewport.height };
    },
  };
}

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

  // Constructed before Page.startScreencast is sent: if a frame arrived
  // during that await with onWarm not yet assigned, the handler's discard
  // branch would latch warmedUp = true but have no resolver to call, so
  // `warmup` below would never settle and every capture would stall for the
  // full timeout - with frames straddling the startedAt reset out of order.
  const warmup = new Promise<void>((resolveWarm) => {
    onWarm = resolveWarm;
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    everyNthFrame: 1,
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

  // The nudge above only ever fires on the document that happened to be
  // loaded when the screencast started - typically about:blank. A caller's
  // script almost always does a cross-document navigation next (`visit`),
  // and nothing forces a compositor frame on the freshly-loaded document: if
  // the script then just sits still (a static page, no click/type/hover to
  // repaint something), the capture window can close with zero frames. Once
  // warm-up is done every subsequent `load` is a real navigation, so re-run
  // the same best-effort nudge each time one fires - the resulting frame is
  // a genuine frame of the new document and is kept, not discarded. Must
  // never throw: the page can be mid-navigation or mid-teardown.
  page.on('load', () => {
    void page
      .evaluate(() => {
        document.documentElement.style.colorScheme = document.documentElement.style.colorScheme ? '' : 'normal';
      })
      .catch(() => {});
  });

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

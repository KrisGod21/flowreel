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

export interface ScreencastOptions {
  // Set when the caller already navigated the page before calling
  // startScreencast - the leading-`visit` hoist in run.ts, added so a
  // recording doesn't open on a blank about:blank frame. In the normal
  // (false) case the very first frame this session ever produces is a
  // throwaway - the page is still about:blank - and is rightly discarded.
  // But when the page was already navigated first, that first frame *is* the
  // real, loaded page, not a throwaway: keep it instead of discarding it.
  //
  // A forced second repaint cannot substitute for this: Chrome's screencast
  // only emits a frame when a compositor commit actually changes pixels, and
  // the warm-up nudge (a colorScheme toggle with no visible effect on an
  // ordinary page) reliably produces exactly one frame right after the
  // session is enabled, then nothing more - confirmed by hand against a real
  // page, repeating the same nudge for several seconds produced no further
  // frames. So there is no reliable way to manufacture a *second* frame of
  // identical, unchanging content; the fix is to stop discarding the first
  // one when it is already real.
  alreadyNavigated?: boolean;
}

async function forceRepaint(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      document.documentElement.style.colorScheme = document.documentElement.style.colorScheme ? '' : 'normal';
    })
    .catch(() => {});
}

export async function startScreencast(page: Page, options: ScreencastOptions = {}): Promise<Screencast> {
  const client = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  let startedAt = Date.now();
  let firstFrameSeen = false;
  let onFirstFrame: (() => void) | undefined;

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  client.on('Page.screencastFrame', (event) => {
    void client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {
      // The session can close mid-flight; a dropped ack is not fatal.
    });

    if (!firstFrameSeen) {
      firstFrameSeen = true;
      // alreadyNavigated: this first frame already depicts the real, loaded
      // page - keep it (timestamp 0, exactly like the "first frame" any other
      // capture starts from). Otherwise it is the classic about:blank
      // throwaway and is discarded, as before.
      if (options.alreadyNavigated) {
        frames.push({ data: Buffer.from(event.data, 'base64'), timestampMs: 0 });
      }
      onFirstFrame?.();
      return;
    }

    frames.push({
      data: Buffer.from(event.data, 'base64'),
      timestampMs: Date.now() - startedAt,
    });
  });

  // Constructed before Page.startScreencast is sent: if a frame arrived
  // during that await with onFirstFrame not yet assigned, the handler above
  // would latch firstFrameSeen = true but have no resolver to call, so
  // `warmup` below would never settle and every capture would stall for the
  // full timeout - with frames straddling the startedAt reset out of order.
  const warmup = new Promise<void>((resolve) => {
    onFirstFrame = resolve;
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    everyNthFrame: 1,
  });

  // Best-effort nudge: a style write forces a compositor frame even on a
  // blank page, so the warm-up frame arrives promptly instead of waiting for
  // whatever the caller's script happens to do first.
  await forceRepaint(page);
  await Promise.race([
    warmup,
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, WARMUP_TIMEOUT_MS)),
  ]);
  // Rebase timestamps to this point so a slow warm-up doesn't inflate every
  // frame's reported time. In alreadyNavigated mode the first frame was
  // already pushed above with timestampMs: 0, matching this same rebase.
  startedAt = Date.now();

  // The nudge above only ever fires on the document that happened to be
  // loaded when the screencast started - typically about:blank. A caller's
  // script almost always does a cross-document navigation next (`visit`),
  // and nothing forces a compositor frame on the freshly-loaded document: if
  // the script then just sits still (a static page, no click/type/hover to
  // repaint something), the capture window can close with zero frames. Once
  // warm-up is done every subsequent `load` is a real navigation, so re-run
  // the same best-effort nudge each time one fires - the resulting frame is
  // a genuine frame of the new document and is kept, not discarded (by this
  // point firstFrameSeen is always true, so the handler above never discards
  // again). Must never throw: the page can be mid-navigation or mid-teardown.
  page.on('load', () => {
    void forceRepaint(page);
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

import type { Page } from 'playwright';
import type { Frame, FrameSet } from './types.js';

export interface Screencast {
  stop(): Promise<FrameSet>;
}

export async function startScreencast(page: Page): Promise<Screencast> {
  const client = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  const startedAt = Date.now();

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  client.on('Page.screencastFrame', (event) => {
    frames.push({
      data: Buffer.from(event.data, 'base64'),
      timestampMs: Date.now() - startedAt,
    });
    void client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {
      // The session can close mid-flight; a dropped ack is not fatal.
    });
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    everyNthFrame: 1,
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

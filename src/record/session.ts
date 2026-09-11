import { chromium, type Page } from 'playwright';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../browser/resolve.js';
import { UserError } from '../errors.js';
import { RECORDER_SOURCE } from './recorder-browser.js';
import type { InteractionEvent, RecordedSession } from './events.js';

export interface SessionOptions {
  /** Default false: the user has to see the browser to click through it. */
  headless?: boolean;
  viewport?: { width: number; height: number };
  /** Test hook, called once the first page has loaded. */
  onReady?: (page: Page) => Promise<void> | void;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

function hostLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

// Mirrors src/runtime/execute.ts's `visit` translation verbatim so a dead dev
// server or an invalid URL reads the same whether it fails during recording
// or during replay.
function translateNavigationError(error: unknown, url: string): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Cannot navigate to invalid URL')) {
    throw new UserError(
      `"${url}" isn't a URL I can open. Use something like http://localhost:3000, or a file:// path to an HTML file.`,
    );
  }
  if (['ERR_CONNECTION_REFUSED', 'ERR_NAME_NOT_RESOLVED'].some((code) => message.includes(code))) {
    throw new UserError(`Nothing is running at ${hostLabel(url)} - start your dev server first, maybe \`npm run dev\`?`);
  }
  throw error;
}

export async function recordSession(url: string, options: SessionOptions = {}): Promise<RecordedSession> {
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const choice = await resolveBrowser(systemProbe);
  if (choice.kind === 'missing') {
    throw new UserError(
      "I couldn't find Chrome, Edge, or a bundled Chromium. Install Chrome, or run `npx playwright install chromium` (~150MB).",
    );
  }

  const browser = await chromium.launch({ ...launchOptionsFor(choice), headless: options.headless ?? false });
  const events: InteractionEvent[] = [];
  const startedAt = Date.now();
  // Page timestamps are performance.now()-relative to each document; rebase
  // everything onto session time so gaps across navigations stay meaningful.
  let pageEpoch = 0;

  let resolveStop!: () => void;
  const stopped = new Promise<void>((resolve) => { resolveStop = resolve; });
  const onSigint = () => resolveStop();

  try {
    const page = await browser.newPage();
    await page.setViewportSize(viewport);

    await page.exposeFunction('__flowreelEvent', (event: InteractionEvent) => {
      events.push({ ...event, at: pageEpoch + event.at });
    });
    await page.exposeFunction('__flowreelStop', () => resolveStop());
    await page.addInitScript(RECORDER_SOURCE);

    page.on('load', () => {
      // Runs for the first document and every navigation after it.
      void (async () => {
        try {
          pageEpoch = Date.now() - startedAt;
          const title = await page.title();
          events.push({ type: 'navigate', url: page.url(), title, at: pageEpoch });
        } catch {
          // Page closed mid-navigation; the session is ending anyway.
        }
      })();
    });

    browser.on('disconnected', () => resolveStop());
    process.once('SIGINT', onSigint);

    try {
      await page.goto(url, { waitUntil: 'load' });
    } catch (error) {
      translateNavigationError(error, url);
    }

    if (options.onReady) {
      await Promise.resolve(options.onReady(page)).catch(() => {
        // The hook closing the browser rejects the awaits inside it; that is a
        // valid way to stop and not an error.
      });
    }

    await stopped;

    // Flush any pending coalesced typing before we tear down.
    await page.evaluate(() => (window as never as { __flowreelRecorder?: { flush(): void } }).__flowreelRecorder?.flush()).catch(() => {});
    await page.waitForTimeout(50).catch(() => {});
  } finally {
    process.off('SIGINT', onSigint);
    await browser.close().catch(() => {});
  }

  const first = events[0]?.at ?? 0;
  const rebased = events
    .map((e) => ({ ...e, at: Math.max(0, Math.round(e.at - first)) }))
    .sort((a, b) => a.at - b.at);

  return { events: rebased, viewport };
}

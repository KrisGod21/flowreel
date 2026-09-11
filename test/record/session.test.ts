import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { recordSession } from '../../src/record/session.js';

const APP = pathToFileURL(resolve('demo/app.html')).href;

describe('recordSession', () => {
  it('captures a navigation, a click and typing, then stops via the button', async () => {
    const session = await recordSession(APP, {
      headless: true,
      onReady: async (page) => {
        await page.click('#new-project');
        await page.fill('#project-name', 'Launch');
        await page.locator('[data-flowreel-stop]').click();
      },
    });

    expect(session.viewport).toEqual({ width: 1280, height: 800 });
    expect(session.events[0]).toMatchObject({ type: 'navigate', url: APP, title: 'Acme Analytics' });
    expect(session.events.some((e) => e.type === 'click' && e.target === 'New project')).toBe(true);
    expect(session.events.some((e) => e.type === 'input' && e.value === 'Launch')).toBe(true);
  }, 60_000);

  it('rebases timestamps so the first event is at 0 and later ones increase', async () => {
    const session = await recordSession(APP, {
      headless: true,
      onReady: async (page) => {
        await page.waitForTimeout(150);
        await page.click('#new-project');
        await page.locator('[data-flowreel-stop]').click();
      },
    });
    const ats = session.events.map((e) => e.at);
    expect(ats[0]).toBe(0);
    for (let i = 1; i < ats.length; i++) expect(ats[i]).toBeGreaterThanOrEqual(ats[i - 1]!);
  }, 60_000);

  it('stops when the browser is closed', async () => {
    const session = await recordSession(APP, {
      headless: true,
      onReady: async (page) => { await page.context().browser()!.close(); },
    });
    expect(session.events[0]?.type).toBe('navigate');
  }, 60_000);

  it('turns a dead dev server into a plain-language error', async () => {
    await expect(recordSession('http://localhost:59999/', { headless: true })).rejects.toThrow(/Nothing is running at localhost:59999/);
  }, 60_000);

  it('drops an event with an unknown type instead of letting the page abort the recording', async () => {
    const session = await recordSession(APP, {
      headless: true,
      onReady: async (page) => {
        await page.evaluate(() => {
          (window as never as { __flowreelEvent(e: unknown): void }).__flowreelEvent({ type: 'bogus' });
        });
        await page.click('#new-project');
        await page.locator('[data-flowreel-stop]').click();
      },
    });

    expect(session.events.some((e) => (e as { type: string }).type === 'bogus')).toBe(false);
    // The rest of the session must be unaffected by the hostile call.
    expect(session.events.some((e) => e.type === 'click' && e.target === 'New project')).toBe(true);
  }, 60_000);

  it('drops a well-typed event that is missing its required fields', async () => {
    const session = await recordSession(APP, {
      headless: true,
      onReady: async (page) => {
        await page.evaluate(() => {
          // A "click" with no target/label/box - the page could send this
          // itself, since __flowreelEvent is a page-visible global.
          (window as never as { __flowreelEvent(e: unknown): void }).__flowreelEvent({ type: 'click' });
        });
        await page.locator('[data-flowreel-stop]').click();
      },
    });

    expect(session.events.filter((e) => e.type === 'click')).toHaveLength(0);
  }, 60_000);

  it('warns exactly once on stderr when a new tab opens, and keeps recording the original tab', async () => {
    const originalWrite = process.stderr.write.bind(process.stderr);
    const written: string[] = [];
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const session = await recordSession(APP, {
        headless: true,
        onReady: async (page) => {
          await page.evaluate(() => { window.open('about:blank'); });
          await page.evaluate(() => { window.open('about:blank'); });
          await page.click('#new-project');
          await page.locator('[data-flowreel-stop]').click();
        },
      });

      expect(session.events.some((e) => e.type === 'click' && e.target === 'New project')).toBe(true);
      const warnings = written.filter((w) => w.includes('A new tab opened'));
      expect(warnings).toHaveLength(1);
    } finally {
      process.stderr.write = originalWrite;
    }
  }, 60_000);
});

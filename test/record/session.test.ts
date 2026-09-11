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
});

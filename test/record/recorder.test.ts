import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { RECORDER_SOURCE } from '../../src/record/recorder-browser.js';
import type { InteractionEvent } from '../../src/record/events.js';

const APP = pathToFileURL(resolve('demo/app.html')).href;

let browser: Browser;
let page: Page;
let events: InteractionEvent[];

beforeAll(async () => {
  const choice = await resolveBrowser(systemProbe);
  browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
});

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  events = [];
  page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.exposeFunction('__flowreelEvent', (e: InteractionEvent) => events.push(e));
  await page.addInitScript(RECORDER_SOURCE);
  await page.goto(APP);
});

const describeEl = (selector: string) =>
  page.evaluate(
    (s) => (window as never as { __flowreelRecorder: { describe(el: Element): { target: string; label: string } } })
      .__flowreelRecorder.describe(document.querySelector(s)!),
    selector,
  );

describe('selector generation', () => {
  it('prefers visible text for a button', async () => {
    expect(await describeEl('#new-project')).toEqual({ target: 'New project', label: 'New project' });
  });

  it('prefers visible text for a link', async () => {
    expect((await describeEl('nav a.active')).target).toBe('Overview');
  });

  it('uses the id for an input', async () => {
    expect((await describeEl('#search')).target).toBe('#search');
  });

  it('falls back to a CSS path for an unlabeled element', async () => {
    const d = await describeEl('.chart b');
    expect(d.target.length).toBeGreaterThan(0);
    // Whatever it produced must resolve back to exactly one element.
    expect(await page.locator(d.target).count()).toBe(1);
  });
});

describe('capture', () => {
  it('records a click with its label and box', async () => {
    await page.click('#new-project');
    const click = events.find((e) => e.type === 'click');
    expect(click).toMatchObject({ type: 'click', target: 'New project', label: 'New project' });
    expect((click as { box: { width: number } }).box.width).toBeGreaterThan(0);
  });

  it('coalesces typing into one input event with the final value', async () => {
    await page.click('#search');
    await page.keyboard.type('launch');
    await page.click('h1'); // blur
    const inputs = events.filter((e) => e.type === 'input');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ type: 'input', target: '#search', value: 'launch' });
  });

  it('records Enter and Escape as press events, not typing', async () => {
    await page.click('#search');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const presses = events.filter((e) => e.type === 'press').map((e) => (e as { key: string }).key);
    expect(presses).toEqual(['Enter', 'Escape']);
  });

  it('records a scroll with its delta', async () => {
    await page.evaluate(() => { document.body.style.height = '4000px'; });
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(400);
    const scroll = events.find((e) => e.type === 'scroll');
    expect(scroll).toBeDefined();
    expect((scroll as { deltaY: number }).deltaY).toBeGreaterThan(0);
  });

  it('timestamps every event', async () => {
    await page.click('#new-project');
    for (const e of events) expect(typeof e.at).toBe('number');
  });
});

describe('stop button', () => {
  it('is present, clickable, and calls __flowreelStop', async () => {
    let stopped = false;
    await page.exposeFunction('__flowreelStop', () => { stopped = true; });
    await page.reload();

    const host = page.locator('[data-flowreel-stop]');
    expect(await host.count()).toBe(1);
    await host.click();
    expect(stopped).toBe(true);
  });

  it('does not record its own click', async () => {
    await page.exposeFunction('__flowreelStop', () => {});
    await page.reload();
    await page.locator('[data-flowreel-stop]').click();
    expect(events.filter((e) => e.type === 'click')).toHaveLength(0);
  });

  it('does not steal clicks from the app', async () => {
    await page.click('#new-project');
    await expect(page.locator('#modal')).toBeVisible();
  });
});

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

  // demo/app.html already has an <h1>Overview</h1>, so the nav link's own text
  // is not actually unique on the page - it only used to "work" because the
  // nav happens to come before the h1 in DOM order, which is exactly the kind
  // of luck a text-first selector must not depend on.
  it('falls back to a unique selector for a link whose text collides elsewhere on the page', async () => {
    const d = await describeEl('nav a.active');
    expect(d.label).toBe('Overview');
    expect(d.target).not.toBe('Overview');
    expect(await page.locator(d.target).count()).toBe(1);
  });

  it('never emits bare text that is ambiguous, even when the duplicate sorts first in the DOM', async () => {
    // Insert a second "Overview" *before* the nav, inverting DOM order versus
    // the pre-existing <h1>Overview</h1>. A uniqueness check that mirrors the
    // resolver must reject the bare text regardless of which duplicate is
    // first - a naive "first match wins" approach would have been fooled by
    // whichever ordering happened to place the real target first.
    await page.evaluate(() => {
      const dup = document.createElement('a');
      dup.href = '#';
      dup.textContent = 'Overview';
      document.body.insertBefore(dup, document.body.firstChild);
    });

    const navLink = await describeEl('nav a.active');
    expect(navLink.target).not.toBe('Overview');
    expect(await page.locator(navLink.target).count()).toBe(1);

    // A button whose label doesn't collide with anything is unaffected.
    expect(await describeEl('#new-project')).toEqual({ target: 'New project', label: 'New project' });
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

  it('records the whole clickable ancestor box, not a clicked child element (e.g. inside <summary>)', async () => {
    await page.evaluate(() => {
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      summary.id = 'test-summary';
      summary.style.cssText = 'display:block;padding:24px;width:200px;';
      const icon = document.createElement('span');
      icon.id = 'test-summary-icon';
      icon.textContent = '▶';
      icon.style.cssText = 'display:inline-block;width:8px;height:8px;';
      summary.appendChild(icon);
      details.appendChild(summary);
      document.body.appendChild(details);
    });

    const summaryBox = await page.locator('#test-summary').boundingBox();
    await page.click('#test-summary-icon');

    const click = events.find((e) => e.type === 'click');
    expect(click).toBeDefined();
    const box = (click as { box: { width: number; height: number } }).box;
    expect(Math.round(box.width)).toBe(Math.round(summaryBox!.width));
    expect(Math.round(box.height)).toBe(Math.round(summaryBox!.height));
  });
});

describe('injection guard', () => {
  it('does not double-mount the stop button or double-record a click when injected twice into the same document', async () => {
    // page.reload() creates a fresh window, so the top-of-file guard is never
    // exercised that way. Injecting a second copy of RECORDER_SOURCE into the
    // *same* document is the actual case the guard exists for.
    await page.addScriptTag({ content: RECORDER_SOURCE });

    expect(await page.locator('[data-flowreel-stop]').count()).toBe(1);

    await page.click('#new-project');
    expect(events.filter((e) => e.type === 'click')).toHaveLength(1);
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
    // A real assertion, not just "the app still works": the host itself must
    // stay small enough that it cannot blanket the page and intercept clicks
    // meant for the app underneath it.
    const box = await page.locator('[data-flowreel-stop]').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThan(240);
    expect(box!.height).toBeLessThan(60);

    await page.click('#new-project');
    await expect(page.locator('#modal')).toBeVisible();
  });
});

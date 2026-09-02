# flowreel Overlay Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `zoom`, `reset zoom`, `highlight` and `caption` from no-ops into real effects, and give every recording a synthetic cursor with click ripples and keystroke chips — so output looks designed rather than screen-recorded.

**Architecture:** One browser-side script is injected into every document via `page.addInitScript`, creating a **closed** shadow root that hosts all overlay elements. Node-side code drives it through a small typed API that calls `page.evaluate`. Nothing is composited per frame: the browser renders the overlay and the existing CDP screencast picks it up for free.

**Tech Stack:** Node 20+, TypeScript, ESM, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-flowreel-design.md` (see "The polish layer")

## Global Constraints

- Node 20+, TypeScript, ESM (`"type": "module"`), strict mode, `.js` import extensions (NodeNext).
- **All scratch stays on the `D:` drive.** Never `C:`, `os.tmpdir()`, or `/tmp`. Test scratch goes under `<repo>/.tmp`.
- **Commits authored as `Krishna <krishnar.sharmanew@gmail.com>` with NO `Co-Authored-By` trailer of any kind.**
- Exit codes: `0` success, `1` user-fixable error (throw `UserError` from `src/errors.ts`), `2` internal error.
- **Errors must state the fix in plain language, never a stack trace.**
- No telemetry, no network beyond the user's own localhost. ffmpeg is the only subprocess.
- **The overlay must never be findable by `resolveTarget`.** A `caption "Sign in"` must not make `click "Sign in"` match the caption.
- **The overlay must never receive real input.** The host is `pointer-events: none`; real clicks pass through to the app.
- **Framing is out of scope.** Browser chrome, rounded corners, shadow and backdrop composite in the encoder in a later plan. Do not add them here.

---

## Key design decisions

**Closed shadow root, not open.** Playwright's `getByText`/`getByRole` pierce *open* shadow roots, which would make caption text a click target and pollute `visibleButtonNames`. A closed root is invisible to `document.querySelector` and to every Playwright locator, which gives the isolation guarantee by construction rather than by filtering.

**A global handle for testability.** Because a closed root cannot be reached from `page.evaluate` either, the injected script stores `window.__flowreelOverlay = { root, api }`. Tests read overlay state through that handle; Playwright locators still cannot see it. This is the only way to have both isolation and testable assertions.

**`addInitScript`, not one-time injection.** The overlay must survive `visit` and any in-page navigation. `addInitScript` re-runs on every document.

**Zoom transforms `document.documentElement`.** `transform: scale()` with a computed `transform-origin` is the only approach that reliably appears in a CDP screencast. It can displace `position: fixed` elements while active — an acceptable, documented tradeoff for a few seconds of a recording, and the effect fully reverts.

**Captions persist until replaced.** A caption stays until the next `caption` command or the end of the script; `caption ""` clears it. One rule, predictable, and the author controls timing with `wait`.

---

## File Structure

| path | responsibility |
|------|----------------|
| `src/overlay/browser.ts` | the injected browser-side source as a string constant; creates the closed root, elements, and the imperative API |
| `src/overlay/ease.ts` | easing + interpolation math (pure, unit-tested) |
| `src/overlay/api.ts` | Node-side `Overlay` class wrapping `page.evaluate` calls |
| `src/overlay/types.ts` | `OverlayHandle`, `Point`, shared types |
| `src/runtime/execute.ts` | *modify* — drive the overlay from commands |
| `src/run.ts` | *modify* — install the overlay before the screencast starts |
| `test/overlay/*.test.ts` | unit tests for pure code, integration tests against the fixture app |

---

## Task 1: Easing math

**Files:**
- Create: `src/overlay/ease.ts`
- Test: `test/overlay/ease.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `easeInOutCubic(t: number): number` and `lerp(a: number, b: number, t: number): number`. Task 2's injected script uses the same curve; keeping it here means the curve is unit-tested rather than only observed.

- [ ] **Step 1: Write the failing test**

Create `test/overlay/ease.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { easeInOutCubic, lerp } from '../../src/overlay/ease.js';

describe('easeInOutCubic', () => {
  it('is pinned at both ends', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it('passes through the midpoint', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 5);
  });

  it('starts slower than linear and ends faster', () => {
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
  });

  it('is monotonic across the range', () => {
    let previous = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const value = easeInOutCubic(i / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('clamps out-of-range input', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe('lerp', () => {
  it('returns the endpoints', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it('interpolates the middle', () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it('handles a descending range', () => {
    expect(lerp(20, 10, 0.5)).toBe(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/overlay/ease.test.ts`
Expected: FAIL — cannot resolve `ease.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/overlay/ease.ts`:

```ts
/** Standard ease-in-out cubic. Input is clamped to [0, 1]. */
export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/overlay/ease.test.ts && npx tsc --noEmit`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/overlay/ease.ts test/overlay/ease.test.ts
git commit -m "feat: easing math for synthetic cursor movement"
```

---

## Task 2: Overlay host — injection, isolation, survival

**Files:**
- Create: `src/overlay/types.ts`, `src/overlay/browser.ts`, `src/overlay/api.ts`
- Test: `test/overlay/host.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface Point { x: number; y: number }`
  - `const OVERLAY_SOURCE: string` — the browser-side script
  - `class Overlay { static install(page: Page): Promise<Overlay>; isInstalled(): Promise<boolean> }`

  Tasks 3 and 4 add methods to `Overlay`. Task 5 drives it from the runtime, and Task 6 installs it from `run.ts`.

This task establishes the three guarantees everything else depends on: the overlay is invisible to Playwright locators, it never receives input, and it survives navigation.

- [ ] **Step 1: Write the failing test**

Create `test/overlay/host.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { Overlay } from '../../src/overlay/api.js';
import { resolveTarget, TargetNotFoundError } from '../../src/runtime/targets.js';

const FIXTURE = pathToFileURL(resolve('test/fixtures/app/index.html')).href;

let browser: Browser;
let page: Page;
let overlay: Overlay;

beforeAll(async () => {
  const choice = await resolveBrowser(systemProbe);
  browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
  page = await browser.newPage();
  overlay = await Overlay.install(page);
  await page.goto(FIXTURE);
});

afterAll(async () => {
  await browser?.close();
});

describe('Overlay host', () => {
  it('installs into the page', async () => {
    expect(await overlay.isInstalled()).toBe(true);
  });

  it('survives a navigation', async () => {
    await page.goto(FIXTURE);
    expect(await overlay.isInstalled()).toBe(true);
  });

  it('is invisible to document.querySelector', async () => {
    const found = await page.evaluate(() => document.querySelector('.fr-cursor') !== null);
    expect(found).toBe(false);
  });

  it('does not let overlay text become a click target', async () => {
    await overlay.caption('Sign in');
    // The caption now reads "Sign in", the same text as the real button.
    // resolveTarget must still find the real button, not the caption.
    const locator = await resolveTarget(page, 'Sign in');
    expect(await locator.getAttribute('id')).toBe('signin');
    await overlay.caption('');
  });

  it('does not appear among the visible buttons in a not-found error', async () => {
    await overlay.caption('Log out');
    let message = '';
    try {
      await resolveTarget(page, 'Nonexistent Thing', 500);
    } catch (error) {
      if (error instanceof TargetNotFoundError) message = error.message;
    }
    expect(message).not.toContain('Log out');
    await overlay.caption('');
  });

  it('does not intercept real clicks', async () => {
    await page.goto(FIXTURE);
    await page.locator('#signin').click();
    await expect(page.locator('#dashboard')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/overlay/host.test.ts`
Expected: FAIL — cannot resolve `api.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/overlay/types.ts`:

```ts
export interface Point {
  x: number;
  y: number;
}
```

Create `src/overlay/browser.ts`:

```ts
// This string is injected into every document via page.addInitScript. It must be
// self-contained: no imports, no TypeScript, no reliance on anything in the app.
//
// The root is a CLOSED shadow root on purpose. Playwright's locators pierce open
// shadow roots, which would make caption text a click target and pollute the
// "visible buttons" list in a not-found error. A closed root is unreachable from
// document.querySelector and from every locator, so the isolation is structural
// rather than something callers must remember to filter for.
//
// Because a closed root is also unreachable from page.evaluate, the handle is
// published on window.__flowreelOverlay. That is how the Node side drives it and
// how tests inspect it.
export const OVERLAY_SOURCE = `
(() => {
  if (window.__flowreelOverlay) return;

  const install = () => {
    if (!document.documentElement || window.__flowreelOverlay) return;

    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:2147483647',
      'contain:layout style size',
    ].join(';');

    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = \`
      <style>
        :host { all: initial; }
        .fr-cursor {
          position: fixed; top: 0; left: 0; width: 22px; height: 22px;
          margin: -2px 0 0 -2px; opacity: 0; transition: opacity 160ms ease;
          will-change: transform;
        }
        .fr-cursor svg { display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
        .fr-ripple {
          position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px;
          border-radius: 50%; border: 2px solid rgba(56,132,255,.9);
          background: rgba(56,132,255,.18); opacity: 0; transform: scale(1);
        }
        .fr-chip {
          position: fixed; transform: translate(-50%, -140%);
          font: 600 13px/1.4 ui-sans-serif, system-ui, sans-serif;
          color: #fff; background: rgba(20,22,28,.92); padding: 4px 9px;
          border-radius: 7px; white-space: pre; opacity: 0;
        }
        .fr-caption {
          position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%);
          max-width: 78%; text-align: center;
          font: 600 17px/1.45 ui-sans-serif, system-ui, sans-serif;
          color: #fff; background: rgba(16,18,24,.88); padding: 10px 18px;
          border-radius: 11px; opacity: 0; transition: opacity 220ms ease;
        }
        .fr-highlight {
          position: fixed; border-radius: 8px; opacity: 0;
          box-shadow: 0 0 0 3px rgba(56,132,255,.95), 0 0 0 9999px rgba(6,8,12,.42);
          transition: opacity 220ms ease;
        }
      </style>
      <div class="fr-highlight"></div>
      <div class="fr-caption"></div>
      <div class="fr-cursor">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M4 2 L4 17 L8.2 13.2 L10.8 19 L13.6 17.8 L11 12.2 L16.4 12.2 Z"
                fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/>
        </svg>
      </div>
    \`;

    document.documentElement.appendChild(host);

    const el = (selector) => root.querySelector(selector);
    const cursor = el('.fr-cursor');
    const caption = el('.fr-caption');
    const highlight = el('.fr-highlight');
    const state = { x: 0, y: 0 };

    const api = {
      cursorAt: () => ({ x: state.x, y: state.y }),

      showCursor(show) {
        cursor.style.opacity = show ? '1' : '0';
      },

      placeCursor(x, y) {
        state.x = x; state.y = y;
        cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      },

      captionText: () => caption.textContent || '',

      setCaption(text) {
        caption.textContent = text;
        caption.style.opacity = text ? '1' : '0';
      },

      highlightRect: (rect) => {
        if (!rect) { highlight.style.opacity = '0'; return; }
        highlight.style.left = rect.x + 'px';
        highlight.style.top = rect.y + 'px';
        highlight.style.width = rect.width + 'px';
        highlight.style.height = rect.height + 'px';
        highlight.style.opacity = '1';
      },

      ripple(x, y, ms) {
        const node = document.createElement('div');
        node.className = 'fr-ripple';
        node.style.left = x + 'px';
        node.style.top = y + 'px';
        root.appendChild(node);
        node.animate(
          [
            { opacity: 0.95, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(3.6)' },
          ],
          { duration: ms, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'forwards' },
        ).finished.catch(() => {}).then(() => node.remove());
      },

      chip(text, x, y, ms) {
        const node = document.createElement('div');
        node.className = 'fr-chip';
        node.textContent = text;
        node.style.left = x + 'px';
        node.style.top = y + 'px';
        root.appendChild(node);
        node.animate(
          [
            { opacity: 0, transform: 'translate(-50%,-120%)' },
            { opacity: 1, transform: 'translate(-50%,-150%)', offset: 0.25 },
            { opacity: 1, transform: 'translate(-50%,-150%)', offset: 0.7 },
            { opacity: 0, transform: 'translate(-50%,-185%)' },
          ],
          { duration: ms, easing: 'ease-out', fill: 'forwards' },
        ).finished.catch(() => {}).then(() => node.remove());
      },

      setZoom(scale, originX, originY, ms) {
        const doc = document.documentElement;
        doc.style.transition = 'transform ' + ms + 'ms cubic-bezier(.45,.05,.2,1)';
        doc.style.transformOrigin = originX + 'px ' + originY + 'px';
        doc.style.transform = scale === 1 ? '' : 'scale(' + scale + ')';
      },
    };

    window.__flowreelOverlay = { root, api };
  };

  if (document.documentElement) install();
  else document.addEventListener('DOMContentLoaded', install, { once: true });
})();
`;
```

Create `src/overlay/api.ts`:

```ts
import type { Page } from 'playwright';
import { OVERLAY_SOURCE } from './browser.js';

export class Overlay {
  private constructor(private readonly page: Page) {}

  /**
   * Installs the overlay into this page and every document it navigates to.
   * Must be called before the first `visit`, and before the screencast starts.
   */
  static async install(page: Page): Promise<Overlay> {
    await page.addInitScript(OVERLAY_SOURCE);
    // addInitScript only affects documents created after it is registered, so
    // run it once by hand for the document already loaded.
    await page.evaluate(OVERLAY_SOURCE).catch(() => {
      // A page still on about:blank can reject; the init script covers it next.
    });
    return new Overlay(page);
  }

  async isInstalled(): Promise<boolean> {
    return this.page.evaluate(() => Boolean((window as never as OverlayWindow).__flowreelOverlay));
  }

  async caption(text: string): Promise<void> {
    await this.page.evaluate(
      (value) => (window as never as OverlayWindow).__flowreelOverlay?.api.setCaption(value),
      text,
    );
  }
}

interface OverlayWindow {
  __flowreelOverlay?: {
    root: ShadowRoot;
    api: {
      cursorAt(): { x: number; y: number };
      showCursor(show: boolean): void;
      placeCursor(x: number, y: number): void;
      captionText(): string;
      setCaption(text: string): void;
      highlightRect(rect: { x: number; y: number; width: number; height: number } | null): void;
      ripple(x: number, y: number, ms: number): void;
      chip(text: string, x: number, y: number, ms: number): void;
      setZoom(scale: number, originX: number, originY: number, ms: number): void;
    };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/overlay/host.test.ts && npx tsc --noEmit`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/overlay/types.ts src/overlay/browser.ts src/overlay/api.ts test/overlay/host.test.ts
git commit -m "feat: injected overlay host, isolated in a closed shadow root"
```

---

## Task 3: Synthetic cursor movement

**Files:**
- Modify: `src/overlay/api.ts`
- Test: `test/overlay/cursor.test.ts`

**Interfaces:**
- Consumes: `easeInOutCubic`, `lerp` (Task 1); `Overlay` (Task 2).
- Produces: `Overlay.showCursor(show: boolean)`, `Overlay.cursorPosition(): Promise<Point>`, `Overlay.moveTo(point: Point, durationMs?: number): Promise<void>`.

Movement is stepped from Node rather than handed to a CSS transition, because the screencast captures whatever the compositor paints and a stepped animation guarantees intermediate frames exist rather than relying on transition interpolation timing.

- [ ] **Step 1: Write the failing test**

Create `test/overlay/cursor.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { Overlay } from '../../src/overlay/api.js';

const FIXTURE = pathToFileURL(resolve('test/fixtures/app/index.html')).href;

let browser: Browser;
let page: Page;
let overlay: Overlay;

beforeAll(async () => {
  const choice = await resolveBrowser(systemProbe);
  browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
  page = await browser.newPage();
  await page.setViewportSize({ width: 800, height: 600 });
  overlay = await Overlay.install(page);
  await page.goto(FIXTURE);
});

afterAll(async () => {
  await browser?.close();
});

describe('cursor', () => {
  it('starts hidden and can be shown', async () => {
    await overlay.showCursor(true);
    const opacity = await page.evaluate(
      () => (window as never as { __flowreelOverlay: { root: ShadowRoot } })
        .__flowreelOverlay.root.querySelector('.fr-cursor')!.getAttribute('style'),
    );
    expect(opacity).toContain('opacity: 1');
  });

  it('lands exactly on the requested point', async () => {
    await overlay.moveTo({ x: 400, y: 300 }, 120);
    expect(await overlay.cursorPosition()).toEqual({ x: 400, y: 300 });
  });

  it('passes through intermediate positions rather than teleporting', async () => {
    await overlay.moveTo({ x: 0, y: 0 }, 0);

    const seen: number[] = [];
    const sampler = setInterval(() => {
      void overlay.cursorPosition().then((p) => seen.push(p.x)).catch(() => {});
    }, 15);

    await overlay.moveTo({ x: 600, y: 400 }, 400);
    clearInterval(sampler);

    const intermediate = seen.filter((x) => x > 0 && x < 600);
    expect(intermediate.length).toBeGreaterThan(0);
  });

  it('takes roughly the requested duration', async () => {
    await overlay.moveTo({ x: 10, y: 10 }, 0);
    const started = Date.now();
    await overlay.moveTo({ x: 500, y: 400 }, 300);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(1500);
  });

  it('moves instantly when the duration is zero', async () => {
    await overlay.moveTo({ x: 123, y: 45 }, 0);
    expect(await overlay.cursorPosition()).toEqual({ x: 123, y: 45 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/overlay/cursor.test.ts`
Expected: FAIL — `overlay.moveTo is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/overlay/api.ts` (inside the `Overlay` class), and import the easing helpers at the top:

```ts
import { easeInOutCubic, lerp } from './ease.js';
import type { Point } from './types.js';
```

```ts
  private static readonly FRAME_MS = 16;

  async showCursor(show: boolean): Promise<void> {
    await this.page.evaluate(
      (value) => (window as never as OverlayWindow).__flowreelOverlay?.api.showCursor(value),
      show,
    );
  }

  async cursorPosition(): Promise<Point> {
    return this.page.evaluate(
      () =>
        (window as never as OverlayWindow).__flowreelOverlay?.api.cursorAt() ?? { x: 0, y: 0 },
    );
  }

  private async placeCursor(point: Point): Promise<void> {
    await this.page.evaluate(
      (p: Point) => (window as never as OverlayWindow).__flowreelOverlay?.api.placeCursor(p.x, p.y),
      point,
    );
  }

  /**
   * Glides the cursor to `point` on an eased path. Stepped from Node so the
   * compositor paints genuine intermediate frames for the screencast to capture;
   * a CSS transition would leave frame timing to chance.
   */
  async moveTo(point: Point, durationMs = 420): Promise<void> {
    if (durationMs <= 0) {
      await this.placeCursor(point);
      return;
    }

    const from = await this.cursorPosition();
    const steps = Math.max(1, Math.round(durationMs / Overlay.FRAME_MS));

    for (let step = 1; step <= steps; step++) {
      const eased = easeInOutCubic(step / steps);
      await this.placeCursor({
        x: Math.round(lerp(from.x, point.x, eased)),
        y: Math.round(lerp(from.y, point.y, eased)),
      });
      if (step < steps) await this.page.waitForTimeout(Overlay.FRAME_MS);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/overlay/cursor.test.ts && npx tsc --noEmit`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/overlay/api.ts test/overlay/cursor.test.ts
git commit -m "feat: synthetic cursor that glides on an eased path"
```

---

## Task 4: Click ripples, keystroke chips, highlight, zoom

**Files:**
- Modify: `src/overlay/api.ts`
- Test: `test/overlay/effects.test.ts`

**Interfaces:**
- Consumes: `Overlay` (Tasks 2-3).
- Produces: `Overlay.ripple(point, ms?)`, `Overlay.chip(text, point, ms?)`, `Overlay.highlight(rect | null)`, `Overlay.zoom(scale, origin, ms?)`, `Overlay.resetZoom(ms?)`.

- [ ] **Step 1: Write the failing test**

Create `test/overlay/effects.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { Overlay } from '../../src/overlay/api.js';

const FIXTURE = pathToFileURL(resolve('test/fixtures/app/index.html')).href;

let browser: Browser;
let page: Page;
let overlay: Overlay;

const count = (selector: string) =>
  page.evaluate(
    (s) =>
      (window as never as { __flowreelOverlay: { root: ShadowRoot } })
        .__flowreelOverlay.root.querySelectorAll(s).length,
    selector,
  );

beforeAll(async () => {
  const choice = await resolveBrowser(systemProbe);
  browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
  page = await browser.newPage();
  await page.setViewportSize({ width: 800, height: 600 });
  overlay = await Overlay.install(page);
  await page.goto(FIXTURE);
});

afterAll(async () => {
  await browser?.close();
});

describe('ripple', () => {
  it('appears and then cleans itself up', async () => {
    await overlay.ripple({ x: 200, y: 200 }, 150);
    expect(await count('.fr-ripple')).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(await count('.fr-ripple')).toBe(0);
  });
});

describe('chip', () => {
  it('shows the typed text and then cleans itself up', async () => {
    await overlay.chip('demo@example.com', { x: 300, y: 200 }, 150);
    const text = await page.evaluate(
      () =>
        (window as never as { __flowreelOverlay: { root: ShadowRoot } })
          .__flowreelOverlay.root.querySelector('.fr-chip')?.textContent ?? '',
    );
    expect(text).toBe('demo@example.com');
    await page.waitForTimeout(500);
    expect(await count('.fr-chip')).toBe(0);
  });
});

describe('caption', () => {
  it('shows text and clears on empty string', async () => {
    await overlay.caption('One command, zero setup');
    expect(await overlay.captionText()).toBe('One command, zero setup');
    await overlay.caption('');
    expect(await overlay.captionText()).toBe('');
  });

  it('replaces the previous caption rather than stacking', async () => {
    await overlay.caption('first');
    await overlay.caption('second');
    expect(await overlay.captionText()).toBe('second');
    expect(await count('.fr-caption')).toBe(1);
    await overlay.caption('');
  });
});

describe('highlight', () => {
  it('positions over the given rect and clears on null', async () => {
    await overlay.highlight({ x: 40, y: 60, width: 120, height: 30 });
    const style = await page.evaluate(
      () =>
        (window as never as { __flowreelOverlay: { root: ShadowRoot } })
          .__flowreelOverlay.root.querySelector('.fr-highlight')!.getAttribute('style') ?? '',
    );
    expect(style).toContain('left: 40px');
    expect(style).toContain('width: 120px');
    expect(style).toContain('opacity: 1');

    await overlay.highlight(null);
    const cleared = await page.evaluate(
      () =>
        (window as never as { __flowreelOverlay: { root: ShadowRoot } })
          .__flowreelOverlay.root.querySelector('.fr-highlight')!.getAttribute('style') ?? '',
    );
    expect(cleared).toContain('opacity: 0');
  });
});

describe('zoom', () => {
  it('applies a scale transform and fully reverts', async () => {
    await overlay.zoom(1.6, { x: 400, y: 300 }, 50);
    await page.waitForTimeout(200);
    const zoomed = await page.evaluate(() => document.documentElement.style.transform);
    expect(zoomed).toContain('scale(1.6)');

    await overlay.resetZoom(50);
    await page.waitForTimeout(200);
    const reset = await page.evaluate(() => document.documentElement.style.transform);
    expect(reset).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/overlay/effects.test.ts`
Expected: FAIL — `overlay.ripple is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/overlay/api.ts`:

```ts
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

```ts
  async captionText(): Promise<string> {
    return this.page.evaluate(
      () => (window as never as OverlayWindow).__flowreelOverlay?.api.captionText() ?? '',
    );
  }

  async ripple(point: Point, ms = 480): Promise<void> {
    await this.page.evaluate(
      (args: { p: Point; ms: number }) =>
        (window as never as OverlayWindow).__flowreelOverlay?.api.ripple(args.p.x, args.p.y, args.ms),
      { p: point, ms },
    );
  }

  async chip(text: string, point: Point, ms = 700): Promise<void> {
    await this.page.evaluate(
      (args: { text: string; p: Point; ms: number }) =>
        (window as never as OverlayWindow).__flowreelOverlay?.api.chip(
          args.text,
          args.p.x,
          args.p.y,
          args.ms,
        ),
      { text, p: point, ms },
    );
  }

  async highlight(rect: Rect | null): Promise<void> {
    await this.page.evaluate(
      (value: Rect | null) =>
        (window as never as OverlayWindow).__flowreelOverlay?.api.highlightRect(value),
      rect,
    );
  }

  async zoom(scale: number, origin: Point, ms = 520): Promise<void> {
    await this.page.evaluate(
      (args: { scale: number; o: Point; ms: number }) =>
        (window as never as OverlayWindow).__flowreelOverlay?.api.setZoom(
          args.scale,
          args.o.x,
          args.o.y,
          args.ms,
        ),
      { scale, o: origin, ms },
    );
  }

  async resetZoom(ms = 420): Promise<void> {
    await this.zoom(1, { x: 0, y: 0 }, ms);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/overlay/effects.test.ts && npx tsc --noEmit`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/overlay/api.ts test/overlay/effects.test.ts
git commit -m "feat: ripples, keystroke chips, highlight and zoom"
```

---

## Task 5: Drive the overlay from the runtime

**Files:**
- Modify: `src/runtime/execute.ts`
- Test: `test/overlay/commands.test.ts`

**Interfaces:**
- Consumes: `Overlay` (Tasks 2-4), `resolveTarget` (existing).
- Produces: `executeScript(page, script, overlay?)` — the third parameter is optional so every existing caller and test keeps working unchanged.

The four no-op cases become real. `click`, `type`, `hover` and `press` gain cursor movement and feedback. **Every overlay call must be optional**: when no overlay is passed the behaviour is exactly what it is today.

- [ ] **Step 1: Write the failing test**

Create `test/overlay/commands.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { Overlay } from '../../src/overlay/api.js';
import { executeScript } from '../../src/runtime/execute.js';
import { parse } from '../../src/parser/parse.js';

const FIXTURE = pathToFileURL(resolve('test/fixtures/app/index.html')).href;

let browser: Browser;
let page: Page;
let overlay: Overlay;

beforeAll(async () => {
  const choice = await resolveBrowser(systemProbe);
  browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
  page = await browser.newPage();
  await page.setViewportSize({ width: 800, height: 600 });
  overlay = await Overlay.install(page);
});

afterAll(async () => {
  await browser?.close();
});

describe('overlay-driven commands', () => {
  it('moves the cursor onto the element it clicks', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\nclick "Sign in"`), overlay);

    const box = await page.locator('#signin').boundingBox();
    const cursor = await overlay.cursorPosition();
    expect(box).not.toBeNull();
    expect(cursor.x).toBeGreaterThanOrEqual(box!.x - 2);
    expect(cursor.x).toBeLessThanOrEqual(box!.x + box!.width + 2);
    expect(cursor.y).toBeGreaterThanOrEqual(box!.y - 2);
    expect(cursor.y).toBeLessThanOrEqual(box!.y + box!.height + 2);
  });

  it('renders a caption from the caption command', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\ncaption "Hello there"`), overlay);
    expect(await overlay.captionText()).toBe('Hello there');
  });

  it('applies and reverts zoom from zoom / reset zoom', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\nzoom "#signin"`), overlay);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.documentElement.style.transform)).toContain('scale(');

    await executeScript(page, parse('reset zoom'), overlay);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.documentElement.style.transform)).toBe('');
  });

  it('highlights the element named by highlight', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\nhighlight "#register"`), overlay);
    const style = await page.evaluate(
      () =>
        (window as never as { __flowreelOverlay: { root: ShadowRoot } })
          .__flowreelOverlay.root.querySelector('.fr-highlight')!.getAttribute('style') ?? '',
    );
    expect(style).toContain('opacity: 1');
  });

  it('still works with no overlay at all', async () => {
    await executeScript(page, parse(`visit ${FIXTURE}\nclick "Sign in"\ncaption "ignored"\nzoom "#signin"`));
    await expect(page.locator('#dashboard')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/overlay/commands.test.ts`
Expected: FAIL — `executeScript` takes two arguments; cursor never moves.

- [ ] **Step 3: Write minimal implementation**

In `src/runtime/execute.ts`, import the overlay type and thread it through:

```ts
// `Locator` is a new import here; `Page` is already imported in this file.
import type { Locator, Page } from 'playwright';
import type { Overlay } from '../overlay/api.js';
import type { Point } from '../overlay/types.js';

const CLICK_SETTLE_MS = 140;
const ZOOM_SCALE = 1.6;

async function centreOf(locator: Locator): Promise<Point | null> {
  const box = await locator.boundingBox();
  return box ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) } : null;
}
```

Change `runCommand(page, command)` to `runCommand(page, command, overlay?)` and update the relevant cases:

```ts
    case 'click': {
      const locator = await resolveTarget(page, command.target);
      const point = await centreOf(locator);
      if (overlay && point) {
        await overlay.showCursor(true);
        await overlay.moveTo(point);
        await overlay.ripple(point);
        await page.waitForTimeout(CLICK_SETTLE_MS);
      }
      await locator.click();
      return;
    }

    case 'type': {
      const locator = await resolveTarget(page, command.target);
      const point = await centreOf(locator);
      if (overlay && point) {
        await overlay.showCursor(true);
        await overlay.moveTo(point);
        await overlay.chip(command.text, point);
      }
      await locator.pressSequentially(command.text, { delay: TYPE_DELAY_MS });
      return;
    }

    case 'hover': {
      const locator = await resolveTarget(page, command.target);
      const point = await centreOf(locator);
      if (overlay && point) {
        await overlay.showCursor(true);
        await overlay.moveTo(point);
      }
      await locator.hover();
      return;
    }

    case 'press': {
      if (overlay) {
        const at = await overlay.cursorPosition();
        await overlay.chip(command.key, at);
      }
      await page.keyboard.press(command.key);
      return;
    }

    case 'zoom': {
      if (!overlay) return;
      const locator = await resolveTarget(page, command.target);
      const point = await centreOf(locator);
      if (point) await overlay.zoom(ZOOM_SCALE, point);
      return;
    }

    case 'resetZoom':
      if (overlay) await overlay.resetZoom();
      return;

    case 'highlight': {
      if (!overlay) return;
      const locator = await resolveTarget(page, command.target);
      const box = await locator.boundingBox();
      if (box) {
        await overlay.highlight({
          x: Math.round(box.x) - 4,
          y: Math.round(box.y) - 4,
          width: Math.round(box.width) + 8,
          height: Math.round(box.height) + 8,
        });
      }
      return;
    }

    case 'caption':
      if (overlay) await overlay.caption(command.text);
      return;
```

Then update the exported signature:

```ts
export async function executeScript(page: Page, script: Script, overlay?: Overlay): Promise<void> {
  for (const command of script.commands) {
    await runCommand(page, command, overlay);
  }
}
```

Delete the "The overlay layer lands in Plan 2" comment — it is no longer true.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/overlay/ test/runtime/ && npx tsc --noEmit`
Expected: PASS. The existing `test/runtime/execute.test.ts` must still pass untouched — it calls `executeScript` with two arguments.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/execute.ts test/overlay/commands.test.ts
git commit -m "feat: drive cursor, captions, zoom and highlight from script commands"
```

---

## Task 6: Wire the overlay into a real run, and prove it reaches the pixels

**Files:**
- Modify: `src/run.ts`, `examples/demo.reel`
- Test: `test/overlay/captured.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no signature change — `runScript` installs the overlay itself.

Wiring and proof are one task on purpose. Every test so far asserts DOM state; none proves the overlay is actually *in the captured frames*, which is the entire point. Splitting them would leave the wiring task with a test that cannot fail — exactly the class of gap that let a static-capture bug survive Plan 1.

Install order matters: the overlay must go in **before** the screencast starts, so the first captured frame already has it, and before any `visit`, so `addInitScript` covers every document.

- [ ] **Step 1: Write the failing test**

Create `test/overlay/captured.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { Overlay } from '../../src/overlay/api.js';
import { startScreencast } from '../../src/capture/screencast.js';
import { executeScript } from '../../src/runtime/execute.js';
import { parse } from '../../src/parser/parse.js';
import { runScript } from '../../src/run.js';

const FIXTURE = pathToFileURL(resolve('test/fixtures/app/index.html')).href;
// Scratch stays inside the repo so nothing is written off the D: drive.
const SCRATCH = resolve('.tmp/overlay-captured');
const SCRIPT = [`visit ${FIXTURE}`, 'caption "Overlay is visible"', 'wait 400'].join('\n');

let browser: Browser;

const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

async function captureLastFrame(withOverlay: boolean): Promise<string> {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 800, height: 600 });
  const overlay = withOverlay ? await Overlay.install(page) : undefined;
  const screencast = await startScreencast(page);
  await executeScript(page, parse(SCRIPT), overlay);
  const frames = (await screencast.stop()).frames;
  await page.close();
  expect(frames.length).toBeGreaterThan(0);
  return hash(frames[frames.length - 1]!.data);
}

beforeAll(async () => {
  await mkdir(SCRATCH, { recursive: true });
  const choice = await resolveBrowser(systemProbe);
  browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
});

afterAll(async () => {
  await browser?.close();
});

describe('the overlay reaches the captured pixels', () => {
  it('produces different frames with the overlay than without it', async () => {
    const withoutOverlay = await captureLastFrame(false);
    const withOverlay = await captureLastFrame(true);
    expect(withOverlay).not.toBe(withoutOverlay);
  }, 60_000);

  it('is installed by a real runScript call', async () => {
    // Proves the wiring in run.ts, not just the standalone API: this script only
    // exercises the overlay path if runScript installed one and passed it along.
    const outputs = await runScript(
      [
        `visit ${FIXTURE}`,
        'viewport 800x600',
        'caption "Recording with overlay"',
        'click "Sign in"',
        'wait 500',
        'output overlaid.gif',
      ].join('\n'),
      { cwd: SCRATCH },
    );

    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.bytes).toBeGreaterThan(0);
  }, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/overlay/captured.test.ts`
Expected: FAIL. Before the wiring exists, `runScript` never installs an overlay. Record the failing output.

- [ ] **Step 3: Write minimal implementation**

In `src/run.ts`, add the import:

```ts
import { Overlay } from './overlay/api.js';
```

and install it immediately before the screencast starts:

```ts
    const viewport = initialViewport(script);
    if (viewport) await page.setViewportSize(viewport);

    // Installed before the screencast so the first captured frame already has
    // the overlay, and before any visit so addInitScript covers every document.
    const overlay = await Overlay.install(page);

    const screencast = await startScreencast(page);
    await executeScript(page, script, overlay);
```

- [ ] **Step 4: Verify the test can actually fail, then pass**

First confirm the test discriminates: comment out `document.documentElement.appendChild(host);` in `src/overlay/browser.ts`, run `npx vitest run test/overlay/captured.test.ts`, and confirm the two frame hashes now MATCH so the first case fails. Restore the line. Put both outputs in the report — a test that cannot fail proves nothing, and this is the test the whole plan rests on.

Then run: `npx vitest run && npx tsc --noEmit`
Expected: whole suite green.

- [ ] **Step 5: Update the example and commit**

Replace `examples/demo.reel` with a version that shows the polish rather than only the mechanics:

```
# flowreel example — start your dev server, then: npx flowreel examples/demo.reel
visit http://localhost:3000
viewport 1280x800

# A caption stays on screen until the next one; "" clears it.
caption "Sign in with one click"

# The cursor glides to the button and leaves a ripple where it lands.
click "Sign in"
wait 800

# Zoom pulls the viewer's eye to one element, so small text stays legible
# once the recording is scaled down to README width.
zoom "#dashboard"
caption "Your dashboard, ready to go"
wait 1200
reset zoom

# Highlight rings the target and dims everything around it.
highlight "#new-project"
caption "Start a project"
wait 1000

caption ""
output demo
```

```bash
git add src/run.ts examples/demo.reel test/overlay/captured.test.ts
git commit -m "feat: install the overlay for every recording, proven in the captured frames"
```

---

## Done when

- `npx vitest run` is green and `npx tsc --noEmit` is clean.
- A recording of a real app shows a cursor gliding between targets, a ripple on click, a chip on typing, captions, highlight and zoom.
- `caption "Sign in"` does not make `click "Sign in"` match the caption.
- Real clicks still reach the app — the overlay never intercepts input.
- `executeScript(page, script)` with no overlay behaves exactly as before.
- Every commit authored `Krishna <krishnar.sharmanew@gmail.com>` with no co-author trailer.

## Deliberately deferred

- **Framing** — browser chrome, device frames, rounded corners, shadow, gradient backdrop. Composited in the encoder, its own plan.
- **`device <name>`** — the spec lists it beside `viewport`; it belongs with framing.
- **Auto-zoom** — the spec's "auto-zoom onto the active element" as an automatic behaviour. This plan implements explicit `zoom <target>`; making it automatic needs a heuristic for when zooming helps, which deserves its own decision.

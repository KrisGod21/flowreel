import type { Page } from 'playwright';
import { OVERLAY_SOURCE } from './browser.js';
import { easeInOutCubic, lerp } from './ease.js';
import type { Point } from './types.js';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Overlay {
  // Mirrors the state a fresh document's overlay does not have. addInitScript
  // re-runs OVERLAY_SOURCE for every new document, so a `visit` - or, far more
  // commonly, a `click` that navigates - builds a brand new overlay: caption
  // empty, cursor back at the origin, cursor hidden. These three fields are
  // updated on every call that changes them and re-applied on the page's
  // next 'load' event, so the caption and cursor survive navigation instead
  // of silently vanishing. Zoom is deliberately NOT restored here - it
  // belonged to the old document's layout, and reapplying it to a new one
  // would zoom into the wrong thing (or nothing).
  private lastCaption = '';
  private lastCursor: Point = { x: 0, y: 0 };
  private lastCursorVisible = false;

  private constructor(private readonly page: Page) {}

  /**
   * Installs the overlay into this page and every document it navigates to.
   * Must be called before the first `visit`, and before the screencast starts.
   */
  static async install(page: Page): Promise<Overlay> {
    await page.addInitScript(OVERLAY_SOURCE);
    // addInitScript only affects documents created after it is registered, so
    // run it once by hand for the document already loaded.
    await page.evaluate(OVERLAY_SOURCE).catch((error: unknown) => {
      // A page still on about:blank, or one navigating/closing right now, tears
      // down the execution context - observed messages are "Execution context
      // was destroyed, most likely because of a navigation." and "Target page,
      // context or browser has been closed." The init script covers those
      // documents anyway. Anything else (e.g. a syntax error introduced into
      // OVERLAY_SOURCE) must not be swallowed silently.
      const message = error instanceof Error ? error.message : String(error);
      const isContextTeardown =
        message.includes('Execution context was destroyed') ||
        message.includes('Target page, context or browser has been closed') ||
        message.includes('Target closed');
      if (!isContextTeardown) throw error;
    });
    const overlay = new Overlay(page);
    // 'load' fires after the init script has already installed the fresh
    // overlay for the new document, so this always has something to write
    // into. The handler must not throw: a `load` can fire while the page is
    // mid-teardown (closing, or navigating again immediately), and a rejected
    // handler here would otherwise surface as an unhandled rejection with no
    // useful stack pointing back at the script that caused it.
    page.on('load', () => {
      overlay.restoreAfterNavigation().catch(() => {});
    });
    return overlay;
  }

  private async restoreAfterNavigation(): Promise<void> {
    await this.page
      .evaluate(
        (state: { caption: string; cursor: Point; cursorVisible: boolean }) => {
          const overlay = (window as unknown as OverlayWindow).__flowreelOverlay;
          if (!overlay) return;
          overlay.api.setCaption(state.caption);
          overlay.api.placeCursor(state.cursor.x, state.cursor.y);
          overlay.api.showCursor(state.cursorVisible);
        },
        { caption: this.lastCaption, cursor: this.lastCursor, cursorVisible: this.lastCursorVisible },
      )
      .catch(() => {
        // The page navigated or closed again before this could run - there is
        // nothing to restore into, and a subsequent 'load' (if any) gets
        // another chance.
      });
  }

  async isInstalled(): Promise<boolean> {
    return this.page.evaluate(() => Boolean((window as unknown as OverlayWindow).__flowreelOverlay));
  }

  async caption(text: string): Promise<void> {
    this.lastCaption = text;
    await this.page.evaluate(
      (value) => (window as unknown as OverlayWindow).__flowreelOverlay?.api.setCaption(value),
      text,
    );
  }

  private static readonly FRAME_MS = 16;

  async showCursor(show: boolean): Promise<void> {
    this.lastCursorVisible = show;
    await this.page.evaluate(
      (value) => (window as unknown as OverlayWindow).__flowreelOverlay?.api.showCursor(value),
      show,
    );
  }

  async cursorPosition(): Promise<Point> {
    return this.page.evaluate(
      () =>
        (window as unknown as OverlayWindow).__flowreelOverlay?.api.cursorAt() ?? { x: 0, y: 0 },
    );
  }

  private async placeCursor(point: Point): Promise<void> {
    this.lastCursor = point;
    await this.page.evaluate(
      (p: Point) => (window as unknown as OverlayWindow).__flowreelOverlay?.api.placeCursor(p.x, p.y),
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
    const started = Date.now();

    // Progress is driven by elapsed time, not by a step counter, so the
    // per-step page.evaluate round-trip is absorbed into the requested
    // duration rather than added on top of it. On a slow machine this
    // renders fewer intermediate frames instead of running long, which is
    // the better failure for a recording.
    for (;;) {
      const elapsed = Date.now() - started;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = easeInOutCubic(progress);

      await this.placeCursor({
        x: Math.round(lerp(from.x, point.x, eased)),
        y: Math.round(lerp(from.y, point.y, eased)),
      });

      if (progress >= 1) return;
      await this.page.waitForTimeout(Overlay.FRAME_MS);
    }
  }

  async captionText(): Promise<string> {
    return this.page.evaluate(
      () => (window as unknown as OverlayWindow).__flowreelOverlay?.api.captionText() ?? '',
    );
  }

  async ripple(point: Point, ms = 480): Promise<void> {
    await this.page.evaluate(
      (args: { p: Point; ms: number }) =>
        (window as unknown as OverlayWindow).__flowreelOverlay?.api.ripple(args.p.x, args.p.y, args.ms),
      { p: point, ms },
    );
  }

  async chip(text: string, point: Point, ms = 700): Promise<void> {
    await this.page.evaluate(
      (args: { text: string; p: Point; ms: number }) =>
        (window as unknown as OverlayWindow).__flowreelOverlay?.api.chip(
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
        (window as unknown as OverlayWindow).__flowreelOverlay?.api.highlightRect(value),
      rect,
    );
  }

  async zoom(scale: number, origin: Point, ms = 520): Promise<void> {
    await this.page.evaluate(
      (args: { scale: number; o: Point; ms: number }) =>
        (window as unknown as OverlayWindow).__flowreelOverlay?.api.setZoom(
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
      highlightRect(rect: Rect | null): void;
      ripple(x: number, y: number, ms: number): void;
      chip(text: string, x: number, y: number, ms: number): void;
      setZoom(scale: number, originX: number, originY: number, ms: number): void;
    };
  };
}

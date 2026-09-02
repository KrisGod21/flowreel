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
    return new Overlay(page);
  }

  async isInstalled(): Promise<boolean> {
    return this.page.evaluate(() => Boolean((window as unknown as OverlayWindow).__flowreelOverlay));
  }

  async caption(text: string): Promise<void> {
    await this.page.evaluate(
      (value) => (window as unknown as OverlayWindow).__flowreelOverlay?.api.setCaption(value),
      text,
    );
  }

  private static readonly FRAME_MS = 16;

  async showCursor(show: boolean): Promise<void> {
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

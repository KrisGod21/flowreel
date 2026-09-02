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

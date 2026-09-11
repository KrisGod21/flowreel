import type { Page } from 'playwright';
import { UserError } from '../errors.js';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameBackground {
  from: string;
  to: string;
}

export interface FrameOptions {
  /** The output width this render targets - the preset's width, post-degrade. */
  width: number;
  /** The recording's captured size, used to keep the window's aspect ratio true. */
  captureWidth: number;
  captureHeight: number;
  background?: FrameBackground;
}

export interface FrameAssets {
  /** PNG bytes: gradient background plus the window's drop shadow. */
  backdrop: Buffer;
  /** PNG bytes: black canvas with a white rounded rect where the window sits. */
  mask: Buffer;
  /** Where the recording gets composited, in backdrop/mask pixel coordinates. */
  window: Rect;
  canvas: { width: number; height: number };
}

// Padding is a fraction of the target width on every side, so the window
// never fills the frame edge to edge - that is what makes the backdrop and
// shadow visible at all.
const PADDING_FRACTION = 0.08;

// Corner radius scales with output width; 14px was picked by eye at the
// default preset's 900px width.
const RADIUS_AT_900 = 14;
const RADIUS_REFERENCE_WIDTH = 900;

const DEFAULT_BACKGROUND: FrameBackground = { from: '#1b1f2a', to: '#0f1117' };

function frameDocument(opts: {
  canvasWidth: number;
  canvasHeight: number;
  window: Rect;
  radius: number;
  pageBackground: string;
  windowBackground: string;
  windowShadow: string;
}): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: ${opts.canvasWidth}px; height: ${opts.canvasHeight}px; overflow: hidden; }
  body { background: ${opts.pageBackground}; }
  .window {
    position: absolute;
    left: ${opts.window.x}px;
    top: ${opts.window.y}px;
    width: ${opts.window.width}px;
    height: ${opts.window.height}px;
    border-radius: ${opts.radius}px;
    background: ${opts.windowBackground};
    box-shadow: ${opts.windowShadow};
  }
</style></head>
<body><div class="window"></div></body></html>`;
}

/**
 * Renders the two still images the ffmpeg filter graph needs to frame a
 * recording: a backdrop (gradient plus the window's soft shadow) and a mask
 * (a white rounded rect on black, used as the composited video's alpha
 * channel). Uses `page` to render them - the browser we already have, rather
 * than hand-drawing anything in ffmpeg.
 */
export async function renderFrameAssets(page: Page, opts: FrameOptions): Promise<FrameAssets> {
  if (opts.captureWidth <= 0 || opts.captureHeight <= 0) {
    throw new UserError('Cannot frame a recording with no captured size. This is an internal error, not something a script can cause.');
  }

  const windowWidth = Math.max(1, Math.round(opts.width));
  const windowHeight = Math.max(1, Math.round((opts.width * opts.captureHeight) / opts.captureWidth));
  const padding = Math.max(1, Math.round(opts.width * PADDING_FRACTION));
  const radius = Math.max(1, Math.round((RADIUS_AT_900 / RADIUS_REFERENCE_WIDTH) * opts.width));

  const canvasWidth = windowWidth + padding * 2;
  const canvasHeight = windowHeight + padding * 2;
  const window: Rect = { x: padding, y: padding, width: windowWidth, height: windowHeight };
  const background = opts.background ?? DEFAULT_BACKGROUND;

  await page.setViewportSize({ width: canvasWidth, height: canvasHeight });

  await page.setContent(
    frameDocument({
      canvasWidth,
      canvasHeight,
      window,
      radius,
      pageBackground: `linear-gradient(135deg, ${background.from}, ${background.to})`,
      windowBackground: 'transparent',
      windowShadow: '0 30px 80px rgba(0, 0, 0, 0.55)',
    }),
    { waitUntil: 'load' },
  );
  const backdrop = await page.screenshot({ type: 'png' });

  await page.setContent(
    frameDocument({
      canvasWidth,
      canvasHeight,
      window,
      radius,
      pageBackground: '#000000',
      windowBackground: '#ffffff',
      windowShadow: 'none',
    }),
    { waitUntil: 'load' },
  );
  const mask = await page.screenshot({ type: 'png' });

  return { backdrop, mask, window, canvas: { width: canvasWidth, height: canvasHeight } };
}

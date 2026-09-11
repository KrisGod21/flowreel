import type { Locator, Page } from 'playwright';
import { UserError } from '../errors.js';

export class TargetNotFoundError extends UserError {
  constructor(target: string, visible: string[]) {
    const seen = visible.length > 0 ? visible.map((v) => `"${v}"`).join(', ') : 'nothing clickable';
    super(`Couldn't find "${target}" on the page. Visible buttons: ${seen}.`);
    this.name = 'TargetNotFoundError';
  }
}

// How long resolveTarget polls before giving up. Playwright's own actionability
// timeout is 30s; this is deliberately shorter because a missing target is
// usually a typo in the script, and a 30s stall before a "did you mean" message
// is a bad first run. `wait <target>` overrides it - see execute.ts.
const DEFAULT_RESOLVE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 100;

type VisibilityOptions = { checkOpacity: boolean; checkVisibilityCSS: boolean };
type Checkable = Element & { checkVisibility(options?: VisibilityOptions): boolean };

async function visibleButtonNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"], a'))
      .filter((el) =>
        // Without these options checkVisibility() only reports on `display: none`
        // and `content-visibility`, so a `visibility: hidden` or `opacity: 0`
        // element would be listed to the user as something they could click.
        'checkVisibility' in el
          ? (el as Checkable).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          : (el as HTMLElement).offsetParent !== null,
      )
      .map((el) => (el.textContent ?? '').trim())
      .filter((text) => text.length > 0)
      .slice(0, 8),
  );
}

// Routing every target through a `count()` precheck would strip away the
// auto-wait that Locator.click() normally provides, so this polls instead of
// sampling once. That matters because `visit` resolves on `load`, which fires
// before a Vite/Next/CRA dev server has mounted its app - the button the script
// clicks often does not exist yet at the instant the command runs.
export async function resolveTarget(
  page: Page,
  target: string,
  timeoutMs = DEFAULT_RESOLVE_TIMEOUT_MS,
): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;

  do {
    // Rebuilt each pass: a locator is a query, and re-running it is what lets a
    // target that appears mid-poll be found.
    const candidates: Locator[] = [
      page.getByRole('button', { name: target, exact: true }),
      page.getByRole('link', { name: target, exact: true }),
      page.getByText(target, { exact: true }),
      page.locator(target),
    ];

    for (const candidate of candidates) {
      try {
        const visible = candidate.filter({ visible: true });
        if ((await visible.count()) > 0) return visible.first();
      } catch {
        // An invalid CSS selector is not an error here; try the next strategy.
      }
    }

    await page.waitForTimeout(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);

  throw new TargetNotFoundError(target, await visibleButtonNames(page));
}

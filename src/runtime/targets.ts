import type { Locator, Page } from 'playwright';

export class TargetNotFoundError extends Error {
  constructor(target: string, visible: string[]) {
    const seen = visible.length > 0 ? visible.map((v) => `"${v}"`).join(', ') : 'nothing clickable';
    super(`Couldn't find "${target}" on the page. Visible buttons: ${seen}.`);
    this.name = 'TargetNotFoundError';
  }
}

async function visibleButtonNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"], a'))
      .filter((el) =>
        'checkVisibility' in el ? (el as Element & { checkVisibility(): boolean }).checkVisibility() : (el as HTMLElement).offsetParent !== null,
      )
      .map((el) => (el.textContent ?? '').trim())
      .filter((text) => text.length > 0)
      .slice(0, 8),
  );
}

export async function resolveTarget(page: Page, target: string): Promise<Locator> {
  const candidates: Locator[] = [
    page.getByRole('button', { name: target, exact: true }),
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

  throw new TargetNotFoundError(target, await visibleButtonNames(page));
}

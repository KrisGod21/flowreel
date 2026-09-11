import type { Command, Script } from '../parser/types.js';
import type { InteractionEvent, RecordedSession } from './events.js';
import { UserError } from '../errors.js';

const MIN_WAIT_MS = 250;
const MAX_WAIT_MS = 1200;
const SETTLE_MS = 800;

export interface BuildOptions {
  /** Apply the deterministic auto-polish heuristics. Default true. */
  polish?: boolean;
  /** Name for the `output` line. Default "demo". */
  outputName?: string;
}

function clampWait(gapMs: number): number {
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, Math.round(gapMs)));
}

function actionFor(event: InteractionEvent): Command[] {
  switch (event.type) {
    case 'navigate':
      return [{ kind: 'visit', url: event.url }, { kind: 'wait', idle: true }];
    case 'click':
      return [{ kind: 'click', target: event.target }];
    case 'input':
      return [{ kind: 'type', target: event.target, text: event.value }];
    case 'press':
      return [{ kind: 'press', key: event.key }];
    case 'scroll':
      return [
        {
          kind: 'scroll',
          direction: event.deltaY >= 0 ? 'down' : 'up',
          amount: Math.abs(Math.round(event.deltaY)),
        },
      ];
  }
}

const CAPTION_MAX_CHARS = 40;
const ZOOM_MAX_WIDTH_FRACTION = 0.4;

/**
 * The auto-polish seam. Pure, deterministic, no model. Returns commands to
 * place before and after the event's own action. A later opt-in polisher can
 * replace this function without touching the recorder.
 */
export function polishEvent(
  event: InteractionEvent,
  viewport: { width: number; height: number },
): { before: Command[]; after: Command[] } {
  switch (event.type) {
    case 'navigate':
      return { before: [], after: captionIfShort(event.title) };
    case 'click':
      return { before: captionIfShort(event.label), after: [] };
    case 'input': {
      const narrow = event.box.width < viewport.width * ZOOM_MAX_WIDTH_FRACTION;
      return narrow
        ? { before: [{ kind: 'zoom', target: event.target }], after: [{ kind: 'resetZoom' }] }
        : { before: [], after: [] };
    }
    default:
      return { before: [], after: [] };
  }
}

function captionIfShort(text: string): Command[] {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0 || trimmed.length > CAPTION_MAX_CHARS) return [];
  return [{ kind: 'caption', text: trimmed }];
}

export function buildScript(session: RecordedSession, options: BuildOptions = {}): Script {
  const { events, viewport } = session;
  if (events.length === 0 || events[0]!.type !== 'navigate') {
    throw new UserError('Nothing was recorded. Open the page, click through the feature you want to show, then press Stop.');
  }

  const polish = options.polish ?? true;
  const commands: Command[] = [];
  let previousAt: number | undefined;

  events.forEach((event, index) => {
    if (index === 0 && event.type === 'navigate') {
      commands.push({ kind: 'visit', url: event.url });
      commands.push({ kind: 'viewport', width: viewport.width, height: viewport.height });
      commands.push({ kind: 'wait', idle: true });
      if (polish) commands.push(...polishEvent(event, viewport).after);
      previousAt = event.at;
      return;
    }

    if (previousAt !== undefined && event.type !== 'navigate') {
      commands.push({ kind: 'wait', ms: clampWait(event.at - previousAt) });
    }
    const extras = polish ? polishEvent(event, viewport) : { before: [], after: [] };
    commands.push(...extras.before, ...actionFor(event), ...extras.after);
    previousAt = event.at;
  });

  if (polish) commands.push({ kind: 'caption', text: '' });
  commands.push({ kind: 'wait', ms: SETTLE_MS });
  commands.push({ kind: 'output', name: options.outputName ?? 'demo' });

  return { commands };
}

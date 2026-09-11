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

export function buildScript(session: RecordedSession, options: BuildOptions = {}): Script {
  const { events, viewport } = session;
  if (events.length === 0 || events[0]!.type !== 'navigate') {
    throw new UserError('Nothing was recorded. Open the page, click through the feature you want to show, then press Stop.');
  }

  const commands: Command[] = [];
  let previousAt: number | undefined;

  events.forEach((event, index) => {
    if (index === 0 && event.type === 'navigate') {
      commands.push({ kind: 'visit', url: event.url });
      commands.push({ kind: 'viewport', width: viewport.width, height: viewport.height });
      commands.push({ kind: 'wait', idle: true });
      previousAt = event.at;
      return;
    }

    if (previousAt !== undefined && event.type !== 'navigate') {
      commands.push({ kind: 'wait', ms: clampWait(event.at - previousAt) });
    }
    commands.push(...actionFor(event));
    previousAt = event.at;
  });

  commands.push({ kind: 'wait', ms: SETTLE_MS });
  commands.push({ kind: 'output', name: options.outputName ?? 'demo' });

  return { commands };
}

import { describe, it, expect } from 'vitest';
import { buildScript } from '../../src/record/build.js';
import type { RecordedSession, InteractionEvent } from '../../src/record/events.js';

const viewport = { width: 1280, height: 800 };
const box = { x: 100, y: 100, width: 120, height: 36 };

function session(events: InteractionEvent[]): RecordedSession {
  return { events, viewport };
}

describe('buildScript (raw)', () => {
  it('opens with visit, viewport and wait idle', () => {
    const script = buildScript(session([{ type: 'navigate', url: 'http://x/', title: 'X', at: 0 }]));
    expect(script.commands.slice(0, 3)).toEqual([
      { kind: 'visit', url: 'http://x/' },
      { kind: 'viewport', width: 1280, height: 800 },
      { kind: 'wait', idle: true },
    ]);
  });

  it('ends with a settle wait and an output', () => {
    const script = buildScript(session([{ type: 'navigate', url: 'http://x/', title: 'X', at: 0 }]), {
      outputName: 'shot',
    });
    const tail = script.commands.slice(-2);
    expect(tail[0]).toEqual({ kind: 'wait', ms: 800 });
    expect(tail[1]).toEqual({ kind: 'output', name: 'shot' });
  });

  it('defaults the output name to demo', () => {
    const script = buildScript(session([{ type: 'navigate', url: 'http://x/', title: 'X', at: 0 }]));
    expect(script.commands.at(-1)).toEqual({ kind: 'output', name: 'demo' });
  });

  it('maps click, input, press and scroll to commands', () => {
    const script = buildScript(
      session([
        { type: 'navigate', url: 'http://x/', title: 'X', at: 0 },
        { type: 'click', target: 'Sign in', label: 'Sign in', box, at: 1000 },
        { type: 'input', target: '#email', value: 'a@b.c', box, at: 2000 },
        { type: 'press', key: 'Enter', at: 3000 },
        { type: 'scroll', deltaY: 420, at: 4000 },
        { type: 'scroll', deltaY: -300, at: 5000 },
      ]),
    );
    const kinds = script.commands.filter((c) => !['visit', 'viewport', 'output'].includes(c.kind) && !('idle' in c));
    expect(kinds).toEqual([
      { kind: 'wait', ms: 1000 },
      { kind: 'click', target: 'Sign in' },
      { kind: 'wait', ms: 1000 },
      { kind: 'type', target: '#email', text: 'a@b.c' },
      { kind: 'wait', ms: 1000 },
      { kind: 'press', key: 'Enter' },
      { kind: 'wait', ms: 1000 },
      { kind: 'scroll', direction: 'down', amount: 420 },
      { kind: 'wait', ms: 1000 },
      { kind: 'scroll', direction: 'up', amount: 300 },
      { kind: 'wait', ms: 800 },
    ]);
  });

  it('clamps gaps into [250, 1200]', () => {
    const script = buildScript(
      session([
        { type: 'navigate', url: 'http://x/', title: 'X', at: 0 },
        { type: 'click', target: 'A', label: 'A', box, at: 50 },
        { type: 'click', target: 'B', label: 'B', box, at: 9000 },
      ]),
    );
    const waits = script.commands.filter((c) => c.kind === 'wait' && 'ms' in c).map((c) => (c as { ms: number }).ms);
    expect(waits).toEqual([250, 1200, 800]);
  });

  it('emits a second navigation as another visit', () => {
    const script = buildScript(
      session([
        { type: 'navigate', url: 'http://x/', title: 'X', at: 0 },
        { type: 'click', target: 'Go', label: 'Go', box, at: 500 },
        { type: 'navigate', url: 'http://x/two', title: 'Two', at: 900 },
      ]),
    );
    expect(script.commands.filter((c) => c.kind === 'visit')).toEqual([
      { kind: 'visit', url: 'http://x/' },
      { kind: 'visit', url: 'http://x/two' },
    ]);
  });

  it('rejects a session with no navigation', () => {
    expect(() => buildScript(session([]))).toThrow(/nothing was recorded/i);
  });
});

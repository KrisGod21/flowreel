import { describe, it, expect } from 'vitest';
import { buildScript, polishEvent } from '../../src/record/build.js';
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
      { polish: false },
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

describe('buildScript (polish)', () => {
  const small = { x: 300, y: 200, width: 320, height: 36 };
  const wide = { x: 0, y: 200, width: 1100, height: 36 };

  it('is the default', () => {
    const script = buildScript(
      session([
        { type: 'navigate', url: 'http://x/', title: 'Acme', at: 0 },
      ]),
    );
    expect(script.commands.some((c) => c.kind === 'caption')).toBe(true);
  });

  it('captions a navigation with the page title', () => {
    const script = buildScript(session([{ type: 'navigate', url: 'http://x/', title: 'Acme Analytics', at: 0 }]));
    expect(script.commands).toContainEqual({ kind: 'caption', text: 'Acme Analytics' });
  });

  it('captions a navigation with only the leading segment of a "Page - Brand" title', () => {
    const script = buildScript(session([{ type: 'navigate', url: 'http://x/', title: 'Dashboard - Acme Analytics', at: 0 }]));
    expect(script.commands).toContainEqual({ kind: 'caption', text: 'Dashboard' });
  });

  it('captions a navigation with only the leading segment of a "Brand | Page" title', () => {
    const script = buildScript(session([{ type: 'navigate', url: 'http://x/', title: 'Acme | Home', at: 0 }]));
    expect(script.commands).toContainEqual({ kind: 'caption', text: 'Acme' });
  });

  it('leaves a title with no separator unchanged', () => {
    const script = buildScript(session([{ type: 'navigate', url: 'http://x/', title: 'Dashboard', at: 0 }]));
    expect(script.commands).toContainEqual({ kind: 'caption', text: 'Dashboard' });
  });

  it('still captions a long title whose leading segment is short', () => {
    const brand = 'x'.repeat(60);
    const script = buildScript(session([{ type: 'navigate', url: 'http://x/', title: `Dashboard - ${brand}`, at: 0 }]));
    expect(script.commands).toContainEqual({ kind: 'caption', text: 'Dashboard' });
  });

  it('captions a click with its short visible label', () => {
    const script = buildScript(
      session([
        { type: 'navigate', url: 'http://x/', title: 'X', at: 0 },
        { type: 'click', target: 'New project', label: 'New project', box: small, at: 1000 },
      ]),
    );
    const i = script.commands.findIndex((c) => c.kind === 'click');
    expect(script.commands[i - 1]).toEqual({ kind: 'caption', text: 'New project' });
  });

  it('does not caption a click whose label is empty or long', () => {
    // Tested directly against the polishEvent seam rather than through a full
    // buildScript output: buildScript can legitimately insert its own
    // caption "" ahead of an uncaptioned event to clear a caption left
    // showing by an earlier event (see the caption-clearing tests below),
    // which is unrelated to whether THIS click's own label produces a
    // caption and would otherwise make a whole-script "no empty caption"
    // assertion fail for reasons that have nothing to do with this rule.
    const long = 'x'.repeat(60);
    expect(polishEvent({ type: 'click', target: '#icon', label: '', box: small, at: 1000 }, viewport).before).toEqual([]);
    expect(polishEvent({ type: 'click', target: '#p', label: long, box: small, at: 2000 }, viewport).before).toEqual([]);
  });

  it('zooms into a narrow input and resets after typing', () => {
    const script = buildScript(
      session([
        { type: 'navigate', url: 'http://x/', title: 'X', at: 0 },
        { type: 'input', target: '#email', value: 'a@b.c', box: small, at: 1000 },
      ]),
    );
    const i = script.commands.findIndex((c) => c.kind === 'type');
    expect(script.commands[i - 1]).toEqual({ kind: 'zoom', target: '#email' });
    expect(script.commands[i + 1]).toEqual({ kind: 'resetZoom' });
  });

  it('does not zoom into a wide input', () => {
    const script = buildScript(
      session([
        { type: 'navigate', url: 'http://x/', title: 'X', at: 0 },
        { type: 'input', target: '#search', value: 'q', box: wide, at: 1000 },
      ]),
    );
    expect(script.commands.some((c) => c.kind === 'zoom')).toBe(false);
  });

  it('clears a click caption before an unrelated zoomed action starts', () => {
    const script = buildScript(
      session([
        { type: 'navigate', url: 'http://x/', title: 'X', at: 0 },
        { type: 'click', target: 'Sign in', label: 'Sign in', box: small, at: 700 },
        { type: 'input', target: '#email', value: 'a@b.c', box: small, at: 1500 },
      ]),
    );
    const clickIndex = script.commands.findIndex((c) => c.kind === 'click');
    const zoomIndex = script.commands.findIndex((c) => c.kind === 'zoom');
    expect(script.commands[clickIndex - 1]).toEqual({ kind: 'caption', text: 'Sign in' });
    // The clearing caption sits directly before the zoom (a wait for the
    // gap between the click and the type may sit between the click and it).
    expect(script.commands[zoomIndex - 1]).toEqual({ kind: 'caption', text: '' });
    expect(script.commands.slice(clickIndex + 1, zoomIndex - 1).every((c) => c.kind !== 'caption')).toBe(true);
  });

  it('does not insert a clearing caption between two consecutive captioned clicks', () => {
    const script = buildScript(
      session([
        { type: 'navigate', url: 'http://x/', title: 'X', at: 0 },
        { type: 'click', target: 'A', label: 'A', box: small, at: 700 },
        { type: 'click', target: 'B', label: 'B', box: small, at: 1400 },
      ]),
    );
    const captionsAndClicks = script.commands
      .filter((c) => c.kind === 'caption' || c.kind === 'click')
      .map((c) => (c.kind === 'caption' ? `caption:${(c as { text: string }).text}` : `click:${(c as { target: string }).target}`));
    // No "caption:" (empty clear) between the two captioned clicks - each
    // caption directly precedes its own click, and the second caption
    // replaces the first without an intermediate clear.
    expect(captionsAndClicks).toEqual(['caption:X', 'caption:A', 'click:A', 'caption:B', 'click:B', 'caption:']);
  });

  it('clears the caption before output so a looping GIF does not end on text', () => {
    const script = buildScript(session([{ type: 'navigate', url: 'http://x/', title: 'X', at: 0 }]));
    const n = script.commands.length;
    expect(script.commands[n - 3]).toEqual({ kind: 'caption', text: '' });
  });

  it('can be switched off', () => {
    const script = buildScript(
      session([
        { type: 'navigate', url: 'http://x/', title: 'X', at: 0 },
        { type: 'input', target: '#email', value: 'a', box: small, at: 1000 },
      ]),
      { polish: false },
    );
    expect(script.commands.some((c) => c.kind === 'zoom' || c.kind === 'caption')).toBe(false);
  });

  it('still round-trips through serialize and parse', async () => {
    const { serialize } = await import('../../src/record/serialize.js');
    const { parse } = await import('../../src/parser/parse.js');
    const script = buildScript(
      session([
        { type: 'navigate', url: 'http://x/', title: 'Acme "Beta"', at: 0 },
        { type: 'click', target: 'Sign in', label: 'Sign in', box: small, at: 700 },
        { type: 'input', target: '#email', value: 'a@b.c', box: small, at: 1500 },
      ]),
    );
    expect(parse(serialize(script))).toEqual(script);
  });
});

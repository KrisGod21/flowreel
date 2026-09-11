# flowreel Record Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `flowreel record <url>` opens the app in a visible browser, the user clicks through it and presses Stop, and flowreel writes both a polished demo and the `.reel` script that reproduces it.

**Architecture:** An injected recorder captures clicks, typing, key presses, scrolls and navigations as timestamped events with text-first selectors, pushed live to Node through an exposed function. A pure `buildScript` turns the event log into a typed `Script`, applying deterministic auto-polish (zoom on small inputs, captions from button text and page titles, clamped waits). A pure `serialize` writes it as `.reel` text. The existing `runScript` then replays it through the pipeline that already renders every effect. **Nothing is post-processed from video.**

**Tech Stack:** Node 20+, TypeScript, ESM, Playwright (headed for real use, headless in tests), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-flowreel-design.md` (see "`flowreel record`" and "Decided during Plan 3")

## Global Constraints

- Node 20+, TypeScript, ESM, strict mode, `.js` import extensions (NodeNext).
- **All scratch stays on the `D:` drive.** Never `C:`, `os.tmpdir()`, or `/tmp`. Test scratch under `<repo>/.tmp`.
- **Commits authored as `Krishna <krishnar.sharmanew@gmail.com>` with NO `Co-Authored-By` trailer of any kind.**
- Exit codes: `0` success, `1` user-fixable error (throw `UserError` from `src/errors.ts`), `2` internal error.
- **Errors state the fix in plain language, never a stack trace.**
- No telemetry, no API key, no network beyond the user's own app.
- **The core invariant:** for every `Script` the recorder can produce, `parse(serialize(script))` deep-equals `script`. A recorded session must always replay.
- **The stop button must never appear in the replayed output and its clicks must never be recorded.** It exists only during recording, in its own isolated shadow host.
- Auto-polish is a pure function. No model, no key. The seam must allow a later opt-in polisher without touching the recorder.
- Existing tests must pass unmodified. `executeScript`, the overlay, and the encoder are finished; do not change their behaviour.

---

## Key design decisions

**Capture and replay, never video.** The recorder captures *intent* (what was clicked, what was typed) rather than pixels. Replaying through `runScript` gives pixel-perfect injected effects and a re-runnable script. This is why flowreel can do this at all in one plan.

**Events are pushed live, not polled.** `page.exposeFunction('__flowreelEvent', ...)` survives navigation; a buffer inside the page would be lost on every `visit`. Navigation itself is observed from Node via `page.on('load')`, which also lets us read the new document's title for the caption heuristic.

**Text-first selectors, matching how `resolveTarget` resolves.** A click on a button, link, or button-role element with short visible text is recorded as that text. Otherwise: `#id`, then `tag[name="..."]`, then a short CSS path. Inputs prefer `#id`, `[name]`, `[placeholder]`. Every recorded target is something the existing resolver already finds.

**Typing is coalesced.** One `type` command per focus session, carrying the field's final value, emitted when focus leaves or the next non-typing event arrives. Recording every keystroke would produce an unreadable script.

**Waits are clamped, not copied.** Real pauses are replaced by `wait` clamped to `[250, 1200]`ms. The replay adds its own cursor glide and ripple time, so a faithful copy of the user's hesitation would drag.

**Always-quoted serialization with `\"` escaping.** The tokenizer gains one escape rule so any text can round-trip. Every target and text is emitted quoted, which is unambiguous and matches the README's examples.

---

## File Structure

| path | responsibility |
|------|----------------|
| `src/parser/tokenize.ts` | *modify* — add `\"` escape inside quoted strings |
| `src/record/serialize.ts` | `Script` → `.reel` text (pure, round-trips through `parse`) |
| `src/record/events.ts` | `InteractionEvent` union, `Box`, `RecordedSession` |
| `src/record/build.ts` | events → `Script`, with polish heuristics behind a flag (pure) |
| `src/record/recorder-browser.ts` | injected recorder source: selector generation, capture, stop button |
| `src/record/session.ts` | Node-side: headed launch, exposed functions, navigation tracking, stop |
| `src/cli.ts` | *modify* — `record` subcommand |
| `test/record/*.test.ts` | unit tests for the pure pieces, browser tests for the recorder |

---

## Task 1: Quote escaping and serialization round-trip

**Files:**
- Modify: `src/parser/tokenize.ts`
- Create: `src/record/serialize.ts`
- Test: `test/parser/tokenize.test.ts` (add cases), `test/record/serialize.test.ts`

**Interfaces:**
- Consumes: `parse`, `Command`, `Script` from `src/parser/`.
- Produces: `serialize(script: Script): string` and `quote(text: string): string`. Every later task that writes a `.reel` uses `serialize`.

- [ ] **Step 1: Write the failing tests**

Add to `test/parser/tokenize.test.ts`:

```ts
  it('unescapes \\" inside a quoted string', () => {
    expect(tokenize('caption "say \\"hi\\" now"')).toEqual(['caption', 'say "hi" now']);
  });

  it('unescapes \\\\ inside a quoted string', () => {
    expect(tokenize('type "#f" "a\\\\b"')).toEqual(['type', '#f', 'a\\b']);
  });

  it('leaves a backslash before any other character alone', () => {
    expect(tokenize('type "#f" "C:\\temp"')).toEqual(['type', '#f', 'C:\\temp']);
  });
```

Create `test/record/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parse } from '../../src/parser/parse.js';
import { serialize, quote } from '../../src/record/serialize.js';
import type { Script } from '../../src/parser/types.js';

describe('quote', () => {
  it('wraps in double quotes', () => {
    expect(quote('Sign in')).toBe('"Sign in"');
  });

  it('escapes embedded double quotes and backslashes', () => {
    expect(quote('say "hi"')).toBe('"say \\"hi\\""');
    expect(quote('a\\b')).toBe('"a\\\\b"');
  });
});

describe('serialize', () => {
  const full: Script = {
    commands: [
      { kind: 'visit', url: 'http://localhost:3000/app?x=1' },
      { kind: 'viewport', width: 1280, height: 800 },
      { kind: 'wait', idle: true },
      { kind: 'caption', text: 'Sign in with one "click"' },
      { kind: 'click', target: 'Sign in' },
      { kind: 'type', target: '#email', text: 'demo@example.com' },
      { kind: 'press', key: 'Enter' },
      { kind: 'hover', target: '.card' },
      { kind: 'scroll', direction: 'down', amount: 400 },
      { kind: 'scroll', direction: 'up' },
      { kind: 'scroll', to: '#footer' },
      { kind: 'wait', ms: 500 },
      { kind: 'wait', target: '#dashboard' },
      { kind: 'zoom', target: '#dashboard' },
      { kind: 'resetZoom' },
      { kind: 'highlight', target: 'New project' },
      { kind: 'resetHighlight' },
      { kind: 'theme', mode: 'dark' },
      { kind: 'caption', text: '' },
      { kind: 'output', name: 'demo', preset: 'twitter' },
    ],
  };

  it('round-trips every command through parse', () => {
    expect(parse(serialize(full))).toEqual(full);
  });

  it('emits one command per line', () => {
    const lines = serialize(full).split('\n').filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(full.commands.length);
  });

  it('writes output without a preset when none is set', () => {
    expect(serialize({ commands: [{ kind: 'output', name: 'demo' }] }).trim()).toBe('output "demo"');
  });

  it('round-trips a text containing every awkward character', () => {
    const script: Script = {
      commands: [{ kind: 'type', target: '#f', text: 'tab\there "quoted" back\\slash #hash' }],
    };
    expect(parse(serialize(script))).toEqual(script);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/parser/tokenize.test.ts test/record/serialize.test.ts`
Expected: tokenize escape cases FAIL (backslash kept literally); serialize FAILS to resolve.

- [ ] **Step 3: Write minimal implementation**

In `src/parser/tokenize.ts`, inside the character loop, add escape handling **before** the quote check:

```ts
    if (inQuotes && ch === '\\') {
      const next = line[i + 1];
      if (next === '"' || next === '\\') {
        current += next;
        hasCurrent = true;
        i++;
        continue;
      }
    }
```

Create `src/record/serialize.ts`:

```ts
import type { Command, Script } from '../parser/types.js';

/** Double-quotes `text`, escaping backslashes and embedded quotes. */
export function quote(text: string): string {
  return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function line(command: Command): string {
  switch (command.kind) {
    case 'visit':
      return `visit ${command.url}`;
    case 'viewport':
      return `viewport ${command.width}x${command.height}`;
    case 'click':
      return `click ${quote(command.target)}`;
    case 'type':
      return `type ${quote(command.target)} ${quote(command.text)}`;
    case 'press':
      return `press ${command.key}`;
    case 'hover':
      return `hover ${quote(command.target)}`;
    case 'scroll':
      if ('to' in command) return `scroll to ${quote(command.to)}`;
      return command.amount === undefined
        ? `scroll ${command.direction}`
        : `scroll ${command.direction} ${command.amount}`;
    case 'wait':
      if ('idle' in command) return 'wait idle';
      if ('ms' in command) return `wait ${command.ms}`;
      return `wait ${quote(command.target)}`;
    case 'zoom':
      return `zoom ${quote(command.target)}`;
    case 'resetZoom':
      return 'reset zoom';
    case 'highlight':
      return `highlight ${quote(command.target)}`;
    case 'resetHighlight':
      return 'reset highlight';
    case 'caption':
      return `caption ${quote(command.text)}`;
    case 'theme':
      return `theme ${command.mode}`;
    case 'output':
      return command.preset === undefined
        ? `output ${quote(command.name)}`
        : `output ${quote(command.name)} --preset ${command.preset}`;
  }
}

/** Writes a Script as .reel source. `parse(serialize(s))` deep-equals `s`. */
export function serialize(script: Script): string {
  return script.commands.map(line).join('\n') + '\n';
}
```

Note `wait` discriminates on `'idle' in command` / `'ms' in command` because all three members share the kind. `press` keys and preset names are emitted bare — they are single tokens by construction.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/parser/ test/record/ && npx tsc --noEmit`
Expected: PASS. The `switch` must be exhaustive — if `tsc` reports a missing return, a `Command` variant is unhandled.

- [ ] **Step 5: Commit**

```bash
git add src/parser/tokenize.ts src/record/serialize.ts test/parser/tokenize.test.ts test/record/serialize.test.ts
git commit -m "feat: serialize scripts to .reel with quote escaping, round-trip tested"
```

---

## Task 2: Event types and raw script building

**Files:**
- Create: `src/record/events.ts`, `src/record/build.ts`
- Test: `test/record/build.test.ts`

**Interfaces:**
- Consumes: `Command`, `Script`.
- Produces:
  - `interface Box { x: number; y: number; width: number; height: number }`
  - `type InteractionEvent` (union below)
  - `interface RecordedSession { events: InteractionEvent[]; viewport: { width: number; height: number } }`
  - `function buildScript(session: RecordedSession, options?: { polish?: boolean; outputName?: string }): Script`

  Task 3 adds the polish branch. Tasks 4-6 produce `InteractionEvent`s. Task 7 calls `buildScript`.

- [ ] **Step 1: Write the failing test**

Create `test/record/build.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/record/build.test.ts`
Expected: FAIL — cannot resolve `build.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/record/events.ts`:

```ts
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One thing the user did, as captured by the injected recorder or Node. `at` is ms since recording started. */
export type InteractionEvent =
  | { type: 'navigate'; url: string; title: string; at: number }
  | { type: 'click'; target: string; label: string; box: Box; at: number }
  | { type: 'input'; target: string; value: string; box: Box; at: number }
  | { type: 'press'; key: string; at: number }
  | { type: 'scroll'; deltaY: number; at: number };

export interface RecordedSession {
  events: InteractionEvent[];
  viewport: { width: number; height: number };
}
```

Create `src/record/build.ts`:

```ts
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
    if (index === 0) {
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
```

A `navigate` after the first is emitted without a preceding wait, because the click that caused it already carries one and the navigation is not a user pause.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/record/build.test.ts && npx tsc --noEmit`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/record/events.ts src/record/build.ts test/record/build.test.ts
git commit -m "feat: build a Script from a recorded interaction log"
```

---

## Task 3: Auto-polish heuristics

**Files:**
- Modify: `src/record/build.ts`
- Test: `test/record/build.test.ts` (add a `describe`)

**Interfaces:**
- Consumes: Task 2.
- Produces: `buildScript(session, { polish: true })` (the default) inserting `zoom`/`reset zoom`, `caption`s, and `caption ""` at the end.

The seam is `polishEvent(event, viewport): { before: Command[]; after: Command[] }` — a pure function a later `--ai` polisher could replace.

- [ ] **Step 1: Write the failing test**

Add to `test/record/build.test.ts`:

```ts
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
    const long = 'x'.repeat(60);
    const script = buildScript(
      session([
        { type: 'navigate', url: 'http://x/', title: 'X', at: 0 },
        { type: 'click', target: '#icon', label: '', box: small, at: 1000 },
        { type: 'click', target: '#p', label: long, box: small, at: 2000 },
      ]),
    );
    const captions = script.commands.filter((c) => c.kind === 'caption').map((c) => (c as { text: string }).text);
    expect(captions).not.toContain('');
    expect(captions).not.toContain(long);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/record/build.test.ts`
Expected: the polish cases FAIL (no captions or zoom emitted).

- [ ] **Step 3: Write minimal implementation**

In `src/record/build.ts`, add:

```ts
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
```

Then in `buildScript`, wire it in. For the first event, after the `wait idle`:

```ts
      if (polish) commands.push(...polishEvent(event, viewport).after);
```

For every later event, replace the single `commands.push(...actionFor(event))` with:

```ts
    const extras = polish ? polishEvent(event, viewport) : { before: [], after: [] };
    commands.push(...extras.before, ...actionFor(event), ...extras.after);
```

and before the final settle wait:

```ts
  if (polish) commands.push({ kind: 'caption', text: '' });
```

where `const polish = options.polish ?? true;` is read at the top.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/record/ && npx tsc --noEmit`
Expected: PASS. The raw-mode tests from Task 2 must still pass — check that the "maps click, input, press and scroll" test's filter still excludes only what it expects; if polish is now the default, that test needs `{ polish: false }` passed explicitly. Make that change to the test and say so in the report: it is the raw-mode test and must opt out of polish.

- [ ] **Step 5: Commit**

```bash
git add src/record/build.ts test/record/build.test.ts
git commit -m "feat: deterministic auto-polish - zoom on narrow inputs, captions from labels and titles"
```

---

## Task 4: The injected recorder — selectors and capture

**Files:**
- Create: `src/record/recorder-browser.ts`
- Test: `test/record/recorder.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RECORDER_SOURCE: string` — the injected script. It calls `window.__flowreelEvent(event)` for each captured interaction (Task 6 exposes that), and exposes `window.__flowreelRecorder = { describe(el) }` for tests.

Event `at` timestamps are `performance.now()`-relative inside the page; Task 6 rebases them to session time on the Node side.

- [ ] **Step 1: Write the failing test**

Create `test/record/recorder.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../../src/browser/resolve.js';
import { RECORDER_SOURCE } from '../../src/record/recorder-browser.js';
import type { InteractionEvent } from '../../src/record/events.js';

const APP = pathToFileURL(resolve('demo/app.html')).href;

let browser: Browser;
let page: Page;
let events: InteractionEvent[];

beforeAll(async () => {
  const choice = await resolveBrowser(systemProbe);
  browser = await chromium.launch({ ...launchOptionsFor(choice), headless: true });
});

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  events = [];
  page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.exposeFunction('__flowreelEvent', (e: InteractionEvent) => events.push(e));
  await page.addInitScript(RECORDER_SOURCE);
  await page.goto(APP);
});

const describeEl = (selector: string) =>
  page.evaluate(
    (s) => (window as never as { __flowreelRecorder: { describe(el: Element): { target: string; label: string } } })
      .__flowreelRecorder.describe(document.querySelector(s)!),
    selector,
  );

describe('selector generation', () => {
  it('prefers visible text for a button', async () => {
    expect(await describeEl('#new-project')).toEqual({ target: 'New project', label: 'New project' });
  });

  it('prefers visible text for a link', async () => {
    expect((await describeEl('nav a.active')).target).toBe('Overview');
  });

  it('uses the id for an input', async () => {
    expect((await describeEl('#search')).target).toBe('#search');
  });

  it('falls back to a CSS path for an unlabeled element', async () => {
    const d = await describeEl('.chart b');
    expect(d.target.length).toBeGreaterThan(0);
    // Whatever it produced must resolve back to exactly one element.
    expect(await page.locator(d.target).count()).toBe(1);
  });
});

describe('capture', () => {
  it('records a click with its label and box', async () => {
    await page.click('#new-project');
    const click = events.find((e) => e.type === 'click');
    expect(click).toMatchObject({ type: 'click', target: 'New project', label: 'New project' });
    expect((click as { box: { width: number } }).box.width).toBeGreaterThan(0);
  });

  it('coalesces typing into one input event with the final value', async () => {
    await page.click('#search');
    await page.keyboard.type('launch');
    await page.click('h1'); // blur
    const inputs = events.filter((e) => e.type === 'input');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ type: 'input', target: '#search', value: 'launch' });
  });

  it('records Enter and Escape as press events, not typing', async () => {
    await page.click('#search');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const presses = events.filter((e) => e.type === 'press').map((e) => (e as { key: string }).key);
    expect(presses).toEqual(['Enter', 'Escape']);
  });

  it('records a scroll with its delta', async () => {
    await page.evaluate(() => { document.body.style.height = '4000px'; });
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(400);
    const scroll = events.find((e) => e.type === 'scroll');
    expect(scroll).toBeDefined();
    expect((scroll as { deltaY: number }).deltaY).toBeGreaterThan(0);
  });

  it('timestamps every event', async () => {
    await page.click('#new-project');
    for (const e of events) expect(typeof e.at).toBe('number');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/record/recorder.test.ts`
Expected: FAIL — cannot resolve `recorder-browser.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/record/recorder-browser.ts`:

```ts
// Injected into every document while recording. Self-contained JavaScript in a
// string: no imports, no TypeScript. It reports each interaction to Node via
// window.__flowreelEvent, which page.exposeFunction makes survive navigation.
//
// A raw backtick anywhere inside this string breaks the outer template literal
// and silently kills the recorder. Never write one in a comment here.
export const RECORDER_SOURCE = `
(() => {
  if (window.__flowreelRecorder) return;

  const MAX_TEXT = 40;
  const send = (event) => { try { window.__flowreelEvent(event); } catch (e) {} };
  const now = () => performance.now();

  const isStopButton = (el) => !!(el && el.closest && el.closest('[data-flowreel-stop]'));

  const cssEscape = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : s;

  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift('#' + cssEscape(node.id)); break; }
      const siblings = Array.from(node.parentNode ? node.parentNode.children : []).filter((s) => s.tagName === node.tagName);
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const shortText = (el) => {
    const raw = el.innerText != null ? el.innerText : (el.textContent || '');
    const text = (raw || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    return text.length > 0 && text.length <= MAX_TEXT && !text.includes('\\n') ? text : '';
  };

  const describe = (el) => {
    const clickable = el.closest('button, a, [role="button"], input[type="submit"], input[type="button"], summary');
    const target = clickable || el;
    const label = shortText(target);
    if (clickable && label) return { target: label, label: label };
    if (target.id) return { target: '#' + cssEscape(target.id), label: label };
    const name = target.getAttribute('name');
    if (name) return { target: target.tagName.toLowerCase() + '[name="' + name + '"]', label: label };
    const placeholder = target.getAttribute('placeholder');
    if (placeholder) return { target: target.tagName.toLowerCase() + '[placeholder="' + placeholder + '"]', label: label };
    return { target: cssPath(target), label: label };
  };

  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };

  // Typing is coalesced: one input event per focus session, carrying the final
  // value, flushed when focus leaves or a non-typing event arrives.
  let pending = null;
  const flushInput = () => {
    if (!pending) return;
    send({ type: 'input', target: pending.target, value: pending.el.value, box: boxOf(pending.el), at: pending.at });
    pending = null;
  };

  const isTextField = (el) =>
    el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(button|submit|checkbox|radio|file|range|color)$/i.test(el.type)) || el.isContentEditable);

  document.addEventListener('click', (e) => {
    const el = e.composedPath()[0];
    if (!el || el.nodeType !== 1 || isStopButton(el)) return;
    if (isTextField(el)) return; // focusing a field is not a demo step; typing into it is
    flushInput();
    const d = describe(el);
    send({ type: 'click', target: d.target, label: d.label, box: boxOf(el.closest('button, a, [role="button"]') || el), at: now() });
  }, true);

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!isTextField(el) || isStopButton(el)) return;
    if (!pending || pending.el !== el) {
      flushInput();
      pending = { el: el, target: describe(el).target, at: now() };
    }
  }, true);

  document.addEventListener('focusout', (e) => {
    if (pending && e.target === pending.el) flushInput();
  }, true);

  const PRESS_KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  document.addEventListener('keydown', (e) => {
    if (!PRESS_KEYS.has(e.key) || isStopButton(e.target)) return;
    flushInput();
    send({ type: 'press', key: e.key, at: now() });
  }, true);

  let scrollAccum = 0;
  let scrollTimer = null;
  let scrollAt = 0;
  window.addEventListener('wheel', (e) => {
    if (isStopButton(e.target)) return;
    if (scrollTimer === null) scrollAt = now();
    scrollAccum += e.deltaY;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      flushInput();
      if (Math.abs(scrollAccum) >= 40) send({ type: 'scroll', deltaY: scrollAccum, at: scrollAt });
      scrollAccum = 0;
      scrollTimer = null;
    }, 250);
  }, { passive: true, capture: true });

  window.addEventListener('pagehide', flushInput);

  window.__flowreelRecorder = { describe: describe, flush: flushInput };
})();
`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/record/recorder.test.ts && npx tsc --noEmit`
Expected: PASS, 9 tests. If the CSS-path test's generated selector matches more than one element, the path builder is wrong — fix the builder, do not loosen the test.

- [ ] **Step 5: Commit**

```bash
git add src/record/recorder-browser.ts test/record/recorder.test.ts
git commit -m "feat: injected recorder with text-first selectors and coalesced typing"
```

---

## Task 5: The stop button

**Files:**
- Modify: `src/record/recorder-browser.ts`
- Test: `test/record/recorder.test.ts` (add a `describe`)

**Interfaces:**
- Consumes: Task 4.
- Produces: the recorder injects a floating "Stop recording" button in its own shadow host marked `data-flowreel-stop`, which calls `window.__flowreelStop()` (Task 6 exposes it). Its clicks are never recorded.

- [ ] **Step 1: Write the failing test**

Add to `test/record/recorder.test.ts`:

```ts
describe('stop button', () => {
  it('is present, clickable, and calls __flowreelStop', async () => {
    let stopped = false;
    await page.exposeFunction('__flowreelStop', () => { stopped = true; });
    await page.reload();

    const host = page.locator('[data-flowreel-stop]');
    expect(await host.count()).toBe(1);
    await host.click();
    expect(stopped).toBe(true);
  });

  it('does not record its own click', async () => {
    await page.exposeFunction('__flowreelStop', () => {});
    await page.reload();
    await page.locator('[data-flowreel-stop]').click();
    expect(events.filter((e) => e.type === 'click')).toHaveLength(0);
  });

  it('does not steal clicks from the app', async () => {
    await page.click('#new-project');
    await expect(page.locator('#modal')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/record/recorder.test.ts -t "stop button"`
Expected: FAIL — no `[data-flowreel-stop]` element.

- [ ] **Step 3: Write minimal implementation**

Inside `RECORDER_SOURCE`, after `window.__flowreelRecorder = ...`, add the button. It uses a **light-DOM host with a closed shadow root**: the host attribute is what the recorder's `isStopButton` check looks for, and the shadow root keeps the app's CSS out.

```js
  const mountStop = () => {
    if (document.querySelector('[data-flowreel-stop]')) return;
    const host = document.createElement('div');
    host.setAttribute('data-flowreel-stop', '');
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML =
      '<style>' +
      'button{all:initial;cursor:pointer;font:600 14px ui-sans-serif,system-ui,sans-serif;color:#fff;' +
      'background:#e5484d;padding:10px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.35);' +
      'display:inline-flex;align-items:center;gap:8px}' +
      'button:hover{background:#d13b40}' +
      'i{width:10px;height:10px;border-radius:50%;background:#fff;display:inline-block}' +
      '</style>' +
      '<button type="button"><i></i>Stop recording</button>';
    root.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      try { window.__flowreelStop(); } catch (err) {}
    });
    (document.body || document.documentElement).appendChild(host);
  };
  if (document.body) mountStop();
  else document.addEventListener('DOMContentLoaded', mountStop, { once: true });
```

Note the `isStopButton` check in the click handler runs on `e.composedPath()[0]`, which for a click inside a closed shadow root is retargeted to the **host** — so `closest('[data-flowreel-stop]')` matches and the click is dropped. That is why the marker is on the host, not the button.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/record/recorder.test.ts && npx tsc --noEmit`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/record/recorder-browser.ts test/record/recorder.test.ts
git commit -m "feat: floating stop button, isolated and never recorded"
```

---

## Task 6: The recording session

**Files:**
- Create: `src/record/session.ts`
- Test: `test/record/session.test.ts`

**Interfaces:**
- Consumes: `RECORDER_SOURCE` (Tasks 4-5), `resolveBrowser`/`launchOptionsFor`/`systemProbe`, `InteractionEvent`, `RecordedSession`.
- Produces:
  ```ts
  interface SessionOptions {
    headless?: boolean;                 // default false - the user must see the browser
    viewport?: { width: number; height: number };  // default 1280x800
    onReady?: (page: Page) => Promise<void> | void; // test hook, called after first load
  }
  function recordSession(url: string, options?: SessionOptions): Promise<RecordedSession>
  ```
  Task 7 calls it.

Stop is a promise resolved by the exposed `__flowreelStop`, by SIGINT, or by the browser being closed. The session must never hang after any of those.

- [ ] **Step 1: Write the failing test**

Create `test/record/session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { recordSession } from '../../src/record/session.js';

const APP = pathToFileURL(resolve('demo/app.html')).href;

describe('recordSession', () => {
  it('captures a navigation, a click and typing, then stops via the button', async () => {
    const session = await recordSession(APP, {
      headless: true,
      onReady: async (page) => {
        await page.click('#new-project');
        await page.fill('#project-name', 'Launch');
        await page.locator('[data-flowreel-stop]').click();
      },
    });

    expect(session.viewport).toEqual({ width: 1280, height: 800 });
    expect(session.events[0]).toMatchObject({ type: 'navigate', url: APP, title: 'Acme Analytics' });
    expect(session.events.some((e) => e.type === 'click' && e.target === 'New project')).toBe(true);
    expect(session.events.some((e) => e.type === 'input' && e.value === 'Launch')).toBe(true);
  }, 60_000);

  it('rebases timestamps so the first event is at 0 and later ones increase', async () => {
    const session = await recordSession(APP, {
      headless: true,
      onReady: async (page) => {
        await page.waitForTimeout(150);
        await page.click('#new-project');
        await page.locator('[data-flowreel-stop]').click();
      },
    });
    const ats = session.events.map((e) => e.at);
    expect(ats[0]).toBe(0);
    for (let i = 1; i < ats.length; i++) expect(ats[i]).toBeGreaterThanOrEqual(ats[i - 1]!);
  }, 60_000);

  it('stops when the browser is closed', async () => {
    const session = await recordSession(APP, {
      headless: true,
      onReady: async (page) => { await page.context().browser()!.close(); },
    });
    expect(session.events[0]?.type).toBe('navigate');
  }, 60_000);

  it('turns a dead dev server into a plain-language error', async () => {
    await expect(recordSession('http://localhost:59999/', { headless: true })).rejects.toThrow(/Nothing is running at localhost:59999/);
  }, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/record/session.test.ts`
Expected: FAIL — cannot resolve `session.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/record/session.ts`:

```ts
import { chromium, type Page } from 'playwright';
import { resolveBrowser, launchOptionsFor, systemProbe } from '../browser/resolve.js';
import { UserError } from '../errors.js';
import { RECORDER_SOURCE } from './recorder-browser.js';
import type { InteractionEvent, RecordedSession } from './events.js';

export interface SessionOptions {
  /** Default false: the user has to see the browser to click through it. */
  headless?: boolean;
  viewport?: { width: number; height: number };
  /** Test hook, called once the first page has loaded. */
  onReady?: (page: Page) => Promise<void> | void;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

function translateNavigationError(error: unknown, url: string): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED/.test(message)) {
    let where = url;
    try { where = new URL(url).host; } catch { /* keep the raw url */ }
    throw new UserError(`Nothing is running at ${where} - start your dev server first, maybe \`npm run dev\`?`);
  }
  if (/Cannot navigate to invalid URL/.test(message)) {
    throw new UserError(`"${url}" isn't a URL I can open. Use something like http://localhost:3000, or a file:// path to an HTML file.`);
  }
  throw error;
}

export async function recordSession(url: string, options: SessionOptions = {}): Promise<RecordedSession> {
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const choice = await resolveBrowser(systemProbe);
  if (choice.kind === 'missing') {
    throw new UserError(
      "I couldn't find Chrome, Edge, or a bundled Chromium. Install Chrome, or run `npx playwright install chromium` (~150MB).",
    );
  }

  const browser = await chromium.launch({ ...launchOptionsFor(choice), headless: options.headless ?? false });
  const events: InteractionEvent[] = [];
  const startedAt = Date.now();
  // Page timestamps are performance.now()-relative to each document; rebase
  // everything onto session time so gaps across navigations stay meaningful.
  let pageEpoch = 0;

  let resolveStop!: () => void;
  const stopped = new Promise<void>((resolve) => { resolveStop = resolve; });
  const onSigint = () => resolveStop();

  try {
    const page = await browser.newPage();
    await page.setViewportSize(viewport);

    await page.exposeFunction('__flowreelEvent', (event: InteractionEvent) => {
      events.push({ ...event, at: pageEpoch + event.at });
    });
    await page.exposeFunction('__flowreelStop', () => resolveStop());
    await page.addInitScript(RECORDER_SOURCE);

    page.on('load', () => {
      // Runs for the first document and every navigation after it.
      void (async () => {
        try {
          pageEpoch = Date.now() - startedAt;
          const title = await page.title();
          events.push({ type: 'navigate', url: page.url(), title, at: pageEpoch });
        } catch {
          // Page closed mid-navigation; the session is ending anyway.
        }
      })();
    });

    browser.on('disconnected', () => resolveStop());
    process.once('SIGINT', onSigint);

    try {
      await page.goto(url, { waitUntil: 'load' });
    } catch (error) {
      translateNavigationError(error, url);
    }

    if (options.onReady) {
      await Promise.resolve(options.onReady(page)).catch(() => {
        // The hook closing the browser rejects the awaits inside it; that is a
        // valid way to stop and not an error.
      });
    }

    await stopped;

    // Flush any pending coalesced typing before we tear down.
    await page.evaluate(() => (window as never as { __flowreelRecorder?: { flush(): void } }).__flowreelRecorder?.flush()).catch(() => {});
    await page.waitForTimeout(50).catch(() => {});
  } finally {
    process.off('SIGINT', onSigint);
    await browser.close().catch(() => {});
  }

  const first = events[0]?.at ?? 0;
  const rebased = events
    .map((e) => ({ ...e, at: Math.max(0, Math.round(e.at - first)) }))
    .sort((a, b) => a.at - b.at);

  return { events: rebased, viewport };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/record/session.test.ts && npx tsc --noEmit`
Expected: PASS, 4 tests. If the "stops when the browser is closed" case hangs, the `disconnected` listener is not wired — that case is the guard against a session that never ends.

- [ ] **Step 5: Commit**

```bash
git add src/record/session.ts test/record/session.test.ts
git commit -m "feat: recording session - headed browser, live events, stop by button, Ctrl+C, or close"
```

---

## Task 7: The `record` command

**Files:**
- Modify: `src/cli.ts`
- Create: `src/record/index.ts`
- Test: `test/record/cli.test.ts`

**Interfaces:**
- Consumes: everything above plus `runScript`, `formatSummary`.
- Produces:
  ```ts
  function record(url: string, options: { cwd: string; outputName?: string; headless?: boolean; onReady?: SessionOptions['onReady'] }): Promise<{ scriptPath: string; outputs: EmittedOutput[] }>
  ```
  and `flowreel record <url> [--out <name>]` in the CLI.

- [ ] **Step 1: Write the failing test**

Create `test/record/cli.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, rm, readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { record } from '../../src/record/index.js';
import { parse } from '../../src/parser/parse.js';
import { main } from '../../src/cli.js';

const APP = pathToFileURL(resolve('demo/app.html')).href;
// Scratch stays inside the repo so nothing is written off the D: drive.
const SCRATCH = resolve('.tmp/record-cli');

beforeAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true });
  await mkdir(SCRATCH, { recursive: true });
});

describe('record', () => {
  it('writes a script that parses, and renders outputs from it', async () => {
    const result = await record(APP, {
      cwd: SCRATCH,
      outputName: 'rec',
      headless: true,
      onReady: async (page) => {
        await page.click('#new-project');
        await page.fill('#project-name', 'Launch');
        await page.click('#create');
        await page.waitForTimeout(300);
        await page.locator('[data-flowreel-stop]').click();
      },
    });

    expect(result.scriptPath).toBe(resolve(SCRATCH, 'rec.reel'));
    const source = await readFile(result.scriptPath, 'utf8');
    const script = parse(source);
    expect(script.commands[0]).toMatchObject({ kind: 'visit' });
    expect(script.commands.some((c) => c.kind === 'click' && c.target === 'New project')).toBe(true);
    expect(script.commands.some((c) => c.kind === 'type' && c.text === 'Launch')).toBe(true);
    expect(script.commands.some((c) => c.kind === 'caption')).toBe(true);

    expect(result.outputs.length).toBeGreaterThanOrEqual(2);
    for (const output of result.outputs) expect((await stat(output.path)).size).toBeGreaterThan(0);
  }, 120_000);
});

describe('cli record', () => {
  it('prints usage and returns 1 when no url is given', async () => {
    const chunks: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => { chunks.push(String(s)); return true; }) as never;
    try {
      expect(await main(['record'])).toBe(1);
    } finally {
      process.stderr.write = original;
    }
    expect(chunks.join('')).toMatch(/flowreel record <url>/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/record/cli.test.ts`
Expected: FAIL — cannot resolve `record/index.js`; `main(['record'])` does not return 1.

- [ ] **Step 3: Write minimal implementation**

Create `src/record/index.ts`:

```ts
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { recordSession, type SessionOptions } from './session.js';
import { buildScript } from './build.js';
import { serialize } from './serialize.js';
import { runScript } from '../run.js';
import type { EmittedOutput } from '../summary.js';

export interface RecordOptions {
  cwd: string;
  outputName?: string;
  headless?: boolean;
  onReady?: SessionOptions['onReady'];
  /** Called after the script is written, before rendering starts. */
  onScriptWritten?: (path: string) => void;
}

export async function record(url: string, options: RecordOptions): Promise<{ scriptPath: string; outputs: EmittedOutput[] }> {
  const name = options.outputName ?? 'demo';
  const session = await recordSession(url, { headless: options.headless, onReady: options.onReady });
  const script = buildScript(session, { outputName: name });
  const source = serialize(script);
  const scriptPath = resolve(options.cwd, `${name}.reel`);
  await writeFile(scriptPath, source, 'utf8');
  options.onScriptWritten?.(scriptPath);
  const outputs = await runScript(source, { cwd: options.cwd });
  return { scriptPath, outputs };
}
```

In `src/cli.ts`, add the subcommand. Keep the existing script path unchanged. At the top of `main`:

```ts
  if (argv[0] === 'record') {
    return recordCommand(argv.slice(1));
  }
```

and:

```ts
async function recordCommand(argv: string[]): Promise<number> {
  const url = argv.find((a) => !a.startsWith('--'));
  const outIndex = argv.indexOf('--out');
  const outputName = outIndex === -1 ? undefined : argv[outIndex + 1];

  if (!url) {
    process.stderr.write(
      '\nUsage: flowreel record <url> [--out <name>]\n\nOpens your app in a browser. Click through the feature you want to show, then press Stop.\n\n',
    );
    return 1;
  }
  if (outIndex !== -1 && !outputName) {
    process.stderr.write('\n--out needs a name after it, like `--out demo`.\n\n');
    return 1;
  }

  process.stderr.write('\nRecording. Click through your app in the browser, then press "Stop recording" (or Ctrl+C here).\n');

  try {
    const result = await record(url, {
      cwd: process.cwd(),
      outputName,
      onScriptWritten: (path) => process.stderr.write(`\nWrote ${basename(path)}. Rendering the demo...\n`),
    });
    process.stdout.write(`\n${formatSummary(result.outputs)}\n\n  Edit ${basename(result.scriptPath)} and re-run it with: flowreel ${basename(result.scriptPath)}\n\n`);
    return 0;
  } catch (error) {
    if (error instanceof UserError) {
      process.stderr.write(`\n${error.message}\n\n`);
      return 1;
    }
    process.stderr.write(`\n${(error as Error).message}\n\n`);
    return 2;
  }
}
```

Import `record` from `./record/index.js` and `basename` from `node:path`. Update the no-argument usage text so it no longer says record mode "arrives in the next milestone" — list both forms:

```
Usage:
  flowreel record <url> [--out <name>]    record a demo by clicking through your app
  flowreel <script.reel> [--preset <p>]   render a demo from a script
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/record/ test/cli.test.ts && npx tsc --noEmit`
Expected: PASS. Then run the whole suite once: `npx vitest run`.

- [ ] **Step 5: Try it for real**

Build and record the demo app in a **visible** browser, clicking through by hand and pressing the Stop button:

```bash
npm run build
cd demo && node ../dist/cli.js record "file:///D:/PROJECT%20MANIA/start-project/demo/app.html" --out recorded
```

Confirm: the browser opens visibly, the red Stop button is bottom-right, clicking through produces `recorded.reel`, rendering produces `recorded.gif` and `recorded.mp4`, and the script reads sensibly. Paste the generated `.reel` into the report. Delete the outputs afterwards; do not commit them.

- [ ] **Step 6: Commit**

```bash
git add src/record/index.ts src/cli.ts test/record/cli.test.ts
git commit -m "feat: flowreel record - click through your app, get the script and the demo"
```

---

## Task 8: README and example

**Files:**
- Modify: `README.md`, `examples/demo.reel` (comment only)

- [ ] **Step 1: Update the README**

Rewrite the **Quick start** section so `record` leads, since it is now the primary path:

```markdown
## Quick start

```bash
npx flowreel record http://localhost:3000
```

A browser opens. Click through the feature you want to show, type what you'd type, and press **Stop recording**. flowreel writes `demo.reel` (the script that reproduces what you did, with captions and zooms added), then renders `demo.gif` and `demo.mp4` from it.

Don't like a caption? Edit `demo.reel` and re-run it:

```bash
npx flowreel demo.reel
```

Or write a script by hand from the start:
```

followed by the existing hand-written example.

In the **Status** section, move `flowreel record` from "What's next" into the shipped list, and add one line under it: *"Auto-polish is deterministic: zoom on narrow inputs, captions from your app's own button labels and page titles. No API key."*

Add a short **How recording works** section after Presets:

```markdown
## How recording works

flowreel does not record video and post-process it. It captures *what you did* - each click, what you typed, where you scrolled - as a script, then replays that script through the same renderer that draws the cursor, ripples and captions. That's why the output is pixel-perfect, and why you can edit and re-run it when your UI changes.

The tradeoff: it records a browser tab flowreel opens, not your whole screen or other apps.
```

Do not use em dashes anywhere in the README.

- [ ] **Step 2: Run the example test and the suite**

Run: `npx vitest run test/examples/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md examples/demo.reel
git commit -m "docs: record mode leads the quick start"
```

---

## Done when

- `npx vitest run` is green and `npx tsc --noEmit` is clean.
- `flowreel record <url>` opens a visible browser with a Stop button; clicking through and stopping produces a `.reel` that parses, plus a GIF and an MP4.
- `parse(serialize(buildScript(session)))` deep-equals `buildScript(session)` for every session the tests construct.
- The Stop button's clicks never appear in the script, and the button never appears in the rendered output.
- A dead dev server, a bad URL, and an empty recording each produce a plain-language error at exit 1.
- Every commit authored `Krishna <krishnar.sharmanew@gmail.com>` with no co-author trailer.

## Deliberately deferred

- **Model-assisted polish** (`--ai` with the user's own key). The seam is `polishEvent`; it is not built.
- **`hover` capture.** Mouse movement without a click is noise in most recordings; a deliberate `hover` is one line to add by hand.
- **Zero-argument `flowreel`** that scans dev ports and offers to record. Small, and worth doing once record mode has been used for real.
- **`device <name>` frames, framing, the GitHub Action, animated WebP** - unchanged from the previous plans' deferrals.

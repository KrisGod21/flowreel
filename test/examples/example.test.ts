import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from '../../src/parser/parse.js';

// The example is the first thing a newcomer copies. If it stops parsing, the
// tool's own documentation is lying to them.
describe('examples/demo.reel', () => {
  it('parses', async () => {
    const source = await readFile(resolve('examples/demo.reel'), 'utf8');
    const script = parse(source);

    expect(script.commands.length).toBeGreaterThan(5);
    expect(script.commands[0]).toEqual({ kind: 'visit', url: 'http://localhost:3000' });
    expect(script.commands.at(-1)).toEqual({ kind: 'output', name: 'demo' });
  });
});

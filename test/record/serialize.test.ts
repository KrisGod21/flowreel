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

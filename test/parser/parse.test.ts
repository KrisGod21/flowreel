import { describe, it, expect } from 'vitest';
import { parse, ReelParseError } from '../../src/parser/parse.js';

describe('parse', () => {
  it('parses a full script', () => {
    const src = [
      '# a demo',
      'visit http://localhost:3000',
      'viewport 1280x800',
      '',
      'click "Sign in"',
      'type "#email" "demo@example.com"',
      'press Enter',
      'hover ".card"',
      'scroll down 400',
      'scroll to "#footer"',
      'wait 500',
      'wait idle',
      'wait "#dashboard"',
      'zoom "#dashboard"',
      'reset zoom',
      'highlight ".cta"',
      'caption "One command, zero setup"',
      'theme dark',
      'output demo',
    ].join('\n');

    expect(parse(src).commands).toEqual([
      { kind: 'visit', url: 'http://localhost:3000' },
      { kind: 'viewport', width: 1280, height: 800 },
      { kind: 'click', target: 'Sign in' },
      { kind: 'type', target: '#email', text: 'demo@example.com' },
      { kind: 'press', key: 'Enter' },
      { kind: 'hover', target: '.card' },
      { kind: 'scroll', direction: 'down', amount: 400 },
      { kind: 'scroll', to: '#footer' },
      { kind: 'wait', ms: 500 },
      { kind: 'wait', idle: true },
      { kind: 'wait', target: '#dashboard' },
      { kind: 'zoom', target: '#dashboard' },
      { kind: 'resetZoom' },
      { kind: 'highlight', target: '.cta' },
      { kind: 'caption', text: 'One command, zero setup' },
      { kind: 'theme', mode: 'dark' },
      { kind: 'output', name: 'demo' },
    ]);
  });

  it('parses an output line with a preset', () => {
    expect(parse('output demo --preset twitter').commands).toEqual([
      { kind: 'output', name: 'demo', preset: 'twitter' },
    ]);
  });

  it('defaults scroll amount to undefined when omitted', () => {
    expect(parse('scroll up').commands).toEqual([
      { kind: 'scroll', direction: 'up' },
    ]);
  });

  it('reports the line number of an unknown command', () => {
    let err: unknown;
    try {
      parse('visit http://x\nfrobnicate now');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReelParseError);
    expect((err as ReelParseError).line).toBe(2);
    expect((err as ReelParseError).message).toMatch(/frobnicate/);
  });

  it('rejects a malformed viewport', () => {
    expect(() => parse('viewport wide')).toThrow(/viewport/i);
  });

  it('rejects click with no target', () => {
    expect(() => parse('click')).toThrow(/needs/i);
  });

  it('rejects an unknown theme', () => {
    expect(() => parse('theme neon')).toThrow(/light.*dark/i);
  });

  it('rejects a non-numeric scroll amount instead of passing NaN to the mouse', () => {
    expect(() => parse('scroll down abc')).toThrow(ReelParseError);
    expect(() => parse('scroll down abc')).toThrow(/distance in pixels.*abc/i);
  });

  it('rejects a negative scroll amount', () => {
    expect(() => parse('scroll down -50')).toThrow(ReelParseError);
  });

  it('rejects a negative wait duration rather than hunting for an element named "-100"', () => {
    expect(() => parse('wait -100')).toThrow(ReelParseError);
    expect(() => parse('wait -100')).toThrow(/whole number of milliseconds/i);
  });

  it('rejects a fractional wait duration', () => {
    expect(() => parse('wait 1.5')).toThrow(/whole number of milliseconds/i);
  });

  it('still treats a non-numeric wait argument as a target', () => {
    expect(parse('wait "#dashboard"').commands).toEqual([{ kind: 'wait', target: '#dashboard' }]);
  });

  it('parses "reset zoom"', () => {
    expect(parse('reset zoom').commands).toEqual([{ kind: 'resetZoom' }]);
  });

  it('parses "reset highlight"', () => {
    expect(parse('reset highlight').commands).toEqual([{ kind: 'resetHighlight' }]);
  });

  it('rejects a reset target other than zoom or highlight', () => {
    expect(() => parse('reset theme')).toThrow(ReelParseError);
    expect(() => parse('reset theme')).toThrow(/reset zoom.*reset highlight/i);
  });

  it('reports an unterminated quote as a parse error with the right line', () => {
    let err: unknown;
    try {
      parse('visit http://x\nclick "Sign in');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReelParseError);
    expect((err as ReelParseError).line).toBe(2);
    expect((err as ReelParseError).message).toMatch(/unterminated/i);
  });
});

import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/parser/tokenize.js';

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('click Sign')).toEqual(['click', 'Sign']);
  });

  it('keeps quoted strings together and strips the quotes', () => {
    expect(tokenize('click "Sign in"')).toEqual(['click', 'Sign in']);
  });

  it('handles several quoted arguments', () => {
    expect(tokenize('type "#email" "a b@c.com"')).toEqual(['type', '#email', 'a b@c.com']);
  });

  it('strips comments outside quotes', () => {
    expect(tokenize('click "Go" # then wait')).toEqual(['click', 'Go']);
  });

  it('keeps a hash inside quotes', () => {
    expect(tokenize('click "#main"')).toEqual(['click', '#main']);
  });

  it('returns an empty array for blank and comment-only lines', () => {
    expect(tokenize('   ')).toEqual([]);
    expect(tokenize('# just a note')).toEqual([]);
  });

  it('throws on an unterminated quote', () => {
    expect(() => tokenize('click "Sign in')).toThrow(/unterminated/i);
  });

  it('unescapes \\" inside a quoted string', () => {
    expect(tokenize('caption "say \\"hi\\" now"')).toEqual(['caption', 'say "hi" now']);
  });

  it('unescapes \\\\ inside a quoted string', () => {
    expect(tokenize('type "#f" "a\\\\b"')).toEqual(['type', '#f', 'a\\b']);
  });

  it('leaves a backslash before any other character alone', () => {
    expect(tokenize('type "#f" "C:\\temp"')).toEqual(['type', '#f', 'C:\\temp']);
  });
});

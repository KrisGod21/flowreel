import { tokenize } from './tokenize.js';
import type { Command, Script } from './types.js';

export type { Command, Script } from './types.js';

export class ReelParseError extends Error {
  constructor(
    public readonly line: number,
    message: string,
  ) {
    super(`Line ${line}: ${message}`);
    this.name = 'ReelParseError';
  }
}

function need(tokens: string[], index: number, line: number, what: string): string {
  const value = tokens[index];
  if (value === undefined) {
    throw new ReelParseError(line, `${tokens[0]} needs ${what}`);
  }
  return value;
}

function parseLine(tokens: string[], line: number): Command {
  const [command] = tokens;

  switch (command) {
    case 'visit':
      return { kind: 'visit', url: need(tokens, 1, line, 'a URL') };

    case 'viewport': {
      const size = need(tokens, 1, line, 'a size like 1280x800');
      const match = /^(\d+)x(\d+)$/.exec(size);
      if (!match) throw new ReelParseError(line, `viewport needs a size like 1280x800, got "${size}"`);
      return { kind: 'viewport', width: Number(match[1]), height: Number(match[2]) };
    }

    case 'click':
      return { kind: 'click', target: need(tokens, 1, line, 'something to click') };

    case 'type':
      return {
        kind: 'type',
        target: need(tokens, 1, line, 'a field to type into'),
        text: need(tokens, 2, line, 'the text to type'),
      };

    case 'press':
      return { kind: 'press', key: need(tokens, 1, line, 'a key') };

    case 'hover':
      return { kind: 'hover', target: need(tokens, 1, line, 'something to hover') };

    case 'scroll': {
      const arg = need(tokens, 1, line, 'up, down, or "to <target>"');
      if (arg === 'to') {
        return { kind: 'scroll', to: need(tokens, 2, line, 'a scroll target') };
      }
      if (arg !== 'up' && arg !== 'down') {
        throw new ReelParseError(line, `scroll needs up, down, or "to <target>", got "${arg}"`);
      }
      const amount = tokens[2];
      return amount === undefined
        ? { kind: 'scroll', direction: arg }
        : { kind: 'scroll', direction: arg, amount: Number(amount) };
    }

    case 'wait': {
      const arg = need(tokens, 1, line, 'a duration, "idle", or a target');
      if (arg === 'idle') return { kind: 'wait', idle: true };
      if (/^\d+$/.test(arg)) return { kind: 'wait', ms: Number(arg) };
      return { kind: 'wait', target: arg };
    }

    case 'zoom':
      return { kind: 'zoom', target: need(tokens, 1, line, 'something to zoom to') };

    case 'reset':
      if (tokens[1] !== 'zoom') throw new ReelParseError(line, 'the only reset is "reset zoom"');
      return { kind: 'resetZoom' };

    case 'highlight':
      return { kind: 'highlight', target: need(tokens, 1, line, 'something to highlight') };

    case 'caption':
      return { kind: 'caption', text: need(tokens, 1, line, 'some text') };

    case 'theme': {
      const mode = need(tokens, 1, line, 'light or dark');
      if (mode !== 'light' && mode !== 'dark') {
        throw new ReelParseError(line, `theme must be light or dark, got "${mode}"`);
      }
      return { kind: 'theme', mode };
    }

    case 'output': {
      const name = need(tokens, 1, line, 'an output name');
      const flagIndex = tokens.indexOf('--preset');
      if (flagIndex === -1) return { kind: 'output', name };
      const preset = tokens[flagIndex + 1];
      if (preset === undefined) throw new ReelParseError(line, '--preset needs a preset name');
      return { kind: 'output', name, preset };
    }

    default:
      throw new ReelParseError(line, `I don't know the command "${command}"`);
  }
}

export function parse(source: string): Script {
  const commands: Command[] = [];

  source.split(/\r?\n/).forEach((raw, index) => {
    const lineNumber = index + 1;
    let tokens: string[];
    try {
      tokens = tokenize(raw);
    } catch (error) {
      throw new ReelParseError(lineNumber, (error as Error).message);
    }
    if (tokens.length === 0) return;
    commands.push(parseLine(tokens, lineNumber));
  });

  return { commands };
}

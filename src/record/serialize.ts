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

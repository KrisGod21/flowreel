#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { runScript } from './run.js';
import { formatSummary } from './summary.js';
import { UserError } from './errors.js';
import { record } from './record/index.js';

// Read from package.json rather than restating it here: a hardcoded copy and
// the manifest drift apart, and the only test of this constant was a regex that
// could not fail. createRequire because a JSON import needs an import attribute
// that is still unstable under NodeNext.
const requireCjs = createRequire(import.meta.url);
export const version: string = (requireCjs('../package.json') as { version: string }).version;

export const USAGE = `flowreel ${version}

Usage:
  flowreel record <url> [--out <name>]    record a demo by clicking through your app
  flowreel <script.reel> [--preset <p>]   render a demo from a script
`;

export function presetFlag(argv: string[]): string | undefined {
  const index = argv.indexOf('--preset');
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new UserError('--preset needs a preset name after it, like `--preset github-readme`.');
  }
  return value;
}

export async function main(argv: string[]): Promise<number> {
  if (argv[0] === 'record') {
    return recordCommand(argv.slice(1));
  }

  const scriptPath = argv.find((arg) => arg.endsWith('.reel'));

  if (!scriptPath) {
    process.stdout.write(USAGE);
    return 0;
  }

  try {
    const source = await readFile(resolve(scriptPath), 'utf8');
    const outputs = await runScript(source, {
      cwd: process.cwd(),
      presetOverride: presetFlag(argv),
    });
    process.stdout.write(`\n${formatSummary(outputs)}\n\n`);
    return 0;
  } catch (error) {
    // Everything a user can fix - a bad script, a missing target, a typo'd
    // preset, no dev server, no encoder - is a UserError and exits 1. Exit 2 is
    // reserved for faults in flowreel itself, so CI can tell them apart.
    if (error instanceof UserError) {
      process.stderr.write(`\n${error.message}\n\n`);
      return 1;
    }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      process.stderr.write(`\nI couldn't find ${scriptPath}.\n\n`);
      return 1;
    }
    process.stderr.write(`\n${(error as Error).message}\n\n`);
    return 2;
  }
}

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

const invokedDirectly = process.argv[1]?.endsWith('cli.js');
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      // main() is meant to be total; if it ever rejects that is an internal
      // fault, and silently exiting 0 would tell CI the run succeeded.
      process.exitCode = 2;
    });
}

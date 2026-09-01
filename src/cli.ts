#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runScript, EmptyCaptureError } from './run.js';
import { formatSummary } from './summary.js';
import { ReelParseError } from './parser/parse.js';
import { TargetNotFoundError } from './runtime/execute.js';

export const version = '0.1.0';

function presetFlag(argv: string[]): string | undefined {
  const index = argv.indexOf('--preset');
  return index === -1 ? undefined : argv[index + 1];
}

export async function main(argv: string[]): Promise<number> {
  const scriptPath = argv.find((arg) => arg.endsWith('.reel'));

  if (!scriptPath) {
    process.stdout.write(
      `flowreel ${version}\n\nUsage: flowreel <script.reel> [--preset <name>]\n\nRecord mode and the zero-argument flow arrive in the next milestone.\n`,
    );
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
    if (error instanceof ReelParseError || error instanceof TargetNotFoundError || error instanceof EmptyCaptureError) {
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

const invokedDirectly = process.argv[1]?.endsWith('cli.js');
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

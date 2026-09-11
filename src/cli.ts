#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { runScript } from './run.js';
import { formatSummary } from './summary.js';
import { UserError } from './errors.js';
import { record } from './record/index.js';
import { detectDevServers, DEFAULT_DEV_PORTS } from './detect.js';

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

Flags:
  --out <name>     name the recorded output (with "record")
  --preset <name>  use a named preset (with a .reel script)
  -h, --help       show this help and exit
  -v, --version    print the version and exit
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

export function outFlag(argv: string[]): string | undefined {
  const index = argv.indexOf('--out');
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new UserError('--out needs a name after it, like `--out demo`.');
  }
  return value;
}

// FLOWREEL_PORTS lets a test (or a curious user) override which ports the
// no-argument dev-server scan checks, as a comma-separated list, e.g.
// `FLOWREEL_PORTS=4321,4322 flowreel`. Unset means use the built-in common
// ports (DEFAULT_DEV_PORTS).
function portsFromEnv(): number[] | undefined {
  const raw = process.env.FLOWREEL_PORTS;
  if (!raw) return undefined;
  const ports = raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((port) => Number.isInteger(port) && port > 0);
  return ports.length > 0 ? ports : undefined;
}

async function findReelFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((entry) => entry.endsWith('.reel')).sort();
  } catch {
    return [];
  }
}

// Running `flowreel` with no arguments must never produce a usage error: it is
// the most common first thing a curious user tries. Instead, help them find
// the one command they actually need next.
async function noArgsCommand(): Promise<number> {
  const reelFiles = await findReelFiles(process.cwd());
  if (reelFiles.length > 0) {
    const [first] = reelFiles;
    process.stdout.write(
      `\nFound ${first} in this directory. Run it with: flowreel ${first}\n\n`,
    );
    return 0;
  }

  const found = await detectDevServers(portsFromEnv() ?? DEFAULT_DEV_PORTS);

  if (found.length === 1) {
    const url = `http://localhost:${found[0]}`;
    process.stdout.write(`\nFound your app at ${url}\n\nRun: flowreel record ${url}\n\n`);
    return 0;
  }
  if (found.length > 1) {
    const lines = found.map((port) => {
      const url = `http://localhost:${port}`;
      return `  ${url}    flowreel record ${url}`;
    });
    process.stdout.write(`\nFound multiple apps running:\n\n${lines.join('\n')}\n\n`);
    return 0;
  }

  process.stdout.write(
    '\nNo .reel script here, and nothing running on a common dev port. Start your dev server, ' +
      'then run flowreel record <url>; or write a .reel script and run it with flowreel <script.reel>.\n\n',
  );
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  // --help/--version work with no browser and no network, and take priority
  // over everything else - including a stray .reel or "record" argument.
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  if (argv.length === 0) {
    return noArgsCommand();
  }

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
    const presetOverride = presetFlag(argv);
    // The .reel path can spend 10-40 seconds encoding before printing
    // anything else, which reads as hung. This line is the proof it isn't.
    process.stderr.write(`Recording ${basename(scriptPath)}...\n`);
    const outputs = await runScript(source, {
      cwd: process.cwd(),
      presetOverride,
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

  if (!url) {
    process.stderr.write(
      '\nUsage: flowreel record <url> [--out <name>]\n\nOpens your app in a browser. Click through the feature you want to show, then press Stop.\n\n',
    );
    return 1;
  }

  let outputName: string | undefined;
  try {
    outputName = outFlag(argv);
  } catch (error) {
    process.stderr.write(`\n${(error as Error).message}\n\n`);
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

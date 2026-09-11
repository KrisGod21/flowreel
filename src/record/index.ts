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

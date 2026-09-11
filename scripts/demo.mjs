// Regenerates demo/demo.gif and demo/demo.mp4 by recording demo/app.html with
// flowreel itself. The README's own animation is made by the tool it documents.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = pathToFileURL(resolve(root, 'demo/app.html')).href;
const source = await readFile(resolve(root, 'demo/demo.reel'), 'utf8');

// Scratch stays inside the repo (gitignored) rather than the system temp dir.
const scratch = resolve(root, '.tmp');
await mkdir(scratch, { recursive: true });
const reel = resolve(scratch, 'readme-demo.reel');
await writeFile(reel, source.replaceAll('__APP__', appUrl));

const child = spawn(process.execPath, [resolve(root, 'dist/cli.js'), reel], {
  cwd: resolve(root, 'demo'),
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));

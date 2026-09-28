import { readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, ['scripts/check.mjs'], { cwd: root, stdio: 'inherit' });
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const target = new URL('../dist/hiraishin/', import.meta.url); // produced by check → build
const archive = `hiraishin-${manifest.version}.zip`;
await rm(new URL(`../dist/${archive}`, import.meta.url), { force: true });
execFileSync('zip', ['-qr', `../${archive}`, '.'], { cwd: fileURLToPath(target) });
console.log(`Unpacked extension: dist/hiraishin/\nArchive: dist/${archive}`);

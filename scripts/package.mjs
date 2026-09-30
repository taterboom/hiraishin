import { readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// This release enforces the trial. Without a live purchase service, users would be locked out
// when it ends with nowhere to buy, so refuse to package until src/license-config.js is filled.
const { MENKYO_URL, MENKYO_PUBLIC_JWK } = await import('../src/license-config.js');
if (!MENKYO_URL || !MENKYO_PUBLIC_JWK) {
  console.error('src/license-config.js: set MENKYO_URL and MENKYO_PUBLIC_JWK to the production Menkyo service before packaging.');
  process.exit(1);
}
// A local test config (http://localhost…) must never ship.
if (!MENKYO_URL.startsWith('https://') || /localhost|127\.0\.0\.1|menkyo-test\./.test(MENKYO_URL)) {
  console.error(`src/license-config.js: MENKYO_URL is ${MENKYO_URL}; restore the production https URL before packaging.`);
  process.exit(1);
}
execFileSync(process.execPath, ['scripts/check.mjs'], { cwd: root, stdio: 'inherit' });
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const target = new URL('../dist/hiraishin/', import.meta.url); // produced by check → build
const archive = `hiraishin-${manifest.version}.zip`;
await rm(new URL(`../dist/${archive}`, import.meta.url), { force: true });
execFileSync('zip', ['-qr', `../${archive}`, '.'], { cwd: fileURLToPath(target) });
console.log(`Unpacked extension: dist/hiraishin/\nArchive: dist/${archive}`);

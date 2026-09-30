// Builds the extension against a Menkyo test backend and opens it in a visible Chrome for
// Testing window, ready to click through purchase / activation by hand.
//
//   npm run try            online test environment (https://menkyo-test.44san.com)
//   npm run try -- local   your local Menkyo (npm run dev in the menkyo repo, port 8787)
//   npm run try -- --fresh start from a clean browser profile (new install, no trial, no license)
//
// Only dist/ is changed: src/license-config.js keeps the production values, so nothing here can
// leak into a release. The browser profile is kept in .artifacts/try-profile-<env> between runs.
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readdir, rm, writeFile, realpath, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BACKENDS = { test: 'https://menkyo-test.44san.com', local: 'http://localhost:8787' };
const args = process.argv.slice(2);
const target = args.find(arg => !arg.startsWith('--')) ?? 'test';
if (!BACKENDS[target]) {
  console.error(`Unknown backend "${target}". Use: ${Object.keys(BACKENDS).join(' | ')}`);
  process.exit(1);
}
const root = process.cwd();
const url = BACKENDS[target];

let jwk;
try {
  const { keys } = await (await fetch(`${url}/license/jwks`)).json();
  const { kty, crv, x, y } = keys[0];
  jwk = { kty, crv, x, y };
} catch {
  console.error(`Cannot reach ${url}/license/jwks.${target === 'local' ? ' Start it first: cd ../menkyo && npm run dev' : ''}`);
  process.exit(1);
}

execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'ignore' });
await writeFile(path.join(root, 'dist/hiraishin/src/license-config.js'),
  `// Written by scripts/try.mjs for the ${target} backend; the next build restores src/license-config.js.\n`
  + `export const MENKYO_URL = '${url}';\nexport const MENKYO_PUBLIC_JWK = ${JSON.stringify(jwk)};\n`);

async function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const found = [];
  async function walk(dir, depth) {
    if (depth > 6) return;
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'Google Chrome for Testing' && full.includes('/MacOS/')) found.push(full);
      else if (entry.isDirectory()) await walk(full, depth + 1);
    }
  }
  await walk(path.join(os.homedir(), 'Library/Caches/ms-playwright'), 0);
  return found.sort().at(-1);
}
const chrome = await findChrome();
if (!chrome) {
  console.error('Chrome for Testing not found (branded Chrome ignores --load-extension). Install it with: npx playwright install chromium, or set CHROME=/path/to/binary');
  process.exit(1);
}

const extension = await realpath(path.join(root, 'dist/hiraishin'));
const hex = createHash('sha256').update(extension).digest('hex').slice(0, 32);
const id = [...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
const profile = path.join(root, `.artifacts/try-profile-${target}`);
if (args.includes('--fresh')) await rm(profile, { recursive: true, force: true });
await mkdir(profile, { recursive: true });

spawn(chrome, [`--user-data-dir=${profile}`, `--load-extension=${extension}`, `--disable-extensions-except=${extension}`,
  '--no-first-run', '--no-default-browser-check', `chrome-extension://${id}/options.html`], { detached: true, stdio: 'ignore' }).unref();

console.log(`Opened Hiraishin settings against ${url}
  Test card: 4242 4242 4242 4242 · any future date · any CVC
  Profile:   ${path.relative(root, profile)} (kept between runs; add --fresh to reset)`);

// Rasterize icons/mark.svg into the PNG sizes the manifest uses.
// Each size is rendered from the vector at that exact size (not downscaled from 128), with a
// transparent background so the cut-out bolt shows whatever the toolbar is.
// Needs chrome-headless-shell (Playwright cache) or CHROME=/path/to/binary.
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ICONS = new URL('../icons/', import.meta.url);
const SIZES = [16, 32, 48, 128];

async function findShell() {
  if (process.env.CHROME) return process.env.CHROME;
  const roots = [path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright')];
  const found = [];
  async function walk(dir, depth) {
    if (depth > 4) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'chrome-headless-shell') found.push(full);
      else if (entry.isDirectory()) await walk(full, depth + 1);
    }
  }
  for (const dir of roots) await walk(dir, 0);
  if (!found.length) throw new Error('No chrome-headless-shell found. Run `npx playwright install chromium-headless-shell` or set CHROME.');
  return found.sort().at(-1);
}

/** Run the shell's one-shot screenshot, with a hard stop: some builds finish writing but never exit. */
function screenshot(binary, url, size, out) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--default-background-color=00000000', `--window-size=${size},${size}`, `--screenshot=${out}`, url], { stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 20000);
    child.on('exit', () => { clearTimeout(timer); resolve(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
  });
}

const binary = await findShell();
const work = await mkdtemp(path.join(os.tmpdir(), 'hiraishin-icons-'));
const svg = await readFile(new URL('mark.svg', ICONS), 'utf8');
try {
  for (const size of SIZES) {
    const page = path.join(work, `${size}.html`);
    await writeFile(page, `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    const out = path.join(work, `${size}.png`);
    await screenshot(binary, `file://${page}`, size, out);
    const png = await readFile(out).catch(() => null);
    if (!png) throw new Error(`Rendering ${size}px failed.`);
    if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`${size}px render came out ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}.`);
    await writeFile(new URL(`${size}.png`, ICONS), png);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
console.log(`Generated icons from mark.svg: ${SIZES.join(', ')} px`);

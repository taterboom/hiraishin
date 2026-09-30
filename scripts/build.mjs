// Build the loadable extension into dist/hiraishin: static files and the ES-module worker,
// content scripts and domain modules are copied as-is; the React pages are bundled by esbuild.
//   node scripts/build.mjs           one-off production build
//   node scripts/build.mjs --watch   rebuild the UI bundles on change
import { build, context } from 'esbuild';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const OUT_DIR = path.join(root, 'dist', 'hiraishin');
const watch = process.argv.includes('--watch');

export async function copyStatic() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(path.join(OUT_DIR, 'src'), { recursive: true });
  for (const file of ['manifest.json', 'popup.html', 'options.html', 'offscreen.html', 'icons']) {
    await cp(path.join(root, file), path.join(OUT_DIR, file), { recursive: true });
  }
  await cp(path.join(root, 'site/privacy.html'), path.join(OUT_DIR, 'privacy.html'));
  for (const file of await readdir(path.join(root, 'src'))) {
    if (file.endsWith('.js')) await cp(path.join(root, 'src', file), path.join(OUT_DIR, 'src', file));
  }
}

/** Machine-readable capability list for the landing page and agents (spec §14.2). */
export async function writeActionsJson() {
  const { listActions, CATEGORIES } = await import('../src/actions.js');
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'manifest.json'), 'utf8'));
  const actions = listActions().filter(action => !action.panelInput).map(action => ({
    id: action.id, name: action.name, category: CATEGORIES[action.category], keywords: action.keywords,
    nativeCommand: action.command, webShortcut: action.web, requiresSelection: action.requiresSelection,
    defaultShortcut: manifest.commands[action.id]?.suggested_key?.default ?? null,
  }));
  await mkdir(path.join(root, 'site'), { recursive: true });
  await writeFile(path.join(root, 'site', 'actions.json'), JSON.stringify({
    name: 'Hiraishin', version: manifest.version, description: manifest.description,
    homepage: 'https://hiraishin.44san.com/', minimumChrome: manifest.minimum_chrome_version, actions,
  }, null, 2) + '\n');
}

// The overlay ships as one classic script injected into pages, and its CSS is bundled as text so
// it can be written into a closed shadow root instead of the page's own stylesheet.
const overlayOptions = {
  entryPoints: { 'ui/overlay': path.join(root, 'ui/overlay/main.tsx') },
  outdir: OUT_DIR, bundle: true, format: 'iife', target: ['chrome121'], jsx: 'automatic',
  loader: { '.css': 'text' }, minify: !watch, sourcemap: watch ? 'inline' : false,
  legalComments: 'none', logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
};

const uiOptions = {
  entryPoints: { 'ui/popup': path.join(root, 'ui/popup/main.tsx'), 'ui/options': path.join(root, 'ui/options/main.tsx') },
  outdir: OUT_DIR, bundle: true, format: 'esm', target: ['chrome121'], jsx: 'automatic',
  minify: !watch, sourcemap: watch ? 'inline' : false, legalComments: 'none', logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
};

export async function buildAll() {
  await copyStatic();
  await writeActionsJson();
  await build(uiOptions);
  await build(overlayOptions);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (watch) {
    await copyStatic();
    await writeActionsJson();
    for (const options of [uiOptions, overlayOptions]) {
      const ctx = await context(options);
      await ctx.watch();
    }
    console.log('watching ui/ … load dist/hiraishin as the unpacked extension');
  } else {
    await buildAll();
    console.log(`built ${path.relative(root, OUT_DIR)}`);
  }
}

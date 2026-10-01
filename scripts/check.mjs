import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildAll, OUT_DIR } from './build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await buildAll();
const dist = `${OUT_DIR}/`;
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.type, 'module');
const files = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page, 'offscreen.html',
  ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
for (const file of new Set(files)) await access(`${dist}${file}`);
for (const dir of ['src', 'scripts', 'tests']) {
  for (const file of await readdir(new URL(`../${dir}/`, import.meta.url))) {
    if (/\.m?js$/.test(file)) execFileSync(process.execPath, ['--check', `${dir}/${file}`], { cwd: root });
  }
}
assert.ok(Object.values(manifest.commands).filter(command => command.suggested_key).length <= 4);
assert.equal(Number(manifest.minimum_chrome_version), 121, 'Tab.lastAccessed needs Chrome 121');
const { COMMAND_IDS } = await import('../src/actions.js');
assert.deepEqual(Object.keys(manifest.commands), COMMAND_IDS, 'manifest commands must match the action registry');

// Translations: every language has exactly the same keys, and each message uses the same
// {placeholders} as its Chinese original. A key present in two areas would shadow silently.
const { AREAS, DICTIONARIES } = await import('../src/locales/index.js');
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
const reference = DICTIONARIES.zh;
for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
  // `.one` singular variants are optional per language (see i18n.js); their base key is not.
  const isOne = key => key.endsWith('.one');
  const missing = Object.keys(reference).filter(key => !isOne(key) && !(key in dictionary));
  const extra = Object.keys(dictionary).filter(key => !(key in reference) && !(isOne(key) && key.slice(0, -4) in reference));
  assert.deepEqual(missing, [], `${locale} is missing translations`);
  assert.deepEqual(extra, [], `${locale} has keys the Chinese dictionary does not`);
  for (const [key, text] of Object.entries(dictionary)) {
    assert.equal(typeof text, 'string', `${locale} ${key} must be a string`);
    assert.ok(text.trim(), `${locale} ${key} is empty`);
    const base = key in reference ? reference[key] : reference[key.slice(0, -4)];
    assert.equal(placeholders(text), placeholders(base), `${locale} ${key} placeholders differ from zh`);
  }
  const seen = new Map();
  for (const [area, entries] of Object.entries(AREAS[locale])) {
    for (const key of Object.keys(entries)) {
      assert.ok(!seen.has(key), `${locale} ${key} is defined in both ${seen.get(key)} and ${area}`);
      seen.set(key, area);
    }
  }
}
// Every __MSG_x__ the manifest uses must exist in each generated _locales folder.
const { CHROME_LOCALES } = await import('./build.mjs');
const manifestText = JSON.stringify(manifest);
const usedMessages = [...manifestText.matchAll(/__MSG_(\w+)__/g)].map(match => match[1]);
assert.equal(manifest.default_locale, 'en');
for (const folder of Object.values(CHROME_LOCALES)) {
  const messages = JSON.parse(await readFile(`${dist}_locales/${folder}/messages.json`, 'utf8'));
  for (const name of usedMessages) assert.ok(messages[name]?.message, `_locales/${folder} lacks ${name}`);
}
for (const id of COMMAND_IDS) assert.equal(manifest.commands[id].description, `__MSG_cmd_${id.replace(/-/g, '_')}__`, `${id} description must come from _locales`);
for (const page of ['popup.html', 'options.html', 'offscreen.html']) {
  const html = await readFile(`${dist}${page}`, 'utf8');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `MV3 ${page} must not contain inline scripts`);
  for (const [, file] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (!/^[a-z]+:/i.test(file)) await access(`${dist}${file}`);
  }
}
// Project design rule: a rounded box must never carry a border on only one side. The bar
// pokes out past the radius and reads as a rendering bug, so it is banned outright.
// Every stylesheet we ship, including the two shared by the popup and the in-page panel.
const STYLESHEETS = ['ui/popup/popup.css', 'ui/options/options.css',
  'ui/shared/action-mark.css', 'ui/overlay/styles.css'];
for (const file of STYLESHEETS) {
  const css = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = body.split(';').map(item => item.trim()).filter(Boolean);
    const radius = declarations.find(item => /^border(-[a-z]+)?-radius\s*:/.test(item) && !/:\s*0[a-z%]*$/.test(item));
    const sides = declarations.filter(item => /^border-(left|right|top|bottom)(-(width|color|style))?\s*:/.test(item)
      && !/:\s*(0|none)\b/.test(item));
    const allSides = declarations.some(item => /^border\s*:/.test(item) && !/:\s*(0|none)\b/.test(item));
    assert.ok(!(radius && sides.length && !allSides),
      `${file}: rounded box with a single-side border is not allowed.\n  ${selector.trim()} { ${radius}; ${sides.join('; ')} }`);
  }
}

// Appending to a stylesheet round after round let a second copy of a whole block survive and
// silently override the first. Selectors must be declared once per file.
/** Split a stylesheet into its top level plus each at-rule body, so a responsive override
 *  inside @media is not mistaken for a duplicate of the rule it overrides. */
function cssScopes(css) {
  const scopes = [];
  let top = '';
  for (let index = 0; index < css.length; index++) {
    if (css[index] !== '@') { top += css[index]; continue; }
    const open = css.indexOf('{', index);
    if (open === -1) { top += css.slice(index); break; }
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}' && --depth === 0) break;
    }
    scopes.push(css.slice(open + 1, end));
    index = end;
  }
  return [top, ...scopes];
}

for (const file of STYLESHEETS) {
  const css = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const scope of cssScopes(css)) {
    const seen = new Map();
    for (const [, selector] of scope.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      const key = selector.trim().replace(/\s+/g, ' ').replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!key) continue;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const duplicated = [...seen].filter(([, count]) => count > 1).map(([selector]) => selector);
    assert.deepEqual(duplicated, [], `${file}: these selectors are declared more than once in the same scope, so a later copy silently wins`);
  }
}

const tsc = new URL('../node_modules/typescript/bin/tsc', import.meta.url);
if (await access(tsc).then(() => true, () => false)) {
  execFileSync(process.execPath, [fileURLToPath(tsc), '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, [fileURLToPath(tsc), '-p', 'tsconfig.ui.json'], { cwd: root, stdio: 'inherit' });
  console.log('Type check (src JSDoc checkJs + ui TypeScript strict) passed.');
} else {
  console.warn('typescript not installed; skipping checkJs (run npm install to enable).');
}
console.log('Build, manifest, referenced assets, and JavaScript syntax passed.');

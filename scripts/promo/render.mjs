// Renders scripts/promo/promo.html frame by frame in headless Chrome and encodes the promo MP4.
//
//   node scripts/promo/record.mjs                 # first: real footage into .artifacts/promo/footage
//   node scripts/promo/render.mjs                 # → .artifacts/promo/hiraishin-promo.mp4
//   node scripts/promo/render.mjs --only 3,8.5    # just those times as PNGs in .artifacts/promo/check
//
// Needs ffmpeg on PATH (or FFMPEG=...) and any Chrome/Chromium (CHROME=...); no extension is loaded here.
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30;
const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? args[onlyAt + 1].split(',').map(Number) : null;
const outDir = path.join(root, '.artifacts/promo');
const out = path.join(outDir, 'hiraishin-promo.mp4');
const framesDir = path.join(outDir, only ? 'check' : 'frames');
fs.rmSync(framesDir, { recursive: true, force: true }); fs.mkdirSync(framesDir, { recursive: true });

// Serve the repository over http so the footage images do not taint the canvas.
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, body) => {
    if (err) { res.statusCode = 404; return res.end(); }
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg' }[path.extname(file)];
    if (type) res.setHeader('Content-Type', type);
    res.end(body);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const page = `http://127.0.0.1:${server.address().port}/scripts/promo/promo.html?render`;

const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraishin-render-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--force-device-scale-factor=1', '--window-size=1960,1200', 'about:blank'], { stdio: 'ignore' });

try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(page)}`, { method: 'PUT' })).json(); }
    catch { await new Promise(r => setTimeout(r, 150)); }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expression => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
    return m.result.result.value;
  };
  let total = 0;
  for (let i = 0; i < 100 && !total; i++) { total = await evaluate('typeof renderFrame === "function" ? renderFrame(0).then(() => window.TOTAL) : 0').catch(() => 0); if (!total) await new Promise(r => setTimeout(r, 100)); }
  if (!total) throw new Error('promo page did not load');
  const times = only || Array.from({ length: Math.round(total * FPS) }, (_, i) => i / FPS);
  console.log(`total ${total.toFixed(2)} s, ${times.length} frame(s)`);
  for (let i = 0; i < times.length; i++) {
    const url = await evaluate(`renderFrame(${times[i]})`);
    const name = only ? `t${times[i].toFixed(2)}.jpg` : `${String(i).padStart(4, '0')}.jpg`;
    fs.writeFileSync(path.join(framesDir, name), Buffer.from(url.split(',')[1], 'base64'));
    if (!only && i % 120 === 0) console.log(`frame ${i}/${times.length}`);
  }
  ws.close();
  if (!only) {
    const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(framesDir, '%04d.jpg'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'slow', '-movflags', '+faststart', out], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg failed');
    fs.rmSync(framesDir, { recursive: true, force: true });
    console.log(`wrote ${path.relative(root, out)}`);
  }
} finally {
  chrome.kill(); server.close();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
}

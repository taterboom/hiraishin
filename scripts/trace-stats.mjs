// Summarise wheel gestures recorded by a HIRAISHIN_TRACE=1 build (ui/overlay/trace.ts), to set the
// sub-wheel's enter / leave radii from real flicks.
//   node scripts/trace-stats.mjs traces.json
// Export from the settings page's DevTools console (chrome://extensions → Hiraishin → Details →
// Extension options, then right-click → Inspect):
//   chrome.storage.local.get(null).then(all => { const t = Object.entries(all).filter(([k]) => k.startsWith('hiraishin-trace:')).map(([, v]) => v); copy(JSON.stringify(t)); return t.length; })
// The file may hold that array or the whole storage object.
import { readFile } from 'node:fs/promises';

// Mirrors ui/overlay/Wheel.tsx; update both together.
const DEAD_ZONE = 40;
const OUTER_RADIUS = 184;
/** How long before the release a selection change still counts as a last-moment flip. */
const FLIP_WINDOW = 80;

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/trace-stats.mjs traces.json');
  process.exit(1);
}
const raw = JSON.parse(await readFile(file, 'utf8'));
const traces = (Array.isArray(raw) ? raw : Object.entries(raw).filter(([key]) => key.startsWith('hiraishin-trace:')).map(([, value]) => value))
  .filter(trace => trace?.v === 1 && trace.samples?.length && trace.end);

function sectorAt(dx, dy, count) {
  if (Math.hypot(dx, dy) < DEAD_ZONE) return null;
  const step = 360 / count;
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return Math.floor((((angle + step / 2) % 360) + 360) % 360 / step);
}
const distance = (sample, from) => Math.hypot(sample[1] - from.x, sample[2] - from.y);
const percentile = (values, p) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const spread = values => ['p50', 'p90', 'p95', 'p99', 'max']
  .map(name => `${name} ${Math.round(name === 'max' ? Math.max(...values) : percentile(values, Number(name.slice(1))))}`).join(' · ');
const share = (values, limit) => `${values.filter(value => value > limit).length}/${values.length}`;

const committed = traces.filter(trace => trace.end.kind !== 'cancel' && trace.end.action);
const kinds = Object.groupBy(traces, trace => trace.end.kind);
console.log(`${traces.length} gestures: ${Object.entries(kinds).map(([kind, list]) => `${kind} ${list.length}`).join(', ')}; ${committed.length} ran an action\n`);
if (!committed.length) process.exit(0);

const fromCenter = committed.map(trace => Math.max(...trace.samples.map(sample => distance(sample, trace.center))));
const fromOrigin = committed.map(trace => Math.max(...trace.samples.map(sample => distance(sample, trace.origin))));
const atRelease = committed.map(trace => distance(trace.samples.at(-1), trace.center));
console.log('Farthest point of a committed flick (px)');
console.log(`  from the drawn centre   ${spread(fromCenter)}`);
console.log(`  from where it began     ${spread(fromOrigin)}`);
console.log(`  at release, from centre ${spread(atRelease)}`);
for (const limit of [OUTER_RADIUS, OUTER_RADIUS + 24, OUTER_RADIUS + 48]) {
  console.log(`  beyond ${limit}px: ${share(fromCenter, limit)} from centre, ${share(fromOrigin, limit)} from origin`);
}

// A selection that changed just before the release is the sub-wheel's worst case: the pointer
// was passing through, and a second ring would add one more thing to pass through.
const flips = committed.filter(trace => {
  const cutoff = trace.end.t - FLIP_WINDOW;
  const before = trace.samples.filter(sample => sample[0] <= cutoff).at(-1);
  if (!before) return false;
  const last = trace.samples.at(-1);
  const at = sample => sectorAt(sample[1] - trace.center.x, sample[2] - trace.center.y, trace.count);
  return at(before) !== null && at(before) !== at(last);
});
console.log(`\nSelection changed in the last ${FLIP_WINDOW}ms: ${flips.length}/${committed.length}`);

// Near an edge the wheel is drawn away from where the flick began, so the opening point already
// sits off-centre: how often does that pick a different sector than the flick's own direction?
const shifted = traces.filter(trace => Math.hypot(trace.origin.x - trace.center.x, trace.origin.y - trace.center.y) > 1);
const disagree = shifted.filter(trace => {
  const first = trace.samples[0];
  const byCenter = sectorAt(first[1] - trace.center.x, first[2] - trace.center.y, trace.count);
  const byOrigin = sectorAt(first[1] - trace.origin.x, first[2] - trace.origin.y, trace.count);
  return byCenter !== null && byCenter !== byOrigin;
});
const deep = shifted.filter(trace => distance(trace.samples[0], trace.center) > OUTER_RADIUS + 24);
console.log(`Opened away from the flick (near an edge): ${shifted.length}; preselected a sector the flick did not point at: ${disagree.length}; opened already beyond ${OUTER_RADIUS + 24}px: ${deep.length}`);

console.log(`\nOpen → end (ms): ${spread(committed.map(trace => trace.end.t))}`);
console.log('\nBy sector (committed, farthest from centre p95):');
const bySector = Object.groupBy(committed.map((trace, index) => ({ trace, far: fromCenter[index] })), ({ trace }) => `${trace.count}:${trace.end.index}`);
for (const [key, list] of Object.entries(bySector).sort()) {
  const [count, index] = key.split(':');
  const actions = [...new Set(list.map(({ trace }) => trace.end.action))].join(', ');
  console.log(`  ${index}/${count} ${String(list.length).padStart(4)} × p95 ${Math.round(percentile(list.map(({ far }) => far), 95))}px  ${actions}`);
}

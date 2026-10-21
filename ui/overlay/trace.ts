// Development-only gesture recorder, compiled in by `HIRAISHIN_TRACE=1 npm run build`. Each wheel
// gesture's pointer path is stored in chrome.storage.local so the sub-wheel's thresholds come
// from real flicks rather than guesses; scripts/trace-stats.mjs reads them back. Production builds
// drop every call site, and scripts/check.mjs fails if TRACE_PREFIX reaches the shipped bundle.
// Only viewport coordinates and the chosen action are kept: no URL, no page content.

export const TRACE_PREFIX = 'hiraishin-trace:';
/** A wheel held open far longer than any flick is not worth keeping in full. */
const MAX_SAMPLES = 2000;

type Point = { x: number; y: number };
interface Trace {
  v: 1;
  at: number;
  viewport: { width: number; height: number };
  count: number;
  /** Where the flick began, and the wheel's centre after it was kept inside the viewport. */
  origin: Point;
  center: Point;
  /** [ms since open, x, y]; the first sample is the pointer when the wheel appeared. */
  samples: [number, number, number][];
  end?: { kind: 'release' | 'click' | 'cancel'; t: number; index: number | null; action: string | null };
}

let current: Trace | null = null;
let openedAt = 0;
const round = (value: number) => Math.round(value * 10) / 10;

export function traceOpen(origin: Point, center: Point, pointer: Point, count: number) {
  openedAt = performance.now();
  current = {
    v: 1, at: Date.now(), viewport: { width: window.innerWidth, height: window.innerHeight }, count,
    origin: { x: round(origin.x), y: round(origin.y) }, center: { x: round(center.x), y: round(center.y) },
    samples: [[0, round(pointer.x), round(pointer.y)]],
  };
}

export function traceMove(x: number, y: number) {
  if (!current || current.samples.length >= MAX_SAMPLES) return;
  current.samples.push([round(performance.now() - openedAt), round(x), round(y)]);
}

/** The first end wins: a release or click runs before the hide() that follows it. Only those
 *  pass the slots, so a cancelled gesture records where it pointed but not an action. */
export function traceEnd(kind: 'release' | 'click' | 'cancel', index: number | null, slots?: ({ id: string } | null)[]) {
  if (!current) return;
  const trace = current;
  current = null;
  const action = index === null ? null : slots?.[index]?.id ?? null;
  trace.end = { kind, t: round(performance.now() - openedAt), index, action };
  const key = `${TRACE_PREFIX}${trace.at}-${Math.random().toString(36).slice(2, 8)}`;
  chrome.storage.local.set({ [key]: trace }).catch(() => {});
}

// The radial menu itself: presentation only. Where it sits and which sector the pointer is
// pointing at are decided in main.tsx, which owns the gesture.
import { ActionIcon } from '../popup/icons';
import type { ActionInfo } from '../shared/types';

/** Intrinsic component size; keep the shared stylesheet and preview frames in sync. */
export const WHEEL_SIZE = 400;
const CENTER = WHEEL_SIZE / 2;
/** A little room outside the dial for its accent and shadow. */
const PAD = 16;
export const OUTER_RADIUS = CENTER - PAD;
export const INNER_RADIUS = 80;
/** Below this distance from the centre nothing is selected: releasing there is a no-op, which is
 *  what makes a flick that never left the middle harmless. It sits well inside the ring, so a
 *  flick commits as soon as its direction is clear rather than only once it reaches the icons. */
export const DEAD_ZONE = 40;
/** Sectors meet edge to edge: the ring is one continuous band and only the selected wedge is
 *  tinted, so there is nothing to separate. */

/** Twelve o'clock is 0 and angles grow clockwise, so a sector's index is also its direction. */
export function sectorAt(dx: number, dy: number, count: number): number | null {
  if (Math.hypot(dx, dy) < DEAD_ZONE) return null;
  const step = 360 / count;
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return Math.floor((((angle + step / 2) % 360) + 360) % 360 / step);
}

const point = (radius: number, degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  return [CENTER + radius * Math.sin(radians), CENTER - radius * Math.cos(radians)];
};

/** Exported so the settings page can draw the same wheel: which index points which way has to be
 *  one piece of knowledge, not two that agree by luck. */
export function sectorPath(index: number, count: number): string {
  const step = 360 / count;
  const from = index * step - step / 2;
  const to = index * step + step / 2;
  const large = to - from > 180 ? 1 : 0;
  const [x1, y1] = point(INNER_RADIUS, from);
  const [x2, y2] = point(OUTER_RADIUS, from);
  const [x3, y3] = point(OUTER_RADIUS, to);
  const [x4, y4] = point(INNER_RADIUS, to);
  return `M ${x1} ${y1} L ${x2} ${y2} A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 ${large} 1 ${x3} ${y3}`
    + ` L ${x4} ${y4} A ${INNER_RADIUS} ${INNER_RADIUS} 0 ${large} 0 ${x1} ${y1} Z`;
}

/** Where a sector's icon sits, as a percentage of the drawing, so a smaller copy of the wheel can
 *  place its icons with the same numbers. */
export function slotPercent(index: number, count: number): { left: number; top: number } {
  const [x, y] = point((INNER_RADIUS + OUTER_RADIUS) / 2, (index * 360) / count);
  return { left: (x / WHEEL_SIZE) * 100, top: (y / WHEEL_SIZE) * 100 };
}

export function Wheel({ slots, activeIndex, position, hint, showHint = true, unavailable, rightCount,
  onSelect, onActivate, allowEmpty = false, sectorLabel, busy = false, idleTitle = '松开取消', idleHint = '甩向某一瓣选择', confirmHint = '松开后确认' }: {
  /** One entry per sector, clockwise from twelve o'clock; null draws an empty wedge. */
  slots: (ActionInfo | null)[];
  activeIndex: number | null;
  /** Viewport coordinates of the wheel's centre, already kept inside the viewport. */
  position: { left: number; top: number };
  /** What a release does right now, shown under the highlighted action's name. */
  hint: string;
  /** The live gesture reveals this after a dwell; the settings preview keeps it visible. */
  showHint?: boolean;
  rightCount?: number;
  unavailable: (action: ActionInfo) => string;
  onSelect?: (index: number | null) => void;
  onActivate?: (index: number) => void;
  /** Configuration may assign empty sectors, while execution leaves them inert. */
  allowEmpty?: boolean;
  sectorLabel?: (index: number) => string;
  busy?: boolean;
  idleTitle?: string;
  idleHint?: string;
  confirmHint?: string;
}) {
  const active = activeIndex === null ? null : slots[activeIndex];
  const reason = active ? unavailable(active) : '';
  const step = 360 / slots.length;
  return (
    <div className="backdrop">
      <div className="wheel" style={{ left: `${position.left}px`, top: `${position.top}px` }} role="menu" aria-label="动作轮盘"
        onMouseMove={onSelect ? event => { if (!(event.target as Element).closest('.sector')) onSelect(null); } : undefined}
        onBlur={onSelect ? event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onSelect(null); } : undefined}
        onMouseLeave={onSelect ? () => onSelect(null) : undefined}>
        {/* The glass blurs the ring; its mask leaves the central hole clear. */}
        <div className="glass" />
        <svg className="dial" viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`} aria-hidden={onActivate ? undefined : true}>
          {/* One translucent tint under all sectors keeps the ring continuous. */}
          <path className="ring" fillRule="evenodd"
            d={`M ${CENTER} ${CENTER - OUTER_RADIUS} A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 1 1 ${CENTER - 0.01} ${CENTER - OUTER_RADIUS} Z`
              + ` M ${CENTER} ${CENTER - INNER_RADIUS} A ${INNER_RADIUS} ${INNER_RADIUS} 0 1 1 ${CENTER - 0.01} ${CENTER - INNER_RADIUS} Z`} />
          {slots.map((action, index) => (
            <path key={index} d={sectorPath(index, slots.length)} className="sector"
              data-slot={index} data-active={activeIndex === index}
              data-dangerous={action?.kind === 'close-right'}
              data-empty={!action} data-disabled={Boolean(action && unavailable(action))}
              role={onActivate && (action || allowEmpty) ? 'menuitem' : undefined}
              aria-label={onActivate && (action || allowEmpty) ? sectorLabel?.(index) ?? (action ? `${action.name}${unavailable(action) ? `：${unavailable(action)}` : ''}` : '空分区') : undefined}
              aria-disabled={onActivate && (action || allowEmpty) ? busy || Boolean(action && unavailable(action)) : undefined}
              tabIndex={onActivate && (action || allowEmpty) ? (busy ? -1 : 0) : undefined}
              onMouseEnter={onSelect ? () => onSelect(action || allowEmpty ? index : null) : undefined}
              onFocus={onSelect ? () => onSelect(action || allowEmpty ? index : null) : undefined}
              onClick={onActivate ? () => { if ((action || allowEmpty) && !busy && !(action && unavailable(action))) onActivate(index); } : undefined}
              onKeyDown={onActivate ? event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if ((action || allowEmpty) && !busy && !(action && unavailable(action))) onActivate(index);
                }
                if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                const items = [...event.currentTarget.ownerSVGElement!.querySelectorAll<SVGPathElement>('[role="menuitem"]')];
                const current = items.indexOf(event.currentTarget);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                  : (current + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + items.length) % items.length;
                event.preventDefault(); items[next]?.focus();
              } : undefined} />
          ))}
          <circle className="hole" cx={CENTER} cy={CENTER} r={INNER_RADIUS} />
          <circle className="rim" cx={CENTER} cy={CENTER} r={OUTER_RADIUS} />
        </svg>
        {slots.map((action, index) => {
          if (!action) return null;
          const [x, y] = point((INNER_RADIUS + OUTER_RADIUS) / 2, index * step);
          return (
            // Actions may repeat; the sector owns the icon's identity across edits.
            <div key={index} className="slot" style={{ left: `${x}px`, top: `${y}px` }}
              data-action={action.id} data-active={activeIndex === index}
              data-dangerous={action.kind === 'close-right'}
              data-disabled={Boolean(unavailable(action))} title={action.name}>
              <ActionIcon action={action} />
            </div>
          );
        })}
        {/* Keep the centre clear during quick gestures; dwell reveals the action and release hint. */}
        {showHint && <div className="hub" data-active={Boolean(active)} data-dangerous={active?.kind === 'close-right'}>
          <span className="hub-name">{active?.kind === 'close-right' && rightCount !== undefined
            ? `关闭右侧 ${rightCount} 个标签页` : active ? active.name : idleTitle}</span>
          <span className="hub-hint">{active ? (reason || (active.kind === 'close-right' ? confirmHint : hint)) : idleHint}</span>
        </div>}
      </div>
    </div>
  );
}

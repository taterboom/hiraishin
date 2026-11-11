// Scrolling while the wheel is open moves a cursor along the selected action's line: the tab
// strip, the visit history. One rule for every sector: left or up is minus, right or down is plus.
// Everything here is pure so the feel can be tuned without touching the gesture code.

/** Within this gap, wheel events belong to one scroll; the first of a new scroll steps at once. */
export const BURST_GAP = 180;
/** Pixels of continued scrolling per step inside one scroll. */
export const STEP_DISTANCE = 60;
const LINE = 40;
const PAGE = 800;

/**
 * One wheel event as a signed push: negative is left / up, positive is right / down. The two
 * axes add up, so an up-left or down-right swipe counts in full, while up-right and down-left
 * cancel out instead of flickering between the two. With natural scrolling the content follows
 * the fingers, so the hand moves opposite to the reported delta; a page cannot read that system
 * setting, so the caller decides.
 * @param {{ deltaX: number, deltaY: number, deltaMode?: number }} event
 */
export function scrollAmount(event, natural) {
  const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? PAGE : 1;
  return (natural ? -1 : 1) * (event.deltaX + event.deltaY) * unit;
}

/** Turns a stream of pushes into single steps. A mouse notch is always one step; inside one
 *  scroll, steps come by distance, at most one per event, so trackpad momentum cannot run away
 *  with the count. Turning back has to cover the full distance too: jitter never steps. */
export function createStepper() {
  let last = -Infinity;
  let pending = 0;
  return {
    /** @returns {-1 | 0 | 1} */
    feed(amount, now) {
      const fresh = now - last > BURST_GAP;
      last = now;
      if (!amount) return 0;
      const sign = amount > 0 ? 1 : -1;
      if (fresh) {
        pending = 0;
        return sign;
      }
      pending = Math.sign(pending) === -sign ? amount : pending + amount;
      if (Math.abs(pending) < STEP_DISTANCE) return 0;
      pending = sign * Math.min(Math.abs(pending) - STEP_DISTANCE, STEP_DISTANCE - 1);
      return sign;
    },
    reset() { last = -Infinity; pending = 0; },
  };
}

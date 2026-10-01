import { t } from '../../src/i18n.js';

// Compass names per sector count, clockwise from twelve o'clock; other counts fall back to degrees.
const DIRECTIONS: Record<number, string[]> = {
  4: ['up', 'right', 'down', 'left'],
  6: ['up', 'upRight', 'downRight', 'down', 'downLeft', 'upLeft'],
  8: ['up', 'upRight', 'right', 'downRight', 'down', 'downLeft', 'left', 'upLeft'],
};

export function wheelDirection(index: number, count: number): string {
  const name = DIRECTIONS[count]?.[index];
  return name ? t(`options.direction.${name}`) : `${Math.round(index * 360 / count)}°`;
}

/** Derive every position from the saved slots, including actions assigned more than once. */
export function WheelPositions({ actionId, slots }: { actionId: string; slots: (string | null)[] }) {
  const positions = slots.flatMap((id, index) => id === actionId ? [index] : []);
  if (!positions.length) return null;
  return <span className="wheel-positions">
    {positions.map(index => <span className="wheel-position" key={index} title={`${t('options.wheel.sector', { index: index + 1 })} · ${wheelDirection(index, slots.length)}`}>
      <svg viewBox="0 0 16 16" aria-hidden="true" style={{ transform: `rotate(${index * 360 / slots.length}deg)` }}>
        <path d="M8 13V3M4 7l4-4 4 4" />
      </svg>
      {wheelDirection(index, slots.length)}
    </span>)}
  </span>;
}

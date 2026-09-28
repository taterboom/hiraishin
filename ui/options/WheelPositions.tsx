export function wheelDirection(index: number, count: number): string {
  const names: Record<number, string[]> = {
    4: ['上', '右', '下', '左'],
    6: ['上', '右上', '右下', '下', '左下', '左上'],
    8: ['上', '右上', '右', '右下', '下', '左下', '左', '左上'],
  };
  return names[count]?.[index] ?? `${Math.round(index * 360 / count)}°`;
}

/** Derive every position from the saved slots, including actions assigned more than once. */
export function WheelPositions({ actionId, slots }: { actionId: string; slots: (string | null)[] }) {
  const positions = slots.flatMap((id, index) => id === actionId ? [index] : []);
  if (!positions.length) return null;
  return <span className="wheel-positions">
    {positions.map(index => <span className="wheel-position" key={index} title={`第 ${index + 1} 瓣 · ${wheelDirection(index, slots.length)}`}>
      <svg viewBox="0 0 16 16" aria-hidden="true" style={{ transform: `rotate(${index * 360 / slots.length}deg)` }}>
        <path d="M8 13V3M4 7l4-4 4 4" />
      </svg>
      {wheelDirection(index, slots.length)}
    </span>)}
  </span>;
}

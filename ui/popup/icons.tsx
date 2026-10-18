import type { ActionInfo } from '../shared/types';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Sliders read as "settings" without being mistaken for a sun the way a spoked circle was. */
export function SettingsGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <path d="M3 6.5h6.5M14 6.5h3M3 13.5h3M10.5 13.5H17" />
      <circle cx="11.75" cy="6.5" r="2.25" /><circle cx="8.25" cy="13.5" r="2.25" />
    </svg>
  );
}

const MODE_BADGE: Record<string, string> = { go: 'M6 12h11M13 7l5 5-5 5', fill: 'M4 20h16M7 16l9-9 2 2-9 9H7z', send: 'M4 12l16-7-7 16-2-7z' };

/** Small line icons keyed by action kind. Transfer actions use the target's monogram plus a mode
 *  badge, because one shared paper plane made every target look identical. */
export function ActionIcon({ action }: { action: ActionInfo }) {
  if (action.kind === 'transfer' && action.monogram) {
    return (
      <span className="action-mark">
        <span className="action-monogram">{action.monogram}</span>
        <svg className="action-badge" viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={2.6}>
          <path d={MODE_BADGE[action.mode ?? 'send'] ?? MODE_BADGE.send} />
        </svg>
      </span>
    );
  }
  const paths = pathsFor(action);
  return (
    <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      {paths.map((d, index) => <path key={index} d={d} />)}
    </svg>
  );
}

function pathsFor(action: ActionInfo): string[] {
  switch (action.kind) {
    case 'history': return action.id === 'history-back'
      ? ['M14 6l-6 6 6 6', 'M8 12h11']
      : ['M10 6l6 6-6 6', 'M5 12h11'];
    case 'previous-tab': return ['M4 8h12l-3-3', 'M20 16H8l3 3'];
    // Lucide's chevron-left / chevron-right: the direction alone, with nothing else to read.
    case 'activate-relative': return action.id.includes('left') ? ['m15 18-6-6 6-6'] : ['m9 18 6-6-6-6'];
    case 'close-right': return ['M4 6h8v12H4z', 'M15 9l5 5', 'M20 9l-5 5'];
    case 'move': {
      const move = (action as ActionInfo & { move?: string }).move ?? action.id.replace('move-tab-', '');
      if (move === 'left' || action.id.endsWith('left')) return ['M9 7h11v10H9z', 'M6 12H2', 'M4 10l-2 2 2 2'];
      if (move === 'right' || action.id.endsWith('right')) return ['M4 7h11v10H4z', 'M18 12h4', 'M20 10l2 2-2 2'];
      if (action.id.endsWith('first')) return ['M10 7h10v10H10z', 'M7 8v8', 'M5 12H2'];
      if (action.id.endsWith('last')) return ['M4 7h10v10H4z', 'M17 8v8', 'M19 12h3'];
      return ['M4 7h16v10H4z', 'M12 10v4'];
    }
    case 'move-to-index': return ['M4 7h16v10H4z', 'M9 12h6', 'M12 9v6'];
    case 'new-window': return action.id.includes('left')
      ? ['M3 5h9v7H3z', 'M14 12h7v7h-7z', 'M8 12v3h6']
      : action.id.includes('right')
        ? ['M12 5h9v7h-9z', 'M3 12h7v7H3z', 'M16 12v3h-6']
        : ['M3 5h10v8H3z', 'M13 11h8v8h-8z'];
    case 'duplicate': return ['M8 8h11v11H8z', 'M5 16V5h11'];
    case 'copy-links': return action.id.includes('markdown')
      ? ['M3 6h18v12H3z', 'M6 15V9l3 3 3-3v6', 'M16 9v6', 'M14 13l2 2 2-2']
      : ['M10 14a4 4 0 0 1 0-5.7l2.3-2.3a4 4 0 0 1 5.7 5.7L17 12.7', 'M14 10a4 4 0 0 1 0 5.7l-2.3 2.3a4 4 0 0 1-5.7-5.7L7 11.3'];
    case 'transfer':
      if (action.mode === 'go') return ['M5 12h12', 'M13 6l6 6-6 6'];
      if (action.mode === 'fill') return ['M4 20h16', 'M6 16l10-10 2 2L8 18H6z'];
      return ['M4 12l16-7-7 16-2-7z'];
    default: return ['M6 6h12v12H6z'];
  }
}

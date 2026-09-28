import { useEffect, useRef, useState } from 'react';
import { CATEGORIES } from '../../src/actions.js';
import { ActionIcon } from '../popup/icons';
import type { ActionInfo } from '../shared/types';
import { WheelPositions } from './WheelPositions';

export function WheelActionPicker({ actions, value, slots, onChange }: {
  actions: ActionInfo[]; value: string | null; slots: (string | null)[]; onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const [query, setQuery] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selected = actions.find(action => action.id === value);
  const groups = new Map<string, ActionInfo[]>();
  const term = query.trim().toLocaleLowerCase();
  for (const action of actions) {
    if (term && ![action.name, action.monogram, ...action.keywords].join(' ').toLocaleLowerCase().includes(term)) continue;
    if (!groups.has(action.category)) groups.set(action.category, []);
    groups.get(action.category)!.push(action);
  }
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (id: string | null) => { close(); onChange(id); };
  return <div className="action-picker" ref={container} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <button type="button" className="action-picker-trigger" ref={trigger} data-value={value ?? ''}
      aria-label={`分区动作：${selected?.name ?? '留空，不执行动作'}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => {
        if (!open) {
          const rect = trigger.current!.getBoundingClientRect();
          setAbove(window.innerHeight - rect.bottom < 340 && rect.top > 340);
          setQuery('');
        }
        setOpen(!open);
      }}>
      {selected ? <ActionIcon action={selected} /> : <span className="empty-action-icon" aria-hidden="true">—</span>}
      <span className="picker-name">{selected?.name ?? '留空，不执行动作'}</span>
      <svg className="picker-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && <div className="action-picker-panel" data-above={above} role="dialog" aria-label="选择分区动作"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        if (event.target === search.current && ['Home', 'End'].includes(event.key)) return;
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.action-choice')];
        if (!items.length) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : current < 0 ? (event.key === 'ArrowUp' ? items.length - 1 : 0)
          : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        event.preventDefault(); items[next].focus();
      }}>
      <input ref={search} className="action-picker-search" type="search" placeholder="搜索动作…" aria-label="搜索分区动作"
        value={query} onChange={event => setQuery(event.target.value)} />
      <div className="action-picker-list">
        {!term && <button type="button" className="action-choice" data-value="" aria-pressed={!value} onClick={() => choose(null)}>
          <span className="empty-action-icon" aria-hidden="true">—</span><span className="picker-name">留空，不执行动作</span>
          {!value && <span className="picker-check" aria-hidden="true">✓</span>}
        </button>}
        {[...groups].map(([category, choices]) => <div key={category} role="group" aria-label={(CATEGORIES as Record<string, string>)[category] ?? category}>
          <div className="picker-category">{(CATEGORIES as Record<string, string>)[category] ?? category}</div>
          {choices.map(action => <button type="button" className="action-choice" key={action.id} data-value={action.id}
            aria-pressed={action.id === value} onClick={() => choose(action.id)}>
            <ActionIcon action={action} />
            <span className="picker-details"><span>{action.name}</span><WheelPositions actionId={action.id} slots={slots} /></span>
            {action.id === value && <span className="picker-check" aria-hidden="true">✓</span>}
          </button>)}
        </div>)}
        {term && !groups.size && <p className="picker-empty" role="status">没有匹配的动作</p>}
      </div>
    </div>}
  </div>;
}

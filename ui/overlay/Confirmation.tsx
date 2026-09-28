import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface CloseConfirmation {
  count: number;
  token: string | null;
  busy: boolean;
  error: string;
  center: { x: number; y: number };
}

/** Replace the wheel at its centre, with Cancel focused by default. */
export function Confirmation({ state, onCancel, onConfirm }: {
  state: CloseConfirmation;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      const offset = (center: number, size: number, viewport: number) => {
        const margin = 16;
        return Math.max(margin, Math.min(center - size / 2, viewport - size - margin));
      };
      const left = offset(state.center.x, width, window.innerWidth);
      const top = offset(state.center.y, height, window.innerHeight);
      setPosition(previous => previous.left === left && previous.top === top ? previous : { left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [state.center.x, state.center.y]);
  useEffect(() => {
    const previous = document.activeElement;
    cancel.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected && document.hasFocus()) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <div className="backdrop confirmation-backdrop" onClick={event => {
      event.stopPropagation();
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div className="confirmation-card" data-confirm-card ref={card} role="dialog" aria-modal="true"
        aria-labelledby="close-title" aria-describedby="close-description"
        style={position}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); onCancel(); return; }
          if (event.key !== 'Tab') return;
          const buttons = Array.from(card.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
          const focused = card.current?.getRootNode() as ShadowRoot | Document;
          const index = buttons.indexOf(focused.activeElement as HTMLButtonElement);
          event.preventDefault();
          buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }}>
        <div className="confirmation-eyebrow">关闭标签页</div>
        <h2 id="close-title">将关闭右侧 {state.count} 个标签页</h2>
        <p id="close-description">保留当前标签页和固定标签页。</p>
        <p className="confirmation-status" role="status" aria-live="polite">
          {state.error || (state.busy ? (state.token ? '正在关闭…' : '正在核对标签页…') : '确认后执行，按 Esc 可取消。')}
        </p>
        <div className="confirmation-buttons">
          <button type="button" ref={cancel} onClick={onCancel}>取消</button>
          <button type="button" className="confirmation-close" disabled={state.busy || !state.token || Boolean(state.error)}
            onClick={onConfirm}>关闭 {state.count} 个</button>
        </div>
      </div>
    </div>
  );
}

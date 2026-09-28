import { useEffect, useRef, useState } from 'react';
import { Wheel, WHEEL_SIZE } from '../overlay/Wheel';
import { ActionIcon } from '../popup/icons';
import type { ActionInfo, SettingsView } from '../shared/types';
import { wheelDirection } from './WheelPositions';

/** Select a destination only: this dialog never executes the action shown on a sector. */
export function WheelPositionDialog({ action, view, onAssign, onClose }: {
  action: ActionInfo;
  view: SettingsView;
  onAssign: (index: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const slots = view.settings.overlay.slots.map(id => view.actions.find(item => item.id === id) ?? null);
  const active = activeIndex === null ? null : slots[activeIndex];
  const direction = activeIndex === null ? '' : wheelDirection(activeIndex, slots.length);

  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);

  const assign = async (index: number) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(false);
    try {
      if (await onAssign(index)) onClose();
      else setError(true);
    } catch { setError(true); }
    finally { saving.current = false; setBusy(false); }
  };

  return <dialog ref={dialog} className="position-dialog" aria-labelledby="position-dialog-title"
    onClose={onClose} onCancel={event => { if (saving.current) event.preventDefault(); }}
    onClick={event => {
      if (event.target !== event.currentTarget || saving.current) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    <div className="dialog-head">
      <h3 id="position-dialog-title">选择放置位置</h3>
      <button type="button" className="icon-close" aria-label="关闭位置选择" disabled={busy} onClick={onClose}>×</button>
    </div>
    <div className="position-action"><ActionIcon action={action} /><span>{action.name}</span></div>
    <p>点击一个分区放入此动作，原有动作会被替换。</p>
    <div className="wheel-stage">
      <div className="wheel-frame">
        <Wheel slots={slots} activeIndex={activeIndex} position={{ left: WHEEL_SIZE / 2, top: WHEEL_SIZE / 2 }}
          unavailable={() => ''} onSelect={setActiveIndex} onActivate={assign} allowEmpty busy={busy}
          sectorLabel={index => `${wheelDirection(index, slots.length)}，${slots[index]?.name ?? '空分区'}，放入${action.name}`}
          idleTitle={direction || '选择位置'} idleHint={direction ? '点击放入' : '点击一瓣放入'}
          hint="点击替换" confirmHint="点击替换" />
      </div>
    </div>
    <p className="position-caption" aria-live="polite">
      {busy ? '正在保存…' : activeIndex === null ? '也可以用方向键选择，按 Enter 放入。'
        : `${direction} · ${active?.id === action.id ? '已在此位置' : active ? `替换「${active.name}」` : '空分区'}`}
    </p>
    {error && <p className="position-error" role="alert">保存失败，请重新选择位置重试。</p>}
  </dialog>;
}

import { useEffect, useRef, useState } from 'react';
import { t } from '../../src/i18n.js';
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
      <h3 id="position-dialog-title">{t('options.position.title')}</h3>
      <button type="button" className="icon-close" aria-label={t('options.position.closeAria')} disabled={busy} onClick={onClose}>×</button>
    </div>
    <div className="position-action"><ActionIcon action={action} /><span>{action.name}</span></div>
    <p>{t('options.position.lead')}</p>
    <div className="wheel-stage">
      <div className="wheel-frame">
        <Wheel slots={slots} activeIndex={activeIndex} position={{ left: WHEEL_SIZE / 2, top: WHEEL_SIZE / 2 }}
          unavailable={() => ''} onSelect={setActiveIndex} onActivate={assign} allowEmpty busy={busy}
          sectorLabel={index => t('options.position.sectorLabel', {
            direction: wheelDirection(index, slots.length), current: slots[index]?.name ?? t('options.position.emptySector'), name: action.name,
          })}
          idleTitle={direction || t('options.position.idleTitle')}
          idleHint={direction ? t('options.position.idleHintDirection') : t('options.position.idleHint')}
          hint={t('options.position.replaceHint')} confirmHint={t('options.position.replaceHint')} />
      </div>
    </div>
    <p className="position-caption" aria-live="polite">
      {busy ? t('options.position.saving') : activeIndex === null ? t('options.position.keyboardHint')
        : `${direction} · ${active?.id === action.id ? t('options.position.alreadyHere')
          : active ? t('options.position.replace', { name: active.name }) : t('options.position.emptySector')}`}
    </p>
    {error && <p className="position-error" role="alert">{t('options.position.error')}</p>}
  </dialog>;
}

import { t } from '../../src/i18n.js';
import type { ActionInfo, TargetInfo } from './types';

/** Inputs both surfaces need to decide whether an action can run right now. */
export interface AvailabilityState {
  canBack: boolean; canForward: boolean; rightCount: number; tabCount: number;
  targets: TargetInfo[]; defaultTargetId: string;
}

/** The reason an action cannot run, or "" when it can. Shared so the popup and the in-page
 *  overlay never disagree about what is actionable. */
export function unavailableReason(action: ActionInfo, state: AvailabilityState): string {
  if (action.kind === 'close-right' && state.rightCount === 0) return t('shared.unavailable.noRight');
  if (action.kind === 'history' && !(action.id === 'history-back' ? state.canBack : state.canForward)) return t('shared.unavailable.edge');
  if (action.kind === 'previous-tab' && state.tabCount <= 1) return t('shared.unavailable.noOther');
  if (action.kind === 'activate-relative' && state.tabCount <= 1) return t('shared.unavailable.noOther');
  if (action.kind === 'new-window' && state.tabCount <= 1) return t('shared.unavailable.singleTab');
  if (action.kind === 'transfer') {
    const wanted = action.targetId === 'default' ? state.defaultTargetId : action.targetId;
    const target = state.targets.find(item => item.id === wanted);
    if (!target) return t('shared.unavailable.noTarget');
    if (action.mode !== 'go' && !target.granted) return t('shared.unavailable.needAccess');
  }
  return '';
}

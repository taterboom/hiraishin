import type { ActionInfo, TargetInfo } from './types';

/** Inputs both surfaces need to decide whether an action can run right now. */
export interface AvailabilityState {
  canBack: boolean; canForward: boolean; rightCount: number; tabCount: number;
  targets: TargetInfo[]; defaultTargetId: string;
}

/** The reason an action cannot run, or "" when it can. Shared so the popup and the in-page
 *  overlay never disagree about what is actionable. */
export function unavailableReason(action: ActionInfo, state: AvailabilityState): string {
  if (action.kind === 'close-right' && state.rightCount === 0) return '右侧没有标签';
  if (action.kind === 'history' && !(action.id === 'history-back' ? state.canBack : state.canForward)) return '已到边界';
  if (action.kind === 'previous-tab' && state.tabCount <= 1) return '没有其他标签';
  if (action.kind === 'new-window' && state.tabCount <= 1) return '窗口只有一个标签';
  if (action.kind === 'transfer') {
    const wanted = action.targetId === 'default' ? state.defaultTargetId : action.targetId;
    const target = state.targets.find(item => item.id === wanted);
    if (!target) return '目标不存在';
    if (action.mode !== 'go' && !target.granted) return '需先在设置中允许访问该网站';
  }
  return '';
}

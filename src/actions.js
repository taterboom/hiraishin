// Action registry shared by every entry point (spec §8.2). Native commands are one
// entry into this registry; the registry may hold more actions than declared commands.
import { BUILTIN_TARGETS } from './targets.js';
import { t } from './i18n.js';

export const CATEGORY_IDS = ['travel', 'arrange', 'copy', 'ai', 'take'];
/** Category names in the current language. */
export const categoryName = id => t(`category.${id}`);

const base = { command: false, web: true, repeat: 'block', requiresSelection: false, panelInput: null };
const define = action => ({ ...base, ...action });

const STATIC_ACTIONS = [
  define({ id: 'history-back', category: 'travel', kind: 'history', direction: -1,
    keywords: ['back', '后退', '返回', '历史', '戻る', '履歴'], command: true, repeat: 'allow' }),
  define({ id: 'history-forward', category: 'travel', kind: 'history', direction: 1,
    keywords: ['forward', '前进', '历史', '進む', '履歴'], command: true, repeat: 'allow' }),
  define({ id: 'switch-previous-tab', category: 'travel', kind: 'previous-tab',
    keywords: ['previous', 'last', 'toggle', '上一个', '切换', 'mru', '直前', '切り替え'], command: true, repeat: 'allow' }),
  define({ id: 'close-right', category: 'arrange', kind: 'close-right',
    keywords: ['close', 'right', '关闭', '右边', '收起', '閉じる', '右'], command: true }),
  define({ id: 'move-tab-left', category: 'arrange', kind: 'move', move: 'left',
    keywords: ['move', 'left', '移动', '左', '移動', '左'], command: true, repeat: 'allow' }),
  define({ id: 'move-tab-right', category: 'arrange', kind: 'move', move: 'right',
    keywords: ['move', 'right', '移动', '右', '移動', '右'], command: true, repeat: 'allow' }),
  define({ id: 'move-tab-first', category: 'arrange', kind: 'move', move: 'first',
    keywords: ['move', 'first', 'start', '移动', '开头', '最左', '移動', '先頭'], command: true }),
  define({ id: 'move-tab-last', category: 'arrange', kind: 'move', move: 'last',
    keywords: ['move', 'last', 'end', '移动', '末尾', '最右', '移動', '末尾'], command: true }),
  define({ id: 'move-tab-to-index', category: 'arrange', kind: 'move-to-index',
    keywords: ['move', 'position', 'index', '位置', '第', '位置'], web: false, panelInput: 'index' }),
  define({ id: 'move-to-new-window', category: 'arrange', kind: 'new-window', scope: 'current',
    keywords: ['window', 'new', '窗口', '新窗口', '拆分', 'ウィンドウ', '新規'], command: true }),
  define({ id: 'move-with-left-to-new-window', category: 'arrange', kind: 'new-window', scope: 'with-left',
    keywords: ['window', 'left', '窗口', '左侧', 'ウィンドウ', '左側'], command: true }),
  define({ id: 'move-with-right-to-new-window', category: 'arrange', kind: 'new-window', scope: 'with-right',
    keywords: ['window', 'right', '窗口', '右侧', 'ウィンドウ', '右側'], command: true }),
  define({ id: 'duplicate-tab', category: 'copy', kind: 'duplicate',
    keywords: ['duplicate', 'clone', '复制', '副本', '複製'], command: true }),
  define({ id: 'copy-links', category: 'take', kind: 'copy-links', format: 'plain',
    keywords: ['copy', 'url', 'link', '链接', '网址', 'コピー', 'リンク', 'URL'], command: true }),
  define({ id: 'copy-links-markdown', category: 'take', kind: 'copy-links', format: 'markdown',
    keywords: ['copy', 'markdown', 'md', '链接', 'コピー', 'リンク'], command: true }),
];

const MODE_KEYWORDS = { go: ['go', 'open', 'switch', '打开', '切换', '前往', '開く'], fill: ['fill', 'paste', '填入', '粘贴', '入力', '貼り付け'], send: ['send', 'ask', '发送', '提问', '送信', '質問'] };

/** `targetName` is a function for the default target, whose name depends on the language. */
function transferAction(idPrefix, targetId, targetName, mode, extra) {
  return define({
    id: `${idPrefix}${mode === 'go' ? 'go-to' : mode}-${targetId}`,
    label: () => t(`action.mode.${mode}`, { target: typeof targetName === 'function' ? targetName() : targetName }),
    category: 'ai', kind: 'transfer', mode, targetId,
    keywords: [...MODE_KEYWORDS[mode], ...(typeof targetName === 'string' ? [targetName.toLowerCase()] : []), 'ai'],
    requiresSelection: mode !== 'go',
    ...extra,
  });
}

// "Send" is the action worth a dedicated entry: filling without sending is barely different from
// copying the text yourself. A separate "fill" action exists only where sending is impossible,
// i.e. a target we can write into but whose submission we cannot confirm. Filling also remains
// the recovery path when a draft blocks a send, but that runs from the pending-selection list
// rather than from the action registry.
const TARGET_ACTIONS = [
  ...BUILTIN_TARGETS.flatMap(target => ['go', 'send'].map(mode =>
    transferAction('', target.id, target.name, mode, { command: true }))),
  ...['go', 'send'].map(mode => transferAction('', 'default', () => t('target.default'), mode, {
    id: `${mode === 'go' ? 'go-to' : mode}-default-target`, command: true,
    keywords: [...MODE_KEYWORDS[mode], 'default', '默认', 'デフォルト'],
  })),
];

/** Actions for user-defined targets; ids are stable per target id. */
function customTargetActions(settings) {
  return settings.targets.custom.flatMap(target => ['go', 'fill', 'send']
    .filter(mode => mode === 'go' || target.capability === mode)
    .map(mode => transferAction('target:', target.id, target.name, mode, {})));
}

/** Names are resolved on every call, in the current language (see i18n.js). */
const named = action => {
  const { label, ...rest } = action;
  return { ...rest, name: label ? label() : t(`action.${action.id}`) };
};

/** @returns {Array<Record<string, any>>} */
export function listActions(settings) {
  return [...STATIC_ACTIONS, ...TARGET_ACTIONS, ...(settings ? customTargetActions(settings) : [])].map(named);
}

export function getAction(id, settings) {
  return listActions(settings).find(action => action.id === id) ?? null;
}

/** Ids that must be declared as manifest commands, in a stable order (spec appendix A). */
export const COMMAND_IDS = listActions().filter(action => action.command).map(action => action.id);

/** Simple ranked search over names, keywords and categories. */
export function searchActions(actions, query) {
  const needle = (query ?? '').trim().toLowerCase();
  if (!needle) return actions;
  const score = action => {
    const name = action.name.toLowerCase();
    if (name.startsWith(needle)) return 0;
    if (name.includes(needle)) return 1;
    if (action.keywords.some(keyword => keyword.toLowerCase().startsWith(needle))) return 2;
    if (action.keywords.some(keyword => keyword.toLowerCase().includes(needle))) return 3;
    if (categoryName(action.category).toLowerCase().includes(needle)) return 4;
    return -1;
  };
  return actions.map(action => ({ action, rank: score(action) })).filter(item => item.rank >= 0)
    .sort((a, b) => a.rank - b.rank).map(item => item.action);
}

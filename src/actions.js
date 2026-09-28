// Action registry shared by every entry point (spec §8.2). Native commands are one
// entry into this registry; the registry may hold more actions than declared commands.
import { BUILTIN_TARGETS } from './targets.js';

export const CATEGORIES = { travel: '穿梭', arrange: '整理', copy: '复制', ai: 'AI 目标', take: '带走' };

const base = { command: false, web: true, repeat: 'block', requiresSelection: false, panelInput: null };
const define = action => ({ ...base, ...action });

const STATIC_ACTIONS = [
  define({ id: 'history-back', name: '访问历史后退', category: 'travel', kind: 'history', direction: -1,
    keywords: ['back', '后退', '返回', '历史'], command: true, repeat: 'allow' }),
  define({ id: 'history-forward', name: '访问历史前进', category: 'travel', kind: 'history', direction: 1,
    keywords: ['forward', '前进', '历史'], command: true, repeat: 'allow' }),
  define({ id: 'switch-previous-tab', name: '切回上一 Tab', category: 'travel', kind: 'previous-tab',
    keywords: ['previous', 'last', 'toggle', '上一个', '切换', 'mru'], command: true, repeat: 'allow' }),
  define({ id: 'close-right', name: '关闭右侧标签页', category: 'arrange', kind: 'close-right',
    keywords: ['close', 'right', '关闭', '右边', '收起'], command: true }),
  define({ id: 'move-tab-left', name: '当前 Tab 左移', category: 'arrange', kind: 'move', move: 'left',
    keywords: ['move', 'left', '移动', '左'], command: true, repeat: 'allow' }),
  define({ id: 'move-tab-right', name: '当前 Tab 右移', category: 'arrange', kind: 'move', move: 'right',
    keywords: ['move', 'right', '移动', '右'], command: true, repeat: 'allow' }),
  define({ id: 'move-tab-first', name: '当前 Tab 移到最左', category: 'arrange', kind: 'move', move: 'first',
    keywords: ['move', 'first', 'start', '移动', '开头', '最左'], command: true }),
  define({ id: 'move-tab-last', name: '当前 Tab 移到最右', category: 'arrange', kind: 'move', move: 'last',
    keywords: ['move', 'last', 'end', '移动', '末尾', '最右'], command: true }),
  define({ id: 'move-tab-to-index', name: '移到指定位置', category: 'arrange', kind: 'move-to-index',
    keywords: ['move', 'position', 'index', '位置', '第'], web: false, panelInput: 'index' }),
  define({ id: 'move-to-new-window', name: '当前 Tab 移到新窗口', category: 'arrange', kind: 'new-window', scope: 'current',
    keywords: ['window', 'new', '窗口', '新窗口', '拆分'], command: true }),
  define({ id: 'move-with-left-to-new-window', name: '当前及左侧 Tabs 移到新窗口', category: 'arrange', kind: 'new-window', scope: 'with-left',
    keywords: ['window', 'left', '窗口', '左侧'], command: true }),
  define({ id: 'move-with-right-to-new-window', name: '当前及右侧 Tabs 移到新窗口', category: 'arrange', kind: 'new-window', scope: 'with-right',
    keywords: ['window', 'right', '窗口', '右侧'], command: true }),
  define({ id: 'duplicate-tab', name: '复制标签页', category: 'copy', kind: 'duplicate',
    keywords: ['duplicate', 'clone', '复制', '副本'], command: true }),
  define({ id: 'copy-links', name: '复制链接', category: 'take', kind: 'copy-links', format: 'plain',
    keywords: ['copy', 'url', 'link', '链接', '网址'], command: true }),
  define({ id: 'copy-links-markdown', name: '复制为 Markdown 链接', category: 'take', kind: 'copy-links', format: 'markdown',
    keywords: ['copy', 'markdown', 'md', '链接'], command: true }),
];

const MODE_LABEL = { go: '前往', fill: '填入', send: '发送到' };
const MODE_KEYWORDS = { go: ['go', 'open', 'switch', '打开', '切换', '前往'], fill: ['fill', 'paste', '填入', '粘贴'], send: ['send', 'ask', '发送', '提问'] };

function transferAction(idPrefix, targetId, targetName, mode, extra) {
  return define({
    id: `${idPrefix}${mode === 'go' ? 'go-to' : mode}-${targetId}`,
    name: `${MODE_LABEL[mode]} ${targetName}`,
    category: 'ai', kind: 'transfer', mode, targetId,
    keywords: [...MODE_KEYWORDS[mode], targetName.toLowerCase(), 'ai'],
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
  ...['go', 'send'].map(mode => transferAction('', 'default', '默认目标', mode, {
    id: `${mode === 'go' ? 'go-to' : mode}-default-target`, command: true,
    keywords: [...MODE_KEYWORDS[mode], 'default', '默认'],
  })),
];

/** Actions for user-defined targets; ids are stable per target id. */
function customTargetActions(settings) {
  return settings.targets.custom.flatMap(target => ['go', 'fill', 'send']
    .filter(mode => mode === 'go' || target.capability === mode)
    .map(mode => transferAction('target:', target.id, target.name, mode, {})));
}

/** @returns {Array<Record<string, any>>} */
export function listActions(settings) {
  return [...STATIC_ACTIONS, ...TARGET_ACTIONS, ...(settings ? customTargetActions(settings) : [])];
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
    if ((CATEGORIES[action.category] ?? '').toLowerCase().includes(needle)) return 4;
    return -1;
  };
  return actions.map(action => ({ action, rank: score(action) })).filter(item => item.rank >= 0)
    .sort((a, b) => a.rank - b.rank).map(item => item.action);
}

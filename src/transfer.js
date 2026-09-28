// Selection transfer orchestration (spec §7, §8.3). One task per trigger; tasks for the
// same window and target run in order so rapid selections never overwrite each other.
import { getTarget, supports } from './targets.js';

export const TASKS_KEY = 'transferTasks';
export const CLEANUP_ALARM = 'hiraishin-task-cleanup';
export const RETENTION_MS = 30 * 60 * 1000;
const LOAD_TIMEOUT_MS = 20000;
const READY_TIMEOUT_MS = 15000;

export const STATUS_MESSAGES = {
  'no-selection': '没有选中文字，未执行。',
  'needs-permission': '需要先在设置页允许访问该网站，才能填入或发送。',
  unsupported: '该目标只支持前往，不支持填入或发送。',
  login: '目标网站尚未登录。选区已保留，可在面板中重试。',
  generating: '目标正在生成回答，暂不能接收新消息。选区已保留。',
  draft: '输入框已有草稿，未自动发送。选区已保留，可改用“填入”追加。',
  'not-ready': '目标页面的输入框未就绪或不兼容。选区已保留，可重试填入或手动复制。',
  'fill-failed': '未能把选区写入输入框。选区已保留，可手动复制。',
  'cannot-submit': '内容已填入，但页面未接受发送，请手动发送。',
  uncertain: '内容已填入，但无法确认是否已提交，未自动重试。',
  'target-gone': '目标标签页已关闭，操作结束。',
  'source-gone': '来源标签页已关闭，操作结束。',
  'selection-blocked': '当前页面无法读取选区（受限页面或未授权），未执行。',
};
const STALE_RUNNING_MS = 5 * 60 * 1000;
const FAILED = new Set(['login', 'generating', 'draft', 'not-ready', 'fill-failed', 'cannot-submit', 'uncertain', 'needs-permission']);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createTransfer(api, { targets, settingsStore, readSelection, now = Date.now }) {
  const chains = new Map();

  async function loadTasks() {
    const saved = await api.storage.session.get(TASKS_KEY);
    return saved[TASKS_KEY] && typeof saved[TASKS_KEY] === 'object' ? saved[TASKS_KEY] : {};
  }

  async function saveTasks(tasks) {
    await api.storage.session.set({ [TASKS_KEY]: tasks });
    const expiries = Object.values(tasks).filter(task => task.failedAt).map(task => task.failedAt + RETENTION_MS);
    if (api.alarms) {
      if (expiries.length) await api.alarms.create(CLEANUP_ALARM, { when: Math.min(...expiries) });
      else await api.alarms.clear(CLEANUP_ALARM);
    }
  }

  async function updateTask(id, changes) {
    const tasks = await loadTasks();
    if (!tasks[id]) return null;
    tasks[id] = { ...tasks[id], ...changes };
    await saveTasks(tasks);
    return tasks[id];
  }

  async function purgeExpired() {
    const tasks = await loadTasks();
    const current = now();
    for (const [id, task] of Object.entries(tasks)) {
      // A worker restart can leave a task "running" forever; drop it once it is clearly stale.
      if (task.state === 'done' || (task.failedAt && task.failedAt + RETENTION_MS <= current)
        || (task.state === 'running' && task.createdAt + STALE_RUNNING_MS <= current)) delete tasks[id];
    }
    await saveTasks(tasks);
  }

  async function removeTask(id) {
    const tasks = await loadTasks();
    if (!(id in tasks)) return;
    delete tasks[id];
    await saveTasks(tasks);
  }

  async function injectAdapter(tabId) {
    await api.scripting.executeScript({ target: { tabId }, files: ['src/page-adapter.js'] });
  }

  async function callAdapter(tabId, op, payload) {
    const results = await api.scripting.executeScript({
      target: { tabId },
      func: (name, data) => globalThis.__hiraishinAdapter?.run(name, data),
      args: [op, payload],
    });
    return results?.[0]?.result ?? null;
  }

  async function waitForLoad(tabId) {
    const started = now();
    while (now() - started < LOAD_TIMEOUT_MS) {
      const tab = await api.tabs.get(tabId);
      if (tab.status === 'complete' || tab.status === undefined) return tab;
      await sleep(250);
    }
    return api.tabs.get(tabId);
  }

  async function waitUntilReady(tabId, payload) {
    const started = now();
    let last = { state: 'missing', draft: '' };
    while (now() - started < READY_TIMEOUT_MS) {
      const probe = await callAdapter(tabId, 'probe', payload);
      // A null result means the page navigated and lost the isolated world: inject again.
      if (probe === null) await injectAdapter(tabId).catch(() => {});
      else last = probe;
      if (last.state && last.state !== 'missing') return last;
      await sleep(400);
    }
    return last;
  }

  async function maybeReturn(source, targetTab) {
    try {
      const current = await api.tabs.get(source.id);
      if (current.windowId !== source.windowId) return false;
      const [active] = await api.tabs.query({ windowId: source.windowId, active: true });
      if (active?.id !== targetTab.id) return false; // The user already went elsewhere.
      await api.tabs.update(source.id, { active: true });
      return true;
    } catch {
      return false;
    }
  }

  async function execute(job) {
    const { task } = job;
    const finish = async (status, extra = {}) => {
      if (task) {
        if (FAILED.has(status)) await updateTask(task.id, { state: 'failed', status, failedAt: now(), message: STATUS_MESSAGES[status] });
        else await removeTask(task.id);
      }
      return { status, message: STATUS_MESSAGES[status] ?? '', notify: FAILED.has(status) || status === 'target-gone', taskId: task?.id, ...extra };
    };
    try {
      return await perform(job, finish);
    } catch (error) {
      // The target closed or turned into a page we cannot script mid-flight.
      const gone = /No tab with id|tab was closed|Frame with ID/i.test(error?.message ?? '');
      return finish(gone ? 'target-gone' : 'not-ready', { error: error?.message });
    }
  }

  async function perform({ mode, target, source, text, settings }, finish) {
    let targetTab;
    try {
      ({ tab: targetTab } = await targets.findOrCreate(target, source));
    } catch (error) {
      return finish('target-gone', { error: error.message });
    }
    const payload = { site: target.site, selectors: target.selectors ?? null };
    const granted = await targets.hasPermission(target);

    if (mode === 'go') {
      if (granted) {
        try {
          await waitForLoad(targetTab.id);
          await injectAdapter(targetTab.id);
          await callAdapter(targetTab.id, 'focus', payload);
        } catch {
          // Focusing is best-effort; the tab switch already happened.
        }
      }
      return finish('navigated', { notify: false });
    }

    if (!granted) return finish('needs-permission');
    try {
      await waitForLoad(targetTab.id);
      await injectAdapter(targetTab.id);
    } catch {
      return finish('target-gone');
    }
    const probe = await waitUntilReady(targetTab.id, payload);
    if (probe.state === 'login') return finish('login');
    if (probe.state === 'generating') return finish('generating');
    if (probe.state !== 'ready') return finish('not-ready');
    if (mode === 'send' && probe.draft.trim()) return finish('draft');

    const filled = await callAdapter(targetTab.id, 'fill', { ...payload, text, mode: mode === 'fill' ? 'append' : 'replace' });
    if (!filled?.ok) return finish('fill-failed');
    if (mode === 'fill') return finish('filled', { notify: false });

    const submitted = await callAdapter(targetTab.id, 'submit', { ...payload, expectedText: text });
    if (submitted?.submitted === true) {
      const returned = settings.returnAfterSend ? await maybeReturn(source, targetTab) : false;
      return finish('sent', { notify: false, returned });
    }
    if (submitted?.submitted === 'uncertain') return finish('uncertain');
    return finish('cannot-submit');
  }

  /**
   * @param {{ mode: 'go' | 'fill' | 'send', targetId: string, ctx: { tabId: number, windowId?: number, frameId?: number, selectionText?: string, fallbackText?: string, origin?: string } }} request
   */
  async function run({ mode, targetId, ctx }) {
    const settings = await settingsStore.get();
    const target = getTarget(settings, targetId);
    if (!target) return { status: 'unsupported', message: '未找到该目标。', notify: true };
    if (!supports(target, mode === 'go' ? 'navigate' : mode)) return { status: 'unsupported', message: STATUS_MESSAGES.unsupported, notify: true };
    let source;
    try { source = await api.tabs.get(ctx.tabId); } catch { return { status: 'source-gone', message: STATUS_MESSAGES['source-gone'], notify: true }; }

    let text = '';
    let task = null;
    if (mode !== 'go') {
      const selection = typeof ctx.selectionText === 'string' && ctx.selectionText.trim()
        ? { text: ctx.selectionText, source: 'provided' }
        : await readSelection({ tabId: source.id, frameId: ctx.frameId, fallbackText: ctx.fallbackText });
      text = selection.text;
      if (!text.trim()) {
        const status = selection.source === 'blocked' ? 'selection-blocked' : 'no-selection';
        return { status, message: STATUS_MESSAGES[status], notify: true };
      }
      const tasks = await loadTasks();
      task = {
        id: `task-${now()}-${Math.random().toString(36).slice(2, 8)}`, mode, targetId: target.id, targetName: target.name,
        text, sourceTabId: source.id, windowId: source.windowId, state: 'running', createdAt: now(),
        formatNote: selection.source === 'context-menu' ? '通过右键菜单读取，格式可能有变化。' : '',
      };
      tasks[task.id] = task;
      await saveTasks(tasks);
    }

    const key = `${source.windowId}:${target.id}`;
    const previous = chains.get(key) ?? Promise.resolve();
    const job = previous.then(() => execute({ mode, target, source, text, task, settings }));
    chains.set(key, job.catch(() => {}));
    const result = await job;
    if (result.formatNote === undefined && task?.formatNote) result.formatNote = task.formatNote;
    return result;
  }

  async function retry(taskId, ctx) {
    const tasks = await loadTasks();
    const task = tasks[taskId];
    if (!task) throw new Error('这条待处理选区已不存在。');
    delete tasks[taskId];
    await saveTasks(tasks);
    let tabId = ctx.tabId;
    try { const source = await api.tabs.get(task.sourceTabId); if (source.windowId === (ctx.windowId ?? source.windowId)) tabId = source.id; } catch { /* use current tab */ }
    return run({ mode: task.mode === 'send' ? 'fill' : task.mode, targetId: task.targetId, ctx: { ...ctx, tabId, selectionText: task.text } });
  }

  async function list() {
    const tasks = await loadTasks();
    return Object.values(tasks).filter(task => task.state === 'failed')
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(task => ({ id: task.id, mode: task.mode, targetName: task.targetName, status: task.status, message: task.message,
        text: task.text, preview: task.text.trim().slice(0, 80), createdAt: task.createdAt, failedAt: task.failedAt }));
  }

  return { run, retry, list, remove: removeTask, purgeExpired, onAlarm: alarm => (alarm?.name === CLEANUP_ALARM ? purgeExpired() : Promise.resolve()) };
}

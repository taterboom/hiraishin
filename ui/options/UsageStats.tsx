import { useCallback, useEffect, useRef, useState } from 'react';
import { USAGE_KEY, USAGE_SOURCES } from '../../src/usage.js';
import { api } from '../shared/api';
import type { ActionInfo, UsageStatsData } from '../shared/types';

const extraNames: Record<string, string> = {
  'retry-transfer': '重试填入', 'jump-history': '跳转访问历史',
  'fill-chatgpt': '填入 ChatGPT', 'fill-claude': '填入 Claude',
};

export function UsageStats({ actions }: { actions: ActionInfo[] }) {
  const [stats, setStats] = useState<UsageStatsData | null>(null);
  const [error, setError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const version = ++request.current;
    try {
      const next = await api.getUsage();
      if (request.current === version) { setStats(next); setError(''); }
    } catch {
      if (request.current === version) setError('无法读取统计，请重新打开设置页。');
    }
  }, []);
  useEffect(() => {
    void load();
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[USAGE_KEY]) void load();
    };
    chrome.storage.onChanged.addListener(changed);
    return () => { request.current++; chrome.storage.onChanged.removeListener(changed); };
  }, [load]);

  const rows = Object.entries(stats?.actions ?? {}).map(([id, sources]) => ({
    id, name: actions.find(action => action.id === id)?.name ?? extraNames[id] ?? '已移除的动作',
    count: Object.values(sources).reduce((sum, n) => sum + n, 0), sources,
  })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const origins = Object.entries(USAGE_SOURCES).map(([id, name]) => ({
    name, count: rows.reduce((sum, row) => sum + (row.sources[id] ?? 0), 0),
  })).filter(source => source.count);

  const reset = async () => {
    setBusy(true);
    try { await api.resetUsage(); setConfirmReset(false); await load(); }
    catch { setError('清空失败，请重试。'); }
    finally { setBusy(false); }
  };
  return <details className="usage-stats">
    <summary>使用统计 <span>{stats ? `${total.toLocaleString()} 次` : '…'}</span></summary>
    <p className="usage-note">发起执行即计一次，不论成功或失败。取消不计，批量操作计一次。仅保存在本机，未上传。</p>
    {stats?.startedAt && <p className="usage-note">自 {new Date(stats.startedAt).toLocaleDateString()} 起累计</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {rows.length > 0 ? <>
      <ul className="usage-sources">{origins.map(source => <li key={source.name}>{source.name} <strong>{source.count.toLocaleString()}</strong></li>)}</ul>
      <table className="usage-table">
        <thead><tr><th>动作</th><th>执行次数</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.count.toLocaleString()}</td></tr>)}</tbody>
      </table>
      <div className="usage-controls">
        {confirmReset ? <><span>清空本机统计？</span>
          <button type="button" className="button small" disabled={busy} onClick={() => void reset()}>确认清空</button>
          <button type="button" className="button subtle small" disabled={busy} onClick={() => setConfirmReset(false)}>取消</button></>
          : <button type="button" className="button subtle small" onClick={() => setConfirmReset(true)}>清空统计</button>}
      </div>
    </> : stats && <p className="usage-note">还没有操作记录。</p>}
  </details>;
}

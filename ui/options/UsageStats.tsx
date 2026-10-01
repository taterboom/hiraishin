import { useCallback, useEffect, useRef, useState } from 'react';
import { USAGE_KEY, USAGE_SOURCES } from '../../src/usage.js';
import { LOCALE_TAGS, getLocale, t } from '../../src/i18n.js';
import { api } from '../shared/api';
import type { ActionInfo, UsageStatsData } from '../shared/types';

// Counted ids that are not in the action list the page receives.
function extraName(id: string): string | undefined {
  if (id === 'retry-transfer' || id === 'jump-history') return t(`options.usage.action.${id}`);
  if (id === 'fill-chatgpt') return t('action.mode.fill', { target: 'ChatGPT' });
  if (id === 'fill-claude') return t('action.mode.fill', { target: 'Claude' });
  return undefined;
}
const localeTag = () => (LOCALE_TAGS as Record<string, string>)[getLocale()];
const formatNumber = (n: number) => n.toLocaleString(localeTag());
/** Grouped digits for display; exactly 1 stays a number so t() can pick the English singular. */
const countParam = (n: number) => (n === 1 ? 1 : formatNumber(n));

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
      if (request.current === version) setError(t('options.usage.loadFailed'));
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
    id, name: actions.find(action => action.id === id)?.name ?? extraName(id) ?? t('options.usage.removed'),
    count: Object.values(sources).reduce((sum, n) => sum + n, 0), sources,
  })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const origins = Object.keys(USAGE_SOURCES).map(id => ({
    name: t(`options.usage.source.${id}`), count: rows.reduce((sum, row) => sum + (row.sources[id] ?? 0), 0),
  })).filter(source => source.count);

  const reset = async () => {
    setBusy(true);
    try { await api.resetUsage(); setConfirmReset(false); await load(); }
    catch { setError(t('options.usage.resetFailed')); }
    finally { setBusy(false); }
  };
  return <details className="usage-stats">
    <summary>{t('options.usage.summary')} <span>{stats ? t('options.usage.total', { count: countParam(total) }) : '…'}</span></summary>
    <p className="usage-note">{t('options.usage.note')}</p>
    {stats?.startedAt && <p className="usage-note">{t('options.usage.since', { date: new Date(stats.startedAt).toLocaleDateString(localeTag()) })}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {rows.length > 0 ? <>
      <ul className="usage-sources">{origins.map(source => <li key={source.name}>{source.name} <strong>{formatNumber(source.count)}</strong></li>)}</ul>
      <table className="usage-table">
        <thead><tr><th>{t('options.table.action')}</th><th>{t('options.usage.runs')}</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><td>{row.name}</td><td>{formatNumber(row.count)}</td></tr>)}</tbody>
      </table>
      <div className="usage-controls">
        {confirmReset ? <><span>{t('options.usage.confirmReset')}</span>
          <button type="button" className="button small" disabled={busy} onClick={() => void reset()}>{t('options.usage.confirm')}</button>
          <button type="button" className="button subtle small" disabled={busy} onClick={() => setConfirmReset(false)}>{t('options.cancel')}</button></>
          : <button type="button" className="button subtle small" onClick={() => setConfirmReset(true)}>{t('options.usage.reset')}</button>}
      </div>
    </> : stats && <p className="usage-note">{t('options.usage.empty')}</p>}
  </details>;
}

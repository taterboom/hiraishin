import { useCallback, useEffect, useRef, useState } from 'react';
import { LICENSE_KEY, TRIAL_MS } from '../../src/license.js';
import { api } from '../shared/api';
import type { LicenseView } from '../shared/types';

const DAY = 24 * 60 * 60 * 1000;
// Returning to this page (focus / visible) checks at once; that covers the usual path of paying
// on Stripe's tab and switching back. While the page stays visible it also checks every 20s, and
// gives up 10 minutes after the last return. Nothing runs while the page is hidden.
const POLL_MS = 20_000;
const POLL_WINDOW_MS = 10 * 60_000;

function summary(license: LicenseView): string {
  if (license.state === 'licensed') return '已购买，感谢支持。';
  if (license.state === 'revoked') return '授权已被撤销（例如已退款）。如有疑问，请带上授权码联系我们。';
  if (license.state === 'expired') return '试用已结束。购买或输入授权码后即可继续使用，设置和待处理内容都已保留。';
  if (!license.trialStarted) return `首次成功执行动作后开始 ${TRIAL_MS / DAY} 天完整试用。`;
  const days = Math.max(1, Math.ceil(((license.trialEndsAt ?? 0) - Date.now()) / DAY));
  return `试用中，还剩 ${days} 天（到 ${new Date(license.trialEndsAt ?? 0).toLocaleDateString()}）。`;
}

export function LicenseSection({ show }: { show: (message: string, kind?: 'info' | 'error') => void }) {
  const [license, setLicense] = useState<LicenseView | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [justCollected, setJustCollected] = useState(false);
  const collecting = useRef(false);

  const load = useCallback(async () => setLicense(await api.getLicense()), []);

  const collect = useCallback(async (manual = false) => {
    if (collecting.current) return;
    collecting.current = true;
    try {
      const result = await api.collectLicense();
      setLicense(result.license);
      if (result.status === 'activated') { setJustCollected(true); show('付款已确认，授权已激活。'); }
      else if (result.status === 'revoked') show('这笔付款已退款或被撤销。', 'error');
      else if (manual && result.status === 'pending') show('还没有收到付款确认，通常需要几秒到几分钟。');
    } catch (error) {
      if (manual) show((error as Error).message, 'error');
    } finally { collecting.current = false; }
  }, [show]);

  useEffect(() => {
    load().catch(() => {});
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[LICENSE_KEY]) load().catch(() => {});
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, [load]);

  // Bounded checks while a purchase is pending and this page is visible; never an open-ended poll.
  const pending = Boolean(license?.pendingPurchase);
  useEffect(() => {
    if (!pending) return;
    let timer = 0;
    let until = 0;
    const tick = () => {
      if (document.visibilityState !== 'visible' || Date.now() > until) return;
      timer = window.setTimeout(() => { void collect(); tick(); }, POLL_MS);
    };
    const onReturn = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== 'visible') return;
      until = Date.now() + POLL_WINDOW_MS;
      void collect();
      tick();
    };
    onReturn();
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onReturn); window.removeEventListener('focus', onReturn); };
  }, [pending, collect]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try { await task(); } catch (error) { show((error as Error).message, 'error'); } finally { setBusy(false); }
  };
  const purchase = () => run(async () => { setLicense(await api.startPurchase()); });
  const activate = () => run(async () => {
    setLicense(await api.activateLicense(input));
    setInput('');
    show('授权已激活。');
  });
  const copyKey = (key: string) => run(async () => { await navigator.clipboard.writeText(key); show('已复制授权码。'); });
  const downloadKey = (key: string) => {
    const url = URL.createObjectURL(new Blob([`飛雷神 Hiraishin 授权码\n\n${key}\n\n重装或换电脑时，在设置页输入此授权码即可恢复。\n`], { type: 'text/plain' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'hiraishin-license.txt' });
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!license) return null;
  const canBuy = license.state !== 'licensed' && license.configured;
  return <section className="license" aria-labelledby="license-heading" data-state={license.state}>
    <h2 id="license-heading">授权</h2>
    <p className="license-summary">{summary(license)}</p>

    {license.licenseKey && <div className={justCollected ? 'license-key fresh' : 'license-key'}>
      {justCollected && <strong>请保存你的授权码，重装或换电脑时用它恢复：</strong>}
      <code>{license.licenseKey}</code>
      <button type="button" className="button small" disabled={busy} onClick={() => copyKey(license.licenseKey!)}>复制</button>
      <button type="button" className="button subtle small" onClick={() => downloadKey(license.licenseKey!)}>下载备份</button>
    </div>}

    {license.state !== 'licensed' && <>
      {pending && <p className="license-pending" role="status">
        等待付款确认…
        <button type="button" className="link" disabled={busy} onClick={() => void collect(true)}>我已付款，重新检查</button>
      </p>}
      <div className="license-actions">
        {canBuy && <button type="button" className="button" disabled={busy} onClick={() => void purchase()}>一次性购买</button>}
        {!license.configured && <span className="muted">购买服务即将开放。</span>}
      </div>
      <form className="license-activate" onSubmit={event => { event.preventDefault(); if (input.trim()) void activate(); }}>
        <label className="field"><span>已有授权码</span>
          <input value={input} onChange={event => setInput(event.target.value)} placeholder="MK-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
            autoComplete="off" spellCheck={false} disabled={!license.configured} />
        </label>
        <button type="submit" className="button" disabled={busy || !input.trim() || !license.configured}>激活</button>
      </form>
    </>}
  </section>;
}

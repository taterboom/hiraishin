import { useCallback, useEffect, useRef, useState } from 'react';
import { LICENSE_KEY, TRIAL_MS } from '../../src/license.js';
import { LOCALE_TAGS, getLocale, t } from '../../src/i18n.js';
import { api } from '../shared/api';
import type { LicenseView } from '../shared/types';

const DAY = 24 * 60 * 60 * 1000;
// Returning to this page (focus / visible) checks at once; that covers the usual path of paying
// on Stripe's tab and switching back. While the page stays visible it also checks every 20s, and
// gives up 10 minutes after the last return. Nothing runs while the page is hidden.
const POLL_MS = 20_000;
const POLL_WINDOW_MS = 10 * 60_000;

function summary(license: LicenseView): string {
  if (license.state === 'licensed') return t('options.license.licensed');
  if (license.state === 'revoked') return t('options.license.revoked');
  if (license.state === 'expired') return t('options.license.expired');
  if (!license.trialStarted) return t('options.license.notStarted', { count: TRIAL_MS / DAY });
  const days = Math.max(1, Math.ceil(((license.trialEndsAt ?? 0) - Date.now()) / DAY));
  const date = new Date(license.trialEndsAt ?? 0).toLocaleDateString((LOCALE_TAGS as Record<string, string>)[getLocale()]);
  return t('options.license.trial', { count: days, date });
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
      if (result.status === 'activated') { setJustCollected(true); show(t('options.license.paymentConfirmed')); }
      else if (result.status === 'revoked') show(t('options.license.paymentRevoked'), 'error');
      else if (manual && result.status === 'pending') show(t('options.license.paymentPending'));
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
    show(t('options.license.activated'));
  });
  const copyKey = (key: string) => run(async () => { await navigator.clipboard.writeText(key); show(t('options.license.copied')); });
  const downloadKey = (key: string) => {
    const url = URL.createObjectURL(new Blob([t('options.license.backupFile', { key })], { type: 'text/plain' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'hiraishin-license.txt' });
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!license) return null;
  const canBuy = license.state !== 'licensed' && license.configured;
  return <section className="license" aria-labelledby="license-heading" data-state={license.state}>
    <h2 id="license-heading">{t('options.license.heading')}</h2>
    <p className="license-summary">{summary(license)}</p>

    {license.licenseKey && <div className={justCollected ? 'license-key fresh' : 'license-key'}>
      {justCollected && <strong>{t('options.license.saveKey')}</strong>}
      <code>{license.licenseKey}</code>
      <button type="button" className="button small" disabled={busy} onClick={() => copyKey(license.licenseKey!)}>{t('options.license.copy')}</button>
      <button type="button" className="button subtle small" onClick={() => downloadKey(license.licenseKey!)}>{t('options.license.download')}</button>
    </div>}

    {license.state !== 'licensed' && <>
      {pending && <p className="license-pending" role="status">
        {t('options.license.pending')}
        <button type="button" className="link" disabled={busy} onClick={() => void collect(true)}>{t('options.license.recheck')}</button>
      </p>}
      <div className="license-actions">
        {canBuy && <button type="button" className="button" disabled={busy} onClick={() => void purchase()}>{t('options.license.buy')}</button>}
        {!license.configured && <span className="muted">{t('options.license.comingSoon')}</span>}
      </div>
      <form className="license-activate" onSubmit={event => { event.preventDefault(); if (input.trim()) void activate(); }}>
        <label className="field"><span>{t('options.license.haveKey')}</span>
          <input value={input} onChange={event => setInput(event.target.value)} placeholder="MK-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
            autoComplete="off" spellCheck={false} disabled={!license.configured} />
        </label>
        <button type="submit" className="button" disabled={busy || !input.trim() || !license.configured}>{t('options.license.activate')}</button>
      </form>
    </>}
  </section>;
}

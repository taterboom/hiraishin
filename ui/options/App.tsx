import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { comboFromEvent, displayCombo, holdKeyLabel, nativeEligible, webEligible, reservedReason } from '../../src/keys.js';
import { categoryName } from '../../src/actions.js';
import { LOCALE_PREFERENCES, applyLocalePreference, getLocale, t } from '../../src/i18n.js';
import { ActionIcon, SettingsGlyph } from '../popup/icons';
import { WHEEL_SIZE, Wheel, sectorAt } from '../overlay/Wheel';
import { OVERLAY_HOLD_MODIFIERS, OVERLAY_SECTORS, PAGE_ORIGINS } from '../../src/settings.js';
import { api } from '../shared/api';
import type { ActionInfo, Capability, CustomTarget, Settings, SettingsView, TargetInfo } from '../shared/types';
import { WheelPositionDialog } from './WheelPositionDialog';
import { WheelActionPicker } from './WheelActionPicker';
import { WheelPositions, wheelDirection } from './WheelPositions';
import { createSettingsClient } from './settings-client';
import { UsageStats } from './UsageStats';
import { LicenseSection } from './LicenseSection';

type Status = { message: string; kind: 'info' | 'error' } | null;
const CAPABILITIES: Capability[] = ['navigate', 'fill', 'send'];
const capabilityLabel = (capability: Capability) => t(`options.capability.${capability}`);
type LocalePreference = Settings['locale'];
// The privacy notice is published once per language; English sits at the root.
const PRIVACY_PAGE: Record<string, string> = { zh: 'zh/privacy.html', ja: 'ja/privacy.html', en: 'privacy.html' };

/** Switch the page's language before React renders the view that carries the preference. */
function applyPageLocale(preference: LocalePreference | undefined) {
  applyLocalePreference(preference);
  document.title = t('options.pageTitle');
}

export function App() {
  const [view, setView] = useState<SettingsView | null>(null);
  const settingsClient = useMemo(() => createSettingsClient(api, (next: SettingsView) => {
    applyPageLocale(next.settings.locale);
    setView(next);
  }), []);
  const [status, setStatus] = useState<Status>(null);
  const [recording, setRecording] = useState<{ action: ActionInfo; combo: string | null; note: string } | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);

  const show = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    setStatus({ message, kind });
    setTimeout(() => setStatus(current => (current?.message === message ? null : current)), 4000);
  }, []);

  const load = useCallback(() => settingsClient.load(), [settingsClient]);
  useEffect(() => {
    load().catch(error => show((error as Error).message, 'error'));
    const reload = () => { if (document.visibilityState === 'visible') load().catch(() => {}); };
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    // @types/chrome omits removeListener on these events although Chrome provides it.
    const permissionEvents = [chrome.permissions?.onAdded, chrome.permissions?.onRemoved] as Array<chrome.events.Event<() => void> | undefined>;
    for (const event of permissionEvents) event?.addListener(reload);
    return () => {
      window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', reload);
      for (const event of permissionEvents) event?.removeListener(reload);
    };
  }, [load, show]);

  const saveSettings = useCallback(async (mutate: (settings: Settings) => void) => {
    try { await settingsClient.save(mutate); show(t('options.saved')); return true; }
    catch (error) { show((error as Error).message, 'error'); return false; }
  }, [settingsClient, show]);

  const setBinding = useCallback(async (actionId: string, combo: string | null) => {
    try { await settingsClient.setBinding(actionId, combo); show(combo ? t('options.web.saved') : t('options.web.cleared')); }
    catch (error) { show((error as Error).message, 'error'); }
  }, [settingsClient, show]);

  const requestPagePermission = useCallback(async () => {
    const granted = await chrome.permissions.request({ origins: PAGE_ORIGINS });
    if (granted) await settingsClient.sync();
    return granted;
  }, [settingsClient]);

  const platform = view?.status.platform ?? 'unknown';
  const label = (combo: string) => (combo ? displayCombo(combo, platform) : '');

  if (!view) return <main className="page"><Header /><p className="lead">{t('options.loading')}</p>{status && <StatusBar status={status} />}</main>;

  return (
    <main className="page">
      {/* A worker still running an older build sends settings without `locale`; show the picker anyway. */}
      <Header locale={view.settings.locale ?? 'auto'}
        onLocale={locale => saveSettings(settings => { settings.locale = locale; })} />
      <LicenseSection show={show} />

      <ActionsSection view={view} label={label} onRecord={action => setRecording({ action, combo: null, note: '' })}
        onClear={id => setBinding(id, null)} onGrant={async () => { const ok = await requestPagePermission(); show(ok ? t('options.web.granted') : t('options.permissionDenied'), ok ? 'info' : 'error'); }}
        onSaveDisabled={sites => saveSettings(settings => { settings.webShortcuts.disabledSites = sites; })}
        onOpenNative={action => {
          chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
          show(t('options.native.openFor', { name: action.name }));
        }}
        onOverlay={enabled => saveSettings(settings => { settings.overlay.enabled = enabled; })}
        onHoldCode={code => saveSettings(settings => { settings.overlay.holdCode = code; })}
        onOpenTargets={() => setTargetsOpen(true)}
        saveSettings={saveSettings} />
      {targetsOpen && (
        <TargetsDialog view={view} saveSettings={saveSettings} show={show} onSync={settingsClient.sync}
          onClose={() => setTargetsOpen(false)} />
      )}
      {status && <StatusBar status={status} />}
      {recording && (
        <Recorder view={view} platform={platform} recording={recording} setRecording={setRecording}
          onSaveWeb={async () => {
            if (!recording.combo) return;
            if (!view.status.granted) {
              const granted = await requestPagePermission();
              if (!granted) show(t('options.web.savedWithoutPermission'), 'error');
            }
            const { action, combo } = recording;
            setRecording(null);
            await setBinding(action.id, combo);
          }}
          onNative={() => { setRecording(null); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); show(t('options.native.open')); }} />
      )}
      <UsageStats actions={view.actions} />
      <footer className="settings-footer"><span>飛雷神 {chrome.runtime.getManifest().version}</span>
        <a href={PRIVACY_PAGE[getLocale()] ?? PRIVACY_PAGE.en} target="_blank" rel="noreferrer">{t('options.footer.privacy')}</a>
      </footer>
    </main>
  );
}

/** The language picker appears once settings have loaded, since it saves into them. */
function Header({ locale, onLocale }: { locale?: LocalePreference; onLocale?: (locale: LocalePreference) => void }) {
  return (
    <header className="brand">
      <img className="brand-mark" src="icons/mark.svg" alt="" width="46" height="46" />
      <div>
        <h1>飛雷神 <span>HIRAISHIN</span></h1>
        <p>{t('options.header.tagline')}</p>
      </div>
      {locale && onLocale && <label className="brand-locale">
        <span>{t('options.language.label')}</span>
        <select value={locale} onChange={event => onLocale(event.target.value as LocalePreference)}>
          {(LOCALE_PREFERENCES as LocalePreference[]).map(value => <option key={value} value={value}>{t(`locale.${value}`)}</option>)}
        </select>
      </label>}
    </header>
  );
}

/** A label that changes with state but keeps the width of its widest text, so a button never
 *  resizes mid-interaction and pushes its neighbours around ("Save target" ↔ "Saving…"). */
function StableLabel({ labels, index }: { labels: string[]; index: number }) {
  return <span className="stable-label">
    {labels.map((label, at) => <span key={at} data-active={at === index || undefined}>{label}</span>)}
  </span>;
}

function StatusBar({ status }: { status: NonNullable<Status> }) {
  return <p className="status" role="status" aria-live="polite" data-kind={status.kind}>{status.message}</p>;
}

/** Only what the two key columns cannot show on their own: a binding that will not actually fire. */
function webProblem(action: ActionInfo, view: SettingsView): string {
  if (!action.web || !action.webBinding) return '';
  if (!view.status.granted) return t('options.problem.ungranted');
  if (action.shadowed) return t('options.problem.shadowed');
  if (action.conflict) return t('options.problem.conflict');
  return '';
}

/** Twenty-odd rows read better clustered by category than as one flat list. */
function groupByCategory(actions: ActionInfo[]) {
  const groups = new Map<string, ActionInfo[]>();
  for (const action of actions) {
    if (!groups.has(action.category)) groups.set(action.category, []);
    groups.get(action.category)!.push(action);
  }
  return groups;
}

function ActionsSection({ view, label, onRecord, onClear, onGrant, onSaveDisabled, onOpenNative, onOpenTargets, onOverlay, onHoldCode, saveSettings }: {
  view: SettingsView; label: (combo: string) => string; onRecord: (action: ActionInfo) => void; onClear: (id: string) => void;
  onGrant: () => void; onSaveDisabled: (sites: string[]) => void; onOpenNative: (action: ActionInfo) => void;
  onOpenTargets: () => void;
  onOverlay: (enabled: boolean) => void;
  onHoldCode: (code: string) => void;
  saveSettings: (change: (settings: Settings) => void) => Promise<boolean>;
}) {
  const [positionAction, setPositionAction] = useState<ActionInfo | null>(null);
  const overlayEnabled = view.settings.overlay.enabled;
  const [sites, setSites] = useState(view.settings.webShortcuts.disabledSites.join('\n'));
  useEffect(() => { setSites(view.settings.webShortcuts.disabledSites.join('\n')); }, [view.settings.webShortcuts.disabledSites]);
  const groups = groupByCategory(view.actions.filter(action => !action.panelInput));
  return (
    <section id="actions" aria-labelledby="actions-heading">
      <div className="actions-head">
        <h2 id="actions-heading">{t('options.actions.heading')}</h2>
        <button className="button subtle" type="button" onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>{t('options.actions.openChromeShortcuts')}</button>
      </div>
      <p className="lead">{t('options.actions.lead')}</p>

      <div className="overlay-settings">
        <div className="overlay-settings-head">
          <label className="toggle overlay-toggle">
            <input type="checkbox" checked={overlayEnabled} aria-expanded={overlayEnabled} aria-controls="wheel-settings"
              onChange={event => onOverlay(event.target.checked)} />
            <span>
              <strong>{t('options.overlay.toggle')}</strong>
              <small>{t('options.overlay.toggleHint')}</small>
            </span>
          </label>
        </div>
        {overlayEnabled && <div id="wheel-settings">
          {!view.status.granted && <div className="overlay-permission-note">
            <p>{t('options.overlay.permissionNote', { key: holdKeyLabel(view.settings.overlay.holdCode, view.status.platform) })}</p>
            <button type="button" className="button" onClick={onGrant}>{t('options.overlay.grant')}</button>
          </div>}
          <div className="overlay-controls">
            <label className="hold-field">
              <span>{t('options.overlay.holdKey')}</span>
              <select className="hold-select" aria-label={t('options.overlay.holdKeyAria')} value={view.settings.overlay.holdCode}
                onChange={event => onHoldCode(event.target.value)}>
                <option value="auto">{t('options.overlay.holdDefault', { key: holdKeyLabel('auto', view.status.platform) })}</option>
                {OVERLAY_HOLD_MODIFIERS.map((code: string) => (
                  <option key={code} value={code}>{holdKeyLabel(code, view.status.platform)}</option>
                ))}
                <option value="KeyZ">Z</option>
              </select>
            </label>
            <p className="overlay-gesture">{view.settings.overlay.holdMs > 0
              ? t('options.overlay.gestureHoldMs', { count: view.settings.overlay.holdMs }) : t('options.overlay.gestureHold')}
              <span aria-hidden="true"> → </span>{t('options.overlay.gestureFlick')}<span aria-hidden="true"> → </span>{t('options.overlay.gestureRelease')}</p>
          </div>
          <details className="overlay-help">
            <summary>{t('options.overlay.helpSummary')}</summary>
            <p>{t('options.overlay.helpGesture')}</p>
            <p>{t('options.overlay.helpScope')}</p>
          </details>
        </div>}
        <WheelSettings view={view} saveSettings={saveSettings} />
      </div>
      <table className="shortcut-table">
        <thead><tr><th>{t('options.table.action')}</th><th>{t('options.table.wheelPosition')}</th>
          <th>{t('options.table.browserShortcut')}</th><th>{t('options.table.webShortcut')}</th></tr></thead>
        <tbody>
          {[...groups].map(([category, actions]) => [
            <tr key={`group-${category}`} className="group-row">
              {/* The flex row lives in a wrapper: `display: flex` on a `th` drops it out of the
                  table formatting context, so colSpan stops working and the text stacks vertically. */}
              <th colSpan={4}>
                <div className="group-row-inner">
                  <span className="group-label">{categoryName(category)}</span>
                  {/* An icon, not a label: 11px text beside an 11px group heading competed with it. */}
                  {category === 'ai' && (
                    <button type="button" className="group-action" onClick={onOpenTargets}
                      title={t('options.table.manageTargets')} aria-label={t('options.table.manageTargets')}>
                      <SettingsGlyph />
                    </button>
                  )}
                </div>
              </th>
            </tr>,
            ...actions.map(action => {
              const problem = webProblem(action, view);
              return (
                <tr key={action.id} data-action-id={action.id}>
                  {/* Same reason as the group row: a flex `td` leaves the table formatting context,
                      so its height and bottom border stop matching the other cells in the row. */}
                  <td className="action-cell">
                    <div className="action-cell-inner"><ActionIcon action={action} /><span className="action-details">
                      <span>{action.name}</span>
                    </span></div>
                  </td>
                  <td className="wheel-position-cell">
                    <button type="button" className={`wheel-position-button${view.settings.overlay.slots.includes(action.id) ? '' : ' empty'}`} aria-label={t('options.table.setPositionAria', { name: action.name })}
                      aria-haspopup="dialog" onClick={() => setPositionAction(action)}>
                      {view.settings.overlay.slots.includes(action.id)
                        ? <WheelPositions actionId={action.id} slots={view.settings.overlay.slots} />
                        : t('options.table.setPosition')}
                    </button>
                  </td>
                  <td className={action.command ? 'kbd-cell' : 'muted'}>
                    {action.command ? (
                      <>
                        {/* Native bindings live in Chrome's own settings; clicking the key opens them. */}
                        <button type="button" className={`kbd-button${action.nativeCombo ? '' : ' empty'}`}
                          title={t('options.table.nativeTitle')} onClick={() => onOpenNative(action)}>
                          {label(action.nativeCombo) || t('options.table.unbound')}
                        </button>
                        {!action.nativeCombo && action.suggested && <span className="hint warn">{t('options.table.suggestedInactive', { combo: label(action.suggested) })}</span>}
                      </>
                    ) : action.web ? t('options.table.webOnly') : t('options.table.panelOnly')}
                  </td>
                  <td className={action.web ? 'kbd-cell' : 'muted'}>
                    {action.web ? (
                      <>
                        <button type="button" className={`kbd-button${action.webBinding ? '' : ' empty'}`} title={action.webBinding ? t('options.table.editTitle') : t('options.table.recordTitle')} onClick={() => onRecord(action)}>
                          {label(action.webBinding) || t('options.table.record')}
                        </button>
                        {action.webBinding && <button type="button" className="clear" title={t('options.table.clearTitle')} aria-label={t('options.table.clearAria', { name: action.name })} onClick={() => onClear(action.id)}>×</button>}
                        {problem && <span className="hint warn">{problem}</span>}
                      </>
                    ) : '—'}
                  </td>
                </tr>
              );
            }),
          ])}
        </tbody>
      </table>
      {positionAction && <WheelPositionDialog action={positionAction} view={view}
        onAssign={index => saveSettings(settings => { settings.overlay.slots[index] = positionAction.id; })}
        onClose={() => setPositionAction(null)} />}
      <KeyProbe view={view} label={label} />
      <details className="advanced">
        <summary>{t('options.sites.summary')}</summary>
        <label htmlFor="disabled-sites">{t('options.sites.label')}</label>
        <textarea id="disabled-sites" rows={3} spellCheck={false} value={sites} onChange={event => setSites(event.target.value)} />
        <button className="button" style={{verticalAlign: 'top', marginLeft: 8}} type="button" onClick={() => onSaveDisabled(sites.split('\n').map(line => line.trim().toLowerCase()).filter(Boolean))}>{t('options.save')}</button>
      </details>
    </section>
  );
}

function KeyProbe({ view, label }: { view: SettingsView; label: (combo: string) => string }) {
  const [result, setResult] = useState<string>('');
  const platform = view.status.platform;
  return (
    <details className="advanced">
      <summary>{t('options.probe.summary')}</summary>
      <p className="lead">{t('options.probe.lead')}</p>
      <input className="probe" placeholder={t('options.probe.placeholder')} onKeyDown={event => {
        event.preventDefault();
        const combo = comboFromEvent(event, platform);
        if (!combo) { setResult(['Control', 'Shift', 'Alt', 'Meta'].includes(event.key) ? '' : t('options.needModifier')); return; }
        const owner = view.actions.find(action => action.webBinding === combo || action.nativeCombo === combo);
        const notes = [t('options.probe.received', { combo: label(combo) })];
        if (owner) notes.push(t(owner.nativeCombo === combo ? 'options.probe.boundNative' : 'options.probe.boundWeb', { name: owner.name }));
        else notes.push(t('options.probe.unbound'));
        const reserved = reservedReason(combo, platform);
        if (reserved) notes.push(reserved);
        setResult(notes.join(' · '));
      }} />
      {result && <p className="probe-result">{result}</p>}
    </details>
  );
}

const emptyTarget = (): CustomTarget => ({ id: '', name: '', openUrl: '', match: [], capability: 'navigate', selectors: { input: '', submit: '' } });

/** The wheel's sectors, clockwise from twelve o'clock. Changing the count keeps whatever still
 *  fits, because re-picking every action after a count change would be tedious; sectors a smaller
 *  count cuts off come back when the count grows again. */
function WheelSettings({ view, saveSettings }: {
  view: SettingsView; saveSettings: (change: (settings: Settings) => void) => Promise<boolean>;
}) {
  const slots = view.settings.overlay.slots;
  const [picked, setPicked] = useState(0);
  const choices = view.actions.filter(action => !action.panelInput);
  // Sectors dropped by a smaller count, kept for this page session so switching back restores
  // them: a one-click control makes an accidental 12 → 4 far more likely than a select did.
  const dropped = useRef<(string | null)[]>([]);
  const resize = (size: number) => {
    if (size === slots.length) return;
    setPicked(current => Math.min(current, size - 1));
    saveSettings(settings => {
      const latest = settings.overlay.slots;
      const known = [...latest, ...dropped.current.slice(latest.length)];
      dropped.current = known;
      settings.overlay.slots = Array.from({ length: size }, (_, index) => known[index] ?? null);
    });
  };
  return (
    <div className="wheel-config" role="group" aria-labelledby="wheel-heading">
      <div className="wheel-config-head">
        <h3 id="wheel-heading">{t('options.wheel.heading')}</h3>
      </div>
      <div className="wheel-editor">
        <div className="wheel-preview">
          {/* Not a drawing of the wheel: the wheel itself, the same component and the same stylesheet
              the page injects, only scaled down. Clicking picks a sector through `sectorAt`, the very
              function the gesture uses, so the two can never disagree about which way a sector faces.
              The scaled frame is also what contains the wheel's fixed positioning: a transformed
              ancestor becomes the containing block for its fixed descendants. */}
          <div className="wheel-stage" onClick={event => {
            const stage = event.currentTarget.getBoundingClientRect();
            const at = sectorAt(event.clientX - (stage.left + stage.width / 2),
              event.clientY - (stage.top + stage.height / 2), slots.length);
            if (at !== null) setPicked(at);
          }}>
            <div className="wheel-frame">
              <Wheel slots={slots.map(id => (id ? choices.find(item => item.id === id) ?? null : null))}
                activeIndex={picked} position={{ left: WHEEL_SIZE / 2, top: WHEEL_SIZE / 2 }}
                hint={t('options.wheel.previewHint')} unavailable={() => ''} />
            </div>
          </div>
        </div>
        <div className="wheel-side">
        <div className="slot-count">
          <span id="slot-count-label">{t('options.wheel.count')}</span>
          <div className="segmented" role="radiogroup" aria-labelledby="slot-count-label">
            {OVERLAY_SECTORS.map((count: number) => <label key={count} className="segment">
              <input type="radio" name="slot-count" value={count} checked={slots.length === count}
                onChange={() => resize(count)} />
              <span>{count}</span>
            </label>)}
          </div>
        </div>
        <div className="wheel-assignment">
          <p className="assignment-caption">{t('options.wheel.current')}</p>
          <strong className="selected-direction">{wheelDirection(picked, slots.length)}<span>{t('options.wheel.sector', { index: picked + 1 })}</span></strong>
          <div className="slot-assign">
            <span>{t('options.wheel.sectorAction')}</span>
            <WheelActionPicker key={`${slots.length}:${picked}`} actions={choices} value={slots[picked]} slots={slots}
              onChange={id => saveSettings(settings => {
                settings.overlay.slots = slots.map((current, at) => at === picked ? id : current);
              })} />
          </div>
          <p className="assignment-hint">{t('options.wheel.assignHint')}</p>
        </div>
        </div>
      </div>
    </div>
  );
}

function TargetsDialog({ view, saveSettings, show, onSync, onClose }: {
  view: SettingsView; saveSettings: (mutate: (settings: Settings) => void) => Promise<boolean>;
  show: (message: string, kind?: 'info' | 'error') => void; onSync: () => Promise<SettingsView>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = dialogRef.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  const [form, setForm] = useState<CustomTarget>(emptyTarget());
  const [matchText, setMatchText] = useState('');
  const [open, setOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const edit = (target: TargetInfo) => {
    setForm({ id: target.id, name: target.name, openUrl: target.openUrl, match: target.match, capability: target.capability, selectors: { ...target.selectors } });
    setMatchText(target.match.join('\n'));
    setOpen(true);
    setTimeout(() => nameRef.current?.focus(), 0);
  };
  const slugify = (name: string) => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'target';
    const ids = new Set(view.targets.map(target => target.id));
    let id = base;
    let counter = 2;
    while (ids.has(id)) id = `${base}-${counter++}`;
    return id;
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setSaveError('');
    const target: CustomTarget = {
      ...form, id: form.id || slugify(form.name), name: form.name.trim(), openUrl: form.openUrl.trim(),
      match: matchText.split('\n').map(line => line.trim()).filter(Boolean),
      selectors: { input: form.selectors.input.trim(), submit: form.selectors.submit.trim() },
    };
    const saved = await saveSettings(settings => {
      settings.targets.custom = settings.targets.custom.filter(item => item.id !== target.id);
      settings.targets.custom.push(target);
    });
    setSaving(false);
    if (!saved) { setSaveError(t('options.targets.saveFailed')); return; }
    setForm(emptyTarget()); setMatchText(''); setOpen(false);
  };

  return (
    <dialog className="wide" ref={dialogRef} onClose={onClose} aria-labelledby="targets-heading">
      <div className="dialog-head">
        <h3 id="targets-heading">{t('options.targets.heading')}</h3>
        <button type="button" className="icon-close" aria-label={t('options.close')} onClick={() => dialogRef.current?.close()}>×</button>
      </div>
      <p className="lead">{t('options.targets.lead')}</p>
      <label className="field"><span>{t('options.targets.default')}</span>
        <select value={view.settings.defaultTargetId} onChange={event => {
          const value = event.target.value;
          void saveSettings(settings => { settings.defaultTargetId = value; });
        }}>
          {view.targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
        </select>
      </label>
      <div className="target-list">
        {view.targets.map(target => (
          <div key={target.id} className="target-card">
            <div className="target-head"><strong>{target.name}</strong><span className="muted">{target.openUrl}</span></div>
            <div className="target-controls">
              {target.builtin ? (
                <select aria-label={t('options.targets.capabilityAria', { name: target.name })} value={target.capability} onChange={event => {
                  const value = event.target.value as Capability;
                  void saveSettings(settings => { settings.targets.enabled[target.id] = value; });
                }}>
                  {CAPABILITIES.map(value => <option key={value} value={value}>{capabilityLabel(value)}</option>)}
                </select>
              ) : <span className="pill muted">{capabilityLabel(target.capability)}</span>}
              <span className={`pill ${target.granted ? 'ok' : 'warn'}`}>{target.granted ? t('options.targets.granted') : t('options.targets.notGranted')}</span>
              {!target.granted && target.capability !== 'navigate' && (
                <button type="button" className="button small" onClick={async () => {
                  const granted = await chrome.permissions.request({ origins: target.origins });
                  if (granted) { await onSync(); show(t('options.targets.allowed', { name: target.name })); } else show(t('options.permissionDenied'), 'error');
                }}>{t('options.targets.allow')}</button>
              )}
              {!target.builtin && (
                <>
                  <button type="button" className="link" onClick={() => edit(target)}>{t('options.edit')}</button>
                  <button type="button" className="link danger" onClick={() => saveSettings(settings => {
                    settings.targets.custom = settings.targets.custom.filter(item => item.id !== target.id);
                    if (settings.defaultTargetId === target.id) settings.defaultTargetId = view.targets.find(item => item.builtin)!.id;
                  })}>{t('options.delete')}</button>
                </>
              )}
            </div>
            <p className="muted small-text">{t('options.targets.match', { patterns: target.match.join(t('options.targets.matchSeparator')) })}</p>
          </div>
        ))}
      </div>
      <details className="advanced" open={open} onToggle={event => setOpen((event.target as HTMLDetailsElement).open)}>
        <summary>{t('options.targets.addCustom')}</summary>
        <form className="target-form" onSubmit={submit}>
          <label className="field"><span>{t('options.targets.name')}</span><input ref={nameRef} required maxLength={40} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
          <label className="field"><span>{t('options.targets.openUrl')}</span><input type="url" required placeholder="https://example.com/chat" value={form.openUrl} onChange={event => setForm({ ...form, openUrl: event.target.value })} /></label>
          <label className="field"><span>{t('options.targets.matchRules')}</span><textarea rows={2} placeholder="https://example.com/chat/*" value={matchText} onChange={event => setMatchText(event.target.value)} /></label>
          <label className="field"><span>{t('options.targets.capability')}</span>
            <select value={form.capability} onChange={event => setForm({ ...form, capability: event.target.value as Capability })}>
              {CAPABILITIES.map(value => <option key={value} value={value}>{capabilityLabel(value)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('options.targets.inputSelector')}</span><input placeholder="textarea, [contenteditable=true]" value={form.selectors.input} onChange={event => setForm({ ...form, selectors: { ...form.selectors, input: event.target.value } })} /></label>
          <label className="field"><span>{t('options.targets.submitSelector')}</span><input placeholder="button[type=submit]" value={form.selectors.submit} onChange={event => setForm({ ...form, selectors: { ...form.selectors, submit: event.target.value } })} /></label>
          {saveError && <p className="form-error" role="alert">{saveError}</p>}
          <div className="form-buttons">
            <button className="button" type="submit" disabled={saving}><StableLabel labels={[t('options.targets.save'), t('options.saving')]} index={saving ? 1 : 0} /></button>
            <button className="button subtle" type="button" onClick={() => { setForm(emptyTarget()); setMatchText(''); }}>{t('options.targets.clear')}</button>
          </div>
        </form>
      </details>

      <h4>{t('options.targets.sendHeading')}</h4>
      <label className="toggle">
        <input type="checkbox" checked={view.settings.returnAfterSend} onChange={event => {
          const checked = event.target.checked;
          void saveSettings(settings => { settings.returnAfterSend = checked; });
        }} />
        <span><strong>{t('options.targets.returnAfterSend')}</strong><small>{t('options.targets.returnAfterSendHint')}</small></span>
      </label>
    </dialog>
  );
}

function Recorder({ view, platform, recording, setRecording, onSaveWeb, onNative }: {
  view: SettingsView; platform: string;
  recording: { action: ActionInfo; combo: string | null; note: string };
  setRecording: (value: { action: ActionInfo; combo: string | null; note: string } | null) => void;
  onSaveWeb: () => void; onNative: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      const combo = comboFromEvent(event, platform);
      if (!combo) {
        if (!['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) setRecording({ ...recording, note: t('options.needModifier') });
        return;
      }
      const taken = view.actions.find(item => item.id !== recording.action.id && (item.nativeCombo === combo || item.webBinding === combo));
      const notes: string[] = [];
      if (taken) notes.push(t('options.recorder.taken', { name: taken.name }));
      const reserved = reservedReason(combo, platform);
      if (reserved) notes.push(reserved);
      notes.push(nativeEligible(combo, platform)
        ? t('options.recorder.nativeOk') : t('options.recorder.webOnly'));
      if (/Ctrl\+(Shift\+)?Minus$/.test(combo) && platform !== 'mac') notes.push(t('options.recorder.zoomOut'));
      setRecording({ ...recording, combo, note: notes.join(' ') });
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [view, platform, recording, setRecording]);

  const nativeOk = recording.combo ? nativeEligible(recording.combo, platform) : false;
  return (
    <dialog ref={ref} onClose={() => setRecording(null)}>
      <h3>{t('options.recorder.title', { name: recording.action.name })}</h3>
      <p>{t('options.recorder.lead')}</p>
      <p className="combo">{recording.combo ? displayCombo(recording.combo, platform) : t('options.recorder.waiting')}</p>
      <p className="note">{recording.note}</p>
      <div className="form-buttons">
        {nativeOk && recording.action.command && <button className="button" type="button" onClick={onNative}>{t('options.recorder.setInChrome')}</button>}
        {recording.combo && webEligible(recording.combo) && <button className="button" type="button" onClick={onSaveWeb}>{nativeOk ? t('options.recorder.webOnlyButton') : t('options.recorder.saveWeb')}</button>}
        <button className="button subtle" type="button" onClick={() => ref.current?.close()}>{t('options.cancel')}</button>
      </div>
    </dialog>
  );
}

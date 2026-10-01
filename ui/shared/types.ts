// Shapes returned by the service worker (src/controller.js). Kept in one place so the pages
// never reach into domain modules directly.
export type TransferMode = 'go' | 'fill' | 'send';
export type Capability = 'navigate' | 'fill' | 'send';

export interface ActionInfo {
  id: string; name: string; category: string; keywords: string[];
  command: boolean; web: boolean; panelInput: 'index' | null; requiresSelection: boolean;
  kind: string; mode: TransferMode | null; targetId: string | null; monogram: string;
  native: string; nativeCombo: string; suggested: string; webBinding: string; shadowed: boolean; conflict: boolean;
}
export interface HistoryEntry { tabId: number; cursor: number; current: boolean; title: string; url: string }
export interface TaskInfo {
  id: string; mode: TransferMode; targetName: string; status: string; message: string;
  text: string; preview: string; createdAt: number; failedAt?: number;
}
export interface CustomTarget {
  id: string; name: string; match: string[]; openUrl: string; capability: Capability;
  selectors: { input: string; submit: string };
}
export interface TargetInfo extends CustomTarget { builtin: boolean; site: string; origins: string[]; granted: boolean }
export interface Settings {
  version: number; locale: 'auto' | 'zh' | 'ja' | 'en'; returnAfterSend: boolean; defaultTargetId: string;
  pinnedActions: string[];
  webShortcuts: { bindings: Record<string, string>; disabledSites: string[] };
  targets: { enabled: Record<string, Capability>; custom: CustomTarget[] };
  overlay: { enabled: boolean; holdCode: string; holdMs: number; slots: (string | null)[] };
}
export interface ShortcutStatus {
  platform: string; granted: boolean;
  keymap: { map: Record<string, string>; shadowed: Record<string, string>; conflicts: Record<string, string> };
  native: Array<{ name: string; shortcut: string; combo: string }>;
}
export interface PanelState {
  windowId: number; cursor: number; entries: HistoryEntry[]; canBack: boolean; canForward: boolean;
  rightCount: number; tabCount: number; activeIndex: number; actions: ActionInfo[];
  tasks: TaskInfo[]; targets: TargetInfo[]; settings: Settings; platform: string;
  shortcuts: { granted: boolean; pageReady: boolean | null; webActive: boolean };
  license: LicenseView;
}
export interface SettingsView {
  settings: Settings; actions: ActionInfo[]; status: ShortcutStatus; targets: TargetInfo[]; commandIds: string[];
}
export interface ActionResult {
  ok: true; status?: string; message?: string; notify?: boolean; changed?: boolean; returned?: boolean; taskId?: string;
}
export interface UsageStatsData {
  version: number; startedAt: number | null; actions: Record<string, Record<string, number>>;
}
/** Local trial and cached purchase, as computed by src/license.js. */
export interface LicenseView {
  state: 'trial' | 'expired' | 'licensed' | 'revoked'; allowed: boolean;
  trialStarted: boolean; trialEndsAt: number | null;
  licenseKey: string | null; pendingPurchase: boolean; configured: boolean;
}
export interface CollectResult { status: 'none' | 'pending' | 'revoked' | 'activated'; licenseKey?: string; license: LicenseView }

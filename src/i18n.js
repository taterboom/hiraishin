// Translation for every context the extension runs in: the service worker, the domain modules,
// the React pages and the in-page wheel all import this one module. The locale is module state
// because each of those contexts has exactly one current language, and every call site then stays
// a plain `t('key')` instead of threading a translator through every function.
import { DICTIONARIES } from './locales/index.js';

export const LOCALES = /** @type {const} */ (['zh', 'ja', 'en']);
export const LOCALE_PREFERENCES = ['auto', ...LOCALES];
/** What a browser language outside Chinese, Japanese and English falls back to. */
export const FALLBACK_LOCALE = 'en';
/** BCP 47 tags for `<html lang>` and Intl. */
export const LOCALE_TAGS = { zh: 'zh-CN', ja: 'ja', en: 'en' };

/** Browser UI language → one of LOCALES. Every Chinese variant maps to the Simplified dictionary. */
export function localeFromLanguage(language) {
  const tag = String(language || '').toLowerCase();
  if (tag.startsWith('zh')) return 'zh';
  if (tag.startsWith('ja')) return 'ja';
  return FALLBACK_LOCALE;
}

/** A stored preference (`auto` or a locale) resolved against the browser's UI language. */
export function resolveLocale(preference, uiLanguage) {
  return LOCALES.includes(preference) ? preference : localeFromLanguage(uiLanguage);
}

/** The browser language as the extension APIs report it, falling back to the page's navigator. */
export function browserLanguage(api = globalThis.chrome) {
  try { return api?.i18n?.getUILanguage?.() || globalThis.navigator?.language || ''; } catch { return ''; }
}

let current = localeFromLanguage(browserLanguage());

/** Extension pages also label their <html>; a content script passes `labelDocument: false`,
 *  because there the document is somebody else's web page. */
export function setLocale(locale, { labelDocument = true } = {}) {
  current = LOCALES.includes(locale) ? locale : FALLBACK_LOCALE;
  if (labelDocument && globalThis.document?.documentElement) globalThis.document.documentElement.lang = LOCALE_TAGS[current];
  return current;
}

export const getLocale = () => current;

/** Apply a stored preference in one step; returns the resolved locale. */
export function applyLocalePreference(preference, api = globalThis.chrome) {
  return setLocale(resolveLocale(preference, browserLanguage(api)));
}

const interpolate = (text, params) => (params
  ? text.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])))
  : text);

/**
 * Look a key up in the current locale, then English, then give the key back so a missing entry
 * is visible instead of blank. `{name}` placeholders are filled from params.
 * @param {string} key @param {Record<string, string | number>} [params] @param {string} [locale]
 */
export function t(key, params, locale = current) {
  // English needs a singular form ("1 tab"); Chinese and Japanese do not, so a `.one` variant is
  // optional and only used when it exists and count is exactly 1.
  const one = params?.count === 1 ? DICTIONARIES[locale]?.[`${key}.one`] : undefined;
  const text = one ?? DICTIONARIES[locale]?.[key] ?? DICTIONARIES[FALLBACK_LOCALE]?.[key];
  return text === undefined ? key : interpolate(text, params);
}

/** True when the key exists in the current locale or the fallback. */
export const hasMessage = key => key in (DICTIONARIES[current] ?? {}) || key in (DICTIONARIES[FALLBACK_LOCALE] ?? {});

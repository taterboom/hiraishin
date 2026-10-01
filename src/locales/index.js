// Each area keeps its own dictionary file per language, so strings can be added to one area
// without touching another. `npm run check` verifies all three languages have the same keys
// and the same {placeholders}.
import zhCommon from './zh/common.js';
import zhBackground from './zh/background.js';
import zhOptions from './zh/options.js';
import zhPopup from './zh/popup.js';
import jaCommon from './ja/common.js';
import jaBackground from './ja/background.js';
import jaOptions from './ja/options.js';
import jaPopup from './ja/popup.js';
import enCommon from './en/common.js';
import enBackground from './en/background.js';
import enOptions from './en/options.js';
import enPopup from './en/popup.js';

export const DICTIONARIES = {
  zh: { ...zhCommon, ...zhBackground, ...zhOptions, ...zhPopup },
  ja: { ...jaCommon, ...jaBackground, ...jaOptions, ...jaPopup },
  en: { ...enCommon, ...enBackground, ...enOptions, ...enPopup },
};

/** Per-area dictionaries, for the check that keys do not collide across areas. */
export const AREAS = {
  zh: { common: zhCommon, background: zhBackground, options: zhOptions, popup: zhPopup },
  ja: { common: jaCommon, background: jaBackground, options: jaOptions, popup: jaPopup },
  en: { common: enCommon, background: enBackground, options: enOptions, popup: enPopup },
};

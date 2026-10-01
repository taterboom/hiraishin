import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { App } from './App';
import { applyLocalePreference, t } from '../../src/i18n.js';
import '../shared/action-mark.css';
import '../overlay/styles.css';
import './options.css';

// Browser language until the stored preference arrives with the settings view (see App).
applyLocalePreference('auto');
document.title = t('options.pageTitle');

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

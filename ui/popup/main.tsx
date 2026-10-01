import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { getLocale, setLocale } from '../../src/i18n.js';
import { App } from './App';
import '../shared/action-mark.css';
import '../overlay/styles.css';
import './popup.css';

// Until the saved preference arrives with the first state, the browser language applies; sync
// <html lang> to it now so the first paint is not labelled Chinese.
setLocale(getLocale());
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

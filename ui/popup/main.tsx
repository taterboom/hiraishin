import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { App } from './App';
import '../shared/action-mark.css';
import '../overlay/styles.css';
import './popup.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

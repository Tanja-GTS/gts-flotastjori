import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './ui-overrides.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import { theme } from './theme';
import { I18nProvider } from './i18n';


function showFatalError(err) {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  const target = document.getElementById('root') || document.body;
  const pre = document.createElement('pre');
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.fontFamily =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  pre.style.padding = '16px';
  pre.style.margin = '0';
  pre.style.color = '#111';
  pre.style.background = '#fff';
  pre.textContent = message;
  if (target) {
    target.innerHTML = '';
    target.appendChild(pre);
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    if (e?.error) showFatalError(e.error);
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (e?.reason) showFatalError(e.reason);
  });
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  showFatalError(new Error('Missing #root element'));
} else {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <MantineProvider theme={theme}>
          <I18nProvider>
            <Notifications position="top-right" />
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </I18nProvider>
        </MantineProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

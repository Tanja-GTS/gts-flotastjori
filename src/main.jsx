import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './ui-overrides.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { theme } from './theme';
import { I18nProvider } from './i18n';



ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MantineProvider theme={theme}>
      <I18nProvider>
        <Notifications position="top-right" />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </MantineProvider>
  </React.StrictMode>
);
